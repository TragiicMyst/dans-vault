import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_RELIABILITY_BUDGET_V1';

export async function applyReliabilityBudget(bot) {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;

  if (bot === 'trainers') {
    // Keep the full trainer/model/size catalogue, but process it in smaller rotating
    // chunks so a busy Vinted page cannot push a GitHub Actions cycle into timeout.
    if (src.includes('const BATCH_SIZE = 8;')) {
      src = src.replace('const BATCH_SIZE = 8;', `${MARKER}\nconst BATCH_SIZE = 6;`);
    } else if (src.includes('const BATCH_SIZE = 4;')) {
      src = src.replace('const BATCH_SIZE = 4;', `${MARKER}\nconst BATCH_SIZE = 6;`);
    } else {
      throw new Error('Trainer batch-size reliability target not found');
    }

    const throughputBudget = "const canFetchDetail = () => bot !== 'trainers' || diagnostics.detailFetches < 24;";
    const baseBudget = "const canFetchDetail = () => bot !== 'trainers' || diagnostics.detailFetches < 8;";
    const replacement = "const canFetchDetail = () => bot === 'trainers' ? diagnostics.detailFetches < 12 : diagnostics.detailFetches < 6;";
    if (src.includes(throughputBudget)) src = src.replace(throughputBudget, replacement);
    else if (src.includes(baseBudget)) src = src.replace(baseBudget, replacement);
    else throw new Error('Trainer detail-budget reliability target not found');
  } else if (bot === 'clothing') {
    const baseBudget = "const canFetchDetail = () => bot !== 'trainers' || diagnostics.detailFetches < 8;";
    const replacement = `${MARKER}\n  const canFetchDetail = () => bot === 'trainers' ? diagnostics.detailFetches < 12 : diagnostics.detailFetches < 6;`;
    if (!src.includes(baseBudget)) throw new Error('Clothing detail-budget reliability target not found');
    src = src.replace(baseBudget, replacement);
  } else {
    throw new Error(`Unsupported bot type for reliability budget: ${bot}`);
  }

  if (!src.includes(MARKER)) throw new Error('Reliability budget marker missing after patch');
  await fs.writeFile(radarUrl, src);
}
