import fs from 'node:fs/promises';

const path = new URL('./radar-v6.mjs', import.meta.url);
let src = await fs.readFile(path, 'utf8');
const before = String.raw`(?:·|\||new with tags|new without tags|very good|good|satisfactory)\b/i);`;
const after = String.raw`(?:·|\||(?:new with tags|new without tags|very good|good|satisfactory)\b)/i);`;
const count = src.split(before).length - 1;
if (count !== 2) throw new Error(`Expected exactly 2 bare-size regex targets, found ${count}`);
src = src.split(before).join(after);
await fs.writeFile(path, src);
console.log('Permanently fixed both trainer and clothing bare-size delimiters in radar-v6.mjs');
