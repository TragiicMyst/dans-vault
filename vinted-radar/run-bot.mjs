import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('./', import.meta.url);
const config = JSON.parse(await fs.readFile(new URL('./config.json', root), 'utf8'));
const bot = process.env.BOT_TYPE ?? 'trainers';
const stateName = process.env.STATE_NAME ?? `${bot}-state.json`;

if (!['trainers', 'clothing'].includes(bot)) throw new Error(`Invalid BOT_TYPE: ${bot}`);

const trainerNames = new Set([
  'Nike P-6000', 'Nike Vomero', 'Nike TN', 'Nike Pegasus Premium', 'Nike Shox TL',
  'Nike Air Max 95', 'Nike Air Max 97', 'Nike Vomero 5', 'Nike V5 RNR',
  'Nike Air Force 1', 'Nike Dunk Low'
]);

// Clothing searches were accidentally lost from config during the trainer-only tuning.
// Keep them here so the clothing workflow always has real searches to run.
const clothingSearches = [
  search('Nike Tech Fleece Hoodie', 'nike tech fleece hoodie', 30),
  search('Nike Tech Fleece Windrunner', 'nike tech fleece windrunner', 32),
  search('Nike Tech Fleece Joggers', 'nike tech fleece joggers', 25),
  search('Nike Tech Fleece Tracksuit', 'nike tech fleece tracksuit', 50),
  search('Nike ACG Fleece', 'nike acg fleece', 40),
  search('Nike ACG Jacket', 'nike acg jacket', 65),
  search('Nike Puffer Jacket', 'nike puffer jacket', 60),
  search('Nike Windrunner Jacket', 'nike windrunner jacket', 35),
  search('Nike Sportswear Tracksuit', 'nike sportswear tracksuit', 45),
  search('Nike Miler Shorts', 'nike miler shorts', 16),
  search('Nike Challenger Shorts', 'nike challenger shorts', 16),
  search('Nike Stride Shorts', 'nike stride shorts', 18),
  search('Nike Pro Training Shorts', 'nike pro training shorts', 15),
  search('Nike Miler Running Top', 'nike miler running top', 15),
  search('Nike Dri-FIT Running Top', 'nike dri-fit running top', 15),
  search('Nike Unlimited Shorts', 'nike unlimited shorts', 18)
];

