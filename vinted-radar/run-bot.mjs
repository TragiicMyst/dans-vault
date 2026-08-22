import fs from 'node:fs/promises';
import { runRadar } from './radar-core.mjs';

const root = new URL('./', import.meta.url);
const bot = process.env.BOT_TYPE ?? 'trainers';
const stateName = process.env.STATE_NAME ?? (bot === 'clothing' ? 'clothing-state.json' : 'state.json');
const webhook = process.env.DISCORD_WEBHOOK_URL;
const testMode = process.env.TEST_MODE === 'true';

const baseConfig = JSON.parse(await fs.readFile(new URL('./config.json', root), 'utf8'));

await runRadar({
  bot,
  baseConfig,
  statePath: new URL(`./${stateName}`, root),
  inventoryPath: new URL('./inventory.json', root),
  webhook,
  testMode
});
