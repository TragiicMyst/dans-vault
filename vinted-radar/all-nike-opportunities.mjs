import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const CLOTHING_MARKER = '// DAN_ALL_NIKE_CLOTHING_OPPORTUNITIES_V1';
const TRAINER_MARKER = '// DAN_ALL_NIKE_TRAINER_OPPORTUNITIES_V1';

const EXTRA_CLOTHING_SPECS = [
  ['Nike T-Shirt','nike t shirt',7],
  ['Nike Long Sleeve Top','nike long sleeve top',9],
  ['Nike Polo','nike polo',9],
  ['Nike Football Shirt','nike football shirt',15],
  ['Nike Training Top','nike training top',10],
  ['Nike Dri-FIT Top','nike dri fit top',10],
  ['Nike Quarter Zip','nike quarter zip',12],
  ['Nike Fleece','nike fleece',14],
  ['Nike Gilet','nike gilet',18],
  ['Nike Windbreaker','nike windbreaker',16],
  ['Nike Anorak','nike anorak',18],
  ['Nike Rain Jacket','nike rain jacket',20],
  ['Nike Woven Jacket','nike woven jacket',17],
  ['Nike Bomber Jacket','nike bomber jacket',22],
  ['Nike Coat','nike coat',22],
  ['Nike Shorts','nike shorts',7],
  ['Nike Cargo Trousers','nike cargo trousers',12],
  ['Nike Track Pants','nike track pants',10],
  ['Nike Woven Trousers','nike woven trousers',11],
  ['Nike Tracksuit','nike tracksuit',22],
  ['Nike Vintage Clothing','vintage nike',14],
  ['Nike SB Clothing','nike sb clothing',11],
  ['Nike Vest','nike vest',7],
  ['Nike Any Clothing Bargain','nike',6]
];

const EXTRA_CLOTHING_MODELS = [
  `  'Nike T-Shirt': clothing(18,{XS:16,S:17,M:18,L:19,XL:20,XXL:20,XXXL:20},'fastFlip')`,
  `  'Nike Long Sleeve Top': clothing(22,{XS:20,S:21,M:22,L:23,XL:24,XXL:24,XXXL:24},'fastFlip')`,
  `  'Nike Polo': clothing(22,{XS:20,S:21,M:22,L:23,XL:24,XXL:24,XXXL:24},'fastFlip')`,
  `  'Nike Football Shirt': clothing(32,{XS:28,S:30,M:32,L:34,XL:35,XXL:35,XXXL:35},'balanced')`,
  `  'Nike Training Top': clothing(24,{XS:21,S:23,M:24,L:25,XL:26,XXL:26,XXXL:26},'fastFlip')`,
  `  'Nike Dri-FIT Top': clothing(23,{XS:20,S:22,M:23,L:24,XL:25,XXL:25,XXXL:25},'fastFlip')`,
  `  'Nike Quarter Zip': clothing(28,{XS:25,S:27,M:28,L:29,XL:30,XXL:30,XXXL:30},'fastFlip')`,
  `  'Nike Fleece': clothing(32,{XS:28,S:31,M:32,L:34,XL:35,XXL:35,XXXL:35},'balanced')`,
  `  'Nike Gilet': clothing(38,{XS:34,S:37,M:38,L:40,XL:42,XXL:42,XXXL:42},'balanced')`,
  `  'Nike Windbreaker': clothing(34,{XS:30,S:33,M:34,L:36,XL:38,XXL:38,XXXL:38},'balanced')`,
  `  'Nike Anorak': clothing(38,{XS:34,S:37,M:38,L:40,XL:42,XXL:42,XXXL:42},'balanced')`,
  `  'Nike Rain Jacket': clothing(40,{XS:35,S:38,M:40,L:42,XL:44,XXL:44,XXXL:44},'balanced')`,
  `  'Nike Woven Jacket': clothing(35,{XS:31,S:34,M:35,L:37,XL:39,XXL:39,XXXL:39},'balanced')`,
  `  'Nike Bomber Jacket': clothing(45,{XS:40,S:43,M:45,L:48,XL:50,XXL:50,XXXL:50},'balanced')`,
  `  'Nike Coat': clothing(45,{XS:40,S:43,M:45,L:48,XL:50,XXL:50,XXXL:50},'balanced')`,
  `  'Nike Shorts': clothing(20,{XS:18,S:19,M:20,L:21,XL:22,XXL:22,XXXL:22},'fastFlip')`,
  `  'Nike Cargo Trousers': clothing(30,{XS:27,S:29,M:30,L:32,XL:33,XXL:33,XXXL:33},'fastFlip')`,
  `  'Nike Track Pants': clothing(26,{XS:23,S:25,M:26,L:27,XL:28,XXL:28,XXXL:28},'fastFlip')`,
  `  'Nike Woven Trousers': clothing(28,{XS:25,S:27,M:28,L:29,XL:30,XXL:30,XXXL:30},'fastFlip')`,
  `  'Nike Tracksuit': clothing(45,{XS:40,S:43,M:45,L:48,XL:50,XXL:50,XXXL:50},'balanced')`,
  `  'Nike Vintage Clothing': clothing(32,{XS:28,S:30,M:32,L:34,XL:36,XXL:36,XXXL:36},'balanced')`,
  `  'Nike SB Clothing': clothing(28,{XS:25,S:27,M:28,L:29,XL:30,XXL:30,XXXL:30},'balanced')`,
  `  'Nike Vest': clothing(18,{XS:16,S:17,M:18,L:19,XL:20,XXL:20,XXXL:20},'fastFlip')`,
  `  'Nike Any Clothing Bargain': clothing(20,{XS:18,S:19,M:20,L:21,XL:22,XXL:22,XXXL:22},'fastFlip')`
];