const modelBaselines = {
  'Nike P-6000': model(65, { 7: 60, 8: 65, 9: 68, 10: 70 }),
  'Nike Vomero': model(65, { 7: 60, 8: 65, 9: 68, 10: 70 }),
  'Nike TN': model(75, { 7: 70, 8: 75, 9: 78, 10: 80 }, 'balanced'),
  'Nike Pegasus Premium': model(125, { 7: 115, 8: 125, 9: 130, 10: 135 }, 'balanced'),
  'Nike Shox TL': model(100, { 7: 90, 8: 100, 9: 105, 10: 110 }),
  'Nike Air Max 95': model(110, { 7: 100, 8: 110, 9: 115, 10: 120 }, 'balanced'),
  'Nike Air Max 97': model(110, { 7: 100, 8: 110, 9: 115, 10: 120 }, 'balanced'),
  'Nike Vomero 5': model(95, { 7: 85, 8: 95, 9: 100, 10: 105 }),
  'Nike V5 RNR': model(65, { 7: 60, 8: 65, 9: 68, 10: 70 }),
  'Nike Air Force 1': model(70, { 7: 65, 8: 70, 9: 72, 10: 75 }),
  'Nike Dunk Low': model(75, { 7: 70, 8: 75, 9: 78, 10: 80 }, 'balanced'),
  'Nike Tech Fleece Hoodie': clothingModel(38, { XS: 30, S: 35, M: 38, L: 40, XL: 42, XXL: 42 }),
  'Nike Tech Fleece Windrunner': clothingModel(40, { XS: 32, S: 38, M: 40, L: 42, XL: 44, XXL: 45 }),
  'Nike Tech Fleece Joggers': clothingModel(32, { XS: 25, S: 30, M: 32, L: 35, XL: 36, XXL: 36 }),
  'Nike Tech Fleece Tracksuit': clothingModel(65, { XS: 55, S: 60, M: 65, L: 70, XL: 72, XXL: 75 }, 'balanced'),
  'Nike ACG Fleece': clothingModel(55, { XS: 45, S: 50, M: 55, L: 60, XL: 62, XXL: 65 }, 'balanced'),
  'Nike ACG Jacket': clothingModel(85, { XS: 70, S: 78, M: 85, L: 90, XL: 95, XXL: 95 }, 'balanced'),
  'Nike Puffer Jacket': clothingModel(75, { XS: 60, S: 68, M: 75, L: 80, XL: 85, XXL: 85 }, 'balanced'),
  'Nike Windrunner Jacket': clothingModel(45, { XS: 35, S: 40, M: 45, L: 48, XL: 50, XXL: 50 }),
  'Nike Sportswear Tracksuit': clothingModel(55, { XS: 45, S: 50, M: 55, L: 58, XL: 60, XXL: 60 }),
  'Nike Miler Shorts': clothingModel(22, { XS: 18, S: 20, M: 22, L: 24, XL: 25, XXL: 25 }),
  'Nike Challenger Shorts': clothingModel(20, { XS: 16, S: 18, M: 20, L: 22, XL: 24, XXL: 24 }),
  'Nike Stride Shorts': clothingModel(25, { XS: 20, S: 23, M: 25, L: 27, XL: 28, XXL: 28 }),
  'Nike Pro Training Shorts': clothingModel(18, { XS: 14, S: 16, M: 18, L: 20, XL: 20, XXL: 20 }),
  'Nike Miler Running Top': clothingModel(18, { XS: 14, S: 16, M: 18, L: 20, XL: 21, XXL: 21 }),
  'Nike Dri-FIT Running Top': clothingModel(16, { XS: 12, S: 14, M: 16, L: 18, XL: 19, XXL: 19 }),
  'Nike Unlimited Shorts': clothingModel(22, { XS: 17, S: 20, M: 22, L: 24, XL: 25, XXL: 25 })
};

const scoreFloors = {
  trainers: { default: 60, 'Nike Pegasus Premium': 63, 'Nike Air Max 95': 62, 'Nike Air Max 97': 62, 'Nike Shox TL': 62, 'Nike Vomero 5': 62, 'Nike TN': 62 },
  clothing: { default: 60, 'Nike Tech Fleece Tracksuit': 63, 'Nike ACG Fleece': 63, 'Nike ACG Jacket': 63, 'Nike Puffer Jacket': 62 }
};

const sourceSearches = bot === 'trainers'
  ? (config.searches ?? []).filter(s => trainerNames.has(s.name))
  : clothingSearches;

// Put specific searches before broad searches so a Vomero 5 is evaluated as Vomero 5,
// rather than being swallowed by the generic Vomero search first.
if (bot === 'trainers') {
  sourceSearches.sort((a, b) => Number(b.name === 'Nike Vomero 5') - Number(a.name === 'Nike Vomero 5'));
}

const searches = sourceSearches.map(s => {
  const effectiveMaxPrice = Number.isFinite(Number(s.maxPrice))
    ? Math.round(Number(s.maxPrice) * 1.30 * 100) / 100
    : s.maxPrice;
  let buyUrl = s.buyUrl;
  try {
    const u = new URL(s.buyUrl);
    if (Number.isFinite(Number(effectiveMaxPrice))) u.searchParams.set('price_to', String(effectiveMaxPrice));
    u.searchParams.set('order', 'newest_first');
    buyUrl = u.toString();
  } catch {}
  return {
    ...s,
    buyUrl,
    maxPrice: effectiveMaxPrice,
    minScore: scoreFloors[bot][s.name] ?? scoreFloors[bot].default
  };
});
if (!searches.length) throw new Error(`No searches configured for ${bot}`);

