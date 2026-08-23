import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { applyExpandedTrainerRadar } from './expanded-trainer-radar.mjs';
import { applyTrainerDiscoveryHardening } from './trainer-discovery-hardening.mjs';
import { applyConditionTierExpansion } from './condition-tier-expansion.mjs';
import { applyConditionFallback } from './condition-fallback.mjs';
import { applyConditionChannelRouting } from './condition-channel-routing.mjs';

await applyExpandedTrainerRadar();
await applyTrainerDiscoveryHardening();
await applyConditionTierExpansion();
await applyConditionFallback();
await applyConditionChannelRouting();

const src = await fs.readFile(new URL('./radar-v6.mjs', import.meta.url), 'utf8');
assert.match(src, /return'veryGood'/);
assert.match(src, /newWithoutTagsWebhook/);
assert.match(src, /newWithTagsWebhook/);
assert.match(src, /veryGoodWebhook/);
assert.match(src, /alert\?\.condition === 'newWithoutTags'/);
assert.match(src, /alert\?\.condition === 'newWithTags'/);
assert.match(src, /alert\?\.condition === 'veryGood'/);
assert.match(src, /selectDiscordWebhook\(alert, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook\)/);
assert.match(src, /selectDiscordWebhook\(pending\.alert, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook\)/);
console.log('Condition channel routing self-test passed.');
