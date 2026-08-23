import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_TRAINER_THROUGHPUT_V2';
const PRIORITY_MARKER = '// DAN_TRAINER_NEW_CONDITION_PRIORITY_V1';

export async function applyTrainerThroughput() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;
  if (!src.includes('// DAN_TRAINER_DETAIL_FETCH_BUDGET_V1')) {
    throw new Error('Condition fallback detail budget must be applied before trainer throughput');
  }

  const oldBudget = "const canFetchDetail = () => bot !== 'trainers' || diagnostics.detailFetches < 8;";
  if (!src.includes(oldBudget)) throw new Error('Trainer detail budget patch target not found');

  src = src.replace(
    oldBudget,
    `${MARKER}\n  // Give the widened trainer radar enough room to verify condition + seller safety.\n  // Twenty-four detail checks remains bounded by the workflow timeout and fetch guard,\n  // but substantially reduces good NWT/NWOT candidates being deferred to later cycles.\n  const canFetchDetail = () => bot !== 'trainers' || diagnostics.detailFetches < 24;`
  );

  const loopAnchor = '  for (const item of candidates) {';
  if (!src.includes(loopAnchor)) throw new Error('Trainer candidate-priority loop target not found');
  src = src.replace(
    loopAnchor,
    `  ${PRIORITY_MARKER}\n  // Spend the finite verification budget on obvious New With Tags / New Without Tags\n  // listings first, then condition-unknown listings, then Very Good. Preserve newest-first\n  // ordering inside each tier. This prevents busy Very Good pages starving the new channels.\n  const conditionPriority = item => {\n    const tier = classifyCondition(normalize(String(item?.title ?? '') + ' ' + String(item?.fullText ?? '')));\n    if (tier === 'newWithTags' || tier === 'newWithoutTags') return 0;\n    if (tier === 'unknown') return 1;\n    if (tier === 'veryGood') return 2;\n    return 3;\n  };\n  const prioritizedCandidates = bot === 'trainers'\n    ? [...candidates].sort((a,b) => conditionPriority(a) - conditionPriority(b) || compareIds(b.id, a.id))\n    : candidates;\n\n  for (const item of prioritizedCandidates) {`
  );

  if (!src.includes(PRIORITY_MARKER)) throw new Error('Trainer condition-priority marker missing after patch');
  await fs.writeFile(radarUrl, src);
}
