import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_CLOTHING_VARIETY_V1';
const CAP_MARKER = '// DAN_TECH_FLEECE_ALERT_CAP_V1';

export async function applyClothingVariety() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;
  if (!src.includes('// DAN_EXPANDED_CLOTHING_V1')) {
    throw new Error('Expanded clothing radar must be applied before clothing variety');
  }

  const specsStart = src.indexOf('const clothingSpecs = [');
  const specsEnd = src.indexOf('];', specsStart);
  if (specsStart < 0 || specsEnd < 0) throw new Error('Could not locate clothingSpecs for variety rebalance');

  const specs = `${MARKER}\nconst clothingSpecs = [\n  ['Nike Tech Fleece Windrunner','nike tech fleece windrunner',45],\n  ['Nike Puffer Jacket','nike puffer jacket',60],\n  ['Nike NOCTA Track Jacket','nike nocta track jacket',65],\n  ['Nike Miler Shorts','nike miler shorts',16],\n\n  ['Nike Tech Fleece Full-Zip Hoodie','nike tech fleece full zip hoodie',45],\n  ['Nike ACG Canwell Glacier Jacket','nike acg canwell glacier',75],\n  ['Nike Strike Tracksuit','nike strike tracksuit',48],\n  ['Nike Challenger Shorts','nike challenger shorts',16],\n\n  ['Nike Tech Fleece Joggers','nike tech fleece joggers',35],\n  ['Nike Storm-FIT Puffer','nike storm fit puffer',70],\n  ['Nike Solo Swoosh Hoodie','nike solo swoosh hoodie',35],\n  ['Nike Miler Running Top','nike miler running top',15],\n\n  ['Nike Tech Fleece Open-Hem Trousers','nike tech fleece open hem trousers',35],\n  ['Nike ACG Lunar Lake Puffer','nike acg lunar lake',110],\n  ['Nike Academy Tracksuit','nike academy tracksuit',38],\n  ['Nike Dri-FIT Running Top','nike dri-fit running top',15],\n\n  ['Nike Tech Fleece Shorts','nike tech fleece shorts',25],\n  ['Nike Therma-FIT Jacket','nike therma fit jacket',60],\n  ['Nike NOCTA Hoodie','nike nocta hoodie',55],\n  ['Nike Stride Shorts','nike stride shorts',18],\n\n  ['Nike Tech Fleece Tracksuit','nike tech fleece tracksuit',70],\n  ['Nike ACG Skull Peak Jacket','nike acg skull peak',105],\n  ['Nike Club Fleece Pullover Hoodie','nike club fleece hoodie',22],\n  ['Nike Unlimited Shorts','nike unlimited shorts',18],\n\n  ['Nike Tech Fleece Colour-Block Windrunner','nike tech fleece colour block windrunner',50],\n  ['Nike Windrunner Jacket','nike windrunner jacket',35],\n  ['Nike NOCTA Tracksuit','nike nocta tracksuit',95],\n  ['Nike Miler Challenger Running Set','nike miler challenger set',28],\n\n  ['Nike Football Tech Fleece','nike football tech fleece',55],\n  ['Nike ACG GORE-TEX Jacket','nike acg gore tex jacket',125],\n  ['Nike Club Fleece Full-Zip Hoodie','nike club fleece full zip hoodie',25],\n  ['Nike Strike Top Shorts Set','nike strike top shorts set',30],\n\n  ['Nike Club Fleece Joggers','nike club fleece joggers',20],\n  ['Nike Sportswear Winterised Jacket','nike sportswear winterised jacket',50],\n  ['Nike NOCTA Joggers','nike nocta joggers',45],\n  ['Nike ACG Fleece','nike acg fleece',45],\n\n  ['Nike Club Fleece Open-Hem Trousers','nike club fleece open hem trousers',20],\n  ['Nike Trail Repel Jacket','nike trail repel jacket',40],\n  ['Jordan Flight Fleece Hoodie','jordan flight fleece hoodie',38],\n  ['Nike ACG Wolf Tree','nike acg wolf tree',60],\n\n  ['Nike Club Fleece Crew','nike club fleece crew',18],\n  ['Nike Running Division Jacket','nike running division jacket',40],\n  ['Jordan Flight Fleece Joggers','jordan flight fleece joggers',32],\n  ['Nike ACG Tuff Fleece','nike acg tuff fleece',50],\n\n  ['Nike Solo Swoosh Crew','nike solo swoosh sweatshirt',30],\n  ['Nike Miler Repel Jacket','nike miler repel jacket',32],\n  ['Nike Solo Swoosh Joggers','nike solo swoosh joggers',30],\n  ['Nike Stride Running Jacket','nike stride running jacket',40]\n];`;
  src = src.slice(0, specsStart) + specs + src.slice(specsEnd + 2);

  const qualifyAnchor = '    diagnostics.qualifyingAlerts += 1;';
  if (!src.includes(qualifyAnchor)) throw new Error('Could not locate clothing alert qualification point');
  src = src.replace(
    qualifyAnchor,
    `${CAP_MARKER}\n    const techFleeceFamily = bot === 'clothing' && /Tech Fleece/i.test(search.name);\n    if (techFleeceFamily && !exceptional && (diagnostics.techFleeceAlerts ?? 0) >= 1) {\n      remember(state, item, prior, { blockedReason: 'clothing-variety-cap', size, condition, resale, netProfit: profit, roi, buyScore: score, fakeRisk: risk });\n      reject(diagnostics, 'clothing-variety-cap');\n      continue;\n    }\n    if (techFleeceFamily) diagnostics.techFleeceAlerts = (diagnostics.techFleeceAlerts ?? 0) + 1;\n${qualifyAnchor}`
  );

  if (!src.includes(MARKER) || !src.includes(CAP_MARKER)) {
    throw new Error('Clothing variety patch markers missing after apply');
  }
  await fs.writeFile(radarUrl, src);
}