const EXTRA_CLOTHING_CASES = `    case 'Nike T-Shirt': return f.includes('nike')&&any('t shirt','tshirt','tee','tee shirt');\n    case 'Nike Long Sleeve Top': return f.includes('nike')&&any('long sleeve','long-sleeve')&&any('top','shirt','tee');\n    case 'Nike Polo': return f.includes('nike')&&any('polo','polo shirt');\n    case 'Nike Football Shirt': return f.includes('nike')&&any('football shirt','football jersey','soccer jersey','jersey','match shirt');\n    case 'Nike Training Top': return f.includes('nike')&&any('training top','training shirt','training jersey','drill top');\n    case 'Nike Dri-FIT Top': return f.includes('nike')&&any('dri fit','drifit')&&any('top','shirt','tee','t shirt');\n    case 'Nike Quarter Zip': return f.includes('nike')&&any('quarter zip','1/4 zip','half zip','1 4 zip');\n    case 'Nike Fleece': return f.includes('nike')&&f.includes('fleece');\n    case 'Nike Gilet': return f.includes('nike')&&any('gilet','bodywarmer','body warmer','vest jacket');\n    case 'Nike Windbreaker': return f.includes('nike')&&any('windbreaker','wind break','windcheater');\n    case 'Nike Anorak': return f.includes('nike')&&any('anorak','pullover jacket');\n    case 'Nike Rain Jacket': return f.includes('nike')&&any('rain jacket','rain coat','waterproof jacket','water resistant jacket','shell jacket');\n    case 'Nike Woven Jacket': return f.includes('nike')&&f.includes('woven')&&any('jacket','track top','zip top');\n    case 'Nike Bomber Jacket': return f.includes('nike')&&any('bomber','varsity jacket');\n    case 'Nike Coat': return f.includes('nike')&&any('coat','parka');\n    case 'Nike Shorts': return f.includes('nike')&&any('short','shorts');\n    case 'Nike Cargo Trousers': return f.includes('nike')&&any('cargo','cargos')&&any('trouser','trousers','pant','pants');\n    case 'Nike Track Pants': return f.includes('nike')&&any('track pant','track pants','track trouser','track trousers','tracksuit bottoms');\n    case 'Nike Woven Trousers': return f.includes('nike')&&f.includes('woven')&&any('trouser','trousers','pant','pants');\n    case 'Nike Tracksuit': return f.includes('nike')&&any('tracksuit','track suit','full set','two piece','2 piece');\n    case 'Nike Vintage Clothing': return f.includes('nike')&&f.includes('vintage')&&any('hoodie','jacket','coat','shirt','top','tee','t shirt','shorts','trousers','pants','joggers','sweatshirt','fleece','tracksuit','gilet','vest','polo','jersey','anorak','windbreaker');\n    case 'Nike SB Clothing': return f.includes('nike')&&/\\bsb\\b/.test(f)&&any('hoodie','jacket','shirt','top','tee','t shirt','shorts','trousers','pants','joggers','sweatshirt','fleece');\n    case 'Nike Vest': return f.includes('nike')&&any('vest','tank top','sleeveless top');\n    case 'Nike Any Clothing Bargain': return f.includes('nike')&&any('hoodie','hoody','jacket','coat','shirt','top','tee','t shirt','tshirt','shorts','trousers','pants','joggers','sweatshirt','sweater','crewneck','crew neck','fleece','tracksuit','track suit','gilet','bodywarmer','vest','polo','jersey','anorak','windbreaker','quarter zip','half zip','cargo','woven');\n`;

