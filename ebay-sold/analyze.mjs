import fs from 'node:fs/promises';

const BASE = new URL('./', import.meta.url);
const dataDir = new URL('./data/', BASE);
const datasetPath = new URL('./dataset.json', BASE);

const configured = JSON.parse(await fs.readFile(datasetPath, 'utf8'));
const files = await fs.readdir(dataDir).catch(() => []);
const csv = files.find((f) => f.toLowerCase().endsWith('.csv'));

let data = configured.models;
let sourceLabel = configured.source;

if (csv) {
  const text = await fs.readFile(new URL(csv, dataDir), 'utf8');
  const rows = parseCsv(text);
  const analysed = analyseCsv(rows);
  if (Object.keys(analysed).length) {
    data = analysed;
    sourceLabel = `Fresh eBay Product Research CSV: ${csv}`;
  }
}

const report = buildReport(data, sourceLabel);
console.log(JSON.stringify(report, null, 2));

function analyseCsv(rows) {
  if (!rows.length) return {};
  const keys = Object.keys(rows[0]);
  const pick = (...names) => {
    const exact = new Map(keys.map((k) => [normal(k), k]));
    for (const n of names) if (exact.has(normal(n))) return exact.get(normal(n));
    return keys.find((k) => names.some((n) => normal(k).includes(normal(n))));
  };
  const priceKey = pick('sold price', 'sale price', 'price', 'soldprice');
  const sizeKey = pick('size', 'uk size', 'item size');
  const colourKey = pick('colour', 'color', 'colourway', 'colorway');
  const titleKey = pick('title', 'item title', 'product', 'product title');
  const conditionKey = pick('condition', 'item condition');
  const dateKey = pick('sold date', 'sale date', 'date', 'end date');
  if (!priceKey || !titleKey) return {};

  const sales = rows.map((r) => ({
    price: money(r[priceKey]), size: clean(r[sizeKey]), colour: clean(r[colourKey]),
    title: clean(r[titleKey]), condition: clean(r[conditionKey]), date: parseDate(r[dateKey])
  })).filter((x) => Number.isFinite(x.price) && x.price > 0 && x.price < 1000);
  if (!sales.length) return {};

  const modelNames = ['Nike P-6000', 'Nike Air Max Plus / TN', 'Nike Pegasus Premium', 'Nike Shox TL', 'Nike Vomero 18 Plus'];
  const out = {};
  for (const model of modelNames) {
    const subset = sales.filter((x) => modelMatch(x.title, model));
    if (!subset.length) continue;
    const prices = subset.map((x) => x.price);
    const sorted = [...prices].sort((a, b) => a - b);
    const recent = subset.filter((x) => x.date && Date.now() - x.date.getTime() <= 30 * 86400000);
    const older = subset.filter((x) => x.date && Date.now() - x.date.getTime() > 30 * 86400000 && Date.now() - x.date.getTime() <= 90 * 86400000);
    const trend = recent.length && older.length ? ((average(recent.map((x) => x.price)) - average(older.map((x) => x.price))) / average(older.map((x) => x.price))) * 100 : null;
    out[model] = {
      confidence: subset.length >= 50 ? 'high' : subset.length >= 15 ? 'medium' : 'low',
      avgSold: average(prices), medianSold: median(prices),
      p10: percentile(sorted, 0.10), p90: percentile(sorted, 0.90),
      salesCount: subset.length, trend30d: trend,
      examples: groups(subset, 'colour').slice(0, 10).map((x) => ({ label: x.name, avgSold: x.avg, sales: x.count })),
      sizeExamples: groups(subset, 'size').slice(0, 10).map((x) => ({ label: x.name, avgSold: x.avg, sales: x.count }))
    };
  }
  return out;
}

