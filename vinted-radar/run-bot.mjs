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

const scoreFloors = {
  trainers: { default: 68, 'Nike Pegasus Premium': 70, 'Nike Air Max 95': 69, 'Nike Air Max 97': 69, 'Nike Shox TL': 69, 'Nike Vomero 5': 69, 'Nike TN': 69 },
  clothing: { default: 68, 'Nike Tech Fleece Tracksuit': 70, 'Nike ACG Fleece': 70, 'Nike ACG Jacket': 70, 'Nike Puffer Jacket': 69 }
};

const searches = (config.searches ?? [])
  .filter(s => bot === 'trainers' ? trainerNames.has(s.name) : !trainerNames.has(s.name))
  .map(s => {
    const effectiveMaxPrice = Number.isFinite(Number(s.maxPrice))
      ? Math.round(Number(s.maxPrice) * 1.20 * 100) / 100
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
  // Do not require the bargain to be <=75% of the price ceiling before checking
  // the listing detail page. A £42 P-6000, for example, can still be a bargain.
  .replace(
    /if \(condition === 'unknown' && \(item\.price <= Number\(search\.maxPrice \?\? item\.price\) \* 0\.75 \|\| item\.price <= 40\)\) \{/,
    "if (condition === 'unknown') {"
  );
await fs.writeFile(path.join(tempDir, 'monitor.mjs'), patchedMonitor);
await fs.copyFile(new URL('./inventory.json', root), path.join(tempDir, 'inventory.json'));
await fs.writeFile(path.join(tempDir, 'config.json'), JSON.stringify({
  ...config,
  searches,
  // User requested a 1-hour fresh-listing window.
  freshness: { ...(config.freshness ?? {}), maxAgeMinutes: 60, itemsPerSearch: 40 },
  allowedConditionKeywords: ['new with tags', 'new without tags'],
  condition: { ...(config.condition ?? {}), new: ['new with tags', 'new without tags'], veryGood: [] }
}, null, 2));
await fs.writeFile(path.join(tempDir, 'state.json'), JSON.stringify(baseState, null, 2));

console.log(`Starting Dan's Vault ${bot} fresh radar with ${searches.length} search groups.`);
console.log('Condition gate: ONLY New with tags / New without tags.');
console.log('Capture range: +20% max price, 60-minute freshness window.');
console.log('Detail verification: enabled for every fresh candidate whose condition is not visible in search HTML.');
await import(pathToFileURL(path.join(tempDir, 'monitor.mjs')).href);

if (process.env.TEST_MODE !== 'true') {
  const nextState = JSON.parse(await fs.readFile(path.join(tempDir, 'state.json'), 'utf8'));
  nextState.lastRotation = { bot, selected: searches.map(x => x.name), at: new Date().toISOString() };
  await fs.writeFile(existingState, JSON.stringify(nextState, null, 2) + '\n');
}
await fs.rm(tempDir, { recursive: true, force: true });
