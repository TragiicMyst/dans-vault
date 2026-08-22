import fs from 'node:fs/promises';

const BASE = new URL('./', import.meta.url);
const config = JSON.parse(await fs.readFile(new URL('./config.json', BASE), 'utf8'));
const stateUrl = new URL('./state.json', BASE);
const inventoryUrl = new URL('./inventory.json', BASE);
const state = await loadJson(stateUrl, {
  items: {},
  market: {},
  sellers: {},
  images: {},
  cursor: 0,
  freshness: { version: 2, bootstrapped: false, frontiers: {}, lastScanAt: null }
});
const inventory = await loadJson(inventoryUrl, { items: [] });
const webhook = process.env.DISCORD_WEBHOOK_URL;
const testMode = process.env.TEST_MODE === 'true';
const UA = 'Mozilla/5.0 (compatible; DansVaultFreshRadar/6.0; +https://github.com/TragiicMyst/dans-vault)';
const MAX_AGE_MINUTES = Number(config.freshness?.maxAgeMinutes ?? 12);
const MAX_ITEMS_PER_SEARCH = Number(config.freshness?.itemsPerSearch ?? 40);

if (!webhook) throw new Error('Missing DISCORD_WEBHOOK_URL secret');
if (testMode) {
  await sendTest(webhook);
  process.exit(0);
}

state.freshness ??= { version: 2, bootstrapped: false, frontiers: {}, lastScanAt: null };
if (state.freshness.version !== 2) {
  state.freshness = { version: 2, bootstrapped: false, frontiers: {}, lastScanAt: null };
}

const searches = config.searches ?? [];
const targetSizes = [...new Set([...(config.sizes ?? []), 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5])];
const now = new Date();
const qualifying = [];
const bootstrapping = state.freshness.bootstrapped !== true;

