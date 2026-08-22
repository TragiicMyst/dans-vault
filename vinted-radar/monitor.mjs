import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const BASE = new URL('./', import.meta.url);
const CONFIG_PATH = new URL('./config.json', BASE);
const STATE_PATH = new URL('./state.json', BASE);
const INVENTORY_PATH = new URL('./inventory.json', BASE);

const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
const inventory = await loadJson(INVENTORY_PATH, { items: [] });
const state = migrateState(await loadJson(STATE_PATH, { seen: [] }));

const webhook = process.env.DISCORD_WEBHOOK_URL;
const testMode = process.env.TEST_MODE === 'true';

if (!webhook) {
  console.error('Missing DISCORD_WEBHOOK_URL secret.');
  process.exit(1);
}

if (testMode) {
  await sendTestAlerts(webhook);
  console.log('Test mode complete.');
  process.exit(0);
}

const userAgent = 'Mozilla/5.0 (compatible; DansVaultRadar/2.0; +https://github.com/TragiicMyst/dans-vault)';
const now = new Date();
let alertsSent = 0;

for (const search of config.searches) {
  if (!config.enabled || alertsSent >= config.maxAlertsPerRun) break;
  if (config.blacklistModels.includes(search.name)) continue;

  try {
    const buyHtml = await fetchText(search.buyUrl);
    const buyItems = extractItems(buyHtml);

    const cache = state.market[search.name];
    const cacheAge = cache?.updatedAt ? (Date.now() - Date.parse(cache.updatedAt)) / 3600000 : Infinity;
    if (!cache || cacheAge >= config.marketCacheHours) {
      const marketHtml = await fetchText(search.marketUrl);
      const marketItems = extractItems(marketHtml);
      state.market[search.name] = {
        updatedAt: now.toISOString(),
        medianBySize: buildMarketMedianBySize(marketItems)
      };
    }

    for (const item of buyItems) {
      if (alertsSent >= config.maxAlertsPerRun) break;

      const prior = state.items[item.id];
      const priceDrop = prior ? getPriceDrop(prior.lastPrice, item.price, config.priceDropAlert) : null;

      if (prior && !priceDrop) {
        state.items[item.id] = updateItemObservation(prior, item, now);
        continue;
      }

      if (prior?.lastAlertedAt && Date.now() - Date.parse(prior.lastAlertedAt) < 3600000) {
        state.items[item.id] = updateItemObservation(prior, item, now);
        continue;
      }

      const size = inferUkSize(item.title, config.sizes);
      const titleLower = item.title.toLowerCase();

      if (config.avoidKeywords.some((word) => titleLower.includes(word))) {
        state.items[item.id] = updateItemObservation(prior, item, now, { blockedReason: 'keyword' });
        continue;
      }

      if (config.condition.avoid.some((word) => titleLower.includes(word))) {
        state.items[item.id] = updateItemObservation(prior, item, now, { blockedReason: 'condition' });
        continue;
      }

      const sizeMatch = size !== null && config.sizes.includes(size);
      if (!sizeMatch) {
        state.items[item.id] = updateItemObservation(prior, item, now, { blockedReason: 'size' });
        continue;
      }

      const condition = classifyCondition(titleLower, config.condition);
      const marketMedian = state.market[search.name]?.medianBySize?.[String(size)] ?? null;
      const resale = resaleEstimate(search.name, size, marketMedian, config);
      const net = netEconomics(item.price, resale, condition, config.costs);
      const inventoryCount = countInStock(inventory, search.name);
      const demand = seasonalDemand(search.name, config);
      const detail = await getListingEvidence(item.url);
      const sellerRisk = updateSellerRisk(state, detail, item, search.name, config);
      const codeInfo = verifyProductCode(detail.codes, titleLower, search.name, size, config.codeRegistry);
      const duplicatePhoto = recordPhotoHash(state, detail.imageHash, item.id);
      const photoEvidence = scorePhotoEvidence(detail.imageCount, config.photoEvidence);
      const fakeRisk = fakeRiskLevel({
        item,
        titleLower,
        resale,
        codeInfo,
        sellerRisk,
        duplicatePhoto,
        photoEvidence
      });
      const scores = computeScores({
        item,
        resale,
        net,
        demand,
        condition,
        fakeRisk,
        priceDrop,
        inventoryCount,
        maxInventory: config.models[search.name]?.maxInventory ?? 3,
        codeInfo,
        strategy: config.models[search.name]?.strategy ?? config.strategy.default
      });

      const buyScore = scores.buyScore;
      const shouldAlert = buyScore >= search.minScore || Boolean(priceDrop && buyScore >= Math.max(60, search.minScore - 12));
      const strategy = strategyLabel(scores);
      const expectedDays = expectedSellDays(demand, scores.fastFlipScore);

      state.items[item.id] = updateItemObservation(prior, item, now, {
        size,
        condition,
        seller: detail.seller,
        imageHash: detail.imageHash,
        imageCount: detail.imageCount,
        code: codeInfo.code,
        codeStatus: codeInfo.status,
        buyScore,
        resale,
        netProfit: net.netProfit,
        roi: net.roi,
        fakeRisk,
        lastAlertedAt: shouldAlert ? now.toISOString() : prior?.lastAlertedAt ?? null,
        lastPriceDrop: priceDrop
      });

      if (!shouldAlert) continue;

      await sendDiscord(webhook, {
        searchName: search.name,
        item,
        size,
        condition,
        resale,
        net,
        demand,
        fakeRisk,
        sellerRisk,
        duplicatePhoto,
        photoEvidence,
        codeInfo,
        scores,
        strategy,
        expectedDays,
        priceDrop,
        inventoryCount,
        imageBytes: detail.imageBytes,
        imageExt: detail.imageExt
      });

      alertsSent += 1;
    }
  } catch (error) {
    console.warn(`${search.name}: ${error.message}`);
  }
}

