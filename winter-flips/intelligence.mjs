import fs from 'node:fs/promises';

const BASE = new URL('./', import.meta.url);
const CONFIG = JSON.parse(await fs.readFile(new URL('./config.json', BASE), 'utf8'));
const RADAR_STATE = JSON.parse(await fs.readFile(new URL('./state.json', BASE), 'utf8'));
const INTEL_PATH = new URL('./intelligence-state.json', BASE);
const WEBHOOK = process.env.DISCORD_WINTER_FLIPS_WEBHOOK_URL || '';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

if (!WEBHOOK) {
  console.log('Winter intelligence disabled: dedicated webhook missing.');
  process.exit(0);
}

const intel = await loadJson(INTEL_PATH, {
  version: 1,
  history: {},
  momentumAlerts: {},
  staleAlerts: {},
  lastRunAt: null
});
intel.history ||= {};
intel.momentumAlerts ||= {};
intel.staleAlerts ||= {};

const now = new Date();
const diagnostics = {
  at: now.toISOString(),
  snapshotsAdded: 0,
  momentumAlerts: 0,
  staleChecked: 0,
  staleAlerts: 0,
  failures: []
};

recordMarketSnapshots();
await detectMomentumBreakouts();
await detectTrackedStaleEbayDeals();

intel.lastRunAt = new Date().toISOString();
pruneIntel();
await fs.writeFile(INTEL_PATH, JSON.stringify(intel, null, 2) + '\n');
console.log(JSON.stringify(diagnostics, null, 2));

function recordMarketSnapshots() {
  for (const [key, snap] of Object.entries(RADAR_STATE.market || {})) {
    const at = Date.parse(snap.at || 0);
    if (!Number.isFinite(at) || at <= 0) continue;
    const history = intel.history[key] ||= [];
    if (history.some(x => x.at === snap.at)) continue;
    history.push({
      at: snap.at,
      count: Number(snap.count || 0),
      median: Number.isFinite(Number(snap.median)) ? Number(snap.median) : null,
      vintedCount: Number(snap.vintedCount || 0),
      ebayCount: Number(snap.ebayCount || 0)
    });
    history.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    intel.history[key] = history.slice(-36);
    diagnostics.snapshotsAdded += 1;
  }
}

async function detectMomentumBreakouts() {
  for (const [key, history] of Object.entries(intel.history)) {
    if (!Array.isArray(history) || history.length < 4) continue;
    const latest = history.at(-1);
    if (!latest || latest.count < 3 || !Number.isFinite(latest.median)) continue;

    const candidates = history.filter(x => {
      const age = Date.parse(latest.at) - Date.parse(x.at);
      return age >= 30 * 60_000 && age <= 8 * 3600_000 && x.count >= 5 && Number.isFinite(x.median);
    });
    if (!candidates.length) continue;

    const baseline = candidates[0];
    const supplyDrop = 1 - latest.count / baseline.count;
    const priceRise = latest.median / baseline.median - 1;
    if (supplyDrop < 0.22 || priceRise < 0.06) continue;

    const last = Date.parse(intel.momentumAlerts[key] || 0);
    if (Number.isFinite(last) && last > 0 && Date.now() - last < 12 * 3600_000) continue;

    const body = {
      username: "Dan's Vault Winter Flips",
      embeds: [{
        title: '🚀 WINTER FLIPS • MOMENTUM BREAKOUT',
        description:
          `**${humaniseKey(key)}**\n\n` +
          `📦 Visible supply: **${baseline.count} → ${latest.count}** (**-${Math.round(supplyDrop * 100)}%**)\n` +
          `💷 Active median: **£${baseline.median.toFixed(0)} → £${latest.median.toFixed(0)}** (**+${Math.round(priceRise * 100)}%**)\n` +
          `🕒 Signal developed across **${Math.round((Date.parse(latest.at) - Date.parse(baseline.at)) / 60000)} minutes**.\n\n` +
          `🧠 This is a market-momentum signal: visible stock is tightening while asking prices are rising. It is not represented as sold-data proof.`,
        color: 10181046,
        footer: { text: "Dan's Vault • Winter Flips • Momentum" },
        timestamp: new Date().toISOString()
      }]
    };

    const sent = await postDiscord(body).catch(error => {
      diagnostics.failures.push(`Momentum ${key}: ${error.message}`);
      return false;
    });
    if (sent) {
      intel.momentumAlerts[key] = new Date().toISOString();
      diagnostics.momentumAlerts += 1;
    }
  }
}

