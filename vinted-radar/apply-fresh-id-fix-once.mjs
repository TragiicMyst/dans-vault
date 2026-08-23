import fs from 'node:fs/promises';

const file = new URL('./radar-v6.mjs', import.meta.url);
let source = await fs.readFile(file, 'utf8');
let changed = false;

function replaceExact(label, before, after) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Could not apply ${label}: expected source block not found`);
  source = source.replace(before, after);
  changed = true;
}

replaceExact('faster search rotation', 'const BATCH_SIZE = 3;', 'const BATCH_SIZE = 4;');

replaceExact(
  'freshness diagnostics',
  `    freshItems: 0,\n    qualifyingAlerts: 0,`,
  `    freshItems: 0,\n    freshByAge: 0,\n    freshByNewId: 0,\n    qualifyingAlerts: 0,`
);

const oldFreshnessBlock = `    const prior = state.items[item.id];\n    const ageFresh = item.ageMinutes !== null && item.ageMinutes <= RADAR_PROFILE.freshnessMinutes;\n    const idNewer = frontierMax ? compareIds(item.id, frontierMax) > 0 : false;\n    if (prior?.lastAlertedAt || state.pendingDeliveries[item.id]) continue;\n\n    if (firstRunForSearch && !ageFresh) {\n      remember(state, item, prior, { bootstrapSeen: true });\n      continue;\n    }\n    if (recoveryMode && !ageFresh) {\n      remember(state, item, prior, { blockedReason: 'recovery-bootstrap' });\n      reject(diagnostics, 'recovery-bootstrap');\n      continue;\n    }\n    if (!(ageFresh || idNewer || Boolean(prior && ageFresh))) {\n      remember(state, item, prior, { blockedReason: 'stale-or-no-freshness-signal' });\n      reject(diagnostics, 'stale');\n      continue;\n    }\n\n    diagnostics.freshItems += 1;`;

const newFreshnessBlock = `    const prior = state.items[item.id];\n    const freshnessSource = classifyFreshness(item, frontierMax);\n    const ageFresh = freshnessSource === 'age';\n    const idNewer = freshnessSource === 'new-id';\n    if (prior?.lastAlertedAt || state.pendingDeliveries[item.id]) continue;\n\n    // The first ever pass for a search must establish a frontier unless Vinted explicitly gives us a fresh age.\n    if (firstRunForSearch && !ageFresh) {\n      remember(state, item, prior, { bootstrapSeen: true });\n      continue;\n    }\n\n    // Public Vinted catalogue pages often omit listing age. A Vinted item id newer than our saved\n    // frontier is therefore a valid freshness signal, including after recovery/downtime.\n    if (!freshnessSource) {\n      const reason = recoveryMode ? 'recovery-no-fresh-signal' : 'stale-or-no-freshness-signal';\n      remember(state, item, prior, { blockedReason: reason });\n      reject(diagnostics, recoveryMode ? 'recovery-no-fresh-signal' : 'stale');\n      continue;\n    }\n\n    diagnostics.freshItems += 1;\n    if (ageFresh) diagnostics.freshByAge += 1;\n    if (idNewer) diagnostics.freshByNewId += 1;`;
replaceExact('age-or-new-id freshness policy', oldFreshnessBlock, newFreshnessBlock);

const oldAgeParser = `export function parseAgeMinutes(text){const n=normalize(text);if(/\\bjust now\\b|\\bnow\\b/.test(n))return 0;let m=n.match(/\\b(?:uploaded\\s*)?(\\d+)\\s*(?:minute|minutes|min)\\s+ago\\b/);if(m)return Number(m[1]);m=n.match(/\\b(?:uploaded\\s*)?(\\d+)\\s*(?:hour|hours|hr|hrs)\\s+ago\\b/);if(m)return Number(m[1])*60;m=n.match(/\\b(?:uploaded\\s*)?(\\d+)\\s*(?:day|days)\\s+ago\\b/);return m?Number(m[1])*1440:null;}`;

const newAgeParser = `export function classifyFreshness(item, frontierMax){const age=Number(item?.ageMinutes);if(Number.isFinite(age)&&age>=0&&age<=RADAR_PROFILE.freshnessMinutes)return'age';if(frontierMax&&item?.id&&compareIds(item.id,frontierMax)>0)return'new-id';return null;}\nexport function parseAgeMinutes(text){const n=normalize(text);if(/\\bjust now\\b|\\bless than (?:a|1) minute ago\\b/.test(n))return 0;if(/\\b(?:a|one) minute ago\\b/.test(n))return 1;if(/\\b(?:an|one) hour ago\\b/.test(n))return 60;let m=n.match(/\\b(?:uploaded\\s*)?(\\d+)\\s*(?:second|seconds|sec|secs)\\s+ago\\b/);if(m)return 0;m=n.match(/\\b(?:uploaded\\s*)?(\\d+)\\s*(?:minute|minutes|min|mins)\\s+ago\\b/);if(m)return Number(m[1]);m=n.match(/\\b(?:uploaded\\s*)?(\\d+)\\s*(?:hour|hours|hr|hrs)\\s+ago\\b/);if(m)return Number(m[1])*60;m=n.match(/\\b(?:uploaded\\s*)?(\\d+)\\s*(?:day|days)\\s+ago\\b/);return m?Number(m[1])*1440:null;}`;
replaceExact('broader Vinted age parsing and exported freshness helper', oldAgeParser, newAgeParser);

if (changed) {
  await fs.writeFile(file, source);
  console.log('Applied permanent Vinted fresh-listing detection fix.');
} else {
  console.log('Vinted fresh-listing detection fix already present.');
}
