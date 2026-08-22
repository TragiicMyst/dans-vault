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

const searches = (config.searches ?? []).filter(s =>
  bot === 'trainers' ? trainerNames.has(s.name) : !trainerNames.has(s.name)
);
if (!searches.length) throw new Error(`No searches configured for ${bot}`);

const existingState = new URL(`./${stateName}`, root);
let baseState;
try { baseState = JSON.parse(await fs.readFile(existingState, 'utf8')); }
catch { baseState = { items:{}, market:{}, sellers:{}, images:{}, cursor:0 }; }

const perRun = Number(process.env.PER_RUN ?? 4);
const start = Number(baseState.cursor ?? 0) % searches.length;
const selected = Array.from({ length: Math.min(perRun, searches.length) }, (_, i) => searches[(start + i) % searches.length]);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `dans-vault-${bot}-`));
await fs.copyFile(new URL('./monitor.mjs', root), path.join(tempDir, 'monitor.mjs'));
await fs.copyFile(new URL('./inventory.json', root), path.join(tempDir, 'inventory.json'));
await fs.writeFile(path.join(tempDir, 'config.json'), JSON.stringify({ ...config, searches: selected }, null, 2));
await fs.writeFile(path.join(tempDir, 'state.json'), JSON.stringify({ ...baseState, cursor: 0 }, null, 2));

console.log(`Starting Dan's Vault ${bot} bot with ${selected.length} search groups: ${selected.map(x => x.name).join(', ')}`);
await import(pathToFileURL(path.join(tempDir, 'monitor.mjs')).href);

if (process.env.TEST_MODE !== 'true') {
  const nextState = JSON.parse(await fs.readFile(path.join(tempDir, 'state.json'), 'utf8'));
  nextState.cursor = (start + selected.length) % searches.length;
  nextState.lastRotation = { bot, start, selected: selected.map(x => x.name), at: new Date().toISOString() };
  await fs.writeFile(path.join(tempDir, 'state.json'), JSON.stringify(nextState, null, 2) + '\n');
  await fs.copyFile(path.join(tempDir, 'state.json'), existingState);
  console.log(`Saved ${bot} state to ${stateName}; next cursor ${nextState.cursor}.`);
}

await fs.rm(tempDir, { recursive: true, force: true });
