import fs from 'node:fs/promises';
import './fetch-guard.mjs';
import { runRadarV5 } from './radar-v5.mjs';

const root = new URL('./', import.meta.url);
const bot = process.env.BOT_TYPE ?? 'trainers';
const stateName = process.env.STATE_NAME ?? (bot === 'clothing' ? 'clothing-state.json' : 'state.json');
const webhook = process.env.DISCORD_WEBHOOK_URL;

const baseConfig = JSON.parse(await fs.readFile(new URL('./config.json', root), 'utf8'));

await runRadarV5({
  bot,
  baseConfig,
  statePath: new URL(`./${stateName}`, root),
  inventoryPath: new URL('./inventory.json', root),
  webhook
});
