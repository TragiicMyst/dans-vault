import fs from 'node:fs/promises';

const file = new URL('./radar-v5.mjs', import.meta.url);
let source = await fs.readFile(file, 'utf8');
let changed = false;

const oldWindow = "      const start = Math.max(0, m.index - 1400), end = Math.min(html.length, m.index + 2600);\n      const context = stripTags(html.slice(start,end)).replace(/\\s+/g,' ').trim();";
const fixedWindow = "      // Keep each card's price/age context forward-only so a previous card cannot bleed into it.\n      const start = m.index, end = Math.min(html.length, m.index + 1800);\n      const context = stripTags(html.slice(start,end)).replace(/\\s+/g,' ').trim();";

if (source.includes(oldWindow)) {
  source = source.replace(oldWindow, fixedWindow);
  changed = true;
} else if (!source.includes(fixedWindow)) {
  throw new Error('Could not apply Vinted card parser isolation fix: expected parser window not found');
}

const oldBootstrap = "    if (firstRunForSearch) { remember(state, item, prior, { bootstrapSeen:true }); continue; }";
const fixedBootstrap = "    // A genuinely fresh listing must not be discarded just because this search has no saved frontier yet.\n    if (firstRunForSearch && !ageFresh) { remember(state, item, prior, { bootstrapSeen:true }); continue; }";

if (source.includes(oldBootstrap)) {
  source = source.replace(oldBootstrap, fixedBootstrap);
  changed = true;
} else if (!source.includes(fixedBootstrap)) {
  throw new Error('Could not apply first-fresh-listing fix: expected bootstrap guard not found');
}

if (changed) {
  await fs.writeFile(file, source);
  console.log('Applied Vinted v5 reliability fixes.');
} else {
  console.log('Vinted v5 reliability fixes already active.');
}