const existingState = new URL(`./${stateName}`, root);
let baseState;
try { baseState = JSON.parse(await fs.readFile(existingState, 'utf8')); }
catch { baseState = { items:{}, market:{}, sellers:{}, images:{}, cursor:0, freshness:{version:2,bootstrapped:false,frontiers:{},lastScanAt:null} }; }

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `dans-vault-${bot}-`));
const monitorSource = await fs.readFile(new URL('./monitor.mjs', root), 'utf8');
let patchedMonitor = monitorSource;

// 1) Search-page HTML contains recommendation links as well as the requested results.
// Filter those unrelated links before they can poison freshness/frontier tracking.
patchedMonitor = replaceRequired(
  patchedMonitor,
  "const candidates = extractItems(html, MAX_ITEMS_PER_SEARCH);",
  "const candidates = extractItems(html, MAX_ITEMS_PER_SEARCH).filter(item => matchesSearchCandidate(item, search.name));",
  'candidate model filter'
);

// 2) An item's numeric ID must NOT be compared with a frontier that is changing while
// we loop over the same page. More importantly, after bootstrap, a never-before-seen
// listing is fresh by definition unless Vinted explicitly tells us it is older than the window.
patchedMonitor = replaceRequired(
  patchedMonitor,
  "const firstSeen = !prior;\n      const idIsNewerThanFrontier = maxId ? compareNumericIds(item.id, maxId) > 0 : false;\n      const ageFresh = item.ageMinutes !== null && item.ageMinutes <= MAX_AGE_MINUTES;\n      const freshnessSignal = ageFresh || (item.ageMinutes === null && idIsNewerThanFrontier);",
  "const firstSeen = !prior;\n      const ageFresh = item.ageMinutes === null || item.ageMinutes <= MAX_AGE_MINUTES;\n      const freshnessSignal = firstSeen && ageFresh;",
  'freshness calculation'
);

// 3) Re-check recently blocked listings when a previous pass could not extract enough
// information. Do not permanently bury them just because one HTML pass was incomplete.
patchedMonitor = replaceRequired(
  patchedMonitor,
  "if (!firstSeen) {\n        remember(item, prior, { lastSeenAt: now.toISOString(), lastPrice: item.price });\n        continue;\n      }\n\n      if (!freshnessSignal) {",
  "const priorAgeMinutes = prior?.lastSeenAt ? (Date.now() - Date.parse(prior.lastSeenAt)) / 60000 : Infinity;\n      const recheck = !firstSeen && prior?.lastAlertedAt == null && priorAgeMinutes <= MAX_AGE_MINUTES && ['condition-not-confirmed','size','no-resale-baseline','weak-margin','stale-or-no-freshness-signal','price'].includes(prior?.blockedReason);\n      if (!firstSeen && !recheck) {\n        remember(item, prior, { lastSeenAt: now.toISOString(), lastPrice: item.price });\n        continue;\n      }\n\n      if (firstSeen && !freshnessSignal) {",
  'recheck/freshness gate'
);

// 4) Vinted often does not expose size in the search-card fragment. Look at the item
// page before rejecting a potentially excellent listing for missing size.
patchedMonitor = replaceRequired(
  patchedMonitor,
  "const size = inferSize(item.fullText, targetSizes);",
  "let size = inferSize(item.fullText, targetSizes);",
  'mutable size'
);
patchedMonitor = replaceRequired(
  patchedMonitor,
  "if (size === null) {\n        remember(item, prior, { blockedReason: 'size', lastSeenAt: now.toISOString() });",
  "if (size === null) {\n        const sizeDetail = await fetchText(item.url).catch(() => '');\n        if (sizeDetail) size = inferSize(stripTags(sizeDetail).replace(/\\s+/g, ' '), targetSizes);\n      }\n      if (size === null) {\n        remember(item, prior, { blockedReason: 'size', lastSeenAt: now.toISOString() });",
  'detail-page size fallback'
);

