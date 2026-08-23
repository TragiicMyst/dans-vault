import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_CONDITION_CHANNEL_ROUTING_V1';

export async function applyConditionChannelRouting() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;

  src = src.replace(
    "export async function runRadarV6({ bot, baseConfig, statePath, inventoryPath, webhook }) {",
    `${MARKER}\nexport async function runRadarV6({ bot, baseConfig, statePath, inventoryPath, webhook, newWithoutTagsWebhook }) {`
  );

  src = src.replace(
    "  await retryPending(state, webhook, diagnostics);",
    "  await retryPending(state, webhook, newWithoutTagsWebhook, diagnostics);"
  );

  src = src.replace(
    "      await processSearch({ bot, search, candidates, sizes, state, inventory, baseConfig, webhook, now, recoveryMode, diagnostics });",
    "      await processSearch({ bot, search, candidates, sizes, state, inventory, baseConfig, webhook, newWithoutTagsWebhook, now, recoveryMode, diagnostics });"
  );

  src = src.replace(
    "async function processSearch({ bot, search, candidates, sizes, state, inventory, baseConfig, webhook, now, recoveryMode, diagnostics }) {",
    "async function processSearch({ bot, search, candidates, sizes, state, inventory, baseConfig, webhook, newWithoutTagsWebhook, now, recoveryMode, diagnostics }) {"
  );

  src = src.replace(
    "      const messageId = await sendDiscord(webhook, alert);",
    "      const messageId = await sendDiscord(selectDiscordWebhook(alert, webhook, newWithoutTagsWebhook), alert);"
  );

  src = src.replace(
    "async function retryPending(state, webhook, diagnostics) {",
    "async function retryPending(state, webhook, newWithoutTagsWebhook, diagnostics) {"
  );

  src = src.replace(
    "      const messageId = await sendDiscord(webhook, pending.alert);",
    "      const messageId = await sendDiscord(selectDiscordWebhook(pending.alert, webhook, newWithoutTagsWebhook), pending.alert);"
  );

  const insertBefore = "async function sendDiscord(url,a){";
  if (!src.includes(insertBefore)) throw new Error('Discord sender target not found');
  src = src.replace(
    insertBefore,
    `function selectDiscordWebhook(alert, primaryWebhook, newWithoutTagsWebhook) {\n  if (alert?.condition === 'newWithoutTags' && newWithoutTagsWebhook) return newWithoutTagsWebhook;\n  return primaryWebhook;\n}\n\n${insertBefore}`
  );

  await fs.writeFile(radarUrl, src);
}
