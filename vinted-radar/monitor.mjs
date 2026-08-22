import fs from 'node:fs/promises';

const BASE = new URL('./', import.meta.url);
const config = JSON.parse(await fs.readFile(new URL('./config.json', BASE), 'utf8'));
const stateUrl = new URL('./state.json', BASE);
const inventoryUrl = new URL('./inventory.json', BASE);
const state = await loadJson(stateUrl, { items: {}, market: {}, sellers: {}, images: {} });
const inventory = await loadJson(inventoryUrl, { items: [] });
const webhook = process.env.DISCORD_WEBHOOK_URL;
const testMode = process.env.TEST_MODE === 'true';
const UA = 'Mozilla/5.0 (compatible; DansVaultRadar/4.0; +https://github.com/TragiicMyst/dans-vault)';

if (!webhook) throw new Error('Missing DISCORD_WEBHOOK_URL secret');

if (testMode) {
  await sendTest(webhook);
  console.log('Bargain Finder test alert sent.');
  process.exit(0);
}

const now = new Date();
const maxAlerts = Number(config.maxAlertsPerRun ?? 10);
const candidatesOut = [];
const targetSizes = [...new Set([...(config.sizes ?? []), 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5])];

for (const search of config.searches ?? []) {
  if (!config.enabled || candidatesOut.length >= maxAlerts * 3) break;
  if ((config.blacklistModels ?? []).includes(search.name)) continue;

  try {
    const buyHtml = await fetchText(search.buyUrl);
    const candidates = extractItems(buyHtml);
    if (!candidates.length) continue;

    const cache = state.market[search.name];
    const cacheAge = cache?.updatedAt ? (Date.now() - Date.parse(cache.updatedAt)) / 3600000 : Infinity;
    if (!cache || cacheAge >= Number(config.marketCacheHours ?? 6)) {
      const marketHtml = await fetchText(search.marketUrl).catch(() => '');
      state.market[search.name] = {
        updatedAt: now.toISOString(),
        medianBySize: buildMarketMedianBySize(extractItems(marketHtml))
      };
    }

    for (const item of candidates) {
      const prior = state.items[item.id];
      const size = inferSize(item.fullText, targetSizes);
      const text = `${item.title} ${item.fullText}`.toLowerCase();

      if (containsBlockedKeyword(text, config.avoidKeywords ?? [])) {
        remember(item, prior, now, { blockedReason: 'keyword', size });
        continue;
      }

      if (hasBadCondition(text, config.condition?.avoid ?? [])) {
        remember(item, prior, now, { blockedReason: 'condition', size });
        continue;
      }

      if (size === null || !targetSizes.map(String).includes(String(size))) {
        remember(item, prior, now, { blockedReason: 'size' });
        continue;
      }

      if (Number.isFinite(Number(search.maxPrice)) && item.price > Number(search.maxPrice)) continue;

      const condition = classifyCondition(text, config.condition ?? {});
      if (condition === 'unknown') {
        remember(item, prior, now, { blockedReason: 'condition-not-confirmed', size });
        continue;
      }

      const marketMedian = state.market[search.name]?.medianBySize?.[String(size)] ?? null;
      const resale = resaleEstimate(search.name, size, marketMedian, config);
      if (!resale || !Number.isFinite(resale)) continue;

      const costs = config.costs ?? {};
      const packaging = Number(costs.packaging ?? 0.8);
      const cleaningTable = costs.cleaning ?? {};
      const cleaning = Number(cleaningTable[condition] ?? cleaningTable.veryGood ?? cleaningTable.unknown ?? 0.75);
      const sellingFee = Number(costs.vintedSellingFee ?? 0);
      const netProfit = round2(resale - item.price - packaging - cleaning - sellingFee);
      const roi = item.price > 0 ? round2((netProfit / item.price) * 100) : 0;
      const demand = seasonalDemand(search.name, config);
      const fakeRisk = fakeRiskLevel(item, text, resale);
      const inventoryCount = countInStock(inventory.items ?? [], search.name);
      const strategy = config.models?.[search.name]?.strategy ?? config.strategy?.default ?? 'balanced';

      const marginScore = clamp(((resale - item.price) / Math.max(resale, 1)) * 100, 0, 100);
      const roiScore = clamp(roi, 0, 200) / 2;
      const demandScore = clamp(demand, 50, 115);
      const conditionScore = condition === 'new' ? 100 : 92;
      const riskScore = fakeRisk.level === 'HIGH' ? 20 : fakeRisk.level === 'MEDIUM' ? 75 : 100;
      const profile = config.strategy?.profiles?.[strategy] ?? { marginWeight: 0.45, roiWeight: 0.25, demandWeight: 0.15, conditionWeight: 0.10, riskWeight: 0.05 };

      let buyScore = marginScore * profile.marginWeight + roiScore * profile.roiWeight + demandScore * profile.demandWeight + conditionScore * profile.conditionWeight + riskScore * profile.riskWeight;
      if (inventoryCount >= Number(config.models?.[search.name]?.maxInventory ?? 3)) buyScore -= 8;
      else if (inventoryCount === Number(config.models?.[search.name]?.maxInventory ?? 3) - 1) buyScore -= 3;
      if (netProfit >= 20) buyScore += 4;
      if (netProfit >= 30) buyScore += 4;
      if (roi >= 80) buyScore += 3;
      if (fakeRisk.level === 'HIGH') buyScore -= 12;

      buyScore = clamp(Math.round(buyScore), 0, 100);

      const priceDrop = prior?.lastPrice ? getPriceDrop(prior.lastPrice, item.price, config.priceDropAlert ?? {}) : null;
      const oldAlert = prior?.lastAlertedAt ? Date.parse(prior.lastAlertedAt) : 0;
      const recentlyAlerted = oldAlert && Date.now() - oldAlert < 2 * 3600000 && !priceDrop;
      const effectiveThreshold = Number(search.minScore ?? 76);
      const strongDeal = netProfit >= 20 && roi >= 55 && fakeRisk.level !== 'HIGH';
      const exceptionalDeal = netProfit >= 30 && roi >= 80 && fakeRisk.level !== 'HIGH';
      const shouldAlert = !recentlyAlerted && (buyScore >= effectiveThreshold || strongDeal || exceptionalDeal);

      remember(item, prior, now, {
        size, condition, buyScore, resale, netProfit, roi, fakeRisk,
        lastPriceDrop: priceDrop,
        lastSeenAt: now.toISOString(),
        lastPrice: item.price,
        lastAlertedAt: shouldAlert ? now.toISOString() : (prior?.lastAlertedAt ?? null)
      });

      if (!shouldAlert) continue;
      candidatesOut.push({ searchName: search.name, item, size, condition, resale, netProfit, roi, buyScore, fakeRisk, demand, strategy, priceDrop, exceptionalDeal });
    }
  } catch (error) {
    console.warn(`${search.name}: ${error.message}`);
  }
}