state.items = pruneObject(state.items, 1500, (a, b) => Date.parse(a.lastSeenAt || 0) - Date.parse(b.lastSeenAt || 0));
state.sellers = pruneObject(state.sellers, 500, (a, b) => Date.parse(a.lastSeenAt || 0) - Date.parse(b.lastSeenAt || 0));
state.images = pruneObject(state.images, 600, (a, b) => Date.parse(a.lastSeenAt || 0) - Date.parse(b.lastSeenAt || 0));

await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
console.log(`Radar complete. Sent ${alertsSent} alert(s).`);

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': userAgent,
      'Accept-Language': 'en-GB,en;q=0.9'
    },
    redirect: 'follow'
  });

  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

function extractItems(html) {
  const found = new Map();
  const itemRegex = /href=["'](\/items\/([0-9]+)(?:-[^"']*)?)[^"']*["'][^>]*>/gi;
  let match;

  while ((match = itemRegex.exec(html)) !== null) {
    const rawPath = match[1];
    const path = rawPath.split('?')[0];
    const id = match[2];
    const slug = path.replace(/^\/items\/[0-9]+-?/, '').replace(/-/g, ' ').trim();
    const context = stripTags(html.slice(match.index, Math.min(html.length, match.index + 5000)))
      .replace(/\s+/g, ' ')
      .trim();
    const priceMatch = context.match(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    if (!priceMatch) continue;

    const title = cleanTitle(slug || 'Nike listing');
    found.set(id, {
      id,
      title,
      price: Number(priceMatch[1]),
      url: `https://www.vinted.co.uk${path}`
    });
  }

  return [...found.values()].slice(0, 60);
}

function cleanTitle(value) {
  return decodeHtmlEntities(value)
    .replace(/\bsize\s+uk\s*\d+(?:\.\d+)?\b.*$/i, '')
    .replace(/\b(fast shipping|quick shipping|free shipping|preloved|very good condition|good condition|new without tags|new with tags)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .slice(0, 120);
}

function inferUkSize(title, sizes) {
  const lower = title.toLowerCase();
  for (const size of sizes) {
    const patterns = [`uk ${size}`, `size ${size}`, `uk${size}`, `size${size}`];
    if (patterns.some((p) => lower.includes(p))) return size;
  }
  return null;
}

function classifyCondition(titleLower, conditionConfig) {
  if (conditionConfig.new.some((word) => titleLower.includes(word))) return 'new';
  if (conditionConfig.veryGood.some((word) => titleLower.includes(word))) return 'veryGood';
  if (conditionConfig.good.some((word) => titleLower.includes(word))) return 'good';
  return 'unknown';
}

function resaleEstimate(modelName, size, marketMedian, config) {
  const model = config.models[modelName] ?? {};
  const baseline = Number(model.resaleBySize?.[String(size)] ?? model.baselineResale ?? 0);
  if (!marketMedian || marketMedian <= 0) return round2(baseline);

  const adjustedAsk = marketMedian * 0.88;
  const blended = baseline * 0.65 + adjustedAsk * 0.35;
  const floor = baseline * 0.9;
  const ceil = baseline * 1.1;
  return round2(Math.min(ceil, Math.max(floor, blended)));
}

function netEconomics(buyPrice, resale, condition, costs) {
  const cleaning = costs.cleaning?.[condition] ?? costs.cleaning.unknown;
  const fixed = costs.packaging + cleaning + costs.vintedSellingFee;
  const netProfit = resale - buyPrice - fixed;
  const roi = buyPrice > 0 ? (netProfit / buyPrice) * 100 : 0;
  return { cleaning, fixed, netProfit: round2(netProfit), roi: round2(roi) };
}

function seasonalDemand(modelName, config) {
  const month = new Date().getMonth() + 1;
  for (const season of Object.values(config.seasonalDemand)) {
    if (season.months.includes(month)) return round2((season[modelName] ?? 1) * 100);
  }
  return 100;
}

function updateSellerRisk(state, detail, item, modelName, config) {
  if (!detail.seller) return { level: 'UNKNOWN', note: 'Seller not found on page' };

  const key = detail.seller;
  const current = state.sellers[key] ?? {
    candidateCount: 0,
    lowPriceCount: 0,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    imageHashes: {}
  };

  current.candidateCount += 1;
  if (item.price <= (config.models[modelName]?.baselineResale ?? 70) * 0.5) current.lowPriceCount += 1;
  current.lastSeenAt = new Date().toISOString();
  if (detail.imageHash) current.imageHashes[detail.imageHash] = true;
  state.sellers[key] = current;

  const lowShare = current.candidateCount ? current.lowPriceCount / current.candidateCount : 0;
  if (current.candidateCount >= config.sellerRisk.suspiciousCandidateCount && lowShare >= config.sellerRisk.suspiciousLowPriceShare) {
    return { level: 'HIGH', note: `${current.candidateCount} unusually cheap Nike candidates observed` };
  }
  return { level: current.candidateCount >= 3 ? 'MEDIUM' : 'LOW', note: `${current.candidateCount} candidate(s) observed` };
}

function recordPhotoHash(state, imageHash, itemId) {
  if (!imageHash) return { level: 'UNKNOWN', note: 'No image hash' };
  const previous = state.images[imageHash];
  state.images[imageHash] = {
    lastSeenAt: new Date().toISOString(),
    itemIds: Array.from(new Set([...(previous?.itemIds ?? []), itemId])).slice(-10)
  };

  if (previous && !previous.itemIds.includes(itemId)) {
    return { level: 'HIGH', note: `Same first photo seen on ${previous.itemIds.length} other listing(s)` };
  }
  return { level: 'LOW', note: 'No exact first-photo duplicate seen' };
}

function verifyProductCode(pageCodes, titleLower, modelName, size, registry) {
  const codes = Array.from(new Set(pageCodes));
  if (!codes.length) return { status: 'UNKNOWN', code: null, note: 'No Nike style code found on page' };

  const code = codes[0];
  const known = registry[code];
  if (!known) return { status: 'UNVERIFIED', code, note: `${code} not in local code registry` };

  const familyMatch = known.family.toLowerCase() === modelName.toLowerCase();
  const sizeMismatch = known.maxUk && size > known.maxUk;
  if (!familyMatch || sizeMismatch) {
    return { status: 'MISMATCH', code, note: `${code} maps to ${known.model}; family/size does not fit this search` };
  }

  return { status: 'VERIFIED', code, note: `${code} matches ${known.model}` };
}

function scorePhotoEvidence(imageCount, photoConfig) {
  if (imageCount >= photoConfig.minImagesStrong) return { level: 'STRONG', note: `${imageCount} distinct listing image(s)` };
  if (imageCount >= photoConfig.minImagesGood) return { level: 'GOOD', note: `${imageCount} distinct listing image(s)` };
  if (imageCount === 1) return { level: 'WEAK', note: 'Only one listing image detected' };
  return { level: 'UNKNOWN', note: 'No reliable image count detected' };
}

function fakeRiskLevel({ item, titleLower, resale, codeInfo, sellerRisk, duplicatePhoto, photoEvidence }) {
  const redFlags = [
    '1:1', 'ua ', 'rep ', 'replica', 'fake', 'counterfeit', 'not authentic',
    'authentic quality', 'mirror', 'pk batch', 'top quality'
  ];
  const flags = redFlags.filter((word) => titleLower.includes(word));
  const unusuallyCheap = resale > 0 && item.price <= resale * 0.35;

  if (flags.length || unusuallyCheap || codeInfo.status === 'MISMATCH' || sellerRisk.level === 'HIGH' || duplicatePhoto.level === 'HIGH') {
    const notes = [];
    if (flags.length) notes.push('red-flag wording');
    if (unusuallyCheap) notes.push('unusually low price');
    if (codeInfo.status === 'MISMATCH') notes.push('style-code mismatch');
    if (sellerRisk.level === 'HIGH') notes.push('seller pattern');
    if (duplicatePhoto.level === 'HIGH') notes.push('duplicate first photo');
    return { level: '🔴 HIGH', note: notes.join(' • ') };
  }

  if (photoEvidence.level === 'WEAK' || sellerRisk.level === 'MEDIUM' || item.price <= resale * 0.5) {
    return { level: '🟠 MEDIUM', note: 'Manual checks recommended' };
  }

  return { level: '🟢 LOW', note: 'No configured major red flags detected' };
}

function computeScores({ item, resale, net, demand, condition, fakeRisk, priceDrop, inventoryCount, maxInventory, codeInfo, strategy }) {
  const profile = config.strategy.profiles[strategy] ?? config.strategy.profiles.balanced;
  const marginScore = clamp(((resale - item.price) / Math.max(resale, 1)) * 100, 0, 100);
  const roiScore = clamp(net.roi, 0, 200) / 2;
  const demandScore = clamp(demand, 50, 115);
  const conditionScore = condition === 'new' ? 100 : condition === 'veryGood' ? 88 : condition === 'good' ? 72 : 50;
  const riskScore = fakeRisk.level === '🟢 LOW' ? 100 : fakeRisk.level === '🟠 MEDIUM' ? 55 : 0;
  let raw = marginScore * profile.marginWeight + roiScore * profile.roiWeight + demandScore * profile.demandWeight + conditionScore * profile.conditionWeight + riskScore * profile.riskWeight;

  if (inventoryCount >= maxInventory) raw -= 10;
  else if (inventoryCount === maxInventory - 1) raw -= 4;
  if (priceDrop) raw += Math.min(8, 3 + priceDrop.percent * 20);
  if (codeInfo.status === 'VERIFIED') raw += 3;
  if (codeInfo.status === 'MISMATCH') raw -= 12;

  const buyScore = clamp(Math.round(raw), 0, 100);
  const fastFlipScore = clamp(Math.round((marginScore * 0.35) + (demand * 0.35) + (conditionScore * 0.15) + (riskScore * 0.15)), 0, 100);
  const maxProfitScore = clamp(Math.round((marginScore * 0.45) + (roiScore * 0.35) + (conditionScore * 0.10) + (riskScore * 0.10)), 0, 100);
  return { buyScore, fastFlipScore, maxProfitScore };
}

function strategyLabel(scores) {
  if (scores.fastFlipScore >= scores.maxProfitScore + 8) return '⚡ FAST FLIP';
  if (scores.maxProfitScore >= scores.fastFlipScore + 8) return '💰 MAX PROFIT';
  return '⚖️ BALANCED';
}

function expectedSellDays(demand, fastFlipScore) {
  if (fastFlipScore >= 85 && demand >= 100) return '3–7 days';
  if (fastFlipScore >= 72) return '7–14 days';
  return '14–30 days';
}

function getPriceDrop(previousPrice, currentPrice, settings) {
  if (!settings.enabled || !previousPrice || previousPrice <= currentPrice) return null;
  const amount = previousPrice - currentPrice;
  const percent = amount / previousPrice;
  if (amount < settings.minDropAmount || percent < settings.minDropPercent) return null;
  return { from: round2(previousPrice), to: round2(currentPrice), amount: round2(amount), percent: round2(percent) };
}

function buildMarketMedianBySize(items) {
  const grouped = {};
  for (const item of items) {
    const size = inferUkSize(item.title, config.sizes);
    if (size === null || item.price <= 0 || item.price > 200) continue;
    (grouped[String(size)] ??= []).push(item.price);
  }

  const output = {};
  for (const [size, prices] of Object.entries(grouped)) {
    prices.sort((a, b) => a - b);
    const middle = Math.floor(prices.length / 2);
    output[size] = round2(prices.length % 2 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2);
  }
  return output;
}

async function getListingEvidence(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': userAgent,
      'Accept-Language': 'en-GB,en;q=0.9'
    },
    redirect: 'follow'
  });

  if (!response.ok) return { seller: null, codes: [], imageUrl: null, imageBytes: null, imageExt: 'jpg', imageCount: 0, imageHash: null };

  const html = await response.text();
  const imageUrls = extractImageUrls(html);
  const imageUrl = imageUrls[0] ?? null;
  const codes = Array.from(new Set([...html.matchAll(/\b[A-Z]{2,4}\d{4}-\d{3}\b/g)].map((m) => m[0])));
  const seller = extractSeller(html);

  let imageBytes = null;
  let imageExt = 'jpg';
  let imageHash = null;

  if (imageUrl) {
    try {
      const imageResponse = await fetch(imageUrl, { headers: { 'User-Agent': userAgent, 'Referer': 'https://www.vinted.co.uk/' } });
      if (imageResponse.ok) {
        imageBytes = Buffer.from(await imageResponse.arrayBuffer());
        imageHash = crypto.createHash('sha256').update(imageBytes).digest('hex');
        imageExt = contentTypeToExt(imageResponse.headers.get('content-type'));
      }
    } catch {
      // Image failure never blocks an alert.
    }
  }

  return { seller, codes, imageUrl, imageBytes, imageExt, imageCount: imageUrls.length, imageHash };
}