function buildReport(models, source) {
  const sections = Object.entries(models).map(([name, d]) => {
    const base = d.medianSold ?? d.avgSold ?? null;
    const buy = base ? Math.max(0, base * 0.55 - 3) : null;
    const strong = base ? Math.max(0, base * 0.48) : null;
    const trend = Number.isFinite(d.trend30d) ? `${d.trend30d >= 0 ? '+' : ''}${d.trend30d.toFixed(1)}%` : 'n/a';
    const top = (d.examples ?? []).slice(0, 5).map((x) => {
      const label = x.label ?? x.name ?? 'Unknown';
      const avg = Number.isFinite(Number(x.avgSold)) ? Number(x.avgSold) : Number(x.avg);
      const sales = x.sales ?? x.count ?? '';
      return `• ${label}: £${Number.isFinite(avg) ? avg.toFixed(0) : 'n/a'} avg${sales !== '' ? ` (${sales})` : ''}`;
    }).join('\n') || 'No colourway breakdown';
    const sizes = (d.sizeExamples ?? []).slice(0, 5).map((x) => {
      const label = x.label ?? x.size ?? x.name ?? 'Unknown';
      const avgValue = x.avgSold ?? x.avg ?? x.sold;
      const avg = Number(avgValue);
      const sales = x.sales ?? x.count ?? '';
      return `• ${label}: £${Number.isFinite(avg) ? avg.toFixed(0) : 'n/a'} avg${sales !== '' ? ` (${sales})` : ''}`;
    }).join('\n') || 'No size breakdown';
    return `**${name}** • ${String(d.confidence ?? 'unknown').toUpperCase()} CONFIDENCE\n💷 Avg £${Number(d.avgSold ?? 0).toFixed(2)}${d.medianSold ? ` • Median £${Number(d.medianSold).toFixed(2)}` : ''}\n📈 30d trend: ${trend}${d.sellThrough ? ` • Sell-through ${(d.sellThrough * 100).toFixed(1)}%` : ''}\n📦 Sales observed: ${d.salesCount ?? d.totalSellers ?? 'n/a'}${d.totalSellers ? ` • Sellers ${d.totalSellers}` : ''}\n\n🎨 **Top colour/model signals**\n${top}\n\n📏 **Size signals**\n${sizes}\n\n🎯 **Indicative max buy:** £${(buy ?? 0).toFixed(0)}\n🔥 **Strong-buy buy price:** £${(strong ?? 0).toFixed(0)}`;
  }).join('\n\n━━━━━━━━━━━━━━━━━━\n\n');

  return {
    title: "📊 DAN'S VAULT • eBAY SOLD TRAINERS",
    description: `${sections}\n\n*Source: ${source}. Estimates are conservative buying signals, not guarantees. Single-sale and low-volume colourways are marked down in confidence.*`
  };
}

function modelMatch(title, model) {
  const t = title.toLowerCase();
  const map = {
    'Nike P-6000': ['p-6000', 'p6000'],
    'Nike Air Max Plus / TN': ['air max plus', 'air max tn', 'tn ', 'tn-'],
    'Nike Pegasus Premium': ['pegasus premium'],
    'Nike Shox TL': ['shox tl'],
    'Nike Vomero 18 Plus': ['vomero 18 plus']
  };
  return map[model].some((needle) => t.includes(needle));
}
function groups(arr, key) {
  const map = {};
  for (const x of arr) {
    const value = x[key];
    if (!value) continue;
    (map[value] ??= []).push(x);
  }
  return Object.entries(map).map(([name, rows]) => ({ name, count: rows.length, avg: average(rows.map((x) => x.price)), median: median(rows.map((x) => x.price)) })).sort((a, b) => b.count - a.count);
}
function normal(v) { return String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function clean(v) { return String(v ?? '').trim(); }
function money(v) { if (v == null) return NaN; return Number(String(v).replace(/[^0-9.\-]/g, '')); }
function parseDate(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
function average(a) { return a.reduce((s, x) => s + x, 0) / a.length; }
function median(a) { const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function percentile(a, p) { if (!a.length) return 0; const i = (a.length - 1) * p, b = Math.floor(i), r = i - b; return a[b] + ((a[b + 1] ?? a[b]) - a[b]) * r; }
function parseCsv(s) { const lines = s.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean); if (!lines.length) return []; const head = split(lines[0]); return lines.slice(1).map((line) => { const vals = split(line), o = {}; head.forEach((h, i) => { o[h] = vals[i] ?? ''; }); return o; }); }
function split(line) { const out = []; let cur = '', quoted = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; } else if (c === ',' && !quoted) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; }