candidatesOut.sort((a, b) => {
  if (Number(b.exceptionalDeal) !== Number(a.exceptionalDeal)) return Number(b.exceptionalDeal) - Number(a.exceptionalDeal);
  if (b.buyScore !== a.buyScore) return b.buyScore - a.buyScore;
  return b.netProfit - a.netProfit;
});

const alerts = candidatesOut.slice(0, maxAlerts);
for (const d of alerts) {
  await sendDiscord(webhook, d);
}

state.updatedAt = now.toISOString();
await fs.writeFile(stateUrl, JSON.stringify(state, null, 2) + '\n');
console.log(`Radar complete. Evaluated ${candidatesOut.length} qualifying bargains; sent ${alerts.length} alert(s).`);

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function extractItems(html) {
  const found = new Map();
  const re = /href=["'](\/items\/([0-9]+)(?:-[^"']*)?)[^"']*["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[2];
    const path = m[1].split('?')[0];
    const context = stripTags(html.slice(m.index, Math.min(html.length, m.index + 7000))).replace(/\s+/g, ' ').trim();
    const pm = context.match(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    if (!pm) continue;
    const title = decodeHtml(path.replace(/^\/items\/[0-9]+-?/, '').replace(/-/g, ' ').trim());
    const conditionBits = [];
    for (const key of ['condition','itemCondition','item_condition']) {
      const rx = new RegExp(`"${key}"\\s*:\s*"([^"]+)"`, 'i');
      const cm = context.match(rx);
      if (cm?.[1]) conditionBits.push(cm[1]);
    }
    found.set(id, {
      id,
      title,
      price: Number(pm[1]),
      fullText: `${title} ${conditionBits.join(' ')} ${context}`,
      url: `https://www.vinted.co.uk${path}`
    });
  }
  return [...found.values()].slice(0, 80);
}

function inferSize(text, sizes) {
  const lower = text.toLowerCase();
  const aliases = {
    XS: ['xs', 'extra small'], S: ['size s', ' small '], M: ['size m', ' medium '], L: ['size l', ' large '],
    XL: ['xl', 'extra large'], XXL: ['xxl', '2xl', 'extra extra large']
  };
  for (const size of sizes) {
    const raw = String(size);
    if (/^\d+(?:\.5)?$/.test(raw)) {
      if (new RegExp(`\\b(?:uk\\s*)?${raw.replace('.', '\\.?')}\\b`, 'i').test(lower)) return Number(raw);
    } else if (aliases[raw.toUpperCase()]?.some((x) => lower.includes(x))) {
      return raw.toUpperCase();
    }
  }
  return null;
}

function classifyCondition(text, cfg) {
  const newer = cfg.new ?? ['brand new','new with tags','new without tags','nwt'];
  const veryGood = cfg.veryGood ?? ['very good','excellent condition','worn once','worn twice','worn a few times'];
  if (newer.some((word) => text.includes(word))) return 'new';
  if (veryGood.some((word) => text.includes(word))) return 'veryGood';
  return 'unknown';
}

function containsBlockedKeyword(text, words) {
  return words.some((word) => {
    const w = String(word).toLowerCase().trim();
    if (!w) return false;
    if (w.length <= 3 && !w.includes(' ')) return new RegExp(`(^|[^a-z0-9])${escapeRegExp(w)}($|[^a-z0-9])`, 'i').test(text);
    return text.includes(w);
  });
}

function hasBadCondition(text, words) {
  return words.some((word) => {
    const w = String(word).toLowerCase().trim();
    if (!w || w === 'good') return false;
    if (w === 'good condition') return /\bgood condition\b/i.test(text);
    return text.includes(w);
  }) || /\bcondition\s*[:\-]?\s*good\b/i.test(text);
}

function resaleEstimate(modelName, size, marketMedian, cfg) {
  const model = cfg.models?.[modelName] ?? {};
  const bySize = model.resaleBySize ?? {};
  let baseline = Number(bySize[String(size)] ?? model.baselineResale ?? 0);
  if (!baseline) {
    const numeric = Number(size);
    const nearest = Object.keys(bySize).map(Number).filter(Number.isFinite).sort((a,b)=>Math.abs(a-numeric)-Math.abs(b-numeric))[0];
    baseline = nearest !== undefined ? Number(bySize[String(nearest)]) : 0;
  }
  if (!marketMedian || marketMedian <= 0) return round2(baseline);
  const blended = baseline * 0.60 + marketMedian * 0.90 * 0.40;
  return round2(clamp(blended, baseline * 0.88, baseline * 1.12));
}

function buildMarketMedianBySize(items) {
  const grouped = {};
  for (const item of items) {
    const size = inferSize(item.fullText, targetSizes);
    if (size === null || item.price <= 0 || item.price > 300) continue;
    (grouped[String(size)] ??= []).push(item.price);
  }
  const out = {};
  for (const [size, prices] of Object.entries(grouped)) out[size] = round2(median(prices));
  return out;
}

function seasonalDemand(modelName, cfg) {
  const month = new Date().getMonth() + 1;
  for (const season of Object.values(cfg.seasonalDemand ?? {})) {
    if (season.months?.includes(month)) return round2((season[modelName] ?? 1) * 100);
  }
  return 100;
}

function fakeRiskLevel(item, text, resale) {
  const wording = ['replica','fake','counterfeit','1:1','ua ','ua-','rep ','mirror','pk batch','not authentic'].filter((x) => text.includes(x));
  if (wording.length) return { level: 'HIGH', note: 'Explicit suspicious-authenticity wording detected' };
  if (resale > 0 && item.price <= resale * 0.30) return { level: 'MEDIUM', note: 'Price is unusually low versus expected resale; inspect photos, code and seller history' };
  if (resale > 0 && item.price <= resale * 0.45) return { level: 'LOW', note: 'Strong bargain price; manual authenticity check still recommended' };
  return { level: 'LOW', note: 'No configured major authenticity red flags detected' };
}

function getPriceDrop(previousPrice, currentPrice, settings) {
  if (!settings?.enabled || !previousPrice || currentPrice >= previousPrice) return null;
  const amount = previousPrice - currentPrice;
  const percent = amount / previousPrice;
  if (amount < Number(settings.minDropAmount ?? 5) || percent < Number(settings.minDropPercent ?? 0.12)) return null;
  return { from: round2(previousPrice), to: round2(currentPrice), amount: round2(amount), percent };
}

async function sendDiscord(url, d) {
  const resaleRange = `£${Math.max(0, d.resale - 5).toFixed(0)}–£${Math.round(d.resale + 5)}`;
  const verdict = d.exceptionalDeal ? '🔥 **EXCEPTIONAL BARGAIN**' : d.buyScore >= 85 ? '🟢 **STRONG BUY**' : '🟡 **GOOD BUY**';
  const drop = d.priceDrop ? `\n📉 **Price drop:** £${d.priceDrop.from.toFixed(2)} → **£${d.priceDrop.to.toFixed(2)}**` : '';
  const body = {
    username: "Dan's Vault Bargain Finder",
    embeds: [{
      title: '🚨 NEW BARGAIN FOUND 🔥',
      description: `**⭐ ${d.searchName.toUpperCase()}**\n**${d.item.title}**\n\n🏷️ **Buy price:** £${d.item.price.toFixed(2)}\n📏 **Size:** ${d.size}\n📦 **Condition:** ${d.condition === 'new' ? '🆕 New / NWT / NWOT' : '✨ Very good'}\n📈 **Estimated resale:** ${resaleRange}\n💰 **Estimated net profit:** £${d.netProfit.toFixed(2)}\n📊 **ROI:** ${d.roi.toFixed(0)}%\n🎯 **Buy score:** ${d.buyScore}/100\n\n${verdict}${drop}\n🛡️ **Authenticity screen:** ${d.fakeRisk.level}\n📈 **Demand factor:** ${d.demand.toFixed(0)}/100\n⚡ **Strategy:** ${d.strategy}\n\n${d.fakeRisk.note}\n\n*Price and resale estimates are buying signals, not guarantees. Check photos, authenticity, condition and current sold prices before buying.*`,
      url: d.item.url,
      color: d.exceptionalDeal ? 3066993 : d.buyScore >= 85 ? 3447003 : 16776960,
      footer: { text: "Dan's Vault • Bargain Finder" },
      timestamp: new Date().toISOString()
    }]
  };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Discord webhook HTTP ${r.status}`);
}

async function sendTest(url) {
  const body = { username: "Dan's Vault Bargain Finder", embeds: [{
    title: '🧪 BARGAIN FINDER TEST',
    description: '✅ **Discord webhook connected**\n\nThe Vinted Bargain Finder is ready.\n\n🔎 Nike trainers + Tech Fleece + jackets + tracksuits + activewear\n✨ Conditions: Very good / New with tags / New without tags\n🎯 Strong deals can alert even when the model score is borderline.\n\n*Test message — not a real bargain.*',
    color: 3447003, timestamp: new Date().toISOString(), footer: { text: "Dan's Vault • Bargain Finder" }
  }] };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Discord webhook HTTP ${r.status}`);
}

function remember(item, prior, now, extra = {}) {
  state.items[item.id] = { ...prior, ...extra, lastPrice: item.price, lastSeenAt: now.toISOString() };
}
function countInStock(items, model) { return items.filter((x) => x.model === model && x.status !== 'sold').length; }
function median(values) { const s = [...values].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length % 2 ? s[m] : (s[m-1]+s[m])/2; }
function round2(n) { return Math.round(n * 100) / 100; }
function clamp(n,min,max) { return Math.max(min, Math.min(max,n)); }
function stripTags(s) { return s.replace(/<[^>]+>/g,' '); }
function decodeHtml(s) { return s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>'); }
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
async function loadJson(url,fallback) { try { return JSON.parse(await fs.readFile(url,'utf8')); } catch { return fallback; } }
