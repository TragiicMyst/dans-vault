import fs from 'node:fs/promises';
import './fetch-guard.mjs';
import { applyExpandedTrainerRadar } from './expanded-trainer-radar.mjs';
import { applyExpandedClothingRadar } from './expanded-clothing-radar.mjs';

const root = new URL('./', import.meta.url);
const bot = process.env.BOT_TYPE ?? 'trainers';
const stateName = process.env.STATE_NAME ?? (bot === 'clothing' ? 'clothing-state.json' : 'state.json');
const webhook = process.env.DISCORD_WEBHOOK_URL;

if (bot === 'trainers') await applyExpandedTrainerRadar();
if (bot === 'clothing') await applyExpandedClothingRadar();
const { runRadarV6 } = await import(`./radar-v6.mjs?expanded-${bot}-v1`);
const baseConfig = JSON.parse(await fs.readFile(new URL('./config.json', root), 'utf8'));

await runRadarV6({
  bot,
  baseConfig,
  statePath: new URL(`./${stateName}`, root),
  inventoryPath: new URL('./inventory.json', root),
  webhook
});
