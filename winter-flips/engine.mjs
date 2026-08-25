import fs from 'node:fs/promises';

const BASE = new URL('./', import.meta.url);
const CONFIG = JSON.parse(await fs.readFile(new URL('./config.json', BASE), 'utf8'));
const STATE_PATH = new URL('./state.json', BASE);
const REPORT_PATH = new URL('./latest-report.json', BASE);
const WEBHOOK = process.env.DISCORD_WINTER_FLIPS_WEBHOOK_URL || '';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const NOW = new Date();

if (!WEBHOOK) {
  console.log('Winter Flips disabled: DISCORD_WINTER_FLIPS_WEBHOOK_URL is not configured.');
  process.exit(0);
}

const state = await loadJson(STATE_PATH, defaultState());
normaliseState(state);

const searchGroups = buildSearchGroups(CONFIG);
const cursor = Number(state.rotationCursor || 0) % Math.max(searchGroups.length, 1);
const selected = pickCircular(searchGroups, cursor, Math.min(Number(CONFIG.scan.searchesPerRun || 8), searchGroups.length));
const diagnostics = {
  version: 2,
  source: 'VINTED',
  startedAt: NOW.toISOString(),
  searchGroups: selected.map(x => x.key),
  vintedItems: 0,
  candidates: 0,
  alerts: 0,
  supplyVacuumAlerts: 0,
  failures: []
};

let alertBudget = Number(CONFIG.scan.maxAlertsPerRun || 6);

for (let i = 0; i < selected.length; i += 1) {
  const group = selected[i];
  if (i) await sleep(Number(CONFIG.scan.fetchDelayMs || 450) + Math.floor(Math.random() * 250));

  let items = [];
  try {
    items = await fetchVinted(group.query);
  } catch (error) {
    diagnostics.failures.push(`Vinted ${group.query}: ${error.message}`);
  }

  diagnostics.vintedItems += items.length;
  const all = dedupeItems(items).slice(0, Number(CONFIG.scan.itemsPerSource || 35));
  const prices = all.map(x => x.price).filter(x => Number.isFinite(x) && x > 5 && x < 1000);
  const marketMedian = prices.length >= 5 ? median(prices) : null;

  await maybeSendSupplyVacuum({ group, all, marketMedian, state, diagnostics });

  for (const item of all) {
    const seenKey = `VINTED:${item.id}`;
    const previous = state.seen[seenKey];
    state.seen[seenKey] = {
      firstSeenAt: previous?.firstSeenAt || NOW.toISOString(),
      lastSeenAt: NOW.toISOString(),
      title: item.title,
      price: item.price,
      url: item.url,
      condition: item.condition
    };

    if (previous?.alertedAt) continue;
    if (previous?.firstSeenAt) continue;

    const modelMatch = identifyModel(item, CONFIG.models || []);
    if (!modelMatch) continue;
    diagnostics.candidates += 1;

    const evaluation = evaluate({
      item,
      model: modelMatch.model,
      modelConfidence: modelMatch.confidence,
      marketMedian
    });
    state.seen[seenKey].evaluation = compactEvaluation(evaluation);

    if (!evaluation.qualifies || alertBudget <= 0) continue;

    const messageId = await sendDealAlert(item, evaluation).catch(error => {
      diagnostics.failures.push(`Discord VINTED:${item.id}: ${error.message}`);
      return null;
    });
    if (!messageId) continue;

    state.seen[seenKey].alertedAt = new Date().toISOString();
    state.seen[seenKey].discordMessageId = messageId;
    diagnostics.alerts += 1;
    alertBudget -= 1;

    state.opportunities.unshift({
      at: new Date().toISOString(),
      platform: 'VINTED',
      id: item.id,
      title: item.title,
      url: item.url,
      modelId: evaluation.model.id,
      buyPrice: item.price,
      estimatedNetProfit: evaluation.netProfit,
      roi: evaluation.roi,
      score: evaluation.score
    });
    state.opportunities = state.opportunities.slice(0, 120);
  }

  state.market[group.key] = {
    at: NOW.toISOString(),
    count: all.length,
    median: marketMedian,
    vintedCount: all.length,
    vintedMedian: marketMedian
  };
}

state.rotationCursor = (cursor + selected.length) % Math.max(searchGroups.length, 1);
state.lastRunAt = new Date().toISOString();
pruneState(state);
await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
await fs.writeFile(REPORT_PATH, JSON.stringify({ diagnostics, topRecent: state.opportunities.slice(0, 20) }, null, 2) + '\n');
console.log(JSON.stringify(diagnostics, null, 2));

