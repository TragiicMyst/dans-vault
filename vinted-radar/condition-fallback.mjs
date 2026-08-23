import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_CONDITION_FALLBACK_V3';

export async function applyConditionFallback() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;

  // If the size is already known, do not make a detail-page request just to prove
  // the condition. Unknown condition is allowed to continue through the normal
  // price, margin, authenticity and score checks.
  const oldDetailGate = "    if (size === null || condition === 'unknown') {";
  const newDetailGate = "    if (size === null) {";
  if (!src.includes(oldDetailGate)) throw new Error('Condition detail gate patch target not found');
  src = src.replace(oldDetailGate, newDetailGate);

  const oldReject = "    if (condition === 'unknown') { remember(state, item, prior, { blockedReason: 'condition-not-confirmed', size }); reject(diagnostics, 'condition-not-confirmed'); continue; }";
  const newFallback = `${MARKER}\n    if (condition === 'unknown') {\n      condition = 'unconfirmed';\n      diagnostics.unconfirmedConditionPassed = Number(diagnostics.unconfirmedConditionPassed || 0) + 1;\n    }`;
  if (!src.includes(oldReject)) throw new Error('Condition fallback patch target not found');
  src = src.replace(oldReject, newFallback);

  const oldLabel = "a.condition==='newWithTags'?'🆕 New with tags':'🆕 New without tags'";
  const newLabel = "a.condition==='newWithTags'?'🆕 New with tags':a.condition==='newWithoutTags'?'🆕 New without tags':a.condition==='veryGood'?'✅ Very good':'⚠️ Condition unconfirmed'";
  if (!src.includes(oldLabel)) throw new Error('Condition label patch target not found');
  src = src.replace(oldLabel, newLabel);

  await fs.writeFile(radarUrl, src);
}
