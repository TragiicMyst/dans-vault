import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_CONDITION_CHANNEL_ROUTING_V6';

export async function applyConditionChannelRouting() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;

  src = src.replace(
    "export async function runRadarV6({ bot, baseConfig, statePath, inventoryPath, webhook }) {",
    `${MARKER}\nexport async function runRadarV6({ bot, baseConfig, statePath, inventoryPath, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook }) {`
  );

  src = src.replace(
    "function normalizeState(s){s.items??={};s.freshness??={frontiers:{},lastScanAt:null,lastAttemptAt:null};s.freshness.frontiers??={};s.pendingDeliveries??={};if(!Number.isFinite(Number(s.rotationCursor)))s.rotationCursor=0;}",
    "function normalizeState(s){s.items??={};s.freshness??={frontiers:{},lastScanAt:null,lastAttemptAt:null};s.freshness.frontiers??={};s.pendingDeliveries??={};s.alertedItemIds??={};if(!Number.isFinite(Number(s.rotationCursor)))s.rotationCursor=0;}"
  );
  src = src.replace(
    "function defaultState(){return{items:{},freshness:{frontiers:{},lastScanAt:null,lastAttemptAt:null},pendingDeliveries:{},rotationCursor:0,radarVersion:RADAR_VERSION};}",
    "function defaultState(){return{items:{},freshness:{frontiers:{},lastScanAt:null,lastAttemptAt:null},pendingDeliveries:{},alertedItemIds:{},rotationCursor:0,radarVersion:RADAR_VERSION};}"
  );

  const dedupeAnchor = "    if (prior?.lastAlertedAt || state.pendingDeliveries[item.id]) continue;";
  if (!src.includes(dedupeAnchor)) throw new Error('Alert dedupe target not found');
  src = src.replace(
    dedupeAnchor,
    "    if (prior?.lastAlertedAt || state.alertedItemIds?.[item.id] || state.pendingDeliveries[item.id]) { diagnostics.duplicateSuppressed = (diagnostics.duplicateSuppressed ?? 0) + 1; continue; }"
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
    "      const messageId = await sendDiscord(selectDiscordWebhook(alert, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook), alert);\n      state.alertedItemIds ??= {};\n      state.alertedItemIds[item.id] = new Date().toISOString();\n      diagnostics.deliveredByCondition ??= {};\n      diagnostics.deliveredByCondition[alert.condition] = (diagnostics.deliveredByCondition[alert.condition] ?? 0) + 1;"
  );

  src = src.replace(
    "async function retryPending(state, webhook, diagnostics) {",
    "async function retryPending(state, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook, diagnostics) {"
  );

  const pendingLoop = "  for (const [id, pending] of Object.entries(state.pendingDeliveries).slice(0, 4)) {";
  if (!src.includes(pendingLoop)) throw new Error('Pending delivery loop target not found');
  src = src.replace(
    pendingLoop,
    `${pendingLoop}\n    if (state.alertedItemIds?.[id] || state.items[id]?.lastAlertedAt) { delete state.pendingDeliveries[id]; diagnostics.duplicateSuppressed = (diagnostics.duplicateSuppressed ?? 0) + 1; continue; }`
  );

  src = src.replace(
    "      const messageId = await sendDiscord(webhook, pending.alert);",
    "      const messageId = await sendDiscord(selectDiscordWebhook(pending.alert, webhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook), pending.alert);\n      state.alertedItemIds ??= {};\n      state.alertedItemIds[id] = new Date().toISOString();\n      diagnostics.deliveredByCondition ??= {};\n      diagnostics.deliveredByCondition[pending.alert.condition] = (diagnostics.deliveredByCondition[pending.alert.condition] ?? 0) + 1;"
  );

  const insertBefore = "async function sendDiscord(url,a){";
  if (!src.includes(insertBefore)) throw new Error('Discord sender target not found');
  src = src.replace(
    insertBefore,
    `function selectDiscordWebhook(alert, primaryWebhook, newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook) {\n  if (alert?.condition === 'newWithoutTags') {\n    if (!newWithoutTagsWebhook) throw new Error('Missing DISCORD_NEW_WITHOUT_TAGS_WEBHOOK_URL');\n    return newWithoutTagsWebhook;\n  }\n  if (alert?.condition === 'newWithTags') {\n    if (!newWithTagsWebhook) throw new Error('Missing DISCORD_NEW_WITH_TAGS_WEBHOOK_URL');\n    return newWithTagsWebhook;\n  }\n  if (alert?.condition === 'veryGood') {\n    if (!veryGoodWebhook) throw new Error('Missing DISCORD_VERY_GOOD_WEBHOOK_URL');\n    return veryGoodWebhook;\n  }\n  throw new Error('Unsupported alert condition for Discord routing: '+String(alert?.condition ?? 'unknown'));\n}\n\n${insertBefore}`
  );

  if (!src.includes(MARKER)) throw new Error('Condition routing marker missing after patch');
  if (!src.includes('state.alertedItemIds')) throw new Error('Permanent alert-id dedupe ledger missing after patch');
  await fs.writeFile(radarUrl, src);
}
