import assert from 'node:assert/strict';
import {
  TRAINER_SIZES,
  CLOTHING_SIZES,
  classifyCondition,
  inferSize,
  matchesSearchCandidate,
  parseAgeMinutes
} from './radar-core.mjs';

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

assert.equal(classifyCondition('New without tags'), 'newWithoutTags');
assert.equal(classifyCondition('New with tags'), 'newWithTags');
assert.equal(classifyCondition('Very good'), 'unknown');

assert.equal(parseAgeMinutes('Uploaded 2 minutes ago'), 2);
assert.equal(parseAgeMinutes('1 hour ago'), 60);

console.log('Radar self-test passed.');
