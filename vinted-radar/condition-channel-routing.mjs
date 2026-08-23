import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_CONDITION_CHANNEL_ROUTING_V2';

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

  src = src.replace(
    "      const messageId = await sendDiscord(webhook, alert);",
    "      const messageId = await sendDiscord(selectDiscordWebhook(alert, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook), alert);"
  );

  src = src.replace(
    "async function retryPending(state, webhook, diagnostics) {",
    "async function retryPending(state, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook, diagnostics) {"
  );

  src = src.replace(
    "      const messageId = await sendDiscord(webhook, pending.alert);",
    "      const messageId = await sendDiscord(selectDiscordWebhook(pending.alert, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook), pending.alert);"
  );

  const insertBefore = "async function sendDiscord(url,a){";
  if (!src.includes(insertBefore)) throw new Error('Discord sender target not found');
  src = src.replace(
    insertBefore,
    `function selectDiscordWebhook(alert, primaryWebhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook) {\n  if (alert?.condition === 'newWithoutTags' && newWithoutTagsWebhook) return newWithoutTagsWebhook;\n  if (alert?.condition === 'newWithTags' && newWithTagsWebhook) return newWithTagsWebhook;\n  if (alert?.condition === 'veryGood' && veryGoodWebhook) return veryGoodWebhook;\n  return primaryWebhook;\n}\n\n${insertBefore}`
  );

  await fs.writeFile(radarUrl, src);
}
