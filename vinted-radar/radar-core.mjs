import fs from 'node:fs/promises';

const USER_AGENT = 'Mozilla/5.0 (compatible; DansVaultRadar/7.0; +https://github.com/TragiicMyst/dans-vault)';
const LIVE_FRESHNESS_MINUTES = 10;
const ITEMS_PER_SEARCH = 80;
const FETCH_TIMEOUT_MS = 9000;
const FETCH_ATTEMPTS = 3;

export const TRAINER_SIZES = [7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5];
export const CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

const trainerModelNames = new Set([
  'Nike P-6000', 'Nike Vomero', 'Nike TN', 'Nike Pegasus Premium', 'Nike Shox TL',
  'Nike Air Max 95', 'Nike Air Max 97', 'Nike Vomero 5', 'Nike V5 RNR',
  'Nike Air Force 1', 'Nike Dunk Low'
]);

const clothingSearchSpecs = [
  ['Nike Tech Fleece Hoodie', 'nike tech fleece hoodie', 30],
  ['Nike Tech Fleece Windrunner', 'nike tech fleece windrunner', 32],
  ['Nike Tech Fleece Joggers', 'nike tech fleece joggers', 25],
  ['Nike Tech Fleece Tracksuit', 'nike tech fleece tracksuit', 50],
  ['Nike ACG Fleece', 'nike acg fleece', 40],
  ['Nike ACG Jacket', 'nike acg jacket', 65],
  ['Nike Puffer Jacket', 'nike puffer jacket', 60],
  ['Nike Windrunner Jacket', 'nike windrunner jacket', 35],
  ['Nike Sportswear Tracksuit', 'nike sportswear tracksuit', 45],
  ['Nike Miler Shorts', 'nike miler shorts', 16],
  ['Nike Challenger Shorts', 'nike challenger shorts', 16],
  ['Nike Stride Shorts', 'nike stride shorts', 18],
  ['Nike Pro Training Shorts', 'nike pro training shorts', 15],
  ['Nike Miler Running Top', 'nike miler running top', 15],
  ['Nike Dri-FIT Running Top', 'nike dri-fit running top', 15],
  ['Nike Unlimited Shorts', 'nike unlimited shorts', 18]
];

const models = {
  'Nike P-6000': shoeModel(65,{7:60,8:65,9:68,10:70}),
  'Nike Vomero': shoeModel(65,{7:60,8:65,9:68,10:70}),
  'Nike TN': shoeModel(80,{7:72,8:78,9:82,10:85},'balanced'),
  'Nike Pegasus Premium': shoeModel(125,{7:115,8:125,9:130,10:135},'balanced'),
  'Nike Shox TL': shoeModel(100,{7:90,8:100,9:105,10:110}),
  'Nike Air Max 95': shoeModel(110,{7:100,8:110,9:115,10:120},'balanced'),
  'Nike Air Max 97': shoeModel(105,{7:95,8:105,9:110,10:115},'balanced'),
  'Nike Vomero 5': shoeModel(95,{7:85,8:95,9:100,10:105}),
  'Nike V5 RNR': shoeModel(65,{7:60,8:65,9:68,10:70}),
  'Nike Air Force 1': shoeModel(70,{7:65,8:70,9:72,10:75}),
  'Nike Dunk Low': shoeModel(75,{7:70,8:75,9:78,10:80},'balanced'),
  'Nike Tech Fleece Hoodie': clothingModel(38,{XS:30,S:35,M:38,L:40,XL:42,XXL:42}),
  'Nike Tech Fleece Windrunner': clothingModel(40,{XS:32,S:38,M:40,L:42,XL:44,XXL:45}),
  'Nike Tech Fleece Joggers': clothingModel(32,{XS:25,S:30,M:32,L:35,XL:36,XXL:36}),
  'Nike Tech Fleece Tracksuit': clothingModel(65,{XS:55,S:60,M:65,L:70,XL:72,XXL:75},'balanced'),
  'Nike ACG Fleece': clothingModel(55,{XS:45,S:50,M:55,L:60,XL:62,XXL:65},'balanced'),
  'Nike ACG Jacket': clothingModel(85,{XS:70,S:78,M:85,L:90,XL:95,XXL:95},'balanced'),
  'Nike Puffer Jacket': clothingModel(75,{XS:60,S:68,M:75,L:80,XL:85,XXL:85},'balanced'),
  'Nike Windrunner Jacket': clothingModel(45,{XS:35,S:40,M:45,L:48,XL:50,XXL:50}),
  'Nike Sportswear Tracksuit': clothingModel(55,{XS:45,S:50,M:55,L:58,XL:60,XXL:60}),
  'Nike Miler Shorts': clothingModel(22,{XS:18,S:20,M:22,L:24,XL:25,XXL:25}),
  'Nike Challenger Shorts': clothingModel(20,{XS:16,S:18,M:20,L:22,XL:24,XXL:24}),
  'Nike Stride Shorts': clothingModel(25,{XS:20,S:23,M:25,L:27,XL:28,XXL:28}),
  'Nike Pro Training Shorts': clothingModel(18,{XS:14,S:16,M:18,L:20,XL:20,XXL:20}),
  'Nike Miler Running Top': clothingModel(18,{XS:14,S:16,M:18,L:20,XL:21,XXL:21}),
  'Nike Dri-FIT Running Top': clothingModel(16,{XS:12,S:14,M:16,L:18,XL:19,XXL:19}),
  'Nike Unlimited Shorts': clothingModel(22,{XS:17,S:20,M:22,L:24,XL:25,XXL:25})
};