function extractImageUrls(html) {
  const urls = [];
  const push = (value) => {
    const clean = decodeHtmlEntities(value).replace(/\\u0026/g, '&');
    if (!/^https?:\/\//i.test(clean)) return;
    if (!/\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(clean)) return;
    if (!urls.includes(clean)) urls.push(clean);
  };

  const metaPatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/gi
  ];
  for (const pattern of metaPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) push(match[1]);
  }

  const vintedPattern = /https?:\\?\/\\?\/[^"'\s<>]+/gi;
  let match;
  while ((match = vintedPattern.exec(html)) !== null && urls.length < 12) {
    const value = match[0].replace(/\\$/, '');
    if (/vinted/i.test(value)) push(value);
  }

  return urls.slice(0, 12);
}

function extractSeller(html) {
  const patterns = [
    /"username":"([^"]+)"/i,
    /"seller":\{"username":"([^"]+)"/i,
    /"user":\{"login":"([^"]+)"/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1]);
  }
  return null;
}

async function sendDiscord(webhookUrl, deal) {
  const profitText = `£${deal.net.netProfit.toFixed(2)}`;
  const roiText = `${deal.net.roi.toFixed(0)}%`;
  const resaleRange = `£${Math.max(0, deal.resale - 5).toFixed(0)}–£${Math.round(deal.resale + 5)}`;
  const priceDropText = deal.priceDrop ? `\n📉 **PRICE DROP:** £${deal.priceDrop.from.toFixed(2)} → **£${deal.priceDrop.to.toFixed(2)}** (-£${deal.priceDrop.amount.toFixed(2)})` : '';
  const riskNote = deal.fakeRisk.level === '🔴 HIGH' ? '⚠️ HIGH fake-risk flags — inspect photos, labels and code before buying.' : '⚠️ Check authenticity before buying.';

  const embed = {
    title: '🚨 NEW BARGAIN FOUND 🔥',
    description: `**⭐ ${deal.searchName.toUpperCase()}**\n**${deal.item.title}**\n\n🏷️ **Price:** £${deal.item.price.toFixed(2)}\n📏 **Size:** UK ${deal.size}\n📦 **Condition:** ${conditionLabel(deal.condition)}\n📈 **Est. resale:** ${resaleRange}\n💰 **Est. net profit:** ${profitText}\n📊 **ROI:** ${roiText}\n⚡ **Strategy:** ${deal.strategy}${priceDropText}`,
    url: deal.item.url,
    color: deal.fakeRisk.level === '🔴 HIGH' ? 15158332 : deal.fakeRisk.level === '🟠 MEDIUM' ? 16753920 : 5763719,
    fields: [
      { name: '🎯 BUY SCORE', value: `**${deal.scores.buyScore}/100**`, inline: true },
      { name: '⚡ FAST FLIP', value: `${deal.scores.fastFlipScore}/100`, inline: true },
      { name: '💰 MAX PROFIT', value: `${deal.scores.maxProfitScore}/100`, inline: true },
      { name: '🛡️ FAKE RISK', value: `**${deal.fakeRisk.level}**\n${deal.fakeRisk.note}`, inline: true },
      { name: '📸 PHOTO EVIDENCE', value: `${deal.photoEvidence.level}\n${deal.photoEvidence.note}`, inline: true },
      { name: '🔎 CODE CHECK', value: `${codeLabel(deal.codeInfo)}\n${deal.codeInfo.note}`, inline: true },
      { name: '🔥 DEMAND', value: `${deal.demand}/100`, inline: true },
      { name: '⚡ EXPECTED SALE', value: deal.expectedDays, inline: true },
      { name: '📦 YOUR STOCK', value: `${deal.inventoryCount} in stock`, inline: true },
      { name: '👤 SELLER', value: sellerLabel(deal.sellerRisk), inline: true },
      { name: '🔁 PHOTO DUPLICATE', value: deal.duplicatePhoto.note, inline: true },
      { name: '🧽 CLEANING ALLOWANCE', value: `£${deal.net.cleaning.toFixed(2)}`, inline: true }
    ],
    footer: { text: `Dan's Vault Radar • Manual purchase only • ${riskNote}` },
    timestamp: new Date().toISOString()
  };

  const form = new FormData();
  form.append('payload_json', JSON.stringify({ username: "Dan's Vault Radar", embeds: [embed] }));

  if (deal.imageBytes && deal.imageBytes.length < 8_000_000) {
    const filename = `listing.${deal.imageExt}`;
    form.append('file', new Blob([deal.imageBytes], { type: `image/${deal.imageExt === 'jpg' ? 'jpeg' : deal.imageExt}` }), filename);
    embed.image = { url: `attachment://${filename}` };
    form.set('payload_json', JSON.stringify({ username: "Dan's Vault Radar", embeds: [embed] }));
  }

  const response = await fetch(webhookUrl, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}`);
}

async function sendTestAlerts(webhookUrl) {
  const samples = [
    { model: 'Nike P-6000', price: 29.99, resale: 65, size: 8, score: 94, fake: '🟢 LOW', strategy: '⚡ FAST FLIP', risk: 'No configured major red flags detected' },
    { model: 'Nike Vomero', price: 34.99, resale: 65, size: 9, score: 90, fake: '🟢 LOW', strategy: '⚖️ BALANCED', risk: 'No configured major red flags detected' },
    { model: 'Nike TN', price: 39.99, resale: 75, size: 7, score: 86, fake: '🟠 MEDIUM', strategy: '💰 MAX PROFIT', risk: 'Manual checks recommended' }
  ];

  for (const sample of samples) {
    const profit = sample.resale - sample.price - config.costs.packaging;
    const embed = {
      title: '🧪 TEST • 🚨 NEW BARGAIN FOUND 🔥',
      description: `**⭐ ${sample.model.toUpperCase()}**\n**Sample listing • UK ${sample.size}**\n\n🏷️ **Price:** £${sample.price.toFixed(2)}\n📏 **Size:** UK ${sample.size}\n📦 **Condition:** Very good\n📈 **Est. resale:** £${sample.resale.toFixed(2)}\n💰 **Est. net profit:** £${profit.toFixed(2)}\n📊 **ROI:** ${((profit / sample.price) * 100).toFixed(0)}%\n⚡ **Strategy:** ${sample.strategy}`,
      url: 'https://www.vinted.co.uk/',
      color: sample.fake === '🔴 HIGH' ? 15158332 : sample.fake === '🟠 MEDIUM' ? 16753920 : 5763719,
      fields: [
        { name: '🎯 BUY SCORE', value: `**${sample.score}/100**`, inline: true },
        { name: '🛡️ FAKE RISK', value: `**${sample.fake}**\n${sample.risk}`, inline: true },
        { name: '📸 PHOTO EVIDENCE', value: 'STRONG\n4+ images', inline: true },
        { name: '🔎 CODE CHECK', value: 'VERIFIED\nExample code', inline: true },
        { name: '🔥 DEMAND', value: '104/100', inline: true },
        { name: '⚡ EXPECTED SALE', value: '3–7 days', inline: true }
      ],
      footer: { text: "TEST ALERT • Dan's Vault Radar • Manual purchase only" }
    };
    const response = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: "Dan's Vault Radar", embeds: [embed] }) });
    if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}`);
  }
}

