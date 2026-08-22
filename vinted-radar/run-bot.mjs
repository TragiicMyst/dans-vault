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
  'Nike P-6000','Nike Vomero','Nike TN','Nike Pegasus Premium','Nike Shox TL',
  'Nike Air Max 95','Nike Air Max 97','Nike Vomero 5','Nike V5 RNR',
  'Nike Air Force 1','Nike Dunk Low'
]);

const clothingSearches = [
  makeSearch('Nike Tech Fleece Hoodie', 'nike tech fleece hoodie', 30),
  makeSearch('Nike Tech Fleece Windrunner', 'nike tech fleece windrunner', 32),
  makeSearch('Nike Tech Fleece Joggers', 'nike tech fleece joggers', 25),
  makeSearch('Nike Tech Fleece Tracksuit', 'nike tech fleece tracksuit', 50),
  makeSearch('Nike ACG Fleece', 'nike acg fleece', 40),
  makeSearch('Nike ACG Jacket', 'nike acg jacket', 65),
  makeSearch('Nike Puffer Jacket', 'nike puffer jacket', 60),
  makeSearch('Nike Windrunner Jacket', 'nike windrunner jacket', 35),
  makeSearch('Nike Sportswear Tracksuit', 'nike sportswear tracksuit', 45),
  makeSearch('Nike Miler Shorts', 'nike miler shorts', 16),
  makeSearch('Nike Challenger Shorts', 'nike challenger shorts', 16),
  makeSearch('Nike Stride Shorts', 'nike stride shorts', 18),
  makeSearch('Nike Pro Training Shorts', 'nike pro training shorts', 15),
  makeSearch('Nike Miler Running Top', 'nike miler running top', 15),
  makeSearch('Nike Dri-FIT Running Top', 'nike dri-fit running top', 15),
  makeSearch('Nike Unlimited Shorts', 'nike unlimited shorts', 18)
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

let sourceSearches = bot === 'trainers'
  ? (config.searches ?? []).filter(s => trainerNames.has(s.name))
  : clothingSearches;

// Specific model searches first so broad terms don't claim the same listing.
sourceSearches = [...sourceSearches].sort((a,b) => Number(b.name === 'Nike Vomero 5') - Number(a.name === 'Nike Vomero 5'));

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
  return { ...s, buyUrl, maxPrice: effectiveMaxPrice, minScore: scoreFloors[bot][s.name] ?? scoreFloors[bot].default };
});
if (!searches.length) throw new Error(`No searches configured for ${bot}`);

const existingState = new URL(`./${stateName}`, root);
let baseState;
try { baseState = JSON.parse(await fs.readFile(existingState, 'utf8')); }
catch { baseState = { items:{}, market:{}, sellers:{}, images:{}, cursor:0, freshness:{version:2,bootstrapped:false,frontiers:{},lastScanAt:null} }; }

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `dans-vault-${bot}-`));
const monitorSource = await fs.readFile(new URL('./monitor.mjs', root), 'utf8');
let patched = monitorSource;

// Only inspect listings that actually match the requested model/category. Vinted's
// catalogue HTML also contains recommendation links; those were poisoning frontiers.
patched = mustReplace(
  patched,
  'const candidates = extractItems(html, MAX_ITEMS_PER_SEARCH);',
  'const candidates = extractItems(html, MAX_ITEMS_PER_SEARCH).filter(item => matchesSearchCandidate(item, search.name));',
  'candidate model filter'
);

// Compare against the frontier from the previous scan, never a frontier that changes
// while iterating the current page.
patched = mustReplace(
  patched,
  'const idIsNewerThanFrontier = maxId ? compareNumericIds(item.id, maxId) > 0 : false;',
  "const frontierMaxId = frontier?.maxId ? String(frontier.maxId) : null;\n      const idIsNewerThanFrontier = frontierMaxId ? compareNumericIds(item.id, frontierMaxId) > 0 : true;",
  'stable freshness frontier'
);

