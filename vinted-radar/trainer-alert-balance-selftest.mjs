import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { applyExpandedTrainerRadar } from './expanded-trainer-radar.mjs';
import { applyTrainerDiscoveryHardening } from './trainer-discovery-hardening.mjs';
import { applyConditionTierExpansion } from './condition-tier-expansion.mjs';
import { applyConditionFallback } from './condition-fallback.mjs';
import { applySellerSafety } from './seller-safety.mjs';
import { applyTrainerAlertBalance } from './trainer-alert-balance.mjs';

await applyExpandedTrainerRadar();
await applyTrainerDiscoveryHardening();
await applyConditionTierExpansion();
await applyConditionFallback();
await applySellerSafety();
await applyTrainerAlertBalance();

const src = await fs.readFile(new URL('./radar-v6.mjs', import.meta.url), 'utf8');
assert.match(src, /DAN_AF1_NEW_WITH_TAGS_BALANCE_V2/);
assert.match(src, /search\.name === 'Nike Air Force 1'/);
assert.match(src, /condition === 'newWithTags'/);
assert.match(src, /!exceptional/);
assert.match(src, /5 \* 60_000/);
assert.match(src, /blockedReason:'model-cooldown'/);
assert.match(src, /modelConditionLastSent/);

console.log('Trainer New With Tags alert balance self-test passed.');
