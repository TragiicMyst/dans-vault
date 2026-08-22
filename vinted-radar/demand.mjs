import fs from 'node:fs/promises';

const BASE = new URL('./', import.meta.url);
const config = JSON.parse(await fs.readFile(new URL('./demand-config.json', BASE), 'utf8'));
const statePath = new URL('./demand-state.json', BASE);
const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
const webhook = process.env.DISCORD_DEMAND_WEBHOOK_URL;

if (!webhook) throw new Error('Missing DISCORD_DEMAND_WEBHOOK_URL secret');

const ua = 'Mozilla/5.0 (compatible; DansVaultDemandRadar/1.0; +https://github.com/TragiicMyst/dans-vault)';
const month = new Date().getMonth() + 1;
const season = config.seasonWeights[String(month)] ?? config.seasonWeights['8'];

const nikeHtml = await Promise.all(config.nikeSources.map(async (url) => {
  try { return await fetchText(url); } catch { return ''; }
}));
const nikeText = nikeHtml.join('\n').toLowerCase();

const results = [];
for (const item of config.items) {
  try {
    const url = `https://www.vinted.co.uk/catalog?search_text=${encodeURIComponent(item.query)}&order=newest_first`;
    const html = await fetchText(url);
    const listings = extractListings(html);
    const prices = listings.map(x => x.price).filter(Number.isFinite).filter(x => x > 0 && x < 1000);
    const median = medianOf(prices);
    const belowTarget = prices.filter(p => p <= item.targetBuy).length;
    const cheapShare = prices.length ? belowTarget / prices.length : 0;
    const bestseller = bestsellerNear(nikeText, item.query);
    const seasonal = season[item.category] ?? 1;

    const previous = state.items[item.name];
    const priceTrend = previous?.median && median ? clamp(((previous.median - median) / previous.median) * 100, -50, 50) : 0;
    const supply = clamp(listings.length / 60, 0, 1);

    // Demand is a practical resale signal, not a claim of exact sales volume.
    const demandScore = Math.round(clamp(
      38 * (seasonal / 1.30) +
      22 * (bestseller ? 1 : 0.35) +
      18 * (1 - supply * 0.45) +
      12 * (cheapShare > 0 ? Math.min(cheapShare / 0.30, 1) : 0) +
      10 * (priceTrend > 0 ? Math.min(priceTrend / 10, 1) : 0),
      0, 100
    ));

    const confidence = listings.length >= 20 && median ? (bestseller ? 'HIGH' : 'MEDIUM') : 'LOW';
    const action = demandScore >= 80 ? '🔥 PRIORITY BUY' : demandScore >= 70 ? '🟢 BUY IF CHEAP' : demandScore >= 62 ? '🟡 WATCH' : '🔴 LOW PRIORITY';

    results.push({
      ...item,
      listings: listings.length,
      median,
      belowTarget,
      cheapShare,
      bestseller,
      seasonal,
      priceTrend,
      demandScore,
      confidence,
      action
    });
  } catch (error) {
    console.warn(`${item.name}: ${error.message}`);
  }
}

results.sort((a, b) => b.demandScore - a.demandScore);
const top = results.slice(0, config.maxResults);
const priority = top.filter(x => x.demandScore >= config.minScoreToHighlight).slice(0, 5);

const lines = top.map((x, i) => {
  const med = x.median ? `£${x.median.toFixed(0)}` : 'n/a';
  const trend = x.priceTrend > 1 ? `↗ ${x.priceTrend.toFixed(0)}%` : x.priceTrend < -1 ? `↘ ${Math.abs(x.priceTrend).toFixed(0)}%` : '→ flat';
  const retail = x.bestseller ? ' • Nike bestseller signal' : '';
  return `**${i + 1}. ${x.name}** — **${x.demandScore}/100** ${x.action}\n   📦 ${x.listings} live Vinted listings • market median ${med} • target buy £${x.targetBuy}\n   📈 Price trend ${trend} • 🗓️ seasonal ${x.category}${retail} • confidence ${x.confidence}`;
});

const buyLine = priority.length
  ? priority.map(x => `**${x.name}** (£${x.targetBuy} or less)`).join(' • ')
  : 'No high-confidence priority buys today.';

const body = {
  username: "Dan's Vault Demand Radar",
  embeds: [{
    title: '📈 DAN\'S VAULT • CURRENT NIKE DEMAND',
    description: `Daily UK resale-demand scan for **Nike only**.\n\n🎯 **Best current buy targets:** ${buyLine}\n\n${lines.join('\n\n')}\n\n*Demand score combines current Vinted market observations, Nike retail bestseller signals, seasonal demand and price movement. It is a buying signal, not guaranteed sales volume.*`,
    color: 3447003,
    footer: { text: "Dan's Vault • Nike Demand Radar • Daily" },
    timestamp: new Date().toISOString()
  }]
};

const response = await fetch(webhook, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});
if (!response.ok) throw new Error(`Discord webhook HTTP ${response.status}`);

state.updatedAt = new Date().toISOString();
for (const x of results) {
  state.items[x.name] = {
    median: x.median,
    demandScore: x.demandScore,
    listings: x.listings,
    bestseller: x.bestseller,
    updatedAt: state.updatedAt
  };
}
await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
console.log(`Nike demand radar sent ${top.length} ranked items.`);

async function fetchText(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': ua, 'Accept-Language': 'en-GB,en;q=0.9' },
    redirect: 'follow'
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function extractListings(html) {
  const found = new Map();
  const re = /href=["'](\/items\/([0-9]+)(?:-[^"']*)?)[^"']*["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[2];
    const path = m[1].split('?')[0];
    const context = stripTags(html.slice(m.index, Math.min(html.length, m.index + 4500))).replace(/\s+/g, ' ');
    const price = context.match(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    if (!price) continue;
    found.set(id, { id, price: Number(price[1]), url: `https://www.vinted.co.uk${path}` });
  }
  return [...found.values()].slice(0, 60);
}

function stripTags(s) { return s.replace(/<[^>]+>/g, ' '); }
function medianOf(a) { if (!a.length) return null; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function clamp(n,min,max) { return Math.max(min, Math.min(max,n)); }
function bestsellerNear(text, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const idx = text.indexOf(words[0]);
  if (idx < 0) return false;
  const window = text.slice(Math.max(0, idx - 500), idx + 900);
  return window.includes('bestseller');
}