const TRAINER_MODELS = [
  `  'Nike Air Max Bargain': shoe(75,{6:68,7:72,8:75,9:78,10:80,11:80},'balanced')`,
  `  'Nike Running Trainer Bargain': shoe(60,{6:55,7:58,8:60,9:63,10:65,11:65},'fastFlip')`,
  `  'Nike Lifestyle Trainer Bargain': shoe(55,{6:50,7:53,8:55,9:58,10:60,11:60},'fastFlip')`,
  `  'Nike Football Boot Bargain': shoe(60,{6:55,7:58,8:60,9:63,10:65,11:65},'balanced')`,
  `  'Nike Basketball Shoe Bargain': shoe(70,{6:63,7:67,8:70,9:73,10:75,11:75},'balanced')`,
  `  'Nike SB Shoe Bargain': shoe(65,{6:58,7:62,8:65,9:68,10:70,11:70},'balanced')`,
  `  'Nike Any Shoe Bargain': shoe(52,{6:48,7:50,8:52,9:55,10:57,11:57},'fastFlip')`
];

const TRAINER_CASES = `    case 'Nike Air Max Bargain': return f.includes('nike')&&f.includes('air max');\n    case 'Nike Running Trainer Bargain': return f.includes('nike')&&any('running trainer','running trainers','running shoe','running shoes','road running','runner')&&any('trainer','trainers','shoe','shoes','sneaker','sneakers','runner');\n    case 'Nike Lifestyle Trainer Bargain': return f.includes('nike')&&any('trainer','trainers','sneaker','sneakers','shoe','shoes')&&!any('football boot','football boots','soccer boot','soccer boots');\n    case 'Nike Football Boot Bargain': return f.includes('nike')&&(any('football boot','football boots','soccer boot','soccer boots')||any('mercurial','phantom','tiempo'));\n    case 'Nike Basketball Shoe Bargain': return f.includes('nike')&&(f.includes('basketball')||any('lebron','kd ','kd-','ja ','ja-','freak','gt cut','gt hustle','gt jump'))&&any('shoe','shoes','trainer','trainers','sneaker','sneakers','basketball');\n    case 'Nike SB Shoe Bargain': return f.includes('nike')&&/\\bsb\\b/.test(f)&&any('shoe','shoes','trainer','trainers','sneaker','sneakers','dunk');\n    case 'Nike Any Shoe Bargain': return f.includes('nike')&&any('trainer','trainers','sneaker','sneakers','shoe','shoes','footwear');\n`;

function insertModels(src, modelLines) {
  const floorsStart = src.indexOf('\nconst floors = {');
  const modelsEnd = src.lastIndexOf('\n};', floorsStart);
  if (floorsStart < 0 || modelsEnd < 0) throw new Error('Could not locate model object');
  return src.slice(0, modelsEnd) + `,\n${modelLines.join(',\n')}` + src.slice(modelsEnd);
}

function insertMatcherCases(src, cases) {
  const matcherStart = src.indexOf('export function matchesSearchCandidate');
  const matcherDefault = src.indexOf('    default:return false;', matcherStart);
  if (matcherStart < 0 || matcherDefault < 0) throw new Error('Could not locate candidate matcher');
  return src.slice(0, matcherDefault) + cases + src.slice(matcherDefault);
}

function patchClothing(src) {
  if (src.includes(CLOTHING_MARKER)) return src;
  if (!src.includes('// DAN_BROAD_CLOTHING_OPPORTUNITIES_V1')) {
    throw new Error('Broad clothing opportunities must be applied first');
  }

  // The broader catalogue needs a little more throughput. Six search groups per cycle is
  // still bounded, while materially reducing how long it takes to revisit every Nike family.
  if (src.includes('const BATCH_SIZE = 4;')) src = src.replace('const BATCH_SIZE = 4;', 'const BATCH_SIZE = 6;');

  const specsAnchor = 'const clothingSpecs = [\n';
  if (!src.includes(specsAnchor)) throw new Error('Could not locate clothingSpecs');
  const specLines = EXTRA_CLOTHING_SPECS.map(([name, query, base]) => `  ['${name}','${query}',${base}],`).join('\n');
  src = src.replace(specsAnchor, `${CLOTHING_MARKER}\n${specsAnchor}${specLines}\n`);
  src = insertModels(src, EXTRA_CLOTHING_MODELS);
  src = insertMatcherCases(src, EXTRA_CLOTHING_CASES);
  return src;
}