function updateItemObservation(previous, item, now, extra = {}) {
  return {
    firstSeenAt: previous?.firstSeenAt ?? now.toISOString(),
    ...previous,
    ...extra,
    lastSeenAt: now.toISOString(),
    lastPrice: item.price,
    title: item.title,
    url: item.url
  };
}

function migrateState(raw) {
  if (raw?.items && raw?.market && raw?.sellers && raw?.images) return raw;
  const items = {};
  for (const id of raw.seen ?? []) {
    items[id] = {
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      lastPrice: 0,
      title: 'Previously seen listing',
      url: `https://www.vinted.co.uk/items/${id}`
    };
  }
  return { version: 2, items, market: {}, sellers: {}, images: {} };
}

async function loadJson(url, fallback) {
  try { return JSON.parse(await fs.readFile(url, 'utf8')); } catch { return fallback; }
}

function pruneObject(object, maxEntries, sortFn) {
  const entries = Object.entries(object);
  if (entries.length <= maxEntries) return object;
  entries.sort((a, b) => sortFn(a[1], b[1]));
  return Object.fromEntries(entries.slice(-maxEntries));
}

function countInStock(inv, modelName) {
  return (inv.items ?? []).filter((item) => item.status === 'in_stock' && item.model === modelName).length;
}

function conditionLabel(condition) {
  return ({ new: 'New', veryGood: 'Very good', good: 'Good / preloved', unknown: 'Unknown' })[condition] ?? 'Unknown';
}

function codeLabel(info) {
  return ({ VERIFIED: '🟢 VERIFIED', MISMATCH: '🔴 MISMATCH', UNVERIFIED: '🟠 UNVERIFIED', UNKNOWN: '⚪ UNKNOWN' })[info.status] ?? info.status;
}

function sellerLabel(risk) {
  if (!risk) return 'UNKNOWN';
  return `${risk.level}\n${risk.note}`;
}

function contentTypeToExt(contentType) {
  const value = (contentType || '').toLowerCase();
  if (value.includes('png')) return 'png';
  if (value.includes('webp')) return 'webp';
  return 'jpg';
}

function decodeHtmlEntities(value) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/gi, "'").replace(/&#39;/g, "'").replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');
}

function stripTags(value) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function round2(value) { return Number(Number(value).toFixed(2)); }
