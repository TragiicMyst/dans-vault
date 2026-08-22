import fs from 'node:fs/promises';

const file = new URL('./radar-v5.mjs', import.meta.url);
let source = await fs.readFile(file, 'utf8');

const oldWindow = "      const start = Math.max(0, m.index - 1400), end = Math.min(html.length, m.index + 2600);\n      const context = stripTags(html.slice(start,end)).replace(/\\s+/g,' ').trim();";
const fixedWindow = "      // Keep each card's price/age context forward-only so a previous card cannot bleed into it.\n      const start = m.index, end = Math.min(html.length, m.index + 1800);\n      const context = stripTags(html.slice(start,end)).replace(/\\s+/g,' ').trim();";

if (source.includes(fixedWindow)) {
  console.log('Vinted card parser isolation fix already active.');
  process.exit(0);
}
if (!source.includes(oldWindow)) {
  throw new Error('Could not apply Vinted card parser isolation fix: expected parser window not found');
}

source = source.replace(oldWindow, fixedWindow);
await fs.writeFile(file, source);
console.log('Applied Vinted card parser isolation fix.');
