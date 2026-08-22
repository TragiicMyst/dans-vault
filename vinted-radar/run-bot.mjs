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

// Fresh-radar filters: only explicit New with tags / New without tags can alert.
// The capture range is deliberately a little wider than the underlying search config
// so we can catch bargains where a seller has priced above the old ceiling but the
// resale margin is still strong.
const scoreFloors = {
  trainers: {
    default: 70,
    'Nike Pegasus Premium': 73,
    'Nike Air Max 95': 71,
    'Nike Air Max 97': 71,
    'Nike Shox TL': 71,
    'Nike Vomero 5': 71,
    'Nike TN': 71
  },
  clothing: {
    default: 72,
    'Nike Tech Fleece Tracksuit': 74,
    'Nike ACG Fleece': 74,
    'Nike ACG Jacket': 74,
    'Nike Puffer Jacket': 73
  }
};

const searches = (config.searches ?? [])
  .filter(s => bot === 'trainers' ? trainerNames.has(s.name) : !trainerNames.has(s.name))
  .map(s => ({
    ...s,
    // Raise the catalogue asking-price ceiling by 20%.
    // The monitor's profit/ROI gates still have to pass, so this does not mean
    // expensive listings automatically get alerted.
    maxPrice: Number.isFinite(Number(s.maxPrice)) ? Math.round(Number(s.maxPrice) * 1.20 * 100) / 100 : s.maxPrice,
    minScore: scoreFloors[bot][s.name] ?? scoreFloors[bot].default
  }));
if (!searches.length) throw new Error(`No searches configured for ${bot}`);

const existingState = new URL(`./${stateName}`, root);
let baseState;
try { baseState = JSON.parse(await fs.readFile(existingState, 'utf8')); }
catch { baseState = { items:{}, market:{}, sellers:{}, images:{}, cursor:0, freshness:{version:2,bootstrapped:false,frontiers:{},lastScanAt:null} }; }

const selected = searches;
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `dans-vault-${bot}-`));
await fs.copyFile(new URL('./monitor.mjs', root), path.join(tempDir, 'monitor.mjs'));
await fs.copyFile(new URL('./inventory.json', root), path.join(tempDir, 'inventory.json'));
await fs.writeFile(path.join(tempDir, 'config.json'), JSON.stringify({
  ...config,
  searches: selected,
  freshness: { ...(config.freshness ?? {}), maxAgeMinutes: 18 },
  // Explicit runtime gate: no worn/used/Very Good items may alert.
  allowedConditionKeywords: ['new with tags', 'new without tags'],
  condition: { ...(config.condition ?? {}), new: ['new with tags', 'new without tags'], veryGood: [] }
}, null, 2));
await fs.writeFile(path.join(tempDir, 'state.json'), JSON.stringify(baseState, null, 2));

console.log(`Starting Dan's Vault ${bot} fresh radar with ${selected.length} search groups.`);
console.log('Condition gate: ONLY New with tags / New without tags.');
console.log('Capture range: +20% max price, 18-minute freshness window.');
await import(pathToFileURL(path.join(tempDir, 'monitor.mjs')).href);

if (process.env.TEST_MODE !== 'true') {
  const nextState = JSON.parse(await fs.readFile(path.join(tempDir, 'state.json'), 'utf8'));
  nextState.lastRotation = { bot, selected: selected.map(x => x.name), at: new Date().toISOString() };
  await fs.writeFile(path.join(tempDir, 'state.json'), JSON.stringify(nextState, null, 2) + '\n');
  await fs.copyFile(path.join(tempDir, 'state.json'), existingState);
  console.log(`Saved ${bot} state to ${stateName}.`);
}

await fs.rm(tempDir, { recursive: true, force: true });
