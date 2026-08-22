import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('./', import.meta.url);
const config = JSON.parse(await fs.readFile(new URL('./config.json', root), 'utf8'));
const bot = process.env.BOT_TYPE ?? 'trainers';
const stateName = process.env.STATE_NAME ?? `${bot}-state.json`;

const trainerNames = new Set([
  'Nike P-6000','Nike Vomero','Nike TN','Nike Pegasus Premium','Nike Shox TL',
  'Nike Air Max 95','Nike Air Max 97','Nike Vomero 5','Nike V5 RNR',
  'Nike Air Force 1','Nike Dunk Low'
]);
if (!['trainers','clothing'].includes(bot)) throw new Error(`Invalid BOT_TYPE: ${bot}`);

// Looser floors: surface more realistic opportunities and let Dan decide on borderline deals.
const scoreFloors = {
  trainers: { default: 60, 'Nike Pegasus Premium': 63, 'Nike Air Max 95': 62, 'Nike Air Max 97': 62, 'Nike Shox TL': 62, 'Nike Vomero 5': 62, 'Nike TN': 62 },
  clothing: { default: 60, 'Nike Tech Fleece Tracksuit': 63, 'Nike ACG Fleece': 63, 'Nike ACG Jacket': 63, 'Nike Puffer Jacket': 62 }
};

const searches = (config.searches ?? [])
  .filter(s => bot === 'trainers' ? trainerNames.has(s.name) : !trainerNames.has(s.name))
  .map(s => {
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
const patchedMonitor = monitorSource
  // Allow condition to be unknown without killing the deal. Explicitly bad conditions
  // are still rejected by the existing bad-condition gate.
  .replace(
    /if \(condition === 'unknown'\) \{/g,
    "if (condition === 'unknown') { condition = 'newWithoutTags'; }\n      if (condition === 'unknown') {"
  )
  // Re-evaluate previously blocked unalerted listings so loosening the rules actually
  // brings good bargains back into consideration.
  .replace(
    /if \(!firstSeen\) \{\n        remember\(item, prior, \{ lastSeenAt: now\.toISOString\(\), lastPrice: item\.price \}\);\n        continue;\n      \}/,
    "if (!firstSeen) {\n        const recheck = prior?.lastAlertedAt == null && ['condition-not-confirmed','size','no-resale-baseline','weak-margin','stale-or-no-freshness-signal','price'].includes(prior?.blockedReason);\n        if (!recheck) {\n          remember(item, prior, { lastSeenAt: now.toISOString(), lastPrice: item.price });\n          continue;\n        }\n      }"
  )
  // Lower the hard margin gate: good £10+ profit deals can now surface if the ROI is sensible.
  .replace(/if \(profit < 15 \|\| roi < 35\) \{/g, "if (profit < 10 || roi < 25) {")
  // Make the stronger-deal shortcut less restrictive too.
  .replace(/const strong = profit >= 20 && roi >= 55 && risk\.level !== 'HIGH';/g, "const strong = profit >= 15 && roi >= 40 && risk.level !== 'HIGH';")
  .replace(/const exceptional = profit >= 30 && roi >= 80 && risk\.level !== 'HIGH';/g, "const exceptional = profit >= 25 && roi >= 65 && risk.level !== 'HIGH';");
await fs.writeFile(path.join(tempDir, 'monitor.mjs'), patchedMonitor);
await fs.copyFile(new URL('./inventory.json', root), path.join(tempDir, 'inventory.json'));
await fs.writeFile(path.join(tempDir, 'config.json'), JSON.stringify({
  ...config,
  searches,
  freshness: { ...(config.freshness ?? {}), maxAgeMinutes: 120, itemsPerSearch: 80 },
  allowedConditionKeywords: ['new with tags', 'new without tags'],
  condition: { ...(config.condition ?? {}), new: ['new with tags', 'new without tags'], veryGood: [] }
}, null, 2));
await fs.writeFile(path.join(tempDir, 'state.json'), JSON.stringify(baseState, null, 2));

console.log(`Starting Dan's Vault ${bot} loose fresh radar with ${searches.length} search groups.`);
console.log('Filtering: relaxed — explicit fakes/damage/kids still blocked, borderline deals can surface.');
console.log('Capture range: +30% max price, 120-minute freshness window, 80 items/search.');
console.log('Condition verification: unknown condition can pass when no explicit bad-condition signal is found.');
console.log('Recheck mode: previously blocked unalerted bargains are re-evaluated.');
await import(pathToFileURL(path.join(tempDir, 'monitor.mjs')).href);

if (process.env.TEST_MODE !== 'true') {
  const nextState = JSON.parse(await fs.readFile(path.join(tempDir, 'state.json'), 'utf8'));
  nextState.lastRotation = { bot, selected: searches.map(x => x.name), at: new Date().toISOString() };
  await fs.writeFile(existingState, JSON.stringify(nextState, null, 2) + '\n');
}
await fs.rm(tempDir, { recursive: true, force: true });
