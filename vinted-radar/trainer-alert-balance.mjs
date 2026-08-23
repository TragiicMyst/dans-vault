import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_AF1_NEW_WITH_TAGS_BALANCE_V2';

export async function applyTrainerAlertBalance() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;
  if (!src.includes('// DAN_INTEGRATED_SELLER_SAFETY_V1')) throw new Error('Seller safety must be applied before trainer alert balance');

  const qualifyAnchor = '    diagnostics.qualifyingAlerts += 1;';
  if (!src.includes(qualifyAnchor)) throw new Error('Trainer alert balance qualification anchor not found');

  const gate = `${MARKER}\n    // Air Force 1 is high-volume on Vinted. Keep it in the wide search set, but allow\n    // one normal AF1 New With Tags alert per 5-minute scan cadence. Exceptional deals\n    // always bypass this balance gate.\n    state.alertBalance ??= {};\n    state.alertBalance.modelConditionLastSent ??= {};\n    const alertBalanceKey = \`${'${search.name}'}::${'${condition}'}\`;\n    if (bot === 'trainers' && search.name === 'Nike Air Force 1' && condition === 'newWithTags' && !exceptional) {\n      const lastSentMs = Date.parse(state.alertBalance.modelConditionLastSent[alertBalanceKey] || 0);\n      if (Number.isFinite(lastSentMs) && lastSentMs > 0 && Date.now() - lastSentMs < 5 * 60_000) {\n        remember(state, item, prior, { blockedReason:'model-cooldown', size, condition, resale, netProfit:profit, roi, buyScore:score, fakeRisk:risk });\n        reject(diagnostics, 'model-cooldown');\n        continue;\n      }\n    }\n\n${qualifyAnchor}`;
  src = src.replace(qualifyAnchor, gate);

  const deliveredAnchor = "      const messageId = await sendDiscord(webhook, alert);\n      diagnostics.deliveredAlerts += 1;";
  if (!src.includes(deliveredAnchor)) throw new Error('Trainer alert balance delivery anchor not found');
  const delivered = "      const messageId = await sendDiscord(webhook, alert);\n      diagnostics.deliveredAlerts += 1;\n      if (bot === 'trainers' && search.name === 'Nike Air Force 1' && condition === 'newWithTags') {\n        state.alertBalance.modelConditionLastSent[alertBalanceKey] = new Date().toISOString();\n      }";
  src = src.replace(deliveredAnchor, delivered);

  if (!src.includes(MARKER)) throw new Error('Trainer alert balance marker missing after patch');
  await fs.writeFile(radarUrl, src);
}
