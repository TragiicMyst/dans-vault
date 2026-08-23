import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_CONDITION_FALLBACK_V1';

export async function applyConditionFallback() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;

  const oldLine = "    if (condition === 'unknown') { remember(state, item, prior, { blockedReason: 'condition-not-confirmed', size }); reject(diagnostics, 'condition-not-confirmed'); continue; }";
  const replacement = `${MARKER}\n    if (condition === 'unknown') {\n      condition = 'unconfirmed';\n      diagnostics.unconfirmedConditionPassed = Number(diagnostics.unconfirmedConditionPassed || 0) + 1;\n    }`;
  if (!src.includes(oldLine)) throw new Error('Condition fallback patch target not found');
  src = src.replace(oldLine, replacement);

  const oldLabel = "a.condition==='newWithTags'?'🆕 New with tags':'🆕 New without tags'";
  const newLabel = "a.condition==='newWithTags'?'🆕 New with tags':a.condition==='newWithoutTags'?'🆕 New without tags':'⚠️ Condition unconfirmed'";
  if (!src.includes(oldLabel)) throw new Error('Condition label patch target not found');
  src = src.replace(oldLabel, newLabel);

  await fs.writeFile(radarUrl, src);
}
