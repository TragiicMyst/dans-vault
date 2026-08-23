import assert from 'node:assert/strict';
import {
  RADAR_PROFILE,
  RADAR_VERSION,
  TRAINER_SIZES,
  CLOTHING_SIZES,
  buildSearches,
  classifyCondition,
  extractItems,
  inferSize,
  matchesSearchCandidate,
  parseAgeMinutes
} from './radar-v6.mjs';

const item = title => ({ title, fullText: title });

assert.equal(RADAR_VERSION, 6);
assert.equal(RADAR_PROFILE.freshnessMinutes, 15);
assert.equal(RADAR_PROFILE.priceMultiplier, 1.4);
assert.equal(RADAR_PROFILE.minProfit, 8);
assert.equal(RADAR_PROFILE.minRoi, 20);
assert.equal(RADAR_PROFILE.defaultScore, 55);

assert.equal(matchesSearchCandidate(item('Nike TN mens trainers'), 'Nike TN'), true);
assert.equal(matchesSearchCandidate(item('Nike TNs black'), 'Nike TN'), true);
assert.equal(matchesSearchCandidate(item('Nike Tans red black'), 'Nike TN'), true);
assert.equal(matchesSearchCandidate(item('Nike Air Max Plus'), 'Nike TN'), true);
assert.equal(matchesSearchCandidate(item('Nike Tuned 1'), 'Nike TN'), true);
assert.equal(matchesSearchCandidate(item('Nike Air Force 1 white'), 'Nike TN'), false);
assert.equal(matchesSearchCandidate(item('Nike P-6000 White Silver'), 'Nike P-6000'), true);

assert.equal(inferSize('Size: UK 9.5', TRAINER_SIZES, 'trainers'), 9.5);
assert.equal(inferSize('Nike 7.5 · New without tags £65.00', TRAINER_SIZES, 'trainers'), 7.5);
assert.equal(inferSize('£7.00 postage', TRAINER_SIZES, 'trainers'), null);
assert.equal(inferSize('Size: XL', CLOTHING_SIZES, 'clothing'), 'XL');
assert.equal(inferSize('Nike M · New with tags £20.00', CLOTHING_SIZES, 'clothing'), 'M');
assert.equal(inferSize('UK 9.5', CLOTHING_SIZES, 'clothing'), null);

assert.equal(classifyCondition('New without tags'), 'newWithoutTags');
assert.equal(classifyCondition('New with tags'), 'newWithTags');
assert.equal(classifyCondition('Very good'), 'unknown');
assert.equal(parseAgeMinutes('Uploaded 2 minutes ago'), 2);
assert.equal(parseAgeMinutes('1 hour ago'), 60);

const fixture = `
<section>
  <a href="/items/101-nike-tns-red">photo</a>
  <a href="/items/101-nike-tns-red">Nike TNs</a>
  <span>Nike 9 · New without tags £45.00 £48.00 incl.</span>
</section>
<section>
  <a href="/items/102-nike-air-force-1-white">photo</a>
  <a href="/items/102-nike-air-force-1-white">AF1</a>
  <span>Nike 7.5 · New with tags £55.00 £58.00 incl.</span>
</section>`;
const parsed = extractItems(fixture, 10);
assert.equal(parsed.length, 2);
assert.equal(parsed[0].id, '101');
assert.equal(parsed[0].price, 45);
assert.equal(parsed[1].id, '102');
assert.equal(parsed[1].price, 55);
assert.equal(inferSize(parsed[0].fullText, TRAINER_SIZES, 'trainers'), 9);
assert.equal(classifyCondition(parsed[0].fullText), 'newWithoutTags');

const config = {
  searches: [{ name: 'Nike TN', buyUrl: 'https://www.vinted.co.uk/catalog?search_text=nike%20tn&price_to=66', maxPrice: 66 }]
};
const trainerSearches = buildSearches('trainers', config);
assert.equal(trainerSearches.length, 3);
assert.equal(trainerSearches.some(s => s.key === 'Nike TN::air-max-plus'), true);
assert.equal(trainerSearches.some(s => s.key === 'Nike TN::tans'), true);
assert.equal(trainerSearches.every(s => !new URL(s.buyUrl).searchParams.has('price_to')), true);
assert.equal(trainerSearches[0].maxPrice, 92.4);
assert.equal(trainerSearches[0].minScore, 57);

const clothingSearches = buildSearches('clothing', config);
assert.equal(clothingSearches.length, 16);
assert.equal(clothingSearches[0].maxPrice, 42);
assert.equal(clothingSearches[0].minScore, 55);
assert.equal(clothingSearches.every(s => !new URL(s.buyUrl).searchParams.has('price_to')), true);

console.log('Radar v6 self-test passed.');