function buildSearchGroups(config) {
  const groups = [];
  for (const model of config.models || []) {
    for (const query of model.searchQueries || []) {
      groups.push({ key: `${model.id}:${slug(query)}`, query });
    }
  }
  for (const query of config.broadQueries || []) {
    groups.push({ key: `hunter:${slug(query)}`, query });
  }
  return groups;
}

async function fetchVinted(query) {
  const url = new URL('https://www.vinted.co.uk/catalog');
  url.searchParams.set('search_text', query);
  url.searchParams.set('order', 'newest_first');
  url.searchParams.append('status_ids[]', '6'); // New with tags
  url.searchParams.append('status_ids[]', '1'); // New without tags

  const html = await fetchText(url.toString(), 'Vinted');
  const occurrences = [];
  const re = /href=["'](?:https?:\/\/(?:www\.)?vinted\.co\.uk)?(\/items\/(\d+)(?:-[^"'?#]*)?)(?:\?[^"']*)?["']/gi;
  let match;
  while ((match = re.exec(html)) !== null) occurrences.push({ id: match[2], path: match[1], index: match.index });

  const unique = [];
  const used = new Set();
  for (const occurrence of occurrences) {
    if (used.has(occurrence.id)) continue;
    used.add(occurrence.id);
    unique.push(occurrence);
  }

  const out = [];
  for (let i = 0; i < unique.length && out.length < Number(CONFIG.scan.itemsPerSource || 35); i += 1) {
    const current = unique[i];
    const next = i + 1 < unique.length ? unique[i + 1].index : html.length;
    const chunk = html.slice(current.index, Math.min(next, current.index + 45000));
    const text = visibleText(chunk);
    const price = parseFirstPound(text);
    if (!Number.isFinite(price) || price <= 0 || price > 1000) continue;

    const titleFromSlug = decodeURIComponentSafe(current.path.replace(/^\/items\/\d+-?/, '').replace(/-/g, ' ')).trim();
    const title = cleanTitle(titleFromSlug || extractMetaText(chunk, 'title') || 'Vinted item');
    const condition = inferAllowedCondition(text);

    out.push({
      platform: 'VINTED',
      id: String(current.id),
      title,
      price,
      condition,
      size: inferSize(`${title} ${text}`),
      text: `${title} ${text}`,
      url: `https://www.vinted.co.uk${current.path}`
    });
  }
  return out;
}

function inferAllowedCondition(text) {
  const n = normalise(text);
  if (/\bnew with tags\b/.test(n)) return 'new';
  if (/\bnew without tags\b/.test(n)) return 'new-other';
  // The catalogue request itself is restricted to Vinted status IDs 6 and 1.
  // If the card omits its condition label, use the more conservative of the two.
  return 'new-other';
}

function identifyModel(item, models) {
  const text = normalise(`${item.title} ${item.text}`);
  let best = null;

  for (const model of models) {
    const brandHit = brandVariants(model.brand).some(v => text.includes(v));
    if (!brandHit) continue;
    const matchValues = (model.matchAny || []).map(normalise);
    const hit = matchValues.find(v => text.includes(v));
    if (!hit) continue;

    const title = normalise(item.title);
    const inTitle = matchValues.some(v => title.includes(v));
    const specificity = Math.min(1, hit.length / 16);
    const confidence = clamp((inTitle ? 0.84 : 0.68) + specificity * 0.12, 0, 0.98);
    if (!best || confidence > best.confidence) best = { model, confidence };
  }
  return best;
}