const scoreFloors = {
  trainers: { default: 60, 'Nike Pegasus Premium': 63, 'Nike Air Max 95': 62, 'Nike Air Max 97': 62, 'Nike Shox TL': 62, 'Nike Vomero 5': 62, 'Nike TN': 62 },
  clothing: { default: 60, 'Nike Tech Fleece Tracksuit': 63, 'Nike ACG Fleece': 63, 'Nike ACG Jacket': 63, 'Nike Puffer Jacket': 62 }
};

export async function runRadar({ bot, baseConfig, statePath, inventoryPath, webhook, testMode = false }) {
  if (!['trainers', 'clothing'].includes(bot)) throw new Error(`Invalid BOT_TYPE: ${bot}`);
  if (!webhook) throw new Error('Missing Discord webhook secret');

  if (testMode) {
    await sendTest(webhook, bot);
    return;
  }

  const searches = buildSearches(bot, baseConfig);
  if (!searches.length) throw new Error(`No searches configured for ${bot}`);

  const targetSizes = bot === 'clothing' ? CLOTHING_SIZES : TRAINER_SIZES;
  const state = await loadJson(statePath, defaultState());
  const inventory = await loadJson(inventoryPath, { items: [] });
  normalizeState(state);

  const now = new Date();
  const bootstrapping = state.freshness.bootstrapped !== true;
  const diagnostics = {
    bot,
    lastRunAt: now.toISOString(),
    searchGroups: searches.length,
    successfulSearches: 0,
    failedSearches: 0,
    candidateItems: 0,
    freshItems: 0,
    qualifyingAlerts: 0,
    discordFailures: 0,
    failures: {}
  };

  for (const search of searches) {
    const frontierKey = search.key ?? search.name;
    try {
      const html = await fetchText(search.buyUrl, { expectCatalog: true });
      const raw = extractItems(html, ITEMS_PER_SEARCH);
      const candidates = raw.filter(item => matchesSearchCandidate(item, search.name));
      diagnostics.successfulSearches += 1;
      diagnostics.candidateItems += candidates.length;

      const frontier = state.freshness.frontiers[frontierKey];
      const frontierMaxId = frontier?.maxId ? String(frontier.maxId) : null;
      let maxRelevantId = frontierMaxId;

      for (const item of candidates) {
        const prior = state.items[item.id];
        const firstSeen = !prior;
        const ageFresh = item.ageMinutes !== null && item.ageMinutes <= LIVE_FRESHNESS_MINUTES;
        const idNewer = frontierMaxId ? compareNumericIds(item.id, frontierMaxId) > 0 : true;
        const freshnessSignal = ageFresh || (item.ageMinutes === null && idNewer);

        maxRelevantId = maxRelevantId === null || compareNumericIds(item.id, maxRelevantId) > 0
          ? String(item.id)
          : maxRelevantId;

        if (bootstrapping) {
          remember(state, item, prior, { bootstrapSeen: true, lastSeenAt: now.toISOString() });
          continue;
        }

        if (!firstSeen && prior?.lastAlertedAt) {
          remember(state, item, prior, { lastSeenAt: now.toISOString() });
          continue;
        }

        if (!firstSeen && !ageFresh) {
          remember(state, item, prior, { lastSeenAt: now.toISOString() });
          continue;
        }

        if (firstSeen && !freshnessSignal) {
          remember(state, item, prior, { blockedReason: 'stale-or-no-freshness-signal', lastSeenAt: now.toISOString() });
          continue;
        }

        diagnostics.freshItems += 1;
        const text = normalizeText(`${item.title} ${item.fullText}`);

        if (containsBlockedKeyword(text, baseConfig.avoidKeywords ?? [])) {
          remember(state, item, prior, { blockedReason: 'keyword', lastSeenAt: now.toISOString() });
          continue;
        }

        if (hasBadCondition(text, baseConfig.condition?.avoid ?? [])) {
          remember(state, item, prior, { blockedReason: 'condition', lastSeenAt: now.toISOString() });
          continue;
        }

        if (Number.isFinite(Number(search.maxPrice)) && item.price > Number(search.maxPrice)) {
          remember(state, item, prior, { blockedReason: 'price', lastSeenAt: now.toISOString() });
          continue;
        }

        let detailText = '';
        let size = inferSize(item.fullText, targetSizes, bot);
        let condition = classifyCondition(text);

        if (size === null || condition === 'unknown') {
          try {
            detailText = normalizeText(stripTags(await fetchText(item.url)));
          } catch (error) {
            console.warn(`${search.name} item ${item.id}: detail fetch failed: ${error.message}`);
          }
          if (size === null && detailText) size = inferSize(detailText, targetSizes, bot);
          if (condition === 'unknown' && detailText) condition = classifyCondition(detailText);
        }

        if (size === null) {
          remember(state, item, prior, { blockedReason: 'size', lastSeenAt: now.toISOString() });
          continue;
        }

        if (condition === 'unknown') {
          remember(state, item, prior, { blockedReason: 'condition-not-confirmed', size, lastSeenAt: now.toISOString() });
          continue;
        }

        const resale = resaleEstimate(search.name, size, state.market?.[search.name]?.medianBySize?.[String(size)] ?? null);
        if (!resale) {
          remember(state, item, prior, { blockedReason: 'no-resale-baseline', size, condition, lastSeenAt: now.toISOString() });
          continue;
        }

        const costs = baseConfig.costs ?? {};
        const fixedCosts = Number(costs.packaging ?? 0.8)
          + Number(costs.cleaning?.[condition] ?? costs.cleaning?.new ?? 0)
          + Number(costs.vintedSellingFee ?? 0);
        const profit = round2(resale - item.price - fixedCosts);
        const roi = item.price > 0 ? round2((profit / item.price) * 100) : 0;

        if (profit < 10 || roi < 25) {
          remember(state, item, prior, {
            blockedReason: 'weak-margin', size, condition, resale,
            netProfit: profit, roi, buyScore: 0, lastSeenAt: now.toISOString()
          });
          continue;
        }

        const risk = fakeRiskLevel(item, `${text} ${detailText}`, resale);
        const demand = seasonalDemand(search.name, baseConfig);
        const strategy = models[search.name]?.strategy ?? 'balanced';
        const stock = countInStock(inventory.items ?? [], search.name);
        const score = buyScore({ searchName: search.name, resale, price: item.price, profit, roi, risk, demand, strategy, stock });

        const threshold = Number(search.minScore ?? 60);
        const strong = profit >= 15 && roi >= 40 && risk.level !== 'HIGH';
        const exceptional = profit >= 25 && roi >= 65 && risk.level !== 'HIGH';
        const shouldAlert = score >= threshold || strong || exceptional;

        const commonState = {
          size, condition, resale, netProfit: profit, roi, buyScore: score,
          fakeRisk: risk, blockedReason: shouldAlert ? undefined : 'score',
          lastSeenAt: now.toISOString()
        };

        if (!shouldAlert) {
          remember(state, item, prior, commonState);
          continue;
        }

        const alert = {
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
        };

        try {
          await sendDiscord(webhook, alert);
          diagnostics.qualifyingAlerts += 1;
          remember(state, item, prior, {
            ...commonState,
            blockedReason: undefined,
            lastAlertedAt: new Date().toISOString()
          });
          console.log(`ALERT SENT: ${search.name} | ${item.title} | £${item.price.toFixed(2)} | size ${size}`);
        } catch (error) {
          diagnostics.discordFailures += 1;
          console.error(`Discord delivery failed for ${item.id}: ${error.message}`);
          if (prior) state.items[item.id] = prior;
          else delete state.items[item.id];
        }
      }

      if (maxRelevantId !== null) {
        state.freshness.frontiers[frontierKey] = {
          maxId: maxRelevantId,
          updatedAt: now.toISOString()
        };
      }
    } catch (error) {
      diagnostics.failedSearches += 1;
      diagnostics.failures[search.key ?? search.name] = error.message;
      console.error(`${search.name}: ${error.message}`);
    }
  }

  if (bootstrapping) {
    state.freshness.bootstrapped = true;
    console.log('Radar bootstrap complete: current catalogue marked as seen; no historical alerts sent.');
  }

  state.freshness.lastScanAt = now.toISOString();
  state.updatedAt = now.toISOString();
  state.radarVersion = 3;
  state.diagnostics = diagnostics;
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n');

  console.log(
    `RADAR SUMMARY ${bot}: ${diagnostics.successfulSearches}/${diagnostics.searchGroups} searches OK, ` +
    `${diagnostics.candidateItems} candidates, ${diagnostics.freshItems} fresh, ` +
    `${diagnostics.qualifyingAlerts} alerts, ${diagnostics.discordFailures} Discord failures.`
  );

  if (diagnostics.successfulSearches === 0) {
    throw new Error(`All ${bot} Vinted searches failed`);
  }
  if (diagnostics.discordFailures > 0) {
    throw new Error(`${diagnostics.discordFailures} Discord bargain alert(s) failed to deliver`);
  }

  return diagnostics;
}