// 5) Always verify an unknown condition on the item page. We keep the user's strict
// New with tags / New without tags rule and do NOT silently treat used items as new.
patchedMonitor = replaceRequired(
  patchedMonitor,
  "if (condition === 'unknown' && (item.price <= Number(search.maxPrice ?? item.price) * 0.75 || item.price <= 40)) {",
  "if (condition === 'unknown') {",
  'condition detail verification'
);

// 6) Loosen profit/score gates as requested, while keeping explicit fake/damage blocks.
patchedMonitor = patchedMonitor
  .replace(/if \(profit < 15 \|\| roi < 35\) \{/g, "if (profit < 10 || roi < 25) {")
  .replace(/const strong = profit >= 20 && roi >= 55 && risk\.level !== 'HIGH';/g, "const strong = profit >= 15 && roi >= 40 && risk.level !== 'HIGH';")
  .replace(/const exceptional = profit >= 30 && roi >= 80 && risk\.level !== 'HIGH';/g, "const exceptional = profit >= 25 && roi >= 65 && risk.level !== 'HIGH';");

// 7) Add a strict model/title sanity check so Dickies, jeans and unrelated Vinted
// recommendations can never become Nike trainer/clothing alerts.
patchedMonitor = replaceRequired(
  patchedMonitor,
  "function parseAgeMinutes(text) {",
  `${matchesSearchCandidateSource()}\n\nfunction parseAgeMinutes(text) {`,
  'model matching helper'
);

await fs.writeFile(path.join(tempDir, 'monitor.mjs'), patchedMonitor);
await fs.copyFile(new URL('./inventory.json', root), path.join(tempDir, 'inventory.json'));
await fs.writeFile(path.join(tempDir, 'config.json'), JSON.stringify({
  ...config,
  searches,
  sizes: ['XS','S','M','L','XL','XXL',7,7.5,8,8.5,9,9.5,10,10.5],
  models: { ...(config.models ?? {}), ...modelBaselines },
  costs: config.costs ?? { packaging: 0.8, cleaning: { new: 0, veryGood: 0.75, good: 2, unknown: 2.5 }, vintedSellingFee: 0 },
  strategy: config.strategy ?? {
    default: 'balanced',
    profiles: {
      fastFlip: { marginWeight: .35, roiWeight: .20, demandWeight: .30, conditionWeight: .10, riskWeight: .05 },
      maxProfit: { marginWeight: .50, roiWeight: .25, demandWeight: .10, conditionWeight: .10, riskWeight: .05 },
      balanced: { marginWeight: .45, roiWeight: .20, demandWeight: .20, conditionWeight: .10, riskWeight: .05 }
    }
  },
  freshness: { ...(config.freshness ?? {}), maxAgeMinutes: 120, itemsPerSearch: 80 },
  allowedConditionKeywords: ['new with tags', 'new without tags'],
  condition: {
    ...(config.condition ?? {}),
    new: ['new with tags', 'new without tags'],
    veryGood: []
  }
}, null, 2));
await fs.writeFile(path.join(tempDir, 'state.json'), JSON.stringify(baseState, null, 2));

console.log(`Starting Dan's Vault ${bot} radar with ${searches.length} search groups.`);
console.log('Freshness: first-seen after bootstrap; explicit age >120m is rejected.');
console.log('Condition: New with tags / New without tags only; unknown is checked on detail page.');
console.log('Capture: +30% search ceiling, £10+ profit, 25%+ ROI, lower score floors.');
console.log('Candidate guard: unrelated Vinted recommendation links are filtered out.');
await import(pathToFileURL(path.join(tempDir, 'monitor.mjs')).href);

if (process.env.TEST_MODE !== 'true') {
  const nextState = JSON.parse(await fs.readFile(path.join(tempDir, 'state.json'), 'utf8'));
  nextState.lastRotation = { bot, selected: searches.map(x => x.name), at: new Date().toISOString() };
  await fs.writeFile(existingState, JSON.stringify(nextState, null, 2) + '\n');
}
await fs.rm(tempDir, { recursive: true, force: true });

function search(name, query, maxPrice) {
  const q = encodeURIComponent(query);
  return {
    name,
    buyUrl: `https://www.vinted.co.uk/catalog?search_text=${q}&order=newest_first&price_to=${maxPrice}`,
    marketUrl: `https://www.vinted.co.uk/catalog?search_text=${q}&order=newest_first`,
    maxPrice,
    minScore: 60
  };
}

function model(baselineResale, resaleBySize, strategy = 'fastFlip') {
  return { baselineResale, resaleBySize, strategy, maxInventory: 4 };
}
function clothingModel(baselineResale, resaleBySize, strategy = 'fastFlip') {
  return { baselineResale, resaleBySize, strategy, maxInventory: 5 };
}

function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`Radar patch failed: ${label} source not found`);
  return source.replace(needle, replacement);
}