for (const search of searches) {
  if (!config.enabled) break;
  if ((config.blacklistModels ?? []).includes(search.name)) continue;

  try {
    const html = await fetchText(search.buyUrl);
    const candidates = extractItems(html, MAX_ITEMS_PER_SEARCH);
    if (!candidates.length) continue;

    const cache = state.market[search.name];
    const cacheAge = cache?.updatedAt ? (Date.now() - Date.parse(cache.updatedAt)) / 3600000 : Infinity;
    if (!cache || cacheAge >= Number(config.marketCacheHours ?? 6)) {
      const marketHtml = await fetchText(search.marketUrl).catch(() => '');
      state.market[search.name] = {
        updatedAt: now.toISOString(),
        medianBySize: buildMarketMedianBySize(extractItems(marketHtml, MAX_ITEMS_PER_SEARCH))
      };
    }

    const frontier = state.freshness.frontiers[search.name];
    let maxId = frontier?.maxId ? String(frontier.maxId) : null;

    for (const item of candidates) {
      const prior = state.items[item.id];
      const text = `${item.title} ${item.fullText}`.toLowerCase();
      const size = inferSize(item.fullText, targetSizes);
      const firstSeen = !prior;
      const idIsNewerThanFrontier = maxId ? compareNumericIds(item.id, maxId) > 0 : false;
      const ageFresh = item.ageMinutes !== null && item.ageMinutes <= MAX_AGE_MINUTES;
      const freshnessSignal = ageFresh || (item.ageMinutes === null && idIsNewerThanFrontier);

      if (bootstrapping) {
        remember(item, prior, { size, bootstrapSeen: true, lastSeenAt: now.toISOString() });
        maxId = maxId === null || compareNumericIds(item.id, maxId) > 0 ? String(item.id) : maxId;
        continue;
      }

      if (!firstSeen) {
        remember(item, prior, { lastSeenAt: now.toISOString(), lastPrice: item.price });
        continue;
      }

      if (!freshnessSignal) {
        remember(item, prior, { blockedReason: 'stale-or-no-freshness-signal', size, lastSeenAt: now.toISOString() });
        maxId = maxId === null || compareNumericIds(item.id, maxId) > 0 ? String(item.id) : maxId;
        continue;
      }

      if (containsBlockedKeyword(text, config.avoidKeywords ?? [])) {
        remember(item, prior, { blockedReason: 'keyword', size, lastSeenAt: now.toISOString() });
        maxId = maxId === null || compareNumericIds(item.id, maxId) > 0 ? String(item.id) : maxId;
        continue;
      }
      if (hasBadCondition(text, config.condition?.avoid ?? [])) {
        remember(item, prior, { blockedReason: 'condition', size, lastSeenAt: now.toISOString() });
        maxId = maxId === null || compareNumericIds(item.id, maxId) > 0 ? String(item.id) : maxId;
        continue;
      }
      if (size === null) {
        remember(item, prior, { blockedReason: 'size', lastSeenAt: now.toISOString() });
        maxId = maxId === null || compareNumericIds(item.id, maxId) > 0 ? String(item.id) : maxId;
        continue;
      }
      if (Number.isFinite(Number(search.maxPrice)) && item.price > Number(search.maxPrice)) {
        maxId = maxId === null || compareNumericIds(item.id, maxId) > 0 ? String(item.id) : maxId;
        remember(item, prior, { blockedReason: 'price', size, lastSeenAt: now.toISOString() });
        continue;
      }

      // STRICT CONDITION FILTER: only New with tags / New without tags.
      let condition = classifyCondition(text);
      if (condition === 'unknown' && (item.price <= Number(search.maxPrice ?? item.price) * 0.75 || item.price <= 40)) {
        const detail = await fetchText(item.url).catch(() => '');
        if (detail) {
          const detailText = stripTags(detail).replace(/\s+/g, ' ').toLowerCase();
          if (!hasBadCondition(detailText, config.condition?.avoid ?? [])) condition = classifyCondition(detailText);
        }
      }
      if (condition === 'unknown') {
        remember(item, prior, { blockedReason: 'condition-not-confirmed', size, lastSeenAt: now.toISOString() });
        maxId = maxId === null || compareNumericIds(item.id, maxId) > 0 ? String(item.id) : maxId;
        continue;
      }

      const market = state.market[search.name]?.medianBySize?.[String(size)] ?? null;
      const resale = resaleEstimate(search.name, size, market, config);
      if (!resale) {
        remember(item, prior, { blockedReason: 'no-resale-baseline', size, condition, lastSeenAt: now.toISOString() });
        maxId = maxId === null || compareNumericIds(item.id, maxId) > 0 ? String(item.id) : maxId;
        continue;
      }

      const costs = config.costs ?? {};
      const fixedCosts = Number(costs.packaging ?? 0.8)
        + Number(costs.cleaning?.[condition] ?? costs.cleaning?.new ?? costs.cleaning?.veryGood ?? 0.75)
        + Number(costs.vintedSellingFee ?? 0);
      const profit = round2(resale - item.price - fixedCosts);
      const roi = item.price > 0 ? round2((profit / item.price) * 100) : 0;
      if (profit < 15 || roi < 35) {
        remember(item, prior, { size, condition, buyScore: 0, resale, netProfit: profit, roi, blockedReason: 'weak-margin', lastSeenAt: now.toISOString() });
        maxId = maxId === null || compareNumericIds(item.id, maxId) > 0 ? String(item.id) : maxId;
        continue;
      }

      const risk = fakeRiskLevel(item, text, resale);
      const demand = seasonalDemand(search.name, config);
      const strategy = config.models?.[search.name]?.strategy ?? 'balanced';
      const stock = countInStock(inventory.items ?? [], search.name);
      const marginScore = clamp(((resale - item.price) / Math.max(resale, 1)) * 100, 0, 100);
      const roiScore = clamp(roi, 0, 200) / 2;
      const conditionScore = 100;
      const demandScore = clamp(demand, 50, 115);
      const riskScore = risk.level === 'HIGH' ? 20 : risk.level === 'MEDIUM' ? 75 : 100;
      const profile = config.strategy?.profiles?.[strategy] ?? { marginWeight: .45, roiWeight: .25, demandWeight: .15, conditionWeight: .10, riskWeight: .05 };
      let score = marginScore * profile.marginWeight
        + roiScore * profile.roiWeight
        + demandScore * profile.demandWeight
        + conditionScore * profile.conditionWeight
        + riskScore * profile.riskWeight;
      if (stock >= Number(config.models?.[search.name]?.maxInventory ?? 3)) score -= 8;
      if (profit >= 20) score += 4;
      if (profit >= 30) score += 4;
      if (roi >= 80) score += 3;
      if (risk.level === 'HIGH') score -= 12;
      score = clamp(Math.round(score), 0, 100);

      const threshold = Number(search.minScore ?? 76);
      const strong = profit >= 20 && roi >= 55 && risk.level !== 'HIGH';
      const exceptional = profit >= 30 && roi >= 80 && risk.level !== 'HIGH';
      const shouldAlert = score >= threshold || strong || exceptional;

      remember(item, prior, {
        size,
        condition,
        buyScore: score,
        resale,
        netProfit: profit,
        roi,
        fakeRisk: risk,
        lastPrice: item.price,
        lastSeenAt: now.toISOString(),
        lastAlertedAt: shouldAlert ? now.toISOString() : prior?.lastAlertedAt
      });
      maxId = maxId === null || compareNumericIds(item.id, maxId) > 0 ? String(item.id) : maxId;

      if (shouldAlert) {
        qualifying.push({
          searchName: search.name,
          item,
          size,
          condition,
          resale,
          netProfit: profit,
          roi,
          buyScore: score,
          fakeRisk: risk,
          demand,
          strategy,
          exceptionalDeal: exceptional
        });
      }
    }

    if (maxId !== null) state.freshness.frontiers[search.name] = { maxId, updatedAt: now.toISOString() };
  } catch (e) {
    console.warn(`${search.name}: ${e.message}`);
  }
}

