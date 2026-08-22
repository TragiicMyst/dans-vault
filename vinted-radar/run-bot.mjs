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

// Fresh-radar filters are intentionally stricter than the general config:
// only Vinted's explicit "New with tags" / "New without tags" labels can alert.
// Score floors are slightly more practical so profitable steals are not lost.
const scoreFloors = {
  trainers: {
    default: 72,
    'Nike Pegasus Premium': 75,
    'Nike Air Max 95': 73,
    'Nike Air Max 97': 73,
    'Nike Shox TL': 73,
    'Nike Vomero 5': 73,
    'Nike TN': 73
  },
  clothing: {
    default: 74,
    'Nike Tech Fleece Tracksuit': 76,
    'Nike ACG Fleece': 76,
    'Nike ACG Jacket': 76,
    'Nike Puffer Jacket': 75
  }
};

const searches = (config.searches ?? [])
  .filter(s => bot === 'trainers' ? trainerNames.has(s.name) : !trainerNames.has(s.name))
  .map(s => ({ ...s, minScore: scoreFloors[bot][s.name] ?? scoreFloors[bot].default }));
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
  // Explicit runtime gate: no worn/used/Very Good items may alert.
  allowedConditionKeywords: ['new with tags', 'new without tags'],
  condition: { ...(config.condition ?? {}), new: ['new with tags', 'new without tags'], veryGood: [] }
}, null, 2));
await fs.writeFile(path.join(tempDir, 'state.json'), JSON.stringify(baseState, null, 2));

console.log(`Starting Dan's Vault ${bot} fresh radar with ${selected.length} search groups.`);
console.log('Condition gate: ONLY New with tags / New without tags.');
await import(pathToFileURL(path.join(tempDir, 'monitor.mjs')).href);

if (process.env.TEST_MODE !== 'true') {
  const nextState = JSON.parse(await fs.readFile(path.join(tempDir, 'state.json'), 'utf8'));
  nextState.lastRotation = { bot, selected: selected.map(x => x.name), at: new Date().toISOString() };
  await fs.writeFile(path.join(tempDir, 'state.json'), JSON.stringify(nextState, null, 2) + '\n');
  await fs.copyFile(path.join(tempDir, 'state.json'), existingState);
  console.log(`Saved ${bot} state to ${stateName}.`);
}

await fs.rm(tempDir, { recursive: true, force: true });
