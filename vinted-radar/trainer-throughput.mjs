import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_TRAINER_THROUGHPUT_V1';

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
    `${MARKER}\n  // Wider trainer coverage needs more condition/seller checks per cycle. Sixteen\n  // still stays comfortably inside the 150s workflow timeout with fetch-guard pacing,\n  // while avoiding large numbers of good NWT/NWOT candidates being skipped.\n  const canFetchDetail = () => bot !== 'trainers' || diagnostics.detailFetches < 16;`
  );

  await fs.writeFile(radarUrl, src);
}