function patchTrainers(src) {
  if (src.includes(TRAINER_MARKER)) return src;
  if (!src.includes('// DAN_TRAINER_DISCOVERY_HARDENING_V1')) {
    throw new Error('Trainer discovery hardening must be applied first');
  }

  src = src.replace('// DAN_TRAINER_DISCOVERY_HARDENING_V1', `// DAN_TRAINER_DISCOVERY_HARDENING_V1\n${TRAINER_MARKER}`);
  src = insertModels(src, TRAINER_MODELS);
  src = insertMatcherCases(src, TRAINER_CASES);

  const buildStart = src.indexOf('export function buildSearches(bot, config) {');
  const catalogStart = src.indexOf('function catalogUrl(query)', buildStart);
  if (buildStart < 0 || catalogStart < 0) throw new Error('Could not locate trainer buildSearches');
  const buildBlock = src.slice(buildStart, catalogStart);
  if (!buildBlock.includes('  return (config.searches ?? [])')) throw new Error('Trainer core search return was not found');
  let patched = buildBlock.replace('  return (config.searches ?? [])', '  const coreSearches = (config.searches ?? [])');
  const endAnchor = '  });\n}\n\n';
  const endAt = patched.lastIndexOf(endAnchor);
  if (endAt < 0) throw new Error('Trainer buildSearches end was not found');

  const fallback = `  });\n\n  const fallbackSearches = [\n    { name:'Nike Air Max Bargain', key:'Nike Air Max Bargain::generic', buyUrl:catalogUrl('nike air max'), buyUrls:[catalogUrl('nike air max'),catalogUrl('air max nike')], discoveryQueries:['nike air max','air max nike'], maxPrice:45, minScore:58 },\n    { name:'Nike Running Trainer Bargain', key:'Nike Running Trainer Bargain::generic', buyUrl:catalogUrl('nike running trainers'), buyUrls:[catalogUrl('nike running trainers'),catalogUrl('nike running shoes')], discoveryQueries:['nike running trainers','nike running shoes'], maxPrice:35, minScore:57 },\n    { name:'Nike Lifestyle Trainer Bargain', key:'Nike Lifestyle Trainer Bargain::generic', buyUrl:catalogUrl('nike trainers'), buyUrls:[catalogUrl('nike trainers'),catalogUrl('nike sneakers')], discoveryQueries:['nike trainers','nike sneakers'], maxPrice:30, minScore:57 },\n    { name:'Nike Football Boot Bargain', key:'Nike Football Boot Bargain::generic', buyUrl:catalogUrl('nike football boots'), buyUrls:[catalogUrl('nike football boots'),catalogUrl('nike mercurial')], discoveryQueries:['nike football boots','nike mercurial'], maxPrice:35, minScore:58 },\n    { name:'Nike Basketball Shoe Bargain', key:'Nike Basketball Shoe Bargain::generic', buyUrl:catalogUrl('nike basketball shoes'), buyUrls:[catalogUrl('nike basketball shoes'),catalogUrl('nike lebron')], discoveryQueries:['nike basketball shoes','nike lebron'], maxPrice:40, minScore:58 },\n    { name:'Nike SB Shoe Bargain', key:'Nike SB Shoe Bargain::generic', buyUrl:catalogUrl('nike sb trainers'), buyUrls:[catalogUrl('nike sb trainers'),catalogUrl('nike sb shoes')], discoveryQueries:['nike sb trainers','nike sb shoes'], maxPrice:35, minScore:58 },\n    { name:'Nike Any Shoe Bargain', key:'Nike Any Shoe Bargain::generic', buyUrl:catalogUrl('nike shoes'), buyUrls:[catalogUrl('nike shoes'),catalogUrl('nike footwear')], discoveryQueries:['nike shoes','nike footwear'], maxPrice:25, minScore:58 }\n  ];\n  return [...coreSearches, ...fallbackSearches];\n}\n\n`;
  patched = patched.slice(0, endAt) + fallback + patched.slice(endAt + endAnchor.length);
  src = src.slice(0, buildStart) + patched + src.slice(catalogStart);
  return src;
}

export async function applyAllNikeOpportunities(bot) {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (bot === 'clothing') src = patchClothing(src);
  else if (bot === 'trainers') src = patchTrainers(src);
  else throw new Error(`Unsupported bot for all-Nike opportunities: ${bot}`);
  await fs.writeFile(radarUrl, src);
}
