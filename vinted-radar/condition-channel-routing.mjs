import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_CONDITION_CHANNEL_ROUTING_V5';

export async function applyConditionChannelRouting() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;

  src = src.replace(
    "export async function runRadarV6({ bot, baseConfig, statePath, inventoryPath, webhook }) {",
    `${MARKER}\nexport async function runRadarV6({ bot, baseConfig, statePath, inventoryPath, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook }) {`
  );

  src = src.replace(
    "  await retryPending(state, webhook, diagnostics);",
    "  await retryPending(state, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook, diagnostics);"
  );

  src = src.replace(
    "      await processSearch({ bot, search, candidates, sizes, state, inventory, baseConfig, webhook, now, recoveryMode, diagnostics });",
    "      await processSearch({ bot, search, candidates, sizes, state, inventory, baseConfig, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook, now, recoveryMode, diagnostics });"
  );

  src = src.replace(
    "async function processSearch({ bot, search, candidates, sizes, state, inventory, baseConfig, webhook, now, recoveryMode, diagnostics }) {",
    "async function processSearch({ bot, search, candidates, sizes, state, inventory, baseConfig, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook, now, recoveryMode, diagnostics }) {"
  );

  const qualifyAnchor = "    diagnostics.qualifyingAlerts += 1;";
  if (!src.includes(qualifyAnchor)) throw new Error('Qualification diagnostics target not found');
  src = src.replace(
    qualifyAnchor,
    `${qualifyAnchor}\n    diagnostics.qualifyingByCondition ??= {};\n    diagnostics.qualifyingByCondition[condition] = (diagnostics.qualifyingByCondition[condition] ?? 0) + 1;`
  );

  src = src.replace(
    "      const messageId = await sendDiscord(webhook, alert);",
    "      const messageId = await sendDiscord(selectDiscordWebhook(alert, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook), alert);\n      diagnostics.deliveredByCondition ??= {};\n      diagnostics.deliveredByCondition[alert.condition] = (diagnostics.deliveredByCondition[alert.condition] ?? 0) + 1;"
  );

  src = src.replace(
    "async function retryPending(state, webhook, diagnostics) {",
    "async function retryPending(state, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook, diagnostics) {"
  );

  src = src.replace(
    "      const messageId = await sendDiscord(webhook, pending.alert);",
    "      const messageId = await sendDiscord(selectDiscordWebhook(pending.alert, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook), pending.alert);\n      diagnostics.deliveredByCondition ??= {};\n      diagnostics.deliveredByCondition[pending.alert.condition] = (diagnostics.deliveredByCondition[pending.alert.condition] ?? 0) + 1;"
  );

  const insertBefore = "async function sendDiscord(url,a){";
  if (!src.includes(insertBefore)) throw new Error('Discord sender target not found');
  src = src.replace(
    insertBefore,
    `function selectDiscordWebhook(alert, primaryWebhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook) {\n  // Both trainer and clothing alerts are organised by condition. The three condition\n  // channels are the source of truth; the primary webhook is not used for supported tiers.\n  if (alert?.condition === 'newWithoutTags') {\n    if (!newWithoutTagsWebhook) throw new Error('Missing DISCORD_NEW_WITHOUT_TAGS_WEBHOOK_URL');\n    return newWithoutTagsWebhook;\n  }\n  if (alert?.condition === 'newWithTags') {\n    if (!newWithTagsWebhook) throw new Error('Missing DISCORD_NEW_WITH_TAGS_WEBHOOK_URL');\n    return newWithTagsWebhook;\n  }\n  if (alert?.condition === 'veryGood') {\n    if (!veryGoodWebhook) throw new Error('Missing DISCORD_VERY_GOOD_WEBHOOK_URL');\n    return veryGoodWebhook;\n  }\n  throw new Error('Unsupported alert condition for Discord routing: '+String(alert?.condition ?? 'unknown'));\n}\n\n${insertBefore}`
  );

  if (!src.includes(MARKER)) throw new Error('Condition routing marker missing after patch');
  await fs.writeFile(radarUrl, src);
}
