import fs from 'node:fs/promises';

const file = new URL('./radar-v5.mjs', import.meta.url);
let source = await fs.readFile(file, 'utf8');
let changed = false;

function replaceExact(label, before, after) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Could not apply ${label}: expected source block not found`);
  source = source.replace(before, after);
  changed = true;
}

const oldWindow = "      const start = Math.max(0, m.index - 1400), end = Math.min(html.length, m.index + 2600);\n      const context = stripTags(html.slice(start,end)).replace(/\\s+/g,' ').trim();";
const fixedWindow = "      // Keep each card's price/age context forward-only so a previous card cannot bleed into it.\n      const start = m.index, end = Math.min(html.length, m.index + 1800);\n      const context = stripTags(html.slice(start,end)).replace(/\\s+/g,' ').trim();";
replaceExact('Vinted card parser isolation fix', oldWindow, fixedWindow);

const oldBootstrapMultiline = `    if (firstRunForSearch) {
      remember(state, item, prior, { bootstrapSeen:true });
      continue;
    }`;
const oldBootstrapInline = "    if (firstRunForSearch) { remember(state, item, prior, { bootstrapSeen:true }); continue; }";
const fixedBootstrap = `    // Do not suppress a genuinely fresh listing just because this search has no saved frontier yet.
    if (firstRunForSearch && !ageFresh) {
      remember(state, item, prior, { bootstrapSeen:true });
      continue;
    }`;
if (!source.includes(fixedBootstrap)) {
  if (source.includes(oldBootstrapMultiline)) {
    source = source.replace(oldBootstrapMultiline, fixedBootstrap);
    changed = true;
  } else if (source.includes(oldBootstrapInline)) {
    source = source.replace(oldBootstrapInline, fixedBootstrap);
    changed = true;
  } else {
    throw new Error('Could not apply first-fresh-listing fix: bootstrap guard not found');
  }
}

replaceExact(
  'safe rotation initialisation',
  "  state.rotationCursor = (cursor + selected.length) % allSearches.length;",
  "  let rotationAdvance = 0;"
);

replaceExact(
  'successful search rotation tracking',
  "      await processSearch({ bot, search, candidates, sizes, state, inventory, baseConfig, webhook, now, recoveryMode, diagnostics });",
  "      await processSearch({ bot, search, candidates, sizes, state, inventory, baseConfig, webhook, now, recoveryMode, diagnostics });\n      rotationAdvance = index + 1;"
);

const oldBlockedCatch = `      if (error.blocked) {
        state.cooldownUntil = new Date(Date.now() + BLOCK_COOLDOWN_MS).toISOString();
        blocked = true;
        break;
      }`;
const fixedBlockedCatch = `      if (error.blocked) {
        state.cooldownUntil = new Date(Date.now() + BLOCK_COOLDOWN_MS).toISOString();
        blocked = true;
        break;
      }
      // Non-blocking failures should not starve later search groups forever.
      rotationAdvance = index + 1;`;
replaceExact('blocked-search retry rotation', oldBlockedCatch, fixedBlockedCatch);

const oldStateBlock = `  state.freshness.lastScanAt = now.toISOString();
  state.updatedAt = now.toISOString();
  state.radarVersion = 5;
  state.diagnostics = diagnostics;
  diagnostics.pendingDeliveries = Object.keys(state.pendingDeliveries).length;
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\\n');

  console.log(\`RADAR V5 \${bot}: \${diagnostics.successfulSearches}/\${selected.length} selected searches OK; \${diagnostics.freshItems} fresh; \${diagnostics.deliveredAlerts} delivered; \${diagnostics.pendingDeliveries} pending.\`);

  const minimumHealthy = Math.ceil(selected.length * 0.6);`;
const fixedStateBlock = `  const minimumHealthy = Math.ceil(selected.length * 0.6);
  const healthyScan = !blocked && diagnostics.successfulSearches >= minimumHealthy;
  diagnostics.healthyScan = healthyScan;

  // Only advance past searches actually completed. A blocked search is retried after cooldown.
  state.rotationCursor = (cursor + rotationAdvance) % allSearches.length;
  state.freshness.lastAttemptAt = now.toISOString();
  if (healthyScan) state.freshness.lastScanAt = now.toISOString();
  state.updatedAt = now.toISOString();
  state.radarVersion = 5;
  state.diagnostics = diagnostics;
  diagnostics.pendingDeliveries = Object.keys(state.pendingDeliveries).length;
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\\n');

  console.log(\`RADAR V5 \${bot}: \${diagnostics.successfulSearches}/\${selected.length} selected searches OK; \${diagnostics.freshItems} fresh; \${diagnostics.deliveredAlerts} delivered; \${diagnostics.pendingDeliveries} pending; healthy=\${healthyScan}.\`);`;
replaceExact('truthful scan health and rotation persistence', oldStateBlock, fixedStateBlock);

if (changed) {
  await fs.writeFile(file, source);
  console.log('Applied Vinted v5 reliability fixes.');
} else {
  console.log('Vinted v5 reliability fixes already active.');
}
