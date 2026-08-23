import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { applyExpandedTrainerRadar } from './expanded-trainer-radar.mjs';
import { applyTrainerDiscoveryHardening } from './trainer-discovery-hardening.mjs';
import { applyConditionTierExpansion } from './condition-tier-expansion.mjs';
import { applyConditionFallback } from './condition-fallback.mjs';
import { applySellerSafety } from './seller-safety.mjs';

await applyExpandedTrainerRadar();
await applyTrainerDiscoveryHardening();
await applyConditionTierExpansion();
await applyConditionFallback();
await applySellerSafety();

const src = await fs.readFile(new URL('./radar-v6.mjs', import.meta.url), 'utf8');
assert.match(src, /DAN_INTEGRATED_SELLER_SAFETY_V1/);
assert.match(src, /let detailRaw = ''/);
assert.match(src, /assessSellerRisk\(detailRaw, item, resale\)/);
assert.match(src, /seller-check-budget-exhausted/);
assert.match(src, /blockedReason: 'seller-risk'/);
assert.match(src, /feedback_count/);
assert.match(src, /price is at or below 30% of expected resale/);
assert.match(src, /seller identity could not be verified/);
assert.match(src, /mergeRisk\(fakeRisk/);

console.log('Integrated trainer seller safety self-test passed.');