if (bootstrapping) {
  state.freshness.bootstrapped = true;
  console.log('Fresh-listing radar bootstrap completed: current catalogue marked as seen; no historical alerts sent.');
}

qualifying.sort((a, b) => Number(b.exceptionalDeal) - Number(a.exceptionalDeal) || b.buyScore - a.buyScore || b.netProfit - a.netProfit);
for (const d of qualifying.slice(0, Number(config.maxAlertsPerRun ?? 10))) await sendDiscord(webhook, d);

state.freshness.lastScanAt = now.toISOString();
state.updatedAt = now.toISOString();
await fs.writeFile(stateUrl, JSON.stringify(state, null, 2) + '\n');
console.log(`Fresh Vinted Radar scanned ${searches.length} search groups and sent ${Math.min(qualifying.length, Number(config.maxAlertsPerRun ?? 10))} alert(s).`);

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function extractItems(html, limit = 40) {
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
    const ageMinutes = parseAgeMinutes(context);
    found.set(id, { id, title, price: Number(pm[1]), ageMinutes, fullText: `${title} ${context}`, url: `https://www.vinted.co.uk${path}` });
  }
  return [...found.values()].slice(0, limit);
}

function parseAgeMinutes(text) {
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  if (/\bjust now\b|\bnow\b/.test(t)) return 0;
  let m = t.match(/\b(?:uploaded\s*)?(\d+)\s*(?:minute|minutes|min)\s+ago\b/);
  if (m) return Number(m[1]);
  m = t.match(/\b(?:uploaded\s*)?(\d+)\s*(?:hour|hours|hr|hrs)\s+ago\b/);
  if (m) return Number(m[1]) * 60;
  m = t.match(/\b(?:uploaded\s*)?(\d+)\s*(?:day|days)\s+ago\b/);
  if (m) return Number(m[1]) * 1440;
  return null;
}

function inferSize(text, sizes) {
  const lower = text.toLowerCase();
  const aliases = { XS: ['xs', 'extra small'], S: ['size s', ' small '], M: ['size m', ' medium '], L: ['size l', ' large '], XL: ['xl', 'extra large'], XXL: ['xxl', '2xl', 'extra extra large'] };
  for (const size of sizes) {
    const raw = String(size);
    if (/^\d+(?:\.5)?$/.test(raw) && new RegExp(`\\b(?:uk\\s*)?${raw.replace('.', '\\.?')}\\b`, 'i').test(lower)) return Number(raw);
    if (aliases[raw.toUpperCase()]?.some(x => lower.includes(x))) return raw.toUpperCase();
  }
  return null;
}

function classifyCondition(text) {
  if (/\bnew\s+with\s+tags\b/i.test(text)) return 'newWithTags';
  if (/\bnew\s+without\s+tags\b/i.test(text)) return 'newWithoutTags';
  return 'unknown';
}

function containsBlockedKeyword(text, words) {
  return words.some(word => {
    const w = String(word).toLowerCase().trim();
    if (!w) return false;
    if (w.length <= 3 && !w.includes(' ')) return new RegExp(`(^|[^a-z0-9])${escapeRegExp(w)}($|[^a-z0-9])`, 'i').test(text);
    return text.includes(w);
  });
}

function hasBadCondition(text, words) {
  return words.some(word => {
    const w = String(word).toLowerCase().trim();
    if (!w || w === 'good') return false;
    if (w === 'good condition') return /\bgood condition\b/i.test(text);
    return text.includes(w);
  }) || /\bcondition\s*[:\-]?\s*good\b/i.test(text);
}

function resaleEstimate(name, size, market, cfg) {
  const model = cfg.models?.[name] ?? {};
  const bySize = model.resaleBySize ?? {};
  let base = Number(bySize[String(size)] ?? model.baselineResale ?? 0);
  if (!base && Number.isFinite(Number(size))) {
    const keys = Object.keys(bySize).map(Number).filter(Number.isFinite);
    if (keys.length) {
      const nearest = keys.sort((a, b) => Math.abs(a - Number(size)) - Math.abs(b - Number(size)))[0];
      base = Number(bySize[String(nearest)] ?? 0);
    }
  }
  if (!base) return 0;
  if (!market || market <= 0) return round2(base);
  return round2(clamp(base * .60 + market * .90 * .40, base * .88, base * 1.12));
}

function buildMarketMedianBySize(items) {
  const groups = {};
  for (const item of items) {
    const size = inferSize(item.fullText, targetSizes);
    if (size === null || item.price <= 0 || item.price > 300) continue;
    (groups[String(size)] ??= []).push(item.price);
  }
  const out = {};
  for (const [s, prices] of Object.entries(groups)) out[s] = round2(median(prices));
  return out;
}