export function buildSearches(bot, baseConfig) {
  if (bot === 'clothing') {
    return clothingSearchSpecs.map(([name, query, baseMax]) => {
      const maxPrice = round2(baseMax * 1.30);
      return {
        key: `${name}::${query}`,
        name,
        buyUrl: catalogUrl(query, maxPrice),
        maxPrice,
        minScore: scoreFloors.clothing[name] ?? scoreFloors.clothing.default
      };
    });
  }

  const base = (baseConfig.searches ?? [])
    .filter(search => trainerModelNames.has(search.name))
    .map(search => {
      const maxPrice = Number.isFinite(Number(search.maxPrice))
        ? round2(Number(search.maxPrice) * 1.30)
        : search.maxPrice;
      const queryUrl = new URL(search.buyUrl);
      queryUrl.searchParams.set('order', 'newest_first');
      if (Number.isFinite(Number(maxPrice))) queryUrl.searchParams.set('price_to', String(maxPrice));
      return {
        ...search,
        key: `${search.name}::primary`,
        buyUrl: queryUrl.toString(),
        maxPrice,
        minScore: scoreFloors.trainers[search.name] ?? scoreFloors.trainers.default
      };
    });

  const tn = base.find(search => search.name === 'Nike TN');
  if (tn) {
    base.push({
      ...tn,
      key: 'Nike TN::air-max-plus',
      buyUrl: catalogUrl('nike air max plus', tn.maxPrice)
    });
  }

  return base.sort((a, b) => Number(b.name === 'Nike Vomero 5') - Number(a.name === 'Nike Vomero 5'));
}

