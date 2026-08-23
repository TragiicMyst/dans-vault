import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_DEFERRED_CONDITION_CONFIRMATION_V5';

export async function applyConditionFallback() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;

  // Catalogue pages often omit condition. Do not fetch every full listing page just
  // to discover condition: that makes the widened trainer radar run for minutes.
  // Resolve size early when necessary, run the cheap price/margin checks, then fetch
  // the exact item page only for candidates that are economically worth considering.
  const oldDetailGate = "    if (size === null || condition === 'unknown') {";
  const newDetailGate = "    if (size === null) {";
  if (!src.includes(oldDetailGate)) throw new Error('Condition detail gate target not found');
  src = src.replace(oldDetailGate, newDetailGate);

  const earlyConditionReject = "    if (condition === 'unknown') { remember(state, item, prior, { blockedReason: 'condition-not-confirmed', size }); reject(diagnostics, 'condition-not-confirmed'); continue; }";
  if (!src.includes(earlyConditionReject)) throw new Error('Early condition reject target not found');
  src = src.replace(earlyConditionReject, `${MARKER}\n    // Condition confirmation is intentionally deferred until after cheap margin checks.`);

  const riskAnchor = "    const risk = fakeRisk(item, `${summaryText} ${detailText}`, resale);";
  if (!src.includes(riskAnchor)) throw new Error('Deferred condition insertion target not found');
  const deferredConfirmation = `    if (condition === 'unknown') {\n      try {\n        await sleep(250 + Math.floor(Math.random() * 250));\n        detailText = normalize(visibleText(await fetchText(item.url)));\n        condition = classifyCondition(detailText);\n      } catch (error) {\n        remember(state, item, prior, { blockedReason: 'detail-fetch-failed', detailError: error.message, size, resale, netProfit: profit, roi });\n        reject(diagnostics, 'detail-fetch-failed');\n        if (error.blocked) throw error;\n        continue;\n      }\n      if (condition === 'unknown') {\n        remember(state, item, prior, { blockedReason: 'condition-not-confirmed', size, resale, netProfit: profit, roi });\n        reject(diagnostics, 'condition-not-confirmed');\n        continue;\n      }\n    }\n\n${riskAnchor}`;
  src = src.replace(riskAnchor, deferredConfirmation);

  const oldLabel = "a.condition==='newWithTags'?'🆕 New with tags':'🆕 New without tags'";
  const newLabel = "a.condition==='newWithTags'?'🆕 New with tags':a.condition==='newWithoutTags'?'🆕 New without tags':a.condition==='veryGood'?'✅ Very good':'⚠️ Condition unconfirmed'";
  if (!src.includes(oldLabel)) throw new Error('Condition label patch target not found');
  src = src.replace(oldLabel, newLabel);

  await fs.writeFile(radarUrl, src);
}
