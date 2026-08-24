import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_NIKE_ACCESSORY_OPPORTUNITIES_V1';

const ACCESSORY_NAMES = [
  'Nike Cap',
  'Nike Beanie',
  'Nike Bag',
  'Nike Backpack',
  'Nike Crossbody Bag',
  'Nike Socks',
  'Nike Gloves',
  'Nike Belt',
  'Nike Accessories Bargain'
];

const ACCESSORY_SPECS = [
  ['Nike Cap','nike cap',6],
  ['Nike Beanie','nike beanie',6],
  ['Nike Bag','nike bag',10],
  ['Nike Backpack','nike backpack',11],
  ['Nike Crossbody Bag','nike crossbody bag',10],
  ['Nike Socks','nike socks',4.5],
  ['Nike Gloves','nike gloves',6],
  ['Nike Belt','nike belt',7],
  ['Nike Accessories Bargain','nike accessories',4.5]
];

const ACCESSORY_MODELS = [
  `  'Nike Cap': clothing(18,{OS:18},'fastFlip')`,
  `  'Nike Beanie': clothing(18,{OS:18},'fastFlip')`,
  `  'Nike Bag': clothing(27,{OS:27},'fastFlip')`,
  `  'Nike Backpack': clothing(30,{OS:30},'balanced')`,
  `  'Nike Crossbody Bag': clothing(27,{OS:27},'fastFlip')`,
  `  'Nike Socks': clothing(15,{OS:15},'fastFlip')`,
  `  'Nike Gloves': clothing(18,{OS:18},'fastFlip')`,
  `  'Nike Belt': clothing(20,{OS:20},'fastFlip')`,
  `  'Nike Accessories Bargain': clothing(16,{OS:16},'fastFlip')`
];

const ACCESSORY_CASES = `    case 'Nike Cap': return f.includes('nike')&&any('cap','baseball cap','snapback','hat');\n    case 'Nike Beanie': return f.includes('nike')&&any('beanie','winter hat','knit hat');\n    case 'Nike Bag': return f.includes('nike')&&any('bag','duffel','duffle','gym bag','shoulder bag','waist bag');\n    case 'Nike Backpack': return f.includes('nike')&&any('backpack','rucksack');\n    case 'Nike Crossbody Bag': return f.includes('nike')&&any('crossbody','cross body','shoulder bag','side bag');\n    case 'Nike Socks': return f.includes('nike')&&any('sock','socks')&&any('new with tags','new without tags','brand new','unused','sealed');\n    case 'Nike Gloves': return f.includes('nike')&&any('glove','gloves');\n    case 'Nike Belt': return f.includes('nike')&&f.includes('belt');\n    case 'Nike Accessories Bargain': return f.includes('nike')&&any('cap','hat','beanie','bag','backpack','rucksack','crossbody','cross body','duffel','duffle','sock','socks','glove','gloves','belt','wallet','scarf');\n`;

export async function applyNikeAccessoryOpportunities() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;
  if (!src.includes('// DAN_ALL_NIKE_CLOTHING_OPPORTUNITIES_V1')) {
    throw new Error('All-Nike clothing opportunities must be applied before accessories');
  }

  // Accessories do not use an apparel size. Add a stable one-size token to the same sizing
  // pipeline, then assign it only to explicit accessory search groups.
  const sizesMatch = src.match(/export const CLOTHING_SIZES = \[[^\n]+\];/);
  if (!sizesMatch) throw new Error('Could not locate clothing size list');
  if (!sizesMatch[0].includes("'OS'")) {
    src = src.replace(sizesMatch[0], sizesMatch[0].replace('];', ", 'OS'];"));
  }

  const specsAnchor = 'const clothingSpecs = [\n';
  if (!src.includes(specsAnchor)) throw new Error('Could not locate clothingSpecs');
  const specLines = ACCESSORY_SPECS.map(([name, query, base]) => `  ['${name}','${query}',${base}],`).join('\n');
  src = src.replace(specsAnchor, `${MARKER}\n${specsAnchor}${specLines}\n`);

  const floorsStart = src.indexOf('\nconst floors = {');
  const modelsEnd = src.lastIndexOf('\n};', floorsStart);
  if (floorsStart < 0 || modelsEnd < 0) throw new Error('Could not locate model object');
  src = src.slice(0, modelsEnd) + `,\n${ACCESSORY_MODELS.join(',\n')}` + src.slice(modelsEnd);

  const matcherStart = src.indexOf('export function matchesSearchCandidate');
  const matcherDefault = src.indexOf('    default:return false;', matcherStart);
  if (matcherStart < 0 || matcherDefault < 0) throw new Error('Could not locate candidate matcher');
  src = src.slice(0, matcherDefault) + ACCESSORY_CASES + src.slice(matcherDefault);

  const sizeAnchor = '    let size = inferSize(item.fullText, sizes, bot);';
  if (!src.includes(sizeAnchor)) throw new Error('Could not locate size inference point');
  const namesLiteral = JSON.stringify(ACCESSORY_NAMES);
  src = src.replace(
    sizeAnchor,
    `${sizeAnchor}\n    if (bot === 'clothing' && size === null && ${namesLiteral}.includes(search.name)) size = 'OS';`
  );

  await fs.writeFile(radarUrl, src);
}
