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

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `dans-vault-${bot}-`));
await fs.copyFile(new URL('./monitor.mjs', root), path.join(tempDir, 'monitor.mjs'));
await fs.copyFile(new URL('./inventory.json', root), path.join(tempDir, 'inventory.json'));
await fs.writeFile(path.join(tempDir, 'config.json'), JSON.stringify({ ...config, searches }, null, 2));

const existingState = new URL(`./${stateName}`, root);
try { await fs.copyFile(existingState, path.join(tempDir, 'state.json')); }
catch { await fs.writeFile(path.join(tempDir, 'state.json'), JSON.stringify({ items:{}, market:{}, sellers:{}, images:{}, cursor:0 }, null, 2)); }

console.log(`Starting Dan's Vault ${bot} bot with ${searches.length} search groups.`);
await import(pathToFileURL(path.join(tempDir, 'monitor.mjs')).href);

if (process.env.TEST_MODE !== 'true') {
  await fs.copyFile(path.join(tempDir, 'state.json'), existingState);
  console.log(`Saved ${bot} state to ${stateName}.`);
}
await fs.rm(tempDir, { recursive: true, force: true });
