import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_EXPANDED_TRAINERS_V1';

export async function applyExpandedTrainerRadar() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;

  // With ~30 high-demand trainer groups, a 4-search batch only revisits each model
  // roughly every 35-40 minutes. Eight keeps the five-minute workflow cadence but
  // reduces a full rotation to roughly 20 minutes without removing any models.
  src = src.replace('const BATCH_SIZE = 4;', 'const BATCH_SIZE = 8;');

  src = src.replace(
    "export const TRAINER_SIZES = [7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5];",
    `${MARKER}\nexport const TRAINER_SIZES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11];`
  );

  const namesStart = src.indexOf('const trainerNames = new Set([');
  const namesEnd = src.indexOf(']);', namesStart);
  if (namesStart < 0 || namesEnd < 0) throw new Error('Could not patch trainerNames');
  const names = `const trainerNames = new Set([\n  'Nike P-6000','Nike V5 RNR','Nike Vomero 5','Nike Vomero 18','Nike Vomero Plus','Nike Vomero Premium',\n  'Nike Pegasus Premium','Nike Pegasus Trail 5 GORE-TEX','Nike TN','Nike Air Max Plus 3','Nike Air Max Plus VII',\n  'Nike Air Max 95','Nike Air Max 90','Nike Air Max 90 Drift','Nike Air Max 97','Nike Air Max 270','Nike Air Max Dn','Nike Air Max 1',\n  'Nike Shox TL','Nike Shox R4','Nike Shox Ride 2','Nike Air Force 1','Nike Dunk Low',\n  'Air Jordan 1 Low','Air Jordan 1 Mid','Air Jordan 4','Nike Initiator','Nike Air Max Moto 2K','Nike Metcon 10','Nike Zoom Fly 6'\n]);`;
  src = src.slice(0, namesStart) + names + src.slice(namesEnd + 3);

  const modelsStart = src.indexOf('const models = {');
  const clothingModelStart = src.indexOf("  'Nike Tech Fleece Hoodie':", modelsStart);
  if (modelsStart < 0 || clothingModelStart < 0) throw new Error('Could not patch trainer model values');
  const trainerModels = `const models = {\n  'Nike P-6000': shoe(72,{6:65,7:68,8:72,9:75,10:78,11:78}),\n  'Nike V5 RNR': shoe(62,{6:58,7:60,8:62,9:65,10:67,11:67}),\n  'Nike Vomero 5': shoe(100,{6:90,7:95,8:100,9:105,10:108,11:108}),\n  'Nike Vomero 18': shoe(80,{6:72,7:76,8:80,9:84,10:86,11:86}),\n  'Nike Vomero Plus': shoe(105,{6:95,7:100,8:105,9:110,10:112,11:112}),\n  'Nike Vomero Premium': shoe(145,{6:130,7:138,8:145,9:150,10:155,11:155},'balanced'),\n  'Nike Pegasus Premium': shoe(125,{6:112,7:118,8:125,9:130,10:135,11:135},'balanced'),\n  'Nike Pegasus Trail 5 GORE-TEX': shoe(95,{6:88,7:92,8:95,9:98,10:100,11:100},'balanced'),\n  'Nike TN': shoe(115,{6:105,7:110,8:115,9:120,10:125,11:125},'balanced'),\n  'Nike Air Max Plus 3': shoe(115,{6:105,7:110,8:115,9:120,10:125,11:125},'balanced'),\n  'Nike Air Max Plus VII': shoe(120,{6:110,7:115,8:120,9:125,10:130,11:130},'balanced'),\n  'Nike Air Max 95': shoe(125,{6:112,7:118,8:125,9:130,10:135,11:135},'balanced'),\n  'Nike Air Max 90': shoe(90,{6:82,7:86,8:90,9:94,10:97,11:97}),\n  'Nike Air Max 90 Drift': shoe(95,{6:86,7:90,8:95,9:100,10:103,11:103}),\n  'Nike Air Max 97': shoe(105,{6:95,7:100,8:105,9:110,10:115,11:115},'balanced'),\n  'Nike Air Max 270': shoe(90,{6:82,7:86,8:90,9:94,10:97,11:97}),\n  'Nike Air Max Dn': shoe(90,{6:82,7:86,8:90,9:94,10:97,11:97}),\n  'Nike Air Max 1': shoe(95,{6:86,7:90,8:95,9:100,10:103,11:103}),\n  'Nike Shox TL': shoe(115,{6:105,7:110,8:115,9:120,10:125,11:125},'balanced'),\n  'Nike Shox R4': shoe(100,{6:92,7:96,8:100,9:105,10:108,11:108}),\n  'Nike Shox Ride 2': shoe(105,{6:95,7:100,8:105,9:110,10:112,11:112}),\n  'Nike Air Force 1': shoe(75,{6:70,7:72,8:75,9:78,10:80,11:80}),\n  'Nike Dunk Low': shoe(80,{6:74,7:77,8:80,9:84,10:86,11:86},'balanced'),\n  'Air Jordan 1 Low': shoe(90,{6:82,7:86,8:90,9:94,10:97,11:97},'balanced'),\n  'Air Jordan 1 Mid': shoe(85,{6:78,7:82,8:85,9:89,10:92,11:92},'balanced'),\n  'Air Jordan 4': shoe(140,{6:125,7:132,8:140,9:148,10:155,11:155},'balanced'),\n  'Nike Initiator': shoe(65,{6:60,7:62,8:65,9:68,10:70,11:70}),\n  'Nike Air Max Moto 2K': shoe(85,{6:78,7:82,8:85,9:89,10:92,11:92}),\n  'Nike Metcon 10': shoe(95,{6:88,7:92,8:95,9:98,10:100,11:100},'balanced'),\n  'Nike Zoom Fly 6': shoe(105,{6:95,7:100,8:105,9:110,10:112,11:112},'balanced'),\n`;
  src = src.slice(0, modelsStart) + trainerModels + src.slice(clothingModelStart);

  const floorStart = src.indexOf('  trainers: {');
  const floorEnd = src.indexOf('\n', floorStart);
  if (floorStart < 0 || floorEnd < 0) throw new Error('Could not patch trainer score floors');
  src = src.slice(0, floorStart) + "  trainers: { default:55,'Nike Pegasus Premium':58,'Nike Vomero Premium':58,'Nike Air Max 95':57,'Nike Air Max Plus 3':57,'Nike Air Max Plus VII':57,'Nike Shox TL':57,'Nike Shox R4':57,'Nike Shox Ride 2':57,'Nike Vomero 5':57,'Nike TN':57,'Air Jordan 4':60 }," + src.slice(floorEnd);

  const caseStart = src.indexOf("    case 'Nike P-6000':");
  const clothingCaseStart = src.indexOf("    case 'Nike Tech Fleece Hoodie':", caseStart);
  if (caseStart < 0 || clothingCaseStart < 0) throw new Error('Could not patch trainer candidate matching');
  const cases = `    case 'Nike P-6000': return /\\bp\\s?6000\\b/.test(t)||/\\bp\\s?6000\\b/.test(f);\n    case 'Nike V5 RNR': return has('v5','rnr')||(f.includes('v5')&&f.includes('rnr'));\n    case 'Nike Vomero 5': return has('vomero','5')||(f.includes('vomero')&&/\\b5\\b/.test(f));\n    case 'Nike Vomero 18': return has('vomero','18')||(f.includes('vomero')&&/\\b18\\b/.test(f));\n    case 'Nike Vomero Plus': return f.includes('vomero')&&f.includes('plus');\n    case 'Nike Vomero Premium': return f.includes('vomero')&&f.includes('premium');\n    case 'Nike Pegasus Premium': return f.includes('pegasus')&&f.includes('premium');\n    case 'Nike Pegasus Trail 5 GORE-TEX': return f.includes('pegasus')&&f.includes('trail')&&/\\b5\\b/.test(f)&&any('gore tex','goretex','gtx');\n    case 'Nike TN': { const plusVariant=f.includes('air max plus 3')||f.includes('air max plus vii')||f.includes('air max plus 7'); return !plusVariant&&(/(^|\\s)tns?(\\s|$)/.test(t)||/(^|\\s)tans?(\\s|$)/.test(t)||t.includes('air max plus')||t.includes('tuned')||f.includes('air max plus')); }\n    case 'Nike Air Max Plus 3': return f.includes('air max plus')&&/\\b3\\b/.test(f);\n    case 'Nike Air Max Plus VII': return f.includes('air max plus')&&(f.includes('vii')||/\\b7\\b/.test(f));\n    case 'Nike Air Max 95': return t.includes('air max 95')||t.includes('am95')||f.includes('air max 95');\n    case 'Nike Air Max 90 Drift': return f.includes('air max 90')&&f.includes('drift');\n    case 'Nike Air Max 90': return (t.includes('air max 90')||t.includes('am90')||f.includes('air max 90'))&&!f.includes('drift');\n    case 'Nike Air Max 97': return t.includes('air max 97')||t.includes('am97')||f.includes('air max 97');\n    case 'Nike Air Max 270': return f.includes('air max 270')||f.includes('am270');\n    case 'Nike Air Max Dn': return f.includes('air max dn')||/\\bam dn\\b/.test(f);\n    case 'Nike Air Max 1': return f.includes('air max 1')&&!f.includes('air max 10')&&!f.includes('air max 11');\n    case 'Nike Shox TL': return f.includes('shox')&&/\\btl\\b/.test(f);\n    case 'Nike Shox R4': return f.includes('shox')&&/\\br4\\b/.test(f);\n    case 'Nike Shox Ride 2': return f.includes('shox')&&f.includes('ride')&&/\\b2\\b/.test(f);\n    case 'Nike Air Force 1': return t.includes('air force')||/(^|\\s)af1(\\s|$)/.test(t)||f.includes('air force 1');\n    case 'Nike Dunk Low': return f.includes('dunk')&&f.includes('low');\n    case 'Air Jordan 1 Low': return f.includes('jordan')&&/\\b1\\b/.test(f)&&f.includes('low');\n    case 'Air Jordan 1 Mid': return f.includes('jordan')&&/\\b1\\b/.test(f)&&f.includes('mid');\n    case 'Air Jordan 4': return f.includes('jordan')&&/\\b4\\b/.test(f);\n    case 'Nike Initiator': return f.includes('nike')&&f.includes('initiator');\n    case 'Nike Air Max Moto 2K': return f.includes('air max moto')&&any('2k','2000');\n    case 'Nike Metcon 10': return f.includes('metcon')&&/\\b10\\b/.test(f);\n    case 'Nike Zoom Fly 6': return f.includes('zoom fly')&&/\\b6\\b/.test(f);\n`;
  src = src.slice(0, caseStart) + cases + src.slice(clothingCaseStart);

  const trainerPlainStart = src.lastIndexOf('  const plain=n.match(');
  const trainerPlainEnd = src.indexOf('\n', trainerPlainStart);
  if (trainerPlainStart < 0 || trainerPlainEnd < 0) throw new Error('Could not patch plain trainer size parser');
  const sizeLine = "  const plain=n.match(/\\b(6(?:\\.5)?|7(?:\\.5)?|8(?:\\.5)?|9(?:\\.5)?|10(?:\\.5)?|11)\\s*(?:·|\\||(?:new with tags|new without tags|very good|good|satisfactory)\\b)/i);if(plain){const v=Number(plain[1]);if(sizes.includes(v))return v;}return null;";
  src = src.slice(0, trainerPlainStart) + sizeLine + src.slice(trainerPlainEnd);

  if (!src.includes(MARKER)) throw new Error('Expanded trainer marker missing after patch');
  await fs.writeFile(radarUrl, src);
}
