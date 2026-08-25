import fs from 'node:fs/promises';

const file = new URL('./engine.mjs', import.meta.url);
let source = await fs.readFile(file, 'utf8');
const MARKER = '// WINTER_FRESHNESS_GATE_V1';

if (source.includes(MARKER)) {
  console.log('Winter Flips freshness gate already applied in working tree.');
  process.exit(0);
}

function replaceExact(label, before, after) {
  if (!source.includes(before)) throw new Error(`Could not apply ${label}: expected source block not found`);
  source = source.replace(before, after);
}

replaceExact(
  'freshness diagnostics',
  `  vintedItems: 0,\n  candidates: 0,\n  alerts: 0,`,
  `  vintedItems: 0,\n  freshItems: 0,\n  freshByAge: 0,\n  freshByNewId: 0,\n  bootstrapBlocked: 0,\n  staleBlocked: 0,\n  candidates: 0,\n  alerts: 0,`
);

replaceExact(
  'per-search freshness frontier',
  `  diagnostics.vintedItems += items.length;\n  const all = dedupeItems(items).slice(0, Number(CONFIG.scan.itemsPerSource || 35));\n  const prices = all.map(x => x.price).filter(x => Number.isFinite(x) && x > 5 && x < 1000);\n  const marketMedian = prices.length >= 5 ? median(prices) : null;\n\n  await maybeSendSupplyVacuum({ group, all, marketMedian, state, diagnostics });\n\n  for (const item of all) {`,
  `${MARKER}\n  diagnostics.vintedItems += items.length;\n  const all = dedupeItems(items).slice(0, Number(CONFIG.scan.itemsPerSource || 35));\n  const prices = all.map(x => x.price).filter(x => Number.isFinite(x) && x > 5 && x < 1000);\n  const marketMedian = prices.length >= 5 ? median(prices) : null;\n  const previousMarket = state.market[group.key];\n  const frontierMax = previousMarket?.frontierMaxId ? String(previousMarket.frontierMaxId) : null;\n  const firstRunForSearch = !frontierMax;\n  let maxRelevantId = frontierMax;\n  for (const item of all) {\n    if (!maxRelevantId || compareIds(item.id, maxRelevantId) > 0) maxRelevantId = String(item.id);\n  }\n\n  await maybeSendSupplyVacuum({ group, all, marketMedian, state, diagnostics });\n\n  for (const item of all) {`
);

replaceExact(
  'freshness alert gate',
  `    if (previous?.alertedAt) continue;\n    if (previous?.firstSeenAt) continue;\n\n    const modelMatch = identifyModel(item, CONFIG.models || []);`,
  `    const freshnessSource = classifyFreshness(item, frontierMax);\n    const ageFresh = freshnessSource === 'age';\n    const idNewer = freshnessSource === 'new-id';\n\n    if (previous?.alertedAt) continue;\n    if (previous?.firstSeenAt) continue;\n\n    // First pass establishes a frontier instead of dumping old catalogue stock into Discord.\n    if (firstRunForSearch && !ageFresh) {\n      state.seen[seenKey].bootstrapSeen = true;\n      state.seen[seenKey].blockedReason = 'freshness-bootstrap';\n      diagnostics.bootstrapBlocked += 1;\n      continue;\n    }\n\n    // Vinted often omits age. A listing ID newer than the saved frontier is the fallback fresh signal.\n    if (!freshnessSource) {\n      state.seen[seenKey].blockedReason = 'stale-or-no-freshness-signal';\n      diagnostics.staleBlocked += 1;\n      continue;\n    }\n\n    state.seen[seenKey].freshnessSource = freshnessSource;\n    diagnostics.freshItems += 1;\n    if (ageFresh) diagnostics.freshByAge += 1;\n    if (idNewer) diagnostics.freshByNewId += 1;\n\n    const modelMatch = identifyModel(item, CONFIG.models || []);`
);

replaceExact(
  'persist frontier',
  `    vintedCount: all.length,\n    vintedMedian: marketMedian\n  };`,
  `    vintedCount: all.length,\n    vintedMedian: marketMedian,\n    frontierMaxId: maxRelevantId || frontierMax || null\n  };`
);

replaceExact(
  'parse listing age',
  `      condition,\n      size: inferSize(\`${'${title} ${text}'}\`),`,
  `      condition,\n      ageMinutes: parseAgeMinutes(text),\n      size: inferSize(\`${'${title} ${text}'}\`),`
);

replaceExact(
  'freshness helpers',
  `function inferAllowedCondition(text) {`,
  `function classifyFreshness(item, frontierMax) {\n  const rawAge = item?.ageMinutes;\n  const age = rawAge === null || rawAge === undefined ? NaN : Number(rawAge);\n  const maxMinutes = Number(CONFIG.scan.freshnessMinutes || 15);\n  if (Number.isFinite(age) && age >= 0 && age <= maxMinutes) return 'age';\n  if (frontierMax && item?.id && compareIds(item.id, frontierMax) > 0) return 'new-id';\n  return null;\n}\n\nfunction compareIds(a, b) {\n  try {\n    const aa = BigInt(String(a));\n    const bb = BigInt(String(b));\n    return aa > bb ? 1 : aa < bb ? -1 : 0;\n  } catch {\n    return String(a).localeCompare(String(b), undefined, { numeric: true });\n  }\n}\n\nfunction parseAgeMinutes(text) {\n  const n = normalise(text);\n  if (/\\bjust now\\b|\\bless than (?:a|1) minute ago\\b/.test(n)) return 0;\n  if (/\\b(?:a|one) minute ago\\b/.test(n)) return 1;\n  if (/\\b(?:an|one) hour ago\\b/.test(n)) return 60;\n  let m = n.match(/\\b(?:uploaded\\s*)?(\\d+)\\s*(?:second|seconds|sec|secs)\\s+ago\\b/);\n  if (m) return 0;\n  m = n.match(/\\b(?:uploaded\\s*)?(\\d+)\\s*(?:minute|minutes|min|mins)\\s+ago\\b/);\n  if (m) return Number(m[1]);\n  m = n.match(/\\b(?:uploaded\\s*)?(\\d+)\\s*(?:hour|hours|hr|hrs)\\s+ago\\b/);\n  if (m) return Number(m[1]) * 60;\n  m = n.match(/\\b(?:uploaded\\s*)?(\\d+)\\s*(?:day|days)\\s+ago\\b/);\n  return m ? Number(m[1]) * 1440 : null;\n}\n\nfunction inferAllowedCondition(text) {`
);

await fs.writeFile(file, source);
console.log('Applied Winter Flips 15-minute/new-ID freshness gate to working engine.');
