import assert from 'node:assert/strict';
import {
  TRAINER_SIZES,
  CLOTHING_SIZES,
  buildSearches,
  classifyCondition,
  discordWebhookUrl,
  extractItems,
  inferSize,
  isRecoveryMode,
  matchesSearchCandidate,
  migrateState,
  parseAgeMinutes
} from './radar-core-v4.mjs';

const item = title => ({ title, fullText: title });
assert.equal(matchesSearchCandidate(item('Nike TN mens trainers'), 'Nike TN'), true);
assert.equal(matchesSearchCandidate(item('Nike TNs black'), 'Nike TN'), true);
assert.equal(matchesSearchCandidate(item('Nike Tans red black'), 'Nike TN'), true);
assert.equal(matchesSearchCandidate(item('Nike Air Max Plus'), 'Nike TN'), true);
assert.equal(matchesSearchCandidate(item('Nike Tuned 1'), 'Nike TN'), true);
assert.equal(matchesSearchCandidate(item('Nike Air Force 1 white'), 'Nike TN'), false);

assert.equal(inferSize('Size: UK 9.5', TRAINER_SIZES, 'trainers'), 9.5);
assert.equal(inferSize('UK 7', TRAINER_SIZES, 'trainers'), 7);
assert.equal(inferSize('£7.00 postage', TRAINER_SIZES, 'trainers'), null);
assert.equal(inferSize('Size: XL', CLOTHING_SIZES, 'clothing'), 'XL');
assert.equal(inferSize('Size M', CLOTHING_SIZES, 'clothing'), 'M');
assert.equal(inferSize('UK 9.5', CLOTHING_SIZES, 'clothing'), null);

assert.equal(classifyCondition('New without tags'), 'newWithoutTags');
assert.equal(classifyCondition('New with tags'), 'newWithTags');
assert.equal(classifyCondition('Very good'), 'unknown');
assert.equal(parseAgeMinutes('Uploaded 2 minutes ago'), 2);
assert.equal(parseAgeMinutes('1 hour ago'), 60);

const fixture = `
<a href="/items/101-nike-tns-red">Nike TNs</a><div>Uploaded 2 minutes ago £45.00</div>
<a href="/items/102-nike-air-force-1">AF1</a><div>Uploaded 4 minutes ago £55.00</div>`;
const parsed = extractItems(fixture, 10);
assert.equal(parsed.length, 2);
assert.equal(parsed[0].id, '101');
assert.equal(parsed[0].price, 45);
assert.equal(parsed[1].price, 55);

const config = {
  searches: [{ name: 'Nike TN', buyUrl: 'https://www.vinted.co.uk/catalog?search_text=nike%20tn&price_to=66', maxPrice: 66 }]
};
const searches = buildSearches('trainers', config);
assert.equal(searches.length, 2);
const legacyState = { freshness: { version: 2, bootstrapped: true, lastScanAt: new Date().toISOString(), frontiers: { 'Nike TN': { maxId: '100' } } }, items: {} };
migrateState(legacyState, searches);
assert.equal(legacyState.freshness.version, 4);
assert.equal(legacyState.freshness.frontiers['Nike TN::primary'].maxId, '100');
assert.equal(legacyState.freshness.frontiers['Nike TN::air-max-plus'].maxId, '100');
assert.equal(isRecoveryMode(new Date().toISOString()), false);
assert.equal(isRecoveryMode('2000-01-01T00:00:00Z'), true);
assert.match(discordWebhookUrl('https://discord.com/api/webhooks/1/x'), /wait=true/);

console.log('Radar v4 self-test passed.');
