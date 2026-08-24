import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_BROAD_CLOTHING_OPPORTUNITIES_V1';

const BROAD_SPECS = [
  ['Nike Air Max Hoodie', 'nike air max hoodie', 18],
  ['Nike Zip Hoodie', 'nike zip hoodie', 14],
  ['Nike Hoodie', 'nike hoodie', 12],
  ['Nike Sweatshirt', 'nike sweatshirt', 10],
  ['Nike Track Jacket', 'nike track jacket', 16],
  ['Nike Joggers', 'nike joggers', 11],
  ['Nike Trousers', 'nike trousers', 11],
  ['Nike Sportswear Hoodie', 'nike sportswear hoodie', 14],
  ['Nike Sportswear Jacket', 'nike sportswear jacket', 17]
];

const BROAD_MODELS = [
  `  'Nike Air Max Hoodie': clothing(32,{XS:28,S:31,M:32,L:33,XL:34,XXL:34,XXXL:34},'fastFlip')`,
  `  'Nike Zip Hoodie': clothing(27,{XS:24,S:26,M:27,L:28,XL:29,XXL:29,XXXL:29},'fastFlip')`,
  `  'Nike Hoodie': clothing(25,{XS:22,S:24,M:25,L:26,XL:27,XXL:27,XXXL:27},'fastFlip')`,
  `  'Nike Sweatshirt': clothing(23,{XS:20,S:22,M:23,L:24,XL:25,XXL:25,XXXL:25},'fastFlip')`,
  `  'Nike Track Jacket': clothing(32,{XS:28,S:31,M:32,L:34,XL:35,XXL:35,XXXL:35},'fastFlip')`,
  `  'Nike Joggers': clothing(24,{XS:21,S:23,M:24,L:25,XL:26,XXL:26,XXXL:26},'fastFlip')`,
  `  'Nike Trousers': clothing(24,{XS:21,S:23,M:24,L:25,XL:26,XXL:26,XXXL:26},'fastFlip')`,
  `  'Nike Sportswear Hoodie': clothing(28,{XS:25,S:27,M:28,L:29,XL:30,XXL:30,XXXL:30},'fastFlip')`,
  `  'Nike Sportswear Jacket': clothing(34,{XS:30,S:33,M:34,L:36,XL:37,XXL:37,XXXL:37},'fastFlip')`
];

const BROAD_CASES = `    case 'Nike Air Max Hoodie': return f.includes('nike')&&f.includes('air max')&&any('hoodie','hoody','hooded sweatshirt','hooded top');\n    case 'Nike Zip Hoodie': return f.includes('nike')&&any('zip hoodie','zip hoody','full zip hoodie','full zip hoody','zip up hoodie','zip up hoody');\n    case 'Nike Hoodie': return f.includes('nike')&&any('hoodie','hoody','hooded sweatshirt');\n    case 'Nike Sweatshirt': return f.includes('nike')&&any('sweatshirt','sweater','crewneck','crew neck')&&!any('hoodie','hoody');\n    case 'Nike Track Jacket': return f.includes('nike')&&any('track jacket','track top','tracksuit jacket','track zip');\n    case 'Nike Joggers': return f.includes('nike')&&any('jogger','joggers','jogging bottoms');\n    case 'Nike Trousers': return f.includes('nike')&&any('trouser','trousers');\n    case 'Nike Sportswear Hoodie': return f.includes('nike')&&f.includes('sportswear')&&any('hoodie','hoody','hooded sweatshirt');\n    case 'Nike Sportswear Jacket': return f.includes('nike')&&f.includes('sportswear')&&any('jacket','coat','track top','zip top');\n`;

export async function applyBroadClothingOpportunities() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;
  if (!src.includes('// DAN_CLOTHING_VARIETY_V1')) {
    throw new Error('Clothing variety patch must be applied before broad clothing opportunities');
  }

  const specsAnchor = 'const clothingSpecs = [\n';
  if (!src.includes(specsAnchor)) throw new Error('Could not locate clothingSpecs');
  const specLines = BROAD_SPECS
    .map(([name, query, base]) => `  ['${name}','${query}',${base}],`)
    .join('\n');
  src = src.replace(specsAnchor, `${MARKER}\n${specsAnchor}${specLines}\n`);

  const modelsStart = src.indexOf('const models = {');
  const floorsStart = src.indexOf('\nconst floors = {', modelsStart);
  const modelsEnd = src.lastIndexOf('\n};', floorsStart);
  if (modelsStart < 0 || floorsStart < 0 || modelsEnd < 0) {
    throw new Error('Could not locate clothing models object');
  }
  src = src.slice(0, modelsEnd) + `,\n${BROAD_MODELS.join(',\n')}` + src.slice(modelsEnd);

  const matcherStart = src.indexOf('export function matchesSearchCandidate');
  const matcherDefault = src.indexOf('    default:return false;', matcherStart);
  if (matcherStart < 0 || matcherDefault < 0) {
    throw new Error('Could not locate clothing candidate matcher');
  }
  src = src.slice(0, matcherDefault) + BROAD_CASES + src.slice(matcherDefault);

  await fs.writeFile(radarUrl, src);
}