// Recover size from the actual listing page instead of throwing away bargains when
// the catalogue card omits size.
patched = mustReplace(patched, 'const size = inferSize(item.fullText, targetSizes);', 'let size = inferSize(item.fullText, targetSizes);', 'mutable size');
patched = mustReplace(
  patched,
  "if (size === null) {\n        remember(item, prior, { blockedReason: 'size', lastSeenAt: now.toISOString() });",
  "if (size === null) {\n        const sizeDetail = await fetchText(item.url).catch(() => '');\n        if (sizeDetail) size = inferSize(stripTags(sizeDetail).replace(/\\s+/g, ' '), targetSizes);\n      }\n      if (size === null) {\n        remember(item, prior, { blockedReason: 'size', lastSeenAt: now.toISOString() });",
  'size detail fallback'
);

// Always check the detail page if the catalogue card doesn't explicitly say New with
// tags / New without tags. Unknown condition stays blocked rather than being guessed.
patched = mustReplace(
  patched,
  "if (condition === 'unknown' && (item.price <= Number(search.maxPrice ?? item.price) * 0.75 || item.price <= 40)) {",
  "if (condition === 'unknown') {",
  'condition detail check'
);

// Relax bargain thresholds, not authenticity/condition requirements.
patched = patched
  .replace(/if \(profit < 15 \|\| roi < 35\) \{/g, "if (profit < 10 || roi < 25) {")
  .replace(/const strong = profit >= 20 && roi >= 55 && risk\.level !== 'HIGH';/g, "const strong = profit >= 15 && roi >= 40 && risk.level !== 'HIGH';")
  .replace(/const exceptional = profit >= 30 && roi >= 80 && risk\.level !== 'HIGH';/g, "const exceptional = profit >= 25 && roi >= 65 && risk.level !== 'HIGH';")
  // Smaller card window reduces cross-contamination from neighbouring Vinted cards.
  .replace(/m\.index \+ 7000/g, 'm.index + 2500');

// Add model/category guard helper.
patched = mustReplace(
  patched,
  'function parseAgeMinutes(text) {',
  `${candidateMatcherSource()}\n\nfunction parseAgeMinutes(text) {`,
  'candidate matcher helper'
);

// Silent diagnostics let us prove a scan happened and whether anything qualified.
patched = mustReplace(
  patched,
  'state.freshness.lastScanAt = now.toISOString();',
  "state.diagnostics = { lastRunAt: now.toISOString(), searchGroups: searches.length, qualifyingAlerts: qualifying.length };\nstate.freshness.lastScanAt = now.toISOString();",
  'scan diagnostics'
);

await fs.writeFile(path.join(tempDir, 'monitor.mjs'), patched);
await fs.copyFile(new URL('./inventory.json', root), path.join(tempDir, 'inventory.json'));
await fs.writeFile(path.join(tempDir, 'config.json'), JSON.stringify({
  ...config,
  searches,
  sizes: bot === 'clothing' ? ['XS','S','M','L','XL','XXL'] : [7,7.5,8,8.5,9,9.5,10,10.5],
  models: { ...(config.models ?? {}), ...models },
  costs: config.costs ?? { packaging: 0.8, cleaning: { new: 0, veryGood: 0.75, good: 2, unknown: 2.5 }, vintedSellingFee: 0 },
  strategy: config.strategy ?? {
    default: 'balanced',
    profiles: {
      fastFlip: { marginWeight: .35, roiWeight: .20, demandWeight: .30, conditionWeight: .10, riskWeight: .05 },
      maxProfit: { marginWeight: .50, roiWeight: .25, demandWeight: .10, conditionWeight: .10, riskWeight: .05 },
      balanced: { marginWeight: .45, roiWeight: .20, demandWeight: .20, conditionWeight: .10, riskWeight: .05 }
    }
  },
  freshness: { ...(config.freshness ?? {}), maxAgeMinutes: 60, itemsPerSearch: 80 },
  allowedConditionKeywords: ['new with tags', 'new without tags'],
  condition: { ...(config.condition ?? {}), new: ['new with tags', 'new without tags'], veryGood: [] }
}, null, 2));
await fs.writeFile(path.join(tempDir, 'state.json'), JSON.stringify(baseState, null, 2));

console.log(`Starting Dan's Vault ${bot} radar with ${searches.length} search groups.`);
console.log('Freshness fix active: unrelated recommendations cannot move model frontiers.');
console.log('Condition: New with tags / New without tags only, with detail-page verification.');
console.log('Capture: +30% price ceiling, 60-minute freshness, 80 items/search, £10+ profit / 25%+ ROI.');
await import(pathToFileURL(path.join(tempDir, 'monitor.mjs')).href);

if (process.env.TEST_MODE !== 'true') {
  const nextState = JSON.parse(await fs.readFile(path.join(tempDir, 'state.json'), 'utf8'));
  nextState.lastRotation = { bot, selected: searches.map(x => x.name), at: new Date().toISOString() };
  await fs.writeFile(existingState, JSON.stringify(nextState, null, 2) + '\n');
}
await fs.rm(tempDir, { recursive: true, force: true });

function makeSearch(name, query, maxPrice) {
  const q = encodeURIComponent(query);
  return {
    name,
    buyUrl: `https://www.vinted.co.uk/catalog?search_text=${q}&order=newest_first&price_to=${maxPrice}`,
    marketUrl: `https://www.vinted.co.uk/catalog?search_text=${q}&order=newest_first`,
    maxPrice,
    minScore: 60
  };
}
function shoeModel(baselineResale, resaleBySize, strategy = 'fastFlip') { return { baselineResale, resaleBySize, strategy, maxInventory: 4 }; }
function clothingModel(baselineResale, resaleBySize, strategy = 'fastFlip') { return { baselineResale, resaleBySize, strategy, maxInventory: 5 }; }
function mustReplace(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`Radar patch failed: ${label}`);
  return source.replace(needle, replacement);
}
function candidateMatcherSource() {
  return String.raw`function matchesSearchCandidate(item, searchName) {
  const t = String(item?.title ?? '').toLowerCase().replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ').trim();
  const has = (...parts) => parts.every(p => t.includes(p));
  const any = (...parts) => parts.some(p => t.includes(p));
  switch (searchName) {
    case 'Nike P-6000': return /\bp\s?6000\b/.test(t);
    case 'Nike Vomero 5': return has('vomero','5');
    case 'Nike Vomero': return t.includes('vomero');
    case 'Nike TN': return /(^|\s)tn(\s|$)/.test(t) || t.includes('air max plus') || t.includes('tuned');
    case 'Nike Pegasus Premium': return has('pegasus','premium');
    case 'Nike Shox TL': return t.includes('shox');
    case 'Nike Air Max 95': return t.includes('air max 95') || t.includes('am95');
    case 'Nike Air Max 97': return t.includes('air max 97') || t.includes('am97');
    case 'Nike V5 RNR': return has('v5','rnr');
    case 'Nike Air Force 1': return t.includes('air force') || /(^|\s)af1(\s|$)/.test(t);
    case 'Nike Dunk Low': return t.includes('dunk');
    case 'Nike Tech Fleece Hoodie': return has('tech','fleece') && any('hoodie','hoody','zip','windrunner');
    case 'Nike Tech Fleece Windrunner': return has('tech','fleece') && any('windrunner','jacket','zip');
    case 'Nike Tech Fleece Joggers': return has('tech','fleece') && any('jogger','trouser','bottom');
    case 'Nike Tech Fleece Tracksuit': return has('tech','fleece') && any('tracksuit','track suit','set','full');
    case 'Nike ACG Fleece': return has('acg','fleece');
    case 'Nike ACG Jacket': return has('acg') && any('jacket','coat','shell');
    case 'Nike Puffer Jacket': return t.includes('nike') && any('puffer','coat','jacket','down');
    case 'Nike Windrunner Jacket': return t.includes('windrunner');
    case 'Nike Sportswear Tracksuit': return t.includes('nike') && any('tracksuit','track suit','set');
    case 'Nike Miler Shorts': return t.includes('miler') && any('short','shorts');
    case 'Nike Challenger Shorts': return t.includes('challenger') && any('short','shorts');
    case 'Nike Stride Shorts': return t.includes('stride') && any('short','shorts');
    case 'Nike Pro Training Shorts': return has('nike','pro') && any('short','shorts');
    case 'Nike Miler Running Top': return t.includes('miler') && any('top','shirt','tee','t shirt');
    case 'Nike Dri-FIT Running Top': return any('dri fit','drifit') && any('top','shirt','tee','t shirt');
    case 'Nike Unlimited Shorts': return t.includes('unlimited') && any('short','shorts');
    default: return t.includes('nike');
  }
}`;
}
