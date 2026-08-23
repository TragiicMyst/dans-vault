import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_CLOTHING_DISCOVERY_HARDENING_V1';

export async function applyClothingDiscoveryHardening() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;
  if (!src.includes('// DAN_EXPANDED_CLOTHING_V1')) throw new Error('Expanded clothing radar must be applied first');

  src = src.replace('// DAN_EXPANDED_CLOTHING_V1', `// DAN_EXPANDED_CLOTHING_V1\n${MARKER}`);

  const oldBranch = "  if (bot === 'clothing') return clothingSpecs.map(([name, query, base]) => ({ name, key:`${name}::${query}`, buyUrl:catalogUrl(query), maxPrice:round2(base * RADAR_PROFILE.priceMultiplier), minScore:floors.clothing[name] ?? floors.clothing.default }));";
  const newBranch = `  if (bot === 'clothing') return clothingSpecs.map(([name, query, base]) => {
    const q = normalize(query);
    const rawQueries = [q, q.replace(/^nike\\s+/, ''), normalize(name).replace(/^nike\\s+/, '')];
    if (q.includes('tech fleece')) {
      rawQueries.push(q.replace('tech fleece','tech'));
      rawQueries.push(q.replace(/^nike\\s+/, '').replace('tech fleece','tech'));
    }
    if (q.includes('club fleece')) rawQueries.push(q.replace('club fleece','club'));
    if (q.includes('gore tex')) rawQueries.push(q.replace('gore tex','goretex'));
    if (q.includes('full zip')) rawQueries.push(q.replace('full zip','zip'));
    const queries = [];
    for (const candidate of rawQueries) if (candidate && !queries.some(existing => normalize(existing) === normalize(candidate))) queries.push(candidate);
    const limited = queries.slice(0, 3);
    const buyUrls = limited.map(catalogUrl);
    return { name, key:\`${'${name}'}::${'${query}'}\`, buyUrl:buyUrls[0], buyUrls, discoveryQueries:limited, maxPrice:round2(base * RADAR_PROFILE.priceMultiplier), minScore:floors.clothing[name] ?? floors.clothing.default };
  });`;
  if (!src.includes(oldBranch)) throw new Error('Could not patch clothing buildSearches branch');
  src = src.replace(oldBranch, newBranch);

  const fetchStart = src.indexOf('async function fetchCatalogue(search) {');
  const processStart = src.indexOf('async function processSearch(', fetchStart);
  if (fetchStart < 0 || processStart < 0) throw new Error('Could not patch clothing fetchCatalogue');
  const fetchCatalogue = `async function fetchCatalogue(search) {
  const urls = [...new Set((search.buyUrls?.length ? search.buyUrls : [search.buyUrl]).filter(Boolean))].slice(0, 3);
  const merged = new Map();
  let markerCount = 0;
  let successfulPages = 0;
  let allEmpty = true;
  let lastError = null;
  for (let i = 0; i < urls.length; i += 1) {
    if (i > 0) await sleep(220 + Math.floor(Math.random() * 220));
    try {
      const page = await fetchCataloguePage(urls[i]);
      successfulPages += 1;
      markerCount += page.markerCount;
      if (!page.confirmedEmpty) allEmpty = false;
      for (const item of page.items) {
        const existing = merged.get(item.id);
        if (!existing || (item.ageMinutes ?? Infinity) < (existing.ageMinutes ?? Infinity)) merged.set(item.id, item);
      }
    } catch (error) {
      lastError = error;
      if (error.blocked) throw error;
      console.warn(\`${'${search.name}'} alias discovery failed: ${'${error.message}'}\`);
    }
  }
  if (successfulPages === 0) throw lastError ?? new Error('All discovery aliases failed');
  return { items:[...merged.values()].sort((a,b)=>compareIds(b.id,a.id)), markerCount, confirmedEmpty:allEmpty };
}

async function fetchCataloguePage(url) {
  const html = await fetchText(url, { catalog: true });
  const markerCount = uniqueItemMarkerCount(html);
  const items = extractItems(html, 80);
  if (markerCount > 0) {
    const minimumParsed = Math.min(markerCount, Math.max(3, Math.floor(markerCount * 0.45)));
    if (items.length < minimumParsed) throw new Error(\`Vinted parser coverage too low: parsed ${'${items.length}'}/${'${markerCount}'} visible item ids\`);
    return { items, markerCount, confirmedEmpty:false };
  }
  if (looksLikeEmptyCatalog(html)) return { items:[], markerCount:0, confirmedEmpty:true };
  throw new Error('Vinted catalogue contained no item markers and was not a confirmed empty result');
}

`;
  src = src.slice(0, fetchStart) + fetchCatalogue + src.slice(processStart);

  const matcherHeader = "  const t=normalize(item?.title??''); const f=normalize(`${item?.title??''} ${item?.fullText??''}`); const has=(...p)=>p.every(x=>t.includes(x)); const any=(...p)=>p.some(x=>f.includes(x));";
  const matcherHeaderNew = matcherHeader + " const tech=f.includes('tech')&&(f.includes('fleece')||f.includes('nike')); const club=f.includes('club')&&(f.includes('fleece')||f.includes('nike'));";
  if (!src.includes(matcherHeader)) throw new Error('Could not add clothing shorthand helpers');
  src = src.replace(matcherHeader, matcherHeaderNew);

  const replacements = [
    ["    case 'Nike Tech Fleece Windrunner': return f.includes('tech')&&f.includes('fleece')&&f.includes('windrunner');", "    case 'Nike Tech Fleece Windrunner': return tech&&f.includes('windrunner');"],
    ["    case 'Nike Tech Fleece Full-Zip Hoodie': return f.includes('tech')&&f.includes('fleece')&&any('full zip hoodie','full zip fleece','zip hoodie');", "    case 'Nike Tech Fleece Full-Zip Hoodie': return tech&&any('full zip hoodie','full zip fleece','zip hoodie','tech hoodie');"],
    ["    case 'Nike Tech Fleece Joggers': return f.includes('tech')&&f.includes('fleece')&&any('jogger','joggers');", "    case 'Nike Tech Fleece Joggers': return tech&&any('jogger','joggers','bottoms');"],
    ["    case 'Nike Tech Fleece Open-Hem Trousers': return f.includes('tech')&&f.includes('fleece')&&any('open hem','open-hem')&&any('trouser','trousers','pant','pants');", "    case 'Nike Tech Fleece Open-Hem Trousers': return tech&&any('open hem','open-hem')&&any('trouser','trousers','pant','pants','bottoms');"],
    ["    case 'Nike Tech Fleece Shorts': return f.includes('tech')&&f.includes('fleece')&&any('short','shorts');", "    case 'Nike Tech Fleece Shorts': return tech&&any('short','shorts');"],
    ["    case 'Nike Tech Fleece Tracksuit': return f.includes('tech')&&f.includes('fleece')&&any('tracksuit','track suit','full set','set');", "    case 'Nike Tech Fleece Tracksuit': return tech&&any('tracksuit','track suit','full set','set');"],
    ["    case 'Nike Tech Fleece Colour-Block Windrunner': return f.includes('tech')&&f.includes('fleece')&&any('colour block','color block','colour-block','color-block')&&any('windrunner','jacket');", "    case 'Nike Tech Fleece Colour-Block Windrunner': return tech&&any('colour block','color block','colour-block','color-block')&&any('windrunner','jacket');"],
    ["    case 'Nike Football Tech Fleece': return f.includes('tech')&&f.includes('fleece')&&any('football','england','chelsea','barcelona','liverpool','psg','inter','tottenham','spurs');", "    case 'Nike Football Tech Fleece': return tech&&any('football','england','chelsea','barcelona','liverpool','psg','inter','tottenham','spurs');"],
    ["    case 'Nike Club Fleece Pullover Hoodie': return f.includes('club')&&f.includes('fleece')&&f.includes('hood')&&!any('full zip','full-zip');", "    case 'Nike Club Fleece Pullover Hoodie': return club&&f.includes('hood')&&!any('full zip','full-zip');"],
    ["    case 'Nike Club Fleece Full-Zip Hoodie': return f.includes('club')&&f.includes('fleece')&&f.includes('hood')&&any('full zip','full-zip','zip');", "    case 'Nike Club Fleece Full-Zip Hoodie': return club&&f.includes('hood')&&any('full zip','full-zip','zip');"],
    ["    case 'Nike Club Fleece Joggers': return f.includes('club')&&f.includes('fleece')&&any('jogger','joggers');", "    case 'Nike Club Fleece Joggers': return club&&any('jogger','joggers','bottoms');"]
  ];
  for (const [before, after] of replacements) {
    if (!src.includes(before)) throw new Error(`Could not harden clothing matcher: ${before.slice(0, 52)}`);
    src = src.replace(before, after);
  }

  await fs.writeFile(radarUrl, src);
}