async function detectTrackedStaleEbayDeals() {
  const tracked = Object.entries(RADAR_STATE.seen || {})
    .filter(([key, value]) => key.startsWith('EBAY:') && value?.firstSeenAt && value?.url && Number(value.price) > 0)
    .map(([key, value]) => ({ key, ...value, ageDays: (Date.now() - Date.parse(value.firstSeenAt)) / 86400000 }))
    .filter(x => x.ageDays >= 14)
    .filter(x => !intel.staleAlerts[x.key])
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 3);

  for (const item of tracked) {
    diagnostics.staleChecked += 1;
    const model = identifyModel(item.title);
    if (!model) continue;

    let html;
    try {
      html = await fetchText(item.url);
    } catch (error) {
      diagnostics.failures.push(`Stale ${item.key}: ${error.message}`);
      continue;
    }
    const text = visibleText(html);
    if (looksEnded(text)) continue;
    if (!/\bbest offer\b/i.test(text) && !/\bmake offer\b/i.test(text)) continue;

    const condition = inferCondition(text);
    const size = inferSize(`${item.title} ${text}`);
    const resale = conservativeResale(model, size, condition);
    const currentAsk = Number(item.price);
    const feeRate = Number(CONFIG.costs?.resaleFeeRate || 0.13);
    const packaging = Number(CONFIG.costs?.packaging || 0.9);
    const targetOffer = Math.min(currentAsk * 0.80, resale - resale * feeRate - packaging - 25);
    const suggestedOffer = roundToPound(Math.max(1, targetOffer));
    if (suggestedOffer >= currentAsk * 0.92 || suggestedOffer <= 0) continue;

    const netProfit = round2(resale - suggestedOffer - resale * feeRate - packaging);
    const roi = round2(netProfit / suggestedOffer * 100);
    if (netProfit < 20 || roi < 40) continue;

    const risk = String(model.counterfeitRisk || 'low').toLowerCase();
    if (risk === 'high' && suggestedOffer / resale < 0.35) continue;

    const body = {
      username: "Dan's Vault Winter Flips",
      embeds: [{
        title: '🧟 EBAY • TRACKED STALE LOWBALL',
        url: item.url,
        description:
          `🧥 **${model.brand} ${model.name}**\n` +
          `📝 ${item.title}\n\n` +
          `⏳ **Bot has tracked this listing for ${Math.floor(item.ageDays)}+ days**\n` +
          `🏷️ Current ask: **£${currentAsk.toFixed(2)}**\n` +
          `🤝 Suggested opening offer: **£${suggestedOffer.toFixed(0)}**\n` +
          `📈 Conservative resale estimate: **£${resale.toFixed(0)}**\n` +
          `💰 Est. net profit at suggested offer: **£${netProfit.toFixed(0)}**\n` +
          `📊 Est. ROI: **${roi.toFixed(0)}%**\n\n` +
          `✅ Listing still appears live and shows an offer route.\n` +
          `⚠️ “Tracked for” means time observed by this bot, not the seller's original listing date.\n\n` +
          `➡️ **[OPEN EBAY LISTING](${item.url})**`,
        color: 15105570,
        footer: { text: "Dan's Vault • Winter Flips • Stale Listing Hunter" },
        timestamp: new Date().toISOString()
      }]
    };

    const sent = await postDiscord(body).catch(error => {
      diagnostics.failures.push(`Stale Discord ${item.key}: ${error.message}`);
      return false;
    });
    if (sent) {
      intel.staleAlerts[item.key] = new Date().toISOString();
      diagnostics.staleAlerts += 1;
    }
  }
}

