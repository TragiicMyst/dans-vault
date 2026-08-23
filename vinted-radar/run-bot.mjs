import fs from 'node:fs/promises';
import './fetch-guard.mjs';
import { applyExpandedTrainerRadar } from './expanded-trainer-radar.mjs';
import { applyTrainerDiscoveryHardening } from './trainer-discovery-hardening.mjs';
import { applyExpandedClothingRadar } from './expanded-clothing-radar.mjs';
import { applyClothingDiscoveryHardening } from './clothing-discovery-hardening.mjs';
import { applyConditionFallback } from './condition-fallback.mjs';
import { applyConditionChannelRouting } from './condition-channel-routing.mjs';

const root = new URL('./', import.meta.url);
const bot = process.env.BOT_TYPE ?? 'trainers';
const stateName = process.env.STATE_NAME ?? (bot === 'clothing' ? 'clothing-state.json' : 'state.json');
const webhook = process.env.DISCORD_WEBHOOK_URL;
const newWithoutTagsWebhook = process.env.DISCORD_NEW_WITHOUT_TAGS_WEBHOOK_URL;

if (bot === 'trainers') {
  await applyExpandedTrainerRadar();
  await applyTrainerDiscoveryHardening();
}
if (bot === 'clothing') {
  await applyExpandedClothingRadar();
  await applyClothingDiscoveryHardening();
}
await applyConditionFallback();
await applyConditionChannelRouting();
const { runRadarV6 } = await import(`./radar-v6.mjs?expanded-${bot}-v4`);
const baseConfig = JSON.parse(await fs.readFile(new URL('./config.json', root), 'utf8'));

await runRadarV6({
  bot,
  baseConfig,
  statePath: new URL(`./${stateName}`, root),
  inventoryPath: new URL('./inventory.json', root),
  webhook,
  newWithoutTagsWebhook
});