function seasonalDemand(name, cfg) {
  const month = new Date().getMonth() + 1;
  for (const season of Object.values(cfg.seasonalDemand ?? {})) {
    if (season.months?.includes(month)) return round2((season[name] ?? 1) * 100);
  }
  return 100;
}

function fakeRiskLevel(item, text, resale) {
  const explicit = ['replica', 'fake', 'counterfeit', '1:1', 'ua ', 'ua-', 'rep ', 'mirror', 'pk batch', 'not authentic'].filter(x => text.includes(x));
  if (explicit.length) return { level: 'HIGH', note: 'Explicit suspicious-authenticity wording detected' };
  if (resale > 0 && item.price <= resale * .30) return { level: 'MEDIUM', note: 'Extremely low price versus expected resale; inspect photos, code and seller history' };
  if (resale > 0 && item.price <= resale * .45) return { level: 'LOW', note: 'Strong bargain price; manual authenticity check recommended' };
  return { level: 'LOW', note: 'No configured major authenticity red flags detected' };
}

async function sendDiscord(url, d) {
  const resaleRange = `£${Math.max(0, d.resale - 5).toFixed(0)}–£${Math.round(d.resale + 5)}`;
  const verdict = d.exceptionalDeal ? '🔥 **EXCEPTIONAL BARGAIN**' : d.buyScore >= 85 ? '🟢 **STRONG BUY**' : '🟡 **GOOD BUY**';
  const conditionLabel = d.condition === 'newWithTags' ? '🆕 New with tags' : '🆕 New without tags';
  const listed = d.item.ageMinutes === null ? '🕐 Newly detected' : `🕐 Listed ~${d.item.ageMinutes} min ago`;
  const body = {
    username: "Dan's Vault Fresh Bargain Finder",
    embeds: [{
      title: '🚨 NEW VINTED BARGAIN 🔥',
      description: `**⭐ ${d.searchName.toUpperCase()}**\n**${d.item.title}**\n\n${listed}\n🏷️ **Buy:** £${d.item.price.toFixed(2)}\n📏 **Size:** ${d.size}\n📦 **Condition:** ${conditionLabel}\n📈 **Est. resale:** ${resaleRange}\n💰 **Est. profit:** £${d.netProfit.toFixed(2)}\n📊 **ROI:** ${d.roi.toFixed(0)}%\n🎯 **Score:** ${d.buyScore}/100\n\n${verdict}\n🛡️ **Authenticity screen:** ${d.fakeRisk.level}\n📈 **Demand:** ${d.demand.toFixed(0)}/100\n⚡ **Strategy:** ${d.strategy}\n\n${d.fakeRisk.note}\n\n*Fresh-listing signal. Check photos, product code, condition and seller before buying.*`,
      url: d.item.url,
      color: d.exceptionalDeal ? 3066993 : d.buyScore >= 85 ? 3447003 : 16776960,
      footer: { text: "Dan's Vault • Fresh Vinted Radar" },
      timestamp: new Date().toISOString()
    }]
  };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Discord webhook HTTP ${r.status}`);
}

async function sendTest(url) {
  const body = {
    username: "Dan's Vault Fresh Bargain Finder",
    embeds: [{
      title: '🧪 FRESH RADAR TEST',
      description: `✅ **Webhook connected**\n\nFresh-listing mode is enabled.\n\n• New with tags / New without tags only\n• Freshness window: **${MAX_AGE_MINUTES} minutes**\n• Already-seen listings are suppressed\n• Trainer and clothing searches stay separated`,
      color: 3447003,
      timestamp: new Date().toISOString(),
      footer: { text: "Dan's Vault • Fresh Vinted Radar" }
    }]
  };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Discord webhook HTTP ${r.status}`);
}

function remember(item, prior, extra) {
  state.items[item.id] = {
    ...(prior ?? {}),
    ...extra,
    lastPrice: item.price,
    lastSeenAt: new Date().toISOString()
  };
}

function countInStock(items, name) { return items.filter(x => x.model === name && x.status !== 'sold').length; }
function compareNumericIds(a, b) { try { return BigInt(String(a)) > BigInt(String(b)) ? 1 : BigInt(String(a)) < BigInt(String(b)) ? -1 : 0; } catch { return String(a).localeCompare(String(b), undefined, { numeric: true }); } }
function median(v) { const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function round2(n) { return Math.round(n * 100) / 100; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function stripTags(s) { return String(s).replace(/<[^>]+>/g, ' '); }
function decodeHtml(s) { return String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
async function loadJson(url, fallback) { try { return JSON.parse(await fs.readFile(url, 'utf8')); } catch { return fallback; } }