function catalogUrl(query, maxPrice) {
  const url = new URL('https://www.vinted.co.uk/catalog');
  url.searchParams.set('search_text', query);
  url.searchParams.set('order', 'newest_first');
  if (Number.isFinite(Number(maxPrice))) url.searchParams.set('price_to', String(maxPrice));
  return url.toString();
}

export function extractItems(html, limit = ITEMS_PER_SEARCH) {
  const found = new Map();
  const re = /href=["'](\/items\/([0-9]+)(?:-[^"']*)?)[^"']*["'][^>]*>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const id = match[2];
    const itemPath = match[1].split('?')[0];
    const context = stripTags(html.slice(match.index, Math.min(html.length, match.index + 2600)))
      .replace(/\s+/g, ' ')
      .trim();
    const priceMatch = context.match(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    if (!priceMatch) continue;

    const title = decodeHtml(
      itemPath.replace(/^\/items\/[0-9]+-?/, '').replace(/-/g, ' ').trim()
    );
    const price = Number(priceMatch[1]);
    if (!Number.isFinite(price) || price <= 0) continue;

    found.set(id, {
      id,
      title,
      price,
      ageMinutes: parseAgeMinutes(context),
      fullText: `${title} ${context}`,
      url: `https://www.vinted.co.uk${itemPath}`
    });
  }
  return [...found.values()].slice(0, limit);
}

export function matchesSearchCandidate(item, searchName) {
  const title = normalizeText(item?.title ?? '');
  const full = normalizeText(`${item?.title ?? ''} ${item?.fullText ?? ''}`);
  const has = (...parts) => parts.every(part => title.includes(part));
  const fullAny = (...parts) => parts.some(part => full.includes(part));

  switch (searchName) {
    case 'Nike P-6000': return /\bp\s?6000\b/.test(title);
    case 'Nike Vomero 5': return has('vomero', '5');
    case 'Nike Vomero': return title.includes('vomero');
    case 'Nike TN':
      return /(^|\s)tns?(\s|$)/.test(title)
        || /(^|\s)tans?(\s|$)/.test(title)
        || title.includes('air max plus')
        || title.includes('tuned');
    case 'Nike Pegasus Premium': return has('pegasus', 'premium');
    case 'Nike Shox TL': return title.includes('shox');
    case 'Nike Air Max 95': return title.includes('air max 95') || title.includes('am95');
    case 'Nike Air Max 97': return title.includes('air max 97') || title.includes('am97');
    case 'Nike V5 RNR': return has('v5', 'rnr');
    case 'Nike Air Force 1': return title.includes('air force') || /(^|\s)af1(\s|$)/.test(title);
    case 'Nike Dunk Low': return title.includes('dunk');
    case 'Nike Tech Fleece Hoodie': return full.includes('tech') && full.includes('fleece') && fullAny('hoodie', 'hoody', 'zip', 'windrunner');
    case 'Nike Tech Fleece Windrunner': return full.includes('tech') && full.includes('fleece') && fullAny('windrunner', 'jacket', 'zip');
    case 'Nike Tech Fleece Joggers': return full.includes('tech') && full.includes('fleece') && fullAny('jogger', 'trouser', 'bottom');
    case 'Nike Tech Fleece Tracksuit': return full.includes('tech') && full.includes('fleece') && fullAny('tracksuit', 'track suit', 'set', 'full');
    case 'Nike ACG Fleece': return full.includes('acg') && full.includes('fleece');
    case 'Nike ACG Jacket': return full.includes('acg') && fullAny('jacket', 'coat', 'shell');
    case 'Nike Puffer Jacket': return full.includes('nike') && fullAny('puffer', 'down jacket', 'down coat');
    case 'Nike Windrunner Jacket': return full.includes('windrunner');
    case 'Nike Sportswear Tracksuit': return full.includes('nike') && fullAny('tracksuit', 'track suit', 'set');
    case 'Nike Miler Shorts': return full.includes('miler') && fullAny('short', 'shorts');
    case 'Nike Challenger Shorts': return full.includes('challenger') && fullAny('short', 'shorts');
    case 'Nike Stride Shorts': return full.includes('stride') && fullAny('short', 'shorts');
    case 'Nike Pro Training Shorts': return full.includes('nike') && full.includes('pro') && fullAny('short', 'shorts');
    case 'Nike Miler Running Top': return full.includes('miler') && fullAny('top', 'shirt', 'tee', 't shirt');
    case 'Nike Dri-FIT Running Top': return fullAny('dri fit', 'drifit') && fullAny('top', 'shirt', 'tee', 't shirt');
    case 'Nike Unlimited Shorts': return full.includes('unlimited') && fullAny('short', 'shorts');
    default: return full.includes('nike');
  }
}

export function inferSize(text, sizes, bot) {
  const normalized = normalizeText(text);

  if (bot === 'clothing') {
    const clothingPatterns = [
      [/\b(?:size\s*[:\-]?\s*)?(xxl|2xl)\b/i, 'XXL'],
      [/\b(?:size\s*[:\-]?\s*)?xl\b/i, 'XL'],
      [/\b(?:size\s*[:\-]?\s*)?xs\b/i, 'XS'],
      [/\bsize\s*[:\-]?\s*s\b/i, 'S'],
      [/\bsize\s*[:\-]?\s*m\b/i, 'M'],
      [/\bsize\s*[:\-]?\s*l\b/i, 'L'],
      [/\bextra\s+small\b/i, 'XS'],
      [/\bsmall\b/i, 'S'],
      [/\bmedium\b/i, 'M'],
      [/\blarge\b/i, 'L'],
      [/\bextra\s+large\b/i, 'XL']
    ];
    for (const [pattern, value] of clothingPatterns) {
      if (pattern.test(normalized) && sizes.includes(value)) return value;
    }
    return null;
  }

  const orderedSizes = [...sizes].sort((a, b) => String(b).length - String(a).length);
  for (const size of orderedSizes) {
    const escaped = String(size).replace('.', '\\.');
    const patterns = [
      new RegExp(`\\b(?:uk|size)\\s*[:\\-]?\\s*${escaped}(?!\\.\\d)\\b`, 'i'),
      new RegExp(`\\b${escaped}(?!\\.\\d)\\s*(?:uk)\\b`, 'i')
    ];
    if (patterns.some(pattern => pattern.test(normalized))) return Number(size);
  }
  return null;
}

export function classifyCondition(text) {
  const normalized = normalizeText(text);
  if (/\bnew\s+without\s+tags\b/i.test(normalized)) return 'newWithoutTags';
  if (/\bnew\s+with\s+tags\b/i.test(normalized)) return 'newWithTags';
  return 'unknown';
}

export function parseAgeMinutes(text) {
  const normalized = normalizeText(text);
  if (/\bjust now\b|\bnow\b/.test(normalized)) return 0;
  let match = normalized.match(/\b(?:uploaded\s*)?(\d+)\s*(?:minute|minutes|min)\s+ago\b/);
  if (match) return Number(match[1]);
  match = normalized.match(/\b(?:uploaded\s*)?(\d+)\s*(?:hour|hours|hr|hrs)\s+ago\b/);
  if (match) return Number(match[1]) * 60;
  match = normalized.match(/\b(?:uploaded\s*)?(\d+)\s*(?:day|days)\s+ago\b/);
  if (match) return Number(match[1]) * 1440;
  return null;
}

async function fetchText(url, { expectCatalog = false } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'en-GB,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });

      const body = await response.text();
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }

      const lower = body.toLowerCase();
      if (lower.includes('captcha') || lower.includes('access denied') || lower.includes('cf-chl-')) {
        const error = new Error('Vinted returned a challenge/block page');
        error.retryable = true;
        throw error;
      }

      if (expectCatalog && body.length < 1000) {
        const error = new Error('Vinted catalogue response was unexpectedly short');
        error.retryable = true;
        throw error;
      }

      return body;
    } catch (error) {
      lastError = error;
      if (attempt === FETCH_ATTEMPTS || error?.retryable === false) break;
      await sleep(350 * attempt);
    }
  }
  throw lastError ?? new Error('Vinted request failed');
}

