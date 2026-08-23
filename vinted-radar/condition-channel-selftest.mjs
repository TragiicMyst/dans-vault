import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = name => fs.readFile(new URL(`./${name}`, import.meta.url), 'utf8');
const [tier, fallback, routing, runner] = await Promise.all([
  read('condition-tier-expansion.mjs'),
  read('condition-fallback.mjs'),
  read('condition-channel-routing.mjs'),
  read('run-bot.mjs')
]);

assert.match(tier, /return'veryGood'/);
assert.match(fallback, /DAN_DEFERRED_CONDITION_CONFIRMATION_V5/);
assert.match(fallback, /if \(size === null\) \{/);
assert.match(fallback, /Condition confirmation is intentionally deferred/);
assert.match(fallback, /condition-not-confirmed/);
assert.match(fallback, /a\.condition==='veryGood'\?'✅ Very good'/);
assert.doesNotMatch(fallback, /unconfirmedConditionPassed/);
assert.match(routing, /newWithoutTagsWebhook/);
assert.match(routing, /newWithTagsWebhook/);
assert.match(routing, /veryGoodWebhook/);
assert.match(routing, /alert\?\.condition === 'newWithoutTags'/);
assert.match(routing, /alert\?\.condition === 'newWithTags'/);
assert.match(routing, /alert\?\.condition === 'veryGood'/);
assert.match(routing, /Unsupported alert condition for Discord routing/);
assert.match(routing, /selectDiscordWebhook\(alert, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook\)/);
assert.match(routing, /selectDiscordWebhook\(pending\.alert, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook\)/);
assert.match(runner, /DISCORD_NEW_WITHOUT_TAGS_WEBHOOK_URL/);
assert.match(runner, /DISCORD_NEW_WITH_TAGS_WEBHOOK_URL/);
assert.match(runner, /DISCORD_VERY_GOOD_WEBHOOK_URL/);

const tierAt = runner.indexOf('await applyConditionTierExpansion()');
const fallbackAt = runner.indexOf('await applyConditionFallback()');
const routingAt = runner.indexOf('await applyConditionChannelRouting()');
assert.ok(tierAt >= 0 && fallbackAt > tierAt && routingAt > fallbackAt, 'Condition patches must run tier -> fallback -> routing');

console.log('Condition channel routing self-test passed.');
