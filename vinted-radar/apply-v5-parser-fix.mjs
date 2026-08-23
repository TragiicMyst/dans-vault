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
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n');

  console.log(\`RADAR V5 \${bot}: \${diagnostics.successfulSearches}/\${selected.length} selected searches OK; \${diagnostics.freshItems} fresh; \${diagnostics.deliveredAlerts} delivered; \${diagnostics.pendingDeliveries} pending.\`);

  const minimumHealthy = Math.ceil(selected.length * 0.6);`;
const fixedStateBlock = `  const minimumHealthy = Math.ceil(selected.length * 0.6);
  const zeroCatalogAnomaly = diagnostics.successfulSearches === selected.length && selected.length > 0 && diagnostics.catalogItems === 0;
  if (zeroCatalogAnomaly) diagnostics.failures.catalog = 'All selected searches returned zero catalogue cards';
  const healthyScan = !blocked && !zeroCatalogAnomaly && diagnostics.successfulSearches >= minimumHealthy;
  diagnostics.healthyScan = healthyScan;

  // Only advance past searches actually completed. A blocked search is retried after cooldown.
  state.rotationCursor = (cursor + rotationAdvance) % allSearches.length;
  state.freshness.lastAttemptAt = now.toISOString();
  if (healthyScan) state.freshness.lastScanAt = now.toISOString();
  state.updatedAt = now.toISOString();
  state.radarVersion = 5;
  state.diagnostics = diagnostics;
  diagnostics.pendingDeliveries = Object.keys(state.pendingDeliveries).length;
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n');

  console.log(\`RADAR V5 \${bot}: \${diagnostics.successfulSearches}/\${selected.length} selected searches OK; \${diagnostics.freshItems} fresh; \${diagnostics.deliveredAlerts} delivered; \${diagnostics.pendingDeliveries} pending; healthy=\${healthyScan}.\`);`;
replaceExact('truthful scan health and rotation persistence', oldStateBlock, fixedStateBlock);

const oldCatalogFetch = `      const html = await fetchText(search.buyUrl, { catalog: true });
      const raw = extractItems(html, 80);
      if (raw.length === 0 && !looksLikeEmptyCatalog(html)) {
        throw new Error('No Vinted item cards could be parsed from catalogue');
      }`;
const fixedCatalogFetch = `      let html = await fetchText(search.buyUrl, { catalog: true });
      let raw = extractItems(html, 80);
      if (raw.length === 0) {
        const fallback = new URL(search.buyUrl);
        const hadPriceFilter = fallback.searchParams.has('price_to');
        fallback.searchParams.delete('price_to');
        if (hadPriceFilter) {
          await sleep(900 + Math.floor(Math.random() * 500));
          html = await fetchText(fallback.toString(), { catalog: true });
          raw = extractItems(html, 80);
          diagnostics.fallbackCatalogSearches = Number(diagnostics.fallbackCatalogSearches || 0) + 1;
        }
      }
      if (raw.length === 0 && !looksLikeEmptyCatalog(html)) {
        throw new Error('No Vinted item cards could be parsed from catalogue');
      }`;
replaceExact('zero-result catalogue fallback', oldCatalogFetch, fixedCatalogFetch);

// Active-reseller filter profile: noticeably more alerts while keeping a sensible profit floor.
replaceExact(
  '15-minute freshness window',
  'const LIVE_FRESHNESS_MINUTES = 10;',
  'const LIVE_FRESHNESS_MINUTES = 15;'
);

replaceExact(
  'more lenient trainer score floors',
  "  trainers: { default:60,'Nike Pegasus Premium':63,'Nike Air Max 95':62,'Nike Air Max 97':62,'Nike Shox TL':62,'Nike Vomero 5':62,'Nike TN':62 },",
  "  trainers: { default:55,'Nike Pegasus Premium':58,'Nike Air Max 95':57,'Nike Air Max 97':57,'Nike Shox TL':57,'Nike Vomero 5':57,'Nike TN':57 },"
);

replaceExact(
  'more lenient clothing score floors',
  "  clothing: { default:60,'Nike Tech Fleece Tracksuit':63,'Nike ACG Fleece':63,'Nike ACG Jacket':63,'Nike Puffer Jacket':62 }",
  "  clothing: { default:55,'Nike Tech Fleece Tracksuit':58,'Nike ACG Fleece':58,'Nike ACG Jacket':58,'Nike Puffer Jacket':57 }"
);

replaceExact(
  'reasonable minimum margin',
  '    if (profit < 10 || roi < 25) {',
  '    if (profit < 8 || roi < 20) {'
);

replaceExact(
  'strong deal shortcut',
  "    const strong = profit >= 15 && roi >= 40 && risk.level !== 'HIGH';",
  "    const strong = profit >= 12 && roi >= 30 && risk.level !== 'HIGH';"
);

replaceExact(
  'exceptional deal shortcut',
  "    const exceptional = profit >= 25 && roi >= 65 && risk.level !== 'HIGH';",
  "    const exceptional = profit >= 20 && roi >= 50 && risk.level !== 'HIGH';"
);

replaceExact(
  'higher clothing search price ceiling',
  "if (bot === 'clothing') return clothingSpecs.map(([name,q,base]) => ({ name, key:`${name}::${q}`, buyUrl:catalogUrl(q,round2(base*1.3)), maxPrice:round2(base*1.3), minScore:floors.clothing[name] ?? floors.clothing.default }));",
  "if (bot === 'clothing') return clothingSpecs.map(([name,q,base]) => ({ name, key:`${name}::${q}`, buyUrl:catalogUrl(q,round2(base*1.4)), maxPrice:round2(base*1.4), minScore:floors.clothing[name] ?? floors.clothing.default }));"
);

replaceExact(
  'higher trainer search price ceiling',
  '    const maxPrice = round2(Number(s.maxPrice) * 1.3);',
  '    const maxPrice = round2(Number(s.maxPrice) * 1.4);'
);

const oldFailuresField = "    rejects: {},\n    failures: {}\n  };";
const profileFailuresField = "    rejects: {},\n    failures: {},\n    filterProfile: { freshnessMinutes:15, minProfit:8, minROI:20, strongProfit:12, strongROI:30, exceptionalProfit:20, exceptionalROI:50, priceMultiplier:1.4 }\n  };";
replaceExact('active filter diagnostics', oldFailuresField, profileFailuresField);

if (changed) {
  await fs.writeFile(file, source);
  console.log('Applied Vinted v5 reliability fixes, zero-result recovery and active-reseller alert filters.');
} else {
  console.log('Vinted v5 reliability fixes, zero-result recovery and active-reseller alert filters already active.');
}
