import assert from 'node:assert/strict';
import { applyExpandedTrainerRadar } from './expanded-trainer-radar.mjs';
import { applyTrainerDiscoveryHardening } from './trainer-discovery-hardening.mjs';

await applyExpandedTrainerRadar();
await applyTrainerDiscoveryHardening();

const radar = await import('./radar-v6.mjs?trainer-discovery-selftest');
const item = title => ({ title, fullText:title });

assert.deepEqual(radar.TRAINER_SIZES, [6,6.5,7,7.5,8,8.5,9,9.5,10,10.5,11]);
assert.equal(radar.matchesSearchCandidate(item('Size 9.5 p6000'), 'Nike P-6000'), true);
assert.equal(radar.matchesSearchCandidate(item('Nike P-6000 mens'), 'Nike P-6000'), true);
assert.equal(radar.matchesSearchCandidate(item('TN3 black red'), 'Nike Air Max Plus 3'), true);
assert.equal(radar.matchesSearchCandidate(item('TN7 triple black'), 'Nike Air Max Plus VII'), true);
assert.equal(radar.matchesSearchCandidate(item('AM95 neon'), 'Nike Air Max 95'), true);
assert.equal(radar.matchesSearchCandidate(item('AF1 white UK 9'), 'Nike Air Force 1'), true);
assert.equal(radar.matchesSearchCandidate(item('AJ4 military black'), 'Air Jordan 4'), true);

const config = {
  searches: [
    { name:'Nike P-6000', buyUrl:'https://www.vinted.co.uk/catalog?search_text=nike%20p-6000&order=newest_first', maxPrice:55 },
    { name:'Nike TN', buyUrl:'https://www.vinted.co.uk/catalog?search_text=nike%20tn&order=newest_first', maxPrice:75 }
  ]
};
const searches = radar.buildSearches('trainers', config);
assert.equal(searches.length, 2);
const p6 = searches.find(x => x.name === 'Nike P-6000');
const tn = searches.find(x => x.name === 'Nike TN');
assert.deepEqual(p6.discoveryQueries.slice(0,2), ['p6000','p 6000']);
assert.equal(p6.buyUrls.some(u => new URL(u).searchParams.get('search_text') === 'p6000'), true);
assert.equal(p6.buyUrls.some(u => new URL(u).searchParams.get('search_text') === 'p 6000'), true);
assert.equal(tn.buyUrls.some(u => new URL(u).searchParams.get('search_text') === 'air max plus'), true);
assert.equal(searches.every(s => !new URL(s.buyUrl).searchParams.has('price_to')), true);

console.log('Trainer discovery hardening self-test passed.');
