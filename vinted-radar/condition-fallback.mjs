import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_DEFERRED_CONDITION_CONFIRMATION_V5';
const BUDGET_MARKER = '// DAN_TRAINER_DETAIL_FETCH_BUDGET_V1';

export async function applyConditionFallback() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;

  // Catalogue pages often omit condition. Do not fetch every full listing page just
  // to discover condition: that makes the widened trainer radar run for minutes.
  // Resolve size only when necessary, run cheap margin checks, then confirm condition
  // on only the strongest candidates. A cycle-wide detail budget prevents one burst
  // of incomplete catalogue cards from stalling the whole trainer workflow.
  const oldDetailGate = "    if (size === null || condition === 'unknown') {";
  const newDetailGate = "    if (size === null) {";
  if (!src.includes(oldDetailGate)) throw new Error('Condition detail gate target not found');
  src = src.replace(oldDetailGate, newDetailGate);

  const earlyConditionReject = "    if (condition === 'unknown') { remember(state, item, prior, { blockedReason: 'condition-not-confirmed', size }); reject(diagnostics, 'condition-not-confirmed'); continue; }";
  if (!src.includes(earlyConditionReject)) throw new Error('Early condition reject target not found');
  src = src.replace(earlyConditionReject, `${MARKER}\n    // Condition confirmation is intentionally deferred until after cheap margin checks.`);

  const budgetAnchor = "  const firstRunForSearch = !frontierMax;";
  if (!src.includes(budgetAnchor)) throw new Error('Trainer detail budget anchor not found');
  src = src.replace(budgetAnchor, `${budgetAnchor}\n  ${BUDGET_MARKER}\n  diagnostics.detailFetches ??= 0;\n  const canFetchDetail = () => bot !== 'trainers' || diagnostics.detailFetches < 4;\n  const claimDetailFetch = () => { diagnostics.detailFetches += 1; };`);

  const sizeDetailStart = "    if (size === null) {\n      try {\n        await sleep(350 + Math.floor(Math.random() * 300));\n        detailText = normalize(visibleText(await fetchText(item.url)));";
  const budgetedSizeDetailStart = "    if (size === null) {\n      if (!canFetchDetail()) { remember(state, item, prior, { blockedReason: 'detail-budget-exhausted', size }); reject(diagnostics, 'detail-budget-exhausted'); continue; }\n      claimDetailFetch();\n      try {\n        detailText = normalize(visibleText(await fetchText(item.url)));";
  if (!src.includes(sizeDetailStart)) throw new Error('Size detail fetch target not found');
  src = src.replace(sizeDetailStart, budgetedSizeDetailStart);

  const riskAnchor = "    const risk = fakeRisk(item, `${summaryText} ${detailText}`, resale);";
  if (!src.includes(riskAnchor)) throw new Error('Deferred condition insertion target not found');
  const deferredConfirmation = `    if (condition === 'unknown') {\n      if (!canFetchDetail()) {\n        remember(state, item, prior, { blockedReason: 'detail-budget-exhausted', size, resale, netProfit: profit, roi });\n        reject(diagnostics, 'detail-budget-exhausted');\n        continue;\n      }\n      claimDetailFetch();\n      try {\n        detailText = normalize(visibleText(await fetchText(item.url)));\n        condition = classifyCondition(detailText);\n      } catch (error) {\n        remember(state, item, prior, { blockedReason: 'detail-fetch-failed', detailError: error.message, size, resale, netProfit: profit, roi });\n        reject(diagnostics, 'detail-fetch-failed');\n        if (error.blocked) throw error;\n        continue;\n      }\n      if (condition === 'unknown') {\n        remember(state, item, prior, { blockedReason: 'condition-not-confirmed', size, resale, netProfit: profit, roi });\n        reject(diagnostics, 'condition-not-confirmed');\n        continue;\n      }\n    }\n\n${riskAnchor}`;
  src = src.replace(riskAnchor, deferredConfirmation);

  const oldLabel = "a.condition==='newWithTags'?'🆕 New with tags':'🆕 New without tags'";
  const newLabel = "a.condition==='newWithTags'?'🆕 New with tags':a.condition==='newWithoutTags'?'🆕 New without tags':a.condition==='veryGood'?'✅ Very good':'⚠️ Condition unconfirmed'";
  if (!src.includes(oldLabel)) throw new Error('Condition label patch target not found');
  src = src.replace(oldLabel, newLabel);

  await fs.writeFile(radarUrl, src);
}