async function sendDiscord(url, alert) {
  const resaleRange = `£${Math.max(0, alert.resale - 5).toFixed(0)}–£${Math.round(alert.resale + 5)}`;
  const verdict = alert.exceptionalDeal
    ? '🔥 **EXCEPTIONAL BARGAIN**'
    : alert.buyScore >= 85
      ? '🟢 **STRONG BUY**'
      : '🟡 **GOOD BUY**';
  const conditionLabel = alert.condition === 'newWithTags' ? '🆕 New with tags' : '🆕 New without tags';
  const listed = alert.item.ageMinutes === null
    ? '🕐 Newly detected'
    : `🕐 Listed ~${alert.item.ageMinutes} min ago`;

  const body = {
    username: "Dan's Vault Fresh Bargain Finder",
    embeds: [{
      title: '🚨 NEW VINTED BARGAIN 🔥',
      description:
        `**⭐ ${alert.searchName.toUpperCase()}**\n**${alert.item.title}**\n\n` +
        `${listed}\n🏷️ **Buy:** £${alert.item.price.toFixed(2)}\n📏 **Size:** ${alert.size}\n` +
        `📦 **Condition:** ${conditionLabel}\n📈 **Est. resale:** ${resaleRange}\n` +
        `💰 **Est. profit:** £${alert.netProfit.toFixed(2)}\n📊 **ROI:** ${alert.roi.toFixed(0)}%\n` +
        `🎯 **Score:** ${alert.buyScore}/100\n\n${verdict}\n` +
        `🛡️ **Authenticity screen:** ${alert.fakeRisk.level}\n📈 **Demand:** ${alert.demand.toFixed(0)}/100\n` +
        `⚡ **Strategy:** ${alert.strategy}\n\n${alert.fakeRisk.note}\n\n` +
        '*Fresh-listing signal. Check photos, product code, condition and seller before buying.*',
      url: alert.item.url,
      color: alert.exceptionalDeal ? 3066993 : alert.buyScore >= 85 ? 3447003 : 16776960,
      footer: { text: "Dan's Vault • Fresh Vinted Radar" },
      timestamp: new Date().toISOString()
    }]
  };

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000)
      });
      if (response.ok) return;
      const error = new Error(`Discord webhook HTTP ${response.status}`);
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    } catch (error) {
      lastError = error;
      if (attempt === 3 || error?.retryable === false) break;
      await sleep(400 * attempt);
    }
  }
  throw lastError ?? new Error('Discord delivery failed');
}