function evaluate({ item, model, modelConfidence, marketMedian }) {
  const size = item.size;
  const baseline = Number(model.resaleBySize?.[size] ?? model.baselineResale);
  const activeSignal = Number.isFinite(marketMedian) ? clamp(marketMedian, baseline * 0.65, baseline * 1.25) : baseline;
  const conditionMultiplier = item.condition === 'new' ? 1 : 0.96;
  const estimatedResale = round2(clamp((baseline * 0.78 + activeSignal * 0.22) * conditionMultiplier, baseline * 0.62, baseline * 1.08));

  const buyerProtection = item.price * Number(CONFIG.costs.vintedBuyerProtectionRateEstimate || 0) + Number(CONFIG.costs.vintedBuyerProtectionFixedEstimate || 0);
  const resaleFees = estimatedResale * Number(CONFIG.costs.resaleFeeRate || 0);
  const totalCost = item.price + buyerProtection + Number(CONFIG.costs.packaging || 0) + resaleFees;
  const netProfit = round2(estimatedResale - totalCost);
  const roi = round2(item.price > 0 ? (netProfit / item.price) * 100 : 0);

  const maxBuy = modelMaxBuy(model, size, item.condition);
  const belowMax = item.price <= maxBuy;
  const discountToBaseline = baseline > 0 ? clamp((baseline - item.price) / baseline, -1, 1) : 0;
  const demand = Number(model.demand || 70);
  const marginScore = clamp((netProfit / Math.max(estimatedResale, 1)) * 180, 0, 100);
  const roiScore = clamp(roi * 1.15, 0, 100);
  const priceScore = clamp(discountToBaseline * 120, 0, 100);
  const conditionScore = item.condition === 'new' ? 100 : 94;
  const confidenceScore = modelConfidence * 100;
  const fakeRisk = counterfeitRisk(model, item, estimatedResale, modelConfidence);

  let score = Math.round(
    marginScore * 0.29 +
    roiScore * 0.22 +
    demand * 0.18 +
    priceScore * 0.13 +
    conditionScore * 0.08 +
    confidenceScore * 0.10
  );
  if (belowMax) score += 4;
  if (fakeRisk.level === 'MEDIUM') score -= 8;
  if (fakeRisk.level === 'HIGH') score = Math.min(score - 18, 79);
  if (!size) score -= 5;
  score = clamp(Math.round(score), 0, 100);

  const strong = netProfit >= Number(CONFIG.scoring.strongNetProfit || 30) && roi >= Number(CONFIG.scoring.strongRoi || 55) && fakeRisk.level !== 'HIGH';
  const exceptional = netProfit >= Number(CONFIG.scoring.exceptionalNetProfit || 45) && roi >= Number(CONFIG.scoring.exceptionalRoi || 80) && fakeRisk.level !== 'HIGH';
  const qualifies =
    netProfit >= Number(CONFIG.scoring.minNetProfit || 18) &&
    roi >= Number(CONFIG.scoring.minRoi || 35) &&
    (score >= Number(CONFIG.scan.minScore || 82) || strong || exceptional) &&
    fakeRisk.level !== 'HIGH';

  const verdict = exceptional ? '🔥 EXCEPTIONAL BUY' : score >= 90 ? '🟢 STRONG BUY' : score >= 82 ? '✅ BUY' : '⚠️ REVIEW';
  return { model, size, baseline, estimatedResale, netProfit, roi, score, verdict, qualifies, strong, exceptional, maxBuy, marketMedian, modelConfidence, fakeRisk };
}

function modelMaxBuy(model, size, condition) {
  const base = Number(model.maxBuy || 0);
  const baseline = Number(model.baselineResale || 1);
  const sized = Number(model.resaleBySize?.[size] ?? baseline);
  const sizeFactor = clamp(sized / Math.max(baseline, 1), 0.82, 1.15);
  const conditionFactor = condition === 'new' ? 1 : 0.96;
  return round2(base * sizeFactor * conditionFactor);
}

function counterfeitRisk(model, item, resale, confidence) {
  const base = String(model.counterfeitRisk || 'low').toLowerCase();
  const ratio = item.price / Math.max(resale, 1);
  const text = normalise(`${item.title} ${item.text}`);
  const flags = [];
  if (ratio < 0.24) flags.push('price is unusually low');
  if (confidence < 0.76) flags.push('model identification is not fully confident');
  if (/\b(rep|replica|fake|ua|1:1|mirror|batch)\b/i.test(text)) flags.push('counterfeit wording detected');

  let level = base === 'high' ? 'MEDIUM' : 'LOW';
  if (flags.some(x => x.includes('counterfeit'))) level = 'HIGH';
  else if (base === 'high' && ratio < 0.35) level = 'HIGH';
  else if (base === 'medium' && ratio < 0.28) level = 'HIGH';
  else if (ratio < 0.24) level = 'MEDIUM';
  else if (base === 'high') level = 'MEDIUM';

  return { level, flags };
}

