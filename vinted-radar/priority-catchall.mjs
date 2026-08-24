import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_PRIORITY_CATCHALL_V1';

export async function applyPriorityCatchall(bot) {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;

  const selectAnchor = "  const cursor = Number(state.rotationCursor || 0) % allSearches.length;\n  const selected = pickCircular(allSearches, cursor, BATCH_SIZE);\n  diagnostics.selectedSearches = selected.map(s => s.key);";
  if (!src.includes(selectAnchor)) throw new Error('Could not locate radar selection block');

  const selectBlock = `${MARKER}\n  // Always scan the broad apparel/shoe Nike catch-all alongside the normal rotating model searches.\n  // Clothing intentionally excludes hats, bags and all other accessories.\n  const priorityNames = bot === 'clothing'\n    ? ['Nike Any Clothing Bargain']\n    : ['Nike Any Shoe Bargain'];\n  const prioritySearches = priorityNames\n    .map(name => allSearches.find(s => s.name === name))\n    .filter(Boolean);\n  const priorityKeys = new Set(prioritySearches.map(s => s.key));\n  const rotatingSearches = allSearches.filter(s => !priorityKeys.has(s.key));\n  const cursor = rotatingSearches.length\n    ? Number(state.rotationCursor || 0) % rotatingSearches.length\n    : 0;\n  const selected = [\n    ...prioritySearches,\n    ...pickCircular(rotatingSearches, cursor, BATCH_SIZE)\n  ];\n  diagnostics.selectedSearches = selected.map(s => s.key);`;

  src = src.replace(selectAnchor, selectBlock);

  const counterAnchor = "  let blocked = false;\n  let completedSearches = 0;";
  if (!src.includes(counterAnchor)) throw new Error('Could not locate completion counters');
  src = src.replace(
    counterAnchor,
    "  let blocked = false;\n  let completedSearches = 0;\n  let completedRotatingSearches = 0;"
  );

  const successAnchor = "      diagnostics.successfulSearches += 1;\n      completedSearches += 1;\n      state.rotationCursor = (cursor + completedSearches) % allSearches.length;";
  if (!src.includes(successAnchor)) throw new Error('Could not locate successful-search cursor update');
  src = src.replace(
    successAnchor,
    "      diagnostics.successfulSearches += 1;\n      completedSearches += 1;\n      if (!priorityKeys.has(search.key)) completedRotatingSearches += 1;\n      state.rotationCursor = rotatingSearches.length ? (cursor + completedRotatingSearches) % rotatingSearches.length : 0;"
  );

  const failureAnchor = "      state.rotationCursor = (cursor + completedSearches) % allSearches.length;\n      break;";
  if (!src.includes(failureAnchor)) throw new Error('Could not locate failure cursor update');
  src = src.replace(
    failureAnchor,
    "      state.rotationCursor = rotatingSearches.length ? (cursor + completedRotatingSearches) % rotatingSearches.length : 0;\n      break;"
  );

  await fs.writeFile(radarUrl, src);
}
