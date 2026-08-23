import assert from 'node:assert/strict';
import { applyExpandedClothingRadar } from './expanded-clothing-radar.mjs';
import { applyClothingDiscoveryHardening } from './clothing-discovery-hardening.mjs';

await applyExpandedClothingRadar();
await applyClothingDiscoveryHardening();

const radar = await import('./radar-v6.mjs?clothing-discovery-selftest');
const item = title => ({ title, fullText:title });

assert.equal(radar.CLOTHING_SIZES.includes('XXXL'), true);
assert.equal(radar.matchesSearchCandidate(item('Nike Tech Hoodie black'), 'Nike Tech Fleece Full-Zip Hoodie'), true);
assert.equal(radar.matchesSearchCandidate(item('Nike Tech Joggers grey'), 'Nike Tech Fleece Joggers'), true);
assert.equal(radar.matchesSearchCandidate(item('Nike Club Hoodie grey'), 'Nike Club Fleece Pullover Hoodie'), true);
assert.equal(radar.matchesSearchCandidate(item('NOCTA hoodie black'), 'Nike NOCTA Hoodie'), true);

const searches = radar.buildSearches('clothing', {});
const tech = searches.find(x => x.name === 'Nike Tech Fleece Full-Zip Hoodie');
assert.ok(tech);
assert.equal(tech.buyUrls.length >= 2, true);
assert.equal(tech.discoveryQueries.some(q => q === 'tech fleece full zip hoodie'), true);
assert.equal(tech.discoveryQueries.some(q => q.includes('tech') && !q.includes('fleece')), true);
assert.equal(searches.every(s => !new URL(s.buyUrl).searchParams.has('price_to')), true);

console.log('Clothing discovery hardening self-test passed.');