async function maybeSendSupplyVacuum({ group, all, marketMedian, state, diagnostics }) {
  if (!CONFIG.supplyVacuum?.enabled) return;
  const previous = state.market[group.key];
  if (!previous || !Number.isFinite(previous.count) || previous.count < Number(CONFIG.supplyVacuum.minPreviousSupply || 8)) return;
  if (!all.length) return;

  const drop = 1 - all.length / previous.count;
  const requiredDrop = Number(CONFIG.supplyVacuum.dropPercent || 0.4);
  const medianOkay = !Number.isFinite(previous.median) || !Number.isFinite(marketMedian) || marketMedian >= previous.median * 0.95;
  if (drop < requiredDrop || !medianOkay) return;

  const lastAlert = Date.parse(state.supplyAlerts[group.key] || 0);
  const cooldownMs = Number(CONFIG.supplyVacuum.cooldownHours || 12) * 3600000;
  if (Number.isFinite(lastAlert) && lastAlert > 0 && Date.now() - lastAlert < cooldownMs) return;

  const body = {
    username: "Dan's Vault Winter Flips",
    embeds: [{
      title: '⚠️ DAN’S VAULT • VINTED SUPPLY VACUUM',
      description:
        `**${group.query}**\n\n` +
        `📦 Previous visible Vinted supply: **${previous.count}**\n` +
        `📉 Current visible Vinted supply: **${all.length}** (**-${Math.round(drop * 100)}%**)\n` +
        `${Number.isFinite(previous.median) ? `💷 Previous active median: **£${Number(previous.median).toFixed(0)}**\n` : ''}` +
        `${Number.isFinite(marketMedian) ? `💷 Current active median: **£${Number(marketMedian).toFixed(0)}**\n` : ''}` +
        `\n🧠 Visible Vinted stock has contracted sharply without a matching price collapse. This is a sourcing signal, not sold-data proof.`,
      color: 15105570,
      footer: { text: "Dan's Vault • Winter Flips • Vinted" },
      timestamp: new Date().toISOString()
    }]
  };

  const id = await postDiscord(body).catch(() => null);
  if (id) {
    state.supplyAlerts[group.key] = new Date().toISOString();
    diagnostics.supplyVacuumAlerts += 1;
  }
}

async function sendDealAlert(item, d) {
  const confidencePct = Math.round(d.modelConfidence * 100);
  const riskEmoji = d.fakeRisk.level === 'LOW' ? '🟢' : d.fakeRisk.level === 'MEDIUM' ? '🟠' : '🔴';
  const reasons = [
    item.price <= d.maxBuy ? `✅ below model max-buy (£${d.maxBuy.toFixed(0)})` : null,
    d.roi >= 80 ? `🔥 ${d.roi.toFixed(0)}% estimated ROI` : d.roi >= 55 ? `📈 ${d.roi.toFixed(0)}% estimated ROI` : null,
    d.netProfit >= 45 ? `💰 £${d.netProfit.toFixed(0)} estimated net profit` : null,
    d.model.demand >= 90 ? '⚡ very high configured demand' : null
  ].filter(Boolean).slice(0, 4).join('\n') || '✅ Passed Winter Flips margin and demand thresholds';

  const imageUrl = await fetchExactLeadImage(item.url);
  const body = {
    username: "Dan's Vault Winter Flips",
    embeds: [{
      title: `🟢 VINTED • ${d.verdict} • ${d.score}/100`,
      url: item.url,
      description:
        `🧥 **${d.model.brand} ${d.model.name}**\n` +
        `📝 ${item.title}\n\n` +
        `📏 **Size:** ${d.size || 'Not confirmed'}\n` +
        `✨ **Condition:** ${item.condition === 'new' ? 'New with tags' : 'New without tags'}\n\n` +
        `🏷️ **Buy:** £${item.price.toFixed(2)}\n` +
        `📈 **Conservative resale estimate:** £${d.estimatedResale.toFixed(2)}\n` +
        `💰 **Estimated net profit:** £${d.netProfit.toFixed(2)}\n` +
        `📊 **Estimated ROI:** ${d.roi.toFixed(1)}%\n` +
        `🎯 **Max buy:** £${d.maxBuy.toFixed(2)}\n\n` +
        `${Number.isFinite(d.marketMedian) ? `💷 **Current Vinted active median:** £${d.marketMedian.toFixed(0)}\n` : ''}` +
        `🧠 **Model ID confidence:** ${confidencePct}%\n` +
        `${riskEmoji} **Counterfeit risk gate:** ${d.fakeRisk.level}\n\n` +
        `**WHY IT PINGED**\n${reasons}\n\n` +
        `➡️ **[VIEW VINTED LISTING](${item.url})**`,
      color: d.score >= 92 ? 3066993 : d.score >= 85 ? 5763719 : 16776960,
      ...(imageUrl ? { image: { url: imageUrl } } : {}),
      footer: { text: "Dan's Vault • Winter Flips • Vinted only" },
      timestamp: new Date().toISOString()
    }]
  };
  return postDiscord(body);
}

