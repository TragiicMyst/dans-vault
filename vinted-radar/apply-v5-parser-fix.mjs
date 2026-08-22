import fs from 'node:fs/promises';

const file = new URL('./radar-v5.mjs', import.meta.url);
let source = await fs.readFile(file, 'utf8');

const oldBlock = `      const start = Math.max(0, m.index - 1400), end = Math.min(html.length, m.index + 2600);
      const context = stripTags(html.slice(start,end)).replace(/\\s+/g,' ').trim();
      const price = parsePrice(context);
      if (!Number.isFinite(price) || price <= 0 || price > 500) continue;
      const slug = path.replace(/^\\/items\\/\\d+-?/,'').replace(/-/g,' ').trim();
      const title = decodeHtml(slug || extractTitle(context) || 'Vinted item');
      found.set(String(id), {id:String(id),title,price,ageMinutes:parseAgeMinutes(context),fullText:\\`${title} ${context}\\`,url:\\`https://www.vinted.co.uk${path}\\`});`;

const newBlock = `      // Read the card forward from its own item link first. Looking far backwards can
      // accidentally pick up the previous card's price when Vinted renders cards tightly.
      const forward = stripTags(html.slice(m.index, Math.min(html.length, m.index + 1800))).replace(/\\s+/g,' ').trim();
      const around = stripTags(html.slice(Math.max(0, m.index - 500), Math.min(html.length, m.index + 2400))).replace(/\\s+/g,' ').trim();
      const price = parsePrice(forward) ?? parsePrice(around);
      if (!Number.isFinite(price) || price <= 0 || price > 500) continue;
      const slug = path.replace(/^\\/items\\/\\d+-?/,'').replace(/-/g,' ').trim();
      const title = decodeHtml(slug || extractTitle(forward) || extractTitle(around) || 'Vinted item');
      const ageMinutes = parseAgeMinutes(forward) ?? parseAgeMinutes(around);
      found.set(String(id), {id:String(id),title,price,ageMinutes,fullText:\\`${title} ${forward}\\`,url:\\`https://www.vinted.co.uk${path}\\`});`;

if (source.includes(newBlock)) {
  console.log('Vinted card parser isolation fix already active.');
  process.exit(0);
}
if (!source.includes(oldBlock)) {
  throw new Error('Could not apply Vinted card parser isolation fix: expected parser block not found');
}
source = source.replace(oldBlock, newBlock);

const oldPrice = `function parsePrice(text){
  const pound=[...text.matchAll(/£\\s*([0-9]+(?:\\.[0-9]{1,2})?)/g)].map(m=>Number(m[1])).filter(n=>n>0&&n<500);
  if(pound.length) return pound[0];
  const json=text.match(/(?:price|amount)["'\\s:]+([0-9]+(?:\\.[0-9]{1,2})?)/i); return json?Number(json[1]):NaN;
}`;
const newPrice = `function parsePrice(text){
  const pound=[...text.matchAll(/£\\s*([0-9]+(?:\\.[0-9]{1,2})?)/g)].map(m=>Number(m[1])).filter(n=>n>0&&n<500);
  if(pound.length) return pound[0];
  const json=text.match(/(?:price|amount)["'\\s:]+([0-9]+(?:\\.[0-9]{1,2})?)/i);
  return json ? Number(json[1]) : null;
}`;
if (source.includes(oldPrice)) source = source.replace(oldPrice, newPrice);

await fs.writeFile(file, source);
console.log('Applied Vinted card parser isolation fix.');
