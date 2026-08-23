import fs from 'node:fs/promises';
import './fetch-guard.mjs';
import { applyExpandedTrainerRadar } from './expanded-trainer-radar.mjs';
import { applyTrainerDiscoveryHardening } from './trainer-discovery-hardening.mjs';
import { applyExpandedClothingRadar } from './expanded-clothing-radar.mjs';
import { applyClothingDiscoveryHardening } from './clothing-discovery-hardening.mjs';
import { applyConditionTierExpansion } from './condition-tier-expansion.mjs';
import { applyConditionFallback } from './condition-fallback.mjs';
import { applyConditionChannelRouting } from './condition-channel-routing.mjs';
import { applyListingImageEmbed } from './listing-image-embed.mjs';

const root = new URL('./', import.meta.url);
const bot = process.env.BOT_TYPE ?? 'trainers';
const stateName = process.env.STATE_NAME ?? (bot === 'clothing' ? 'clothing-state.json' : 'state.json');
const webhook = process.env.DISCORD_WEBHOOK_URL;
const newWithoutTagsWebhook = process.env.DISCORD_NEW_WITHOUT_TAGS_WEBHOOK_URL;
const newWithTagsWebhook = process.env.DISCORD_NEW_WITH_TAGS_WEBHOOK_URL;
const veryGoodWebhook = process.env.DISCORD_VERY_GOOD_WEBHOOK_URL;

if (bot === 'trainers') {
  await applyExpandedTrainerRadar();
  await applyTrainerDiscoveryHardening();
}
if (bot === 'clothing') {
  await applyExpandedClothingRadar();
  await applyClothingDiscoveryHardening();
}
await applyConditionTierExpansion();
await applyConditionFallback();
await applyConditionChannelRouting();
await applyListingImageEmbed();
const { runRadarV6 } = await import(`./radar-v6.mjs?expanded-${bot}-v6`);
const baseConfig = JSON.parse(await fs.readFile(new URL('./config.json', root), 'utf8'));

// "Very good" is a valid alert tier. Keep explicit Good/Fair/Satisfactory filtering,
// but do not let a bare "good" substring accidentally block "very good" listings.
baseConfig.condition ??= {};
baseConfig.condition.veryGood = [...new Set([...(baseConfig.condition.veryGood ?? []), 'very good'])];
baseConfig.condition.avoid = (baseConfig.condition.avoid ?? []).filter(x => String(x).trim().toLowerCase() !== 'good');
baseConfig.allowedConditionKeywords = [...new Set([...(baseConfig.allowedConditionKeywords ?? []), 'very good'])];

await runRadarV6({
  bot,
  baseConfig,
  statePath: new URL(`./${stateName}`, root),
  inventoryPath: new URL('./inventory.json', root),
  webhook,
  newWithoutTagsWebhook,
  newWithTagsWebhook,
  veryGoodWebhook
});