async function sendTest(url, bot) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: "Dan's Vault Fresh Bargain Finder",
      embeds: [{
        title: '🧪 RADAR TEST',
        description: `✅ ${bot} webhook connected`,
        color: 3447003,
        timestamp: new Date().toISOString()
      }]
    }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Discord webhook HTTP ${response.status}`);
}

function buyScore({ searchName, resale, price, profit, roi, risk, demand, strategy, stock }) {
  const marginScore = clamp(((resale - price) / Math.max(resale, 1)) * 100, 0, 100);
  const roiScore = clamp(roi, 0, 200) / 2;
  const conditionScore = 100;
  const demandScore = clamp(demand, 50, 115);
  const riskScore = risk.level === 'HIGH' ? 20 : risk.level === 'MEDIUM' ? 75 : 100;
  const profiles = {
    fastFlip: { marginWeight: .35, roiWeight: .20, demandWeight: .30, conditionWeight: .10, riskWeight: .05 },
    maxProfit: { marginWeight: .50, roiWeight: .25, demandWeight: .10, conditionWeight: .10, riskWeight: .05 },
    balanced: { marginWeight: .45, roiWeight: .20, demandWeight: .20, conditionWeight: .10, riskWeight: .05 }
  };
  const profile = profiles[strategy] ?? profiles.balanced;

  let score = marginScore * profile.marginWeight
    + roiScore * profile.roiWeight
    + demandScore * profile.demandWeight
    + conditionScore * profile.conditionWeight
    + riskScore * profile.riskWeight;

  if (stock >= Number(models[searchName]?.maxInventory ?? 3)) score -= 8;
  if (profit >= 20) score += 4;
  if (profit >= 30) score += 4;
  if (roi >= 80) score += 3;
  if (risk.level === 'HIGH') score -= 12;
  return clamp(Math.round(score), 0, 100);
}

function resaleEstimate(name, size, market) {
  const model = models[name] ?? {};
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

function seasonalDemand(name, config) {
  const month = new Date().getMonth() + 1;
  for (const season of Object.values(config.seasonalDemand ?? {})) {
    if (season.months?.includes(month)) return round2((season[name] ?? 1) * 100);
  }
  return 100;
}

function fakeRiskLevel(item, text, resale) {
  const explicit = ['replica', 'fake', 'counterfeit', '1:1', 'ua ', 'ua-', 'rep ', 'mirror', 'pk batch', 'not authentic']
    .filter(term => text.includes(term));
  if (explicit.length) return { level: 'HIGH', note: 'Explicit suspicious-authenticity wording detected' };
  if (resale > 0 && item.price <= resale * .30) {
    return { level: 'MEDIUM', note: 'Extremely low price versus expected resale; inspect photos, code and seller history' };
  }
  if (resale > 0 && item.price <= resale * .45) {
    return { level: 'LOW', note: 'Strong bargain price; manual authenticity check recommended' };
  }
  return { level: 'LOW', note: 'No configured major authenticity red flags detected' };
}

function containsBlockedKeyword(text, words) {
  return words.some(word => {
    const normalized = String(word).toLowerCase().trim();
    if (!normalized) return false;
    if (normalized.length <= 3 && !normalized.includes(' ')) {
      return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalized)}($|[^a-z0-9])`, 'i').test(text);
    }
    return text.includes(normalized);
  });
}

