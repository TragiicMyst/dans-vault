import fs from 'node:fs/promises';
import './fetch-guard.mjs';
import { applyExpandedTrainerRadar } from './expanded-trainer-radar.mjs';
import { applyTrainerDiscoveryHardening } from './trainer-discovery-hardening.mjs';
import { applyExpandedClothingRadar } from './expanded-clothing-radar.mjs';
import { applyClothingDiscoveryHardening } from './clothing-discovery-hardening.mjs';
import { applyConditionTierExpansion } from './condition-tier-expansion.mjs';
import { applyConditionFallback } from './condition-fallback.mjs';
import { applyTrainerThroughput } from './trainer-throughput.mjs';
import { applyReliabilityBudget } from './reliability-budget.mjs';
import { applySellerSafety } from './seller-safety.mjs';
import { applyTrainerAlertBalance } from './trainer-alert-balance.mjs';
import { applyClothingVariety } from './clothing-variety.mjs';
import { applyBroadClothingOpportunities } from './broad-clothing-opportunities.mjs';
import { applyAllNikeOpportunities } from './all-nike-opportunities.mjs';
import { applyConditionChannelRouting } from './condition-channel-routing.mjs';
import { applyListingImageEmbed } from './listing-image-embed.mjs';
import { resolveDiscordRoutes } from './discord-route-resolver.mjs';

const root = new URL('./', import.meta.url);
const bot = process.env.BOT_TYPE ?? 'trainers';
const stateName = process.env.STATE_NAME ?? (bot === 'clothing' ? 'clothing-state.json' : 'state.json');
const statePath = new URL(`./${stateName}`, root);
const webhook = process.env.DISCORD_WEBHOOK_URL;

let newWithoutTagsWebhook = process.env.DISCORD_NEW_WITHOUT_TAGS_WEBHOOK_URL;
let newWithTagsWebhook = process.env.DISCORD_NEW_WITH_TAGS_WEBHOOK_URL;
let veryGoodWebhook = process.env.DISCORD_VERY_GOOD_WEBHOOK_URL;

const routeResolution = await resolveDiscordRoutes({
  newWithoutTagsWebhook,
  newWithTagsWebhook,
  veryGoodWebhook
});
newWithoutTagsWebhook = routeResolution.newWithoutTagsWebhook;
newWithTagsWebhook = routeResolution.newWithTagsWebhook;
veryGoodWebhook = routeResolution.veryGoodWebhook;

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
if (bot === 'trainers') await applyTrainerThroughput();
await applyReliabilityBudget(bot);
await applySellerSafety();
if (bot === 'trainers') await applyTrainerAlertBalance();
if (bot === 'clothing') {
  await applyClothingVariety();
  await applyBroadClothingOpportunities();
}
await applyAllNikeOpportunities(bot);
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

const diagnostics = await runRadarV6({
  bot,
  baseConfig,
  statePath,
  inventoryPath: new URL('./inventory.json', root),
  webhook,
  newWithoutTagsWebhook,
  newWithTagsWebhook,
  veryGoodWebhook
});

// Persist only safe Discord destination metadata (IDs/names, never webhook URLs or tokens)
// so routing problems can be diagnosed from health JSON without exposing secrets.
try {
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  state.diagnostics ??= diagnostics ?? {};
  state.diagnostics.discordRoutes = routeResolution.summary;
  state.diagnostics.discordRouteAutoCorrected = routeResolution.autoCorrected;
  state.diagnostics.discordRouteWarnings = routeResolution.warnings ?? [];
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
} catch (error) {
  console.error(`Could not persist Discord route diagnostics: ${error.message}`);
}
