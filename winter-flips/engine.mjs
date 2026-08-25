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
const selected = pickCircular(searchGroups, cursor, Math.min(CONFIG.scan.searchesPerRun, searchGroups.length));
const diagnostics = {
  version: CONFIG.version,
  startedAt: NOW.toISOString(),
  searchGroups: selected.map(x => x.key),
  vintedItems: 0,
  ebayItems: 0,
  candidates: 0,
  alerts: 0,
  supplyVacuumAlerts: 0,
  failures: []
};

let alertBudget = Number(CONFIG.scan.maxAlertsPerRun || 6);
for (let i = 0; i < selected.length; i += 1) {
  const group = selected[i];
  if (i) await sleep(Number(CONFIG.scan.fetchDelayMs || 450) + Math.floor(Math.random() * 300));

  let vinted = [];
  let ebay = [];
  try {
    [vinted, ebay] = await Promise.all([
      fetchVinted(group.query).catch(error => {
        diagnostics.failures.push(`Vinted ${group.query}: ${error.message}`);
        return [];
      }),
      fetchEbay(group.query).catch(error => {
        diagnostics.failures.push(`eBay ${group.query}: ${error.message}`);
        return [];
      })
    ]);
  } catch (error) {
    diagnostics.failures.push(`${group.query}: ${error.message}`);
  }

  diagnostics.vintedItems += vinted.length;
  diagnostics.ebayItems += ebay.length;

  const all = dedupeItems([...vinted, ...ebay]).slice(0, Number(CONFIG.scan.itemsPerSource || 35) * 2);
  const marketPrices = all.map(x => x.price).filter(x => Number.isFinite(x) && x > 5 && x < 1000);
  const marketMedian = marketPrices.length >= 5 ? median(marketPrices) : null;
  const sourceMedians = {
    vinted: vinted.length >= 3 ? median(vinted.map(x => x.price)) : null,
    ebay: ebay.length >= 3 ? median(ebay.map(x => x.price)) : null
  };

  await maybeSendSupplyVacuum({ group, all, marketMedian, state, diagnostics });

  for (const item of all) {
    const seenKey = `${item.platform}:${item.id}`;
    const previous = state.seen[seenKey];
    state.seen[seenKey] = {
      firstSeenAt: previous?.firstSeenAt || NOW.toISOString(),
      lastSeenAt: NOW.toISOString(),
      title: item.title,
      price: item.price,
      url: item.url
    };

    if (previous?.alertedAt) continue;
    if (previous && previous.firstSeenAt) continue;

    const modelMatch = identifyModel(item, CONFIG.models);
    if (!modelMatch) continue;
    diagnostics.candidates += 1;

    const evaluation = evaluate({ item, model: modelMatch.model, modelConfidence: modelMatch.confidence, marketMedian, sourceMedians });
    state.seen[seenKey].evaluation = compactEvaluation(evaluation);

    if (!evaluation.qualifies) continue;
    if (alertBudget <= 0) continue;

    const messageId = await sendDealAlert(item, evaluation).catch(error => {
      diagnostics.failures.push(`Discord ${item.platform}:${item.id}: ${error.message}`);
      return null;
    });
    if (!messageId) continue;

    state.seen[seenKey].alertedAt = new Date().toISOString();
    state.seen[seenKey].discordMessageId = messageId;
    diagnostics.alerts += 1;
    alertBudget -= 1;

    state.opportunities.unshift({
      at: new Date().toISOString(),
      platform: item.platform,
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
    vintedCount: vinted.length,
    ebayCount: ebay.length,
    vintedMedian: sourceMedians.vinted,
    ebayMedian: sourceMedians.ebay
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
  for (const model of config.models) {
    for (const query of model.searchQueries || []) {
      groups.push({ key: `${model.id}:${slug(query)}`, query, expectedModelId: model.id, broad: false });
    }
  }
  for (const query of config.broadQueries || []) {
    groups.push({ key: `hunter:${slug(query)}`, query, expectedModelId: null, broad: true });
  }
  return groups;
}

async function fetchVinted(query) {
  const url = new URL('https://www.vinted.co.uk/catalog');
  url.searchParams.set('search_text', query);
  url.searchParams.set('order', 'newest_first');
  const html = await fetchText(url.toString(), 'Vinted');
  const occurrences = [];
  const re = /href=["'](?:https?:\/\/(?:www\.)?vinted\.co\.uk)?(\/items\/(\d+)(?:-[^"'?#]*)?)(?:\?[^"']*)?["']/gi;
  let match;
  while ((match = re.exec(html)) !== null) occurrences.push({ id: match[2], path: match[1], index: match.index });

  const unique = [];
  const used = new Set();
  for (const x of occurrences) {
    if (!used.has(x.id)) {
      used.add(x.id);
      unique.push(x);
    }
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
    out.push({
      platform: 'VINTED',
      id: String(current.id),
      title,
      price,
      condition: inferCondition(text),
      size: inferSize(`${title} ${text}`),
      text: `${title} ${text}`,
      url: `https://www.vinted.co.uk${current.path}`,
      newListing: true
    });
  }
  return out;
}

async function fetchEbay(query) {
  const url = new URL('https://www.ebay.co.uk/sch/i.html');
  url.searchParams.set('_nkw', query);
  url.searchParams.set('_sop', '10');
  url.searchParams.set('LH_BIN', '1');
  url.searchParams.set('rt', 'nc');

  const html = await fetchText(url.toString(), 'eBay');
  const chunks = html.match(/<li\b[^>]*class=["'][^"']*\bs-item\b[^"']*["'][\s\S]*?<\/li>/gi) || [];
  const out = [];
  const used = new Set();

  for (const chunk of chunks) {
    if (out.length >= Number(CONFIG.scan.itemsPerSource || 35)) break;
    const href = firstMatch(chunk, /href=["'](https?:\/\/www\.ebay\.co\.uk\/itm\/(?:[^"'?#/]+\/)?(\d+)[^"']*)["']/i);
    if (!href) continue;
    const id = href[2];
    if (used.has(id)) continue;
    used.add(id);

    const titleHtml =
      firstMatch(chunk, /<div[^>]*class=["'][^"']*\bs-item__title\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
      firstMatch(chunk, /<span[^>]*role=["']heading["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
      '';
    const title = cleanTitle(visibleText(titleHtml));
    if (!title || /shop on ebay/i.test(title)) continue;

    const priceHtml = firstMatch(chunk, /<span[^>]*class=["'][^"']*\bs-item__price\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '';
    const price = parseFirstPound(visibleText(priceHtml));
    if (!Number.isFinite(price) || price <= 0 || price > 1000) continue;

    const text = visibleText(chunk);
    out.push({
      platform: 'EBAY',
      id: String(id),
      title,
      price,
      condition: inferCondition(text),
      size: inferSize(`${title} ${text}`),
      text: `${title} ${text}`,
      url: href[1].replace(/&amp;/g, '&'),
      newListing: /\bnew listing\b/i.test(text),
      bestOffer: /\bbest offer\b/i.test(text)
    });
  }
  return out;
}

function identifyModel(item, models) {
  const text = normalise(`${item.title} ${item.text}`);
  let best = null;

  for (const model of models) {
    const brandTokens = brandVariants(model.brand);
    const brandHit = brandTokens.some(v => text.includes(v));
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

function evaluate({ item, model, modelConfidence, marketMedian, sourceMedians }) {
  const size = item.size;
  const baseline = Number(model.resaleBySize?.[size] ?? model.baselineResale);
  const activeSignal = Number.isFinite(marketMedian) ? clamp(marketMedian, baseline * 0.65, baseline * 1.25) : baseline;
  const conditionMultiplier = {
    new: 1.0,
    'new-other': 0.96,
    'very-good': 0.91,
    good: 0.82,
    unknown: 0.78
  }[item.condition] ?? 0.78;

  const estimatedResale = round2(clamp((baseline * 0.78 + activeSignal * 0.22) * conditionMultiplier, baseline * 0.62, baseline * 1.08));
  const sourceCost = item.platform === 'VINTED'
    ? item.price * Number(CONFIG.costs.vintedBuyerProtectionRateEstimate || 0) + Number(CONFIG.costs.vintedBuyerProtectionFixedEstimate || 0)
    : 0;
  const resaleFees = estimatedResale * Number(CONFIG.costs.resaleFeeRate || 0);
  const totalCost = item.price + sourceCost + Number(CONFIG.costs.packaging || 0) + resaleFees;
  const netProfit = round2(estimatedResale - totalCost);
  const roi = round2(item.price > 0 ? (netProfit / item.price) * 100 : 0);
  const spread = round2(estimatedResale - item.price);

  const maxBuy = modelMaxBuy(model, size, item.condition);
  const belowMax = item.price <= maxBuy;
  const discountToBaseline = baseline > 0 ? clamp((baseline - item.price) / baseline, -1, 1) : 0;
  const demand = Number(model.demand || 70);
  const marginScore = clamp((netProfit / Math.max(estimatedResale, 1)) * 180, 0, 100);
  const roiScore = clamp(roi * 1.15, 0, 100);
  const priceScore = clamp(discountToBaseline * 120, 0, 100);
  const conditionScore = { new: 100, 'new-other': 94, 'very-good': 86, good: 72, unknown: 56 }[item.condition] ?? 56;
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
  if (item.platform === 'EBAY' && item.bestOffer && item.price <= maxBuy * 1.12) score += 2;
  if (fakeRisk.level === 'MEDIUM') score -= 8;
  if (fakeRisk.level === 'HIGH') score = Math.min(score - 18, 79);
  if (!size) score -= 5;
  score = clamp(Math.round(score), 0, 100);

  const strong =
    netProfit >= Number(CONFIG.scoring.strongNetProfit || 30) &&
    roi >= Number(CONFIG.scoring.strongRoi || 55) &&
    fakeRisk.level !== 'HIGH';
  const exceptional =
    netProfit >= Number(CONFIG.scoring.exceptionalNetProfit || 45) &&
    roi >= Number(CONFIG.scoring.exceptionalRoi || 80) &&
    fakeRisk.level !== 'HIGH';
  const qualifies =
    netProfit >= Number(CONFIG.scoring.minNetProfit || 18) &&
    roi >= Number(CONFIG.scoring.minRoi || 35) &&
    (score >= Number(CONFIG.scan.minScore || 82) || strong || exceptional) &&
    fakeRisk.level !== 'HIGH';

  const verdict = exceptional ? '🔥 EXCEPTIONAL BUY' : score >= 90 ? '🟢 STRONG BUY' : score >= 82 ? '✅ BUY' : '⚠️ REVIEW';
  return {
    model,
    size,
    baseline,
    estimatedResale,
    netProfit,
    roi,
    spread,
    score,
    verdict,
    qualifies,
    strong,
    exceptional,
    maxBuy,
    marketMedian,
    sourceMedians,
    modelConfidence,
    fakeRisk
  };
}

function counterfeitRisk(model, item, resale, confidence) {
  const base = String(model.counterfeitRisk || 'low').toLowerCase();
  const ratio = item.price / Math.max(resale, 1);
  const text = normalise(`${item.title} ${item.text}`);

  const flags = [];
  if (ratio < 0.24) flags.push('price is unusually low');
  if (confidence < 0.76) flags.push('model identification is not fully confident');
  if (/\b(rep|replica|fake|ua|1:1|mirror|batch)\b/i.test(text)) flags.push('counterfeit wording detected');

  let level = base === 'high' ? 'MEDIUM' : base === 'medium' ? 'LOW' : 'LOW';
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
      title: '⚠️ DAN’S VAULT • SUPPLY VACUUM',
      description:
        `**${group.query}**\n\n` +
        `📦 Previous visible supply: **${previous.count}**\n` +
        `📉 Current visible supply: **${all.length}** (**-${Math.round(drop * 100)}%**)\n` +
        `${Number.isFinite(previous.median) ? `💷 Previous active median: **£${Number(previous.median).toFixed(0)}**\n` : ''}` +
        `${Number.isFinite(marketMedian) ? `💷 Current active median: **£${Number(marketMedian).toFixed(0)}**\n` : ''}` +
        `\n🧠 Supply has contracted sharply without a matching price collapse. This is a sourcing signal, not proof of sold demand.`,
      color: 15105570,
      footer: { text: "Dan's Vault • Winter Flips • Vinted + eBay" },
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
  const platformIcon = item.platform === 'VINTED' ? '🟢' : '🔵';
  const confidencePct = Math.round(d.modelConfidence * 100);
  const riskEmoji = d.fakeRisk.level === 'LOW' ? '🟢' : d.fakeRisk.level === 'MEDIUM' ? '🟠' : '🔴';
  const cross =
    `${Number.isFinite(d.sourceMedians.vinted) ? `Vinted £${d.sourceMedians.vinted.toFixed(0)}` : 'Vinted n/a'} • ` +
    `${Number.isFinite(d.sourceMedians.ebay) ? `eBay £${d.sourceMedians.ebay.toFixed(0)}` : 'eBay n/a'}`;
  const reasons = [
    item.price <= d.maxBuy ? `✅ below model max-buy (£${d.maxBuy.toFixed(0)})` : null,
    d.roi >= 80 ? `🔥 ${d.roi.toFixed(0)}% estimated ROI` : d.roi >= 55 ? `📈 ${d.roi.toFixed(0)}% estimated ROI` : null,
    d.netProfit >= 45 ? `💰 £${d.netProfit.toFixed(0)} estimated net profit` : null,
    d.model.demand >= 90 ? '⚡ very high configured demand' : null,
    item.bestOffer ? '🤝 eBay Best Offer available' : null
  ].filter(Boolean).slice(0, 4).join('\n') || '✅ Passed Winter Flips margin and demand thresholds';

  const body = {
    username: "Dan's Vault Winter Flips",
    embeds: [{
      title: `${platformIcon} ${d.verdict} • ${d.score}/100`,
      url: item.url,
      description:
        `🧥 **${d.model.brand} ${d.model.name}**\n` +
        `📝 ${item.title}\n\n` +
        `🛒 **Marketplace:** ${item.platform}\n` +
        `📏 **Size:** ${d.size || 'Not confirmed'}\n` +
        `✨ **Condition:** ${prettyCondition(item.condition)}\n\n` +
        `🏷️ **Buy:** £${item.price.toFixed(2)}\n` +
        `📈 **Conservative resale estimate:** £${d.estimatedResale.toFixed(2)}\n` +
        `💰 **Estimated net profit:** £${d.netProfit.toFixed(2)}\n` +
        `📊 **Estimated ROI:** ${d.roi.toFixed(1)}%\n` +
        `🎯 **Max buy:** £${d.maxBuy.toFixed(2)}\n\n` +
        `🌐 **Cross-market active-price signal:** ${cross}\n` +
        `🧠 **Model ID confidence:** ${confidencePct}%\n` +
        `${riskEmoji} **Counterfeit risk gate:** ${d.fakeRisk.level}\n\n` +
        `**WHY IT PINGED**\n${reasons}\n\n` +
        `➡️ **[VIEW ${item.platform} LISTING](${item.url})**`,
      color: d.score >= 92 ? 3066993 : d.score >= 85 ? 5763719 : 16776960,
      footer: { text: "Dan's Vault • Winter Flips • Vinted + eBay simultaneously" },
      timestamp: new Date().toISOString()
    }]
  };
  return postDiscord(body);
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

function modelMaxBuy(model, size, condition) {
  const baseline = Number(model.resaleBySize?.[size] ?? model.baselineResale);
  const configured = Number(model.maxBuy || baseline * 0.5);
  const sizeAdjusted = size && model.resaleBySize?.[size]
    ? configured * (Number(model.resaleBySize[size]) / Number(model.baselineResale))
    : configured;
  const conditionMultiplier = { new: 1.08, 'new-other': 1.03, 'very-good': 1, good: 0.86, unknown: 0.76 }[condition] ?? 0.76;
  return round2(sizeAdjusted * conditionMultiplier);
}

function brandVariants(brand) {
  const b = normalise(brand);
  const variants = [b];
  if (b.includes('the north face')) variants.push('north face', 'tnf');
  if (b.includes("arc'teryx") || b.includes('arcteryx')) variants.push('arcteryx', 'arc teryx');
  if (b.includes('polo ralph lauren')) variants.push('ralph lauren', 'polo');
  return variants;
}

function compactEvaluation(d) {
  return {
    modelId: d.model.id,
    resale: d.estimatedResale,
    netProfit: d.netProfit,
    roi: d.roi,
    score: d.score,
    risk: d.fakeRisk.level,
    confidence: round2(d.modelConfidence)
  };
}

function normaliseState(s) {
  s.seen ||= {};
  s.market ||= {};
  s.opportunities ||= [];
  s.supplyAlerts ||= {};
  s.rotationCursor ||= 0;
}

function defaultState() {
  return { version: 1, rotationCursor: 0, lastRunAt: null, seen: {}, market: {}, opportunities: [], supplyAlerts: {} };
}

function pruneState(s) {
  const cutoff = Date.now() - 21 * 86400000;
  for (const [key, value] of Object.entries(s.seen)) {
    const seenAt = Date.parse(value.lastSeenAt || value.firstSeenAt || 0);
    if (Number.isFinite(seenAt) && seenAt > 0 && seenAt < cutoff) delete s.seen[key];
  }
  s.opportunities = (s.opportunities || []).slice(0, 120);
}

async function loadJson(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

function dedupeItems(items) {
  const map = new Map();
  for (const item of items) {
    const key = `${item.platform}:${item.id}`;
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function cleanTitle(value) {
  return String(value || '')
    .replace(/^new listing\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function visibleText(html) {
  return decodeHtml(String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' '));
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&pound;/g, '£')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function extractMetaText(html, name) {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["'][^"']*${name}[^"']*["'][^>]+content=["']([^"']+)["']`, 'i');
  return firstMatch(html, re)?.[1] || '';
}

function parseFirstPound(text) {
  const match = String(text || '').match(/£\s*([0-9]+(?:[.,][0-9]{1,2})?)/);
  return match ? Number(match[1].replace(',', '.')) : NaN;
}

function firstMatch(text, re) {
  return re.exec(String(text || ''));
}

function decodeURIComponentSafe(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pickCircular(items, start, count) {
  if (!items.length) return [];
  const out = [];
  for (let i = 0; i < Math.min(count, items.length); i += 1) out.push(items[(start + i) % items.length]);
  return out;
}

function prettyCondition(value) {
  return {
    new: 'New',
    'new-other': 'New without tags / other',
    'very-good': 'Very Good',
    good: 'Good / Used',
    unknown: 'Not confirmed'
  }[value] || 'Not confirmed';
}

function slug(value) {
  return normalise(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalise(value) {
  return decodeHtml(String(value || '')).toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