function hasBadCondition(text, words) {
  return words.some(word => {
    const normalized = String(word).toLowerCase().trim();
    if (!normalized || normalized === 'good') return false;
    if (normalized === 'good condition') return /\bgood condition\b/i.test(text);
    return text.includes(normalized);
  }) || /\bcondition\s*[:\-]?\s*good\b/i.test(text);
}

function remember(state, item, prior, extra) {
  const cleanedExtra = Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined));
  state.items[item.id] = {
    ...(prior ?? {}),
    ...cleanedExtra,
    title: item.title,
    url: item.url,
    lastPrice: item.price,
    lastSeenAt: new Date().toISOString()
  };
  if (extra.blockedReason === undefined) delete state.items[item.id].blockedReason;
}

function normalizeState(state) {
  state.items ??= {};
  state.market ??= {};
  state.sellers ??= {};
  state.images ??= {};
  state.freshness ??= { version: 3, bootstrapped: false, frontiers: {}, lastScanAt: null };
  state.freshness.frontiers ??= {};
  if (state.freshness.bootstrapped === undefined) state.freshness.bootstrapped = false;
  state.freshness.version = 3;
}

function defaultState() {
  return {
    items: {},
    market: {},
    sellers: {},
    images: {},
    freshness: { version: 3, bootstrapped: false, frontiers: {}, lastScanAt: null }
  };
}

function shoeModel(baselineResale, resaleBySize, strategy = 'fastFlip') {
  return { baselineResale, resaleBySize, strategy, maxInventory: 4 };
}
function clothingModel(baselineResale, resaleBySize, strategy = 'fastFlip') {
  return { baselineResale, resaleBySize, strategy, maxInventory: 5 };
}
function countInStock(items, name) {
  return items.filter(item => item.model === name && item.status !== 'sold').length;
}
function compareNumericIds(a, b) {
  try {
    const aa = BigInt(String(a));
    const bb = BigInt(String(b));
    return aa > bb ? 1 : aa < bb ? -1 : 0;
  } catch {
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }
}
function normalizeText(value) {
  return String(value).toLowerCase().replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function stripTags(value) {
  return String(value).replace(/<[^>]+>/g, ' ');
}
function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
async function loadJson(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}