async function fetchExactLeadImage(itemUrl) {
  try {
    const html = await fetchText(itemUrl, 'Vinted item');
    const image = metaContent(html, 'og:image') || metaContent(html, 'twitter:image');
    return cleanVintedImageUrl(image);
  } catch {
    return null;
  }
}

function metaContent(html, key) {
  const wanted = String(key).toLowerCase();
  const tags = String(html).match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const property = attr(tag, 'property').toLowerCase();
    const name = attr(tag, 'name').toLowerCase();
    if (property !== wanted && name !== wanted) continue;
    const content = attr(tag, 'content');
    if (content) return decodeHtml(content);
  }
  return '';
}

function attr(tag, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const pattern of [
    new RegExp(`${escaped}\\s*=\\s*\"([^\"]*)\"`, 'i'),
    new RegExp(`${escaped}\\s*=\\s*'([^']*)'`, 'i')
  ]) {
    const match = String(tag).match(pattern);
    if (match) return match[1];
  }
  return '';
}

function cleanVintedImageUrl(value) {
  if (!value) return null;
  let raw = decodeHtml(String(value).trim());
  if (raw.startsWith('//')) raw = `https:${raw}`;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || !(host === 'vinted.net' || host.endsWith('.vinted.net'))) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function postDiscord(body) {
  const response = await fetch(`${WEBHOOK}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json().catch(() => ({}));
  return data.id || `sent-${Date.now()}`;
}

async function fetchText(url, sourceName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(CONFIG.scan.requestTimeoutMs || 12000));
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
    if (!response.ok) throw new Error(`${sourceName} HTTP ${response.status}`);
    const text = await response.text();
    if (text.length < 1500) throw new Error(`${sourceName} response unexpectedly short`);
    return text;
  } finally {
    clearTimeout(timeout);
  }
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

function brandVariants(brand) {
  const b = normalise(brand);
  const out = [b];
  if (b.includes('the north face')) out.push('north face', 'tnf');
  if (b.includes("arc'teryx") || b.includes('arcteryx')) out.push('arcteryx', 'arc teryx');
  if (b.includes('polo ralph lauren')) out.push('ralph lauren', 'polo');
  return out;
}

function defaultState() {
  return { version: 2, rotationCursor: 0, lastRunAt: null, seen: {}, market: {}, opportunities: [], supplyAlerts: {} };
}

function normaliseState(s) {
  s.version = 2;
  s.rotationCursor ||= 0;
  s.seen ||= {};
  s.market ||= {};
  s.opportunities ||= [];
  s.supplyAlerts ||= {};
  // Remove legacy records from sources that are no longer used.
  for (const key of Object.keys(s.seen)) if (!key.startsWith('VINTED:')) delete s.seen[key];
  s.opportunities = s.opportunities.filter(x => !x.platform || x.platform === 'VINTED');
  for (const snap of Object.values(s.market)) {
    if (snap && typeof snap === 'object') {
      delete snap.ebayCount;
      delete snap.ebayMedian;
    }
  }
}

function pruneState(s) {
  const seenCutoff = Date.now() - 21 * 86400000;
  for (const [key, value] of Object.entries(s.seen)) {
    if (Date.parse(value.lastSeenAt || 0) < seenCutoff) delete s.seen[key];
  }
  s.opportunities = (s.opportunities || []).slice(0, 120);
}

function compactEvaluation(d) {
  return {
    modelId: d.model.id,
    size: d.size,
    estimatedResale: d.estimatedResale,
    netProfit: d.netProfit,
    roi: d.roi,
    score: d.score,
    maxBuy: d.maxBuy,
    risk: d.fakeRisk.level
  };
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = String(item.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseFirstPound(text) {
  const matches = [...String(text).matchAll(/£\s*([0-9]{1,4}(?:[.,][0-9]{1,2})?)/g)];
  for (const match of matches) {
    const value = Number(match[1].replace(',', '.'));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
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

function extractMetaText(html, key) {
  return metaContent(html, key);
}

function cleanTitle(value) {
  return decodeHtml(String(value || '')).replace(/\s+/g, ' ').trim().slice(0, 180);
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function decodeURIComponentSafe(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function normalise(value) {
  return String(value || '').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pickCircular(items, start, count) {
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(items[(start + i) % items.length]);
  return out;
}

function slug(value) {
  return normalise(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, Number(n))); }
function round2(n) { return Math.round(Number(n) * 100) / 100; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