function identifyModel(title) {
  const text = normalise(title);
  let best = null;
  for (const model of CONFIG.models || []) {
    const brand = brandVariants(model.brand).some(x => text.includes(x));
    if (!brand) continue;
    const matches = (model.matchAny || []).map(normalise).filter(x => text.includes(x));
    if (!matches.length) continue;
    const specificity = Math.max(...matches.map(x => x.length));
    if (!best || specificity > best.specificity) best = { ...model, specificity };
  }
  if (!best) return null;
  delete best.specificity;
  return best;
}

function conservativeResale(model, size, condition) {
  const baseline = Number(model.resaleBySize?.[size] ?? model.baselineResale);
  const multiplier = { new: 1, 'new-other': 0.96, 'very-good': 0.90, good: 0.80, unknown: 0.76 }[condition] ?? 0.76;
  return round2(baseline * multiplier);
}

function inferCondition(text) {
  const n = normalise(text);
  if (/\bbrand new\b|\bnew with tags\b|\bnew with box\b/.test(n)) return 'new';
  if (/\bnew without tags\b|\bnew other\b|\bnew without box\b/.test(n)) return 'new-other';
  if (/\bvery good\b|\bexcellent\b|\blike new\b/.test(n)) return 'very-good';
  if (/\bgood condition\b|\bpre owned\b|\bpre-owned\b|\bused\b/.test(n)) return 'good';
  return 'unknown';
}

function inferSize(text) {
  const n = normalise(text);
  const patterns = [
    [/\b(?:size\s*[:\-]?\s*)?(xxl|2xl)\b/i, 'XXL'],
    [/\b(?:size\s*[:\-]?\s*)?xl\b/i, 'XL'],
    [/\b(?:size\s*[:\-]?\s*)?xs\b/i, 'XS'],
    [/\bsize\s*[:\-]?\s*s\b/i, 'S'],
    [/\bsize\s*[:\-]?\s*m\b/i, 'M'],
    [/\bsize\s*[:\-]?\s*l\b/i, 'L'],
    [/\bextra small\b/i, 'XS'],
    [/\bsmall\b/i, 'S'],
    [/\bmedium\b/i, 'M'],
    [/\blarge\b/i, 'L'],
    [/\bextra large\b/i, 'XL']
  ];
  for (const [re, value] of patterns) if (re.test(n)) return value;
  return null;
}

function looksEnded(text) {
  const n = normalise(text);
  return /\bthis listing (?:has )?ended\b|\bthis item is no longer available\b|\bsold on\b|\bout of stock\b/.test(n);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length < 1500) throw new Error('response unexpectedly short');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function postDiscord(body) {
  const response = await fetch(`${WEBHOOK}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return true;
}

function brandVariants(brand) {
  const b = normalise(brand);
  const out = [b];
  if (b.includes('the north face')) out.push('north face', 'tnf');
  if (b.includes("arc'teryx") || b.includes('arcteryx')) out.push('arcteryx', 'arc teryx');
  if (b.includes('polo ralph lauren')) out.push('ralph lauren', 'polo');
  return out;
}

function humaniseKey(key) {
  return String(key)
    .replace(/^hunter:/, 'Hunter: ')
    .replace(/^[^:]+:/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function pruneIntel() {
  const cutoff = Date.now() - 14 * 86400000;
  for (const [key, history] of Object.entries(intel.history)) {
    intel.history[key] = (history || []).filter(x => Date.parse(x.at || 0) >= cutoff).slice(-36);
    if (!intel.history[key].length) delete intel.history[key];
  }
  const staleCutoff = Date.now() - 60 * 86400000;
  for (const [key, at] of Object.entries(intel.staleAlerts)) {
    if (Date.parse(at || 0) < staleCutoff) delete intel.staleAlerts[key];
  }
}

async function loadJson(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch { return structuredClone(fallback); }
}

function visibleText(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalise(value) {
  return String(value || '').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }
function roundToPound(n) { return Math.max(1, Math.round(Number(n))); }