function matchesSearchCandidateSource() {
  return String.raw`function matchesSearchCandidate(item, searchName) {
  const t = String(item?.title ?? '').toLowerCase().replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ').trim();
  const has = (...parts) => parts.every(p => t.includes(p));
  const any = (...parts) => parts.some(p => t.includes(p));
  switch (searchName) {
    case 'Nike P-6000': return /\bp\s?6000\b/.test(t);
    case 'Nike Vomero 5': return has('vomero', '5');
    case 'Nike Vomero': return t.includes('vomero');
    case 'Nike TN': return /(^|\s)tn(\s|$)/.test(t) || t.includes('air max plus') || t.includes('tuned');
    case 'Nike Pegasus Premium': return has('pegasus', 'premium');
    case 'Nike Shox TL': return t.includes('shox');
    case 'Nike Air Max 95': return t.includes('air max 95') || t.includes('am95');
    case 'Nike Air Max 97': return t.includes('air max 97') || t.includes('am97');
    case 'Nike V5 RNR': return has('v5', 'rnr');
    case 'Nike Air Force 1': return t.includes('air force') || /(^|\s)af1(\s|$)/.test(t);
    case 'Nike Dunk Low': return t.includes('dunk');
    case 'Nike Tech Fleece Hoodie': return has('tech', 'fleece') && any('hoodie', 'hoody', 'zip', 'windrunner');
    case 'Nike Tech Fleece Windrunner': return has('tech', 'fleece') && any('windrunner', 'jacket', 'zip');
    case 'Nike Tech Fleece Joggers': return has('tech', 'fleece') && any('jogger', 'trouser', 'bottom');
    case 'Nike Tech Fleece Tracksuit': return has('tech', 'fleece') && any('tracksuit', 'set', 'full');
    case 'Nike ACG Fleece': return has('acg', 'fleece');
    case 'Nike ACG Jacket': return has('acg') && any('jacket', 'coat', 'shell');
    case 'Nike Puffer Jacket': return t.includes('nike') && any('puffer', 'coat', 'jacket', 'down');
    case 'Nike Windrunner Jacket': return t.includes('windrunner');
    case 'Nike Sportswear Tracksuit': return t.includes('nike') && any('tracksuit', 'track suit', 'set');
    case 'Nike Miler Shorts': return has('miler') && any('short', 'shorts');
    case 'Nike Challenger Shorts': return has('challenger') && any('short', 'shorts');
    case 'Nike Stride Shorts': return has('stride') && any('short', 'shorts');
    case 'Nike Pro Training Shorts': return has('nike', 'pro') && any('short', 'shorts');
    case 'Nike Miler Running Top': return has('miler') && any('top', 'shirt', 'tee', 't shirt');
    case 'Nike Dri-FIT Running Top': return any('dri fit', 'drifit') && any('top', 'shirt', 'tee', 't shirt');
    case 'Nike Unlimited Shorts': return has('unlimited') && any('short', 'shorts');
    default: return t.includes('nike');
  }
}`;
}
