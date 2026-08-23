import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_TRAINER_DISCOVERY_HARDENING_V1';

export async function applyTrainerDiscoveryHardening() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;
  if (!src.includes('// DAN_EXPANDED_TRAINERS_V1')) throw new Error('Expanded trainer radar must be applied first');

  src = src.replace('// DAN_EXPANDED_TRAINERS_V1', `// DAN_EXPANDED_TRAINERS_V1\n${MARKER}`);

  // Keep one scoring/frontier group per model, but let that group query several common
  // seller spellings. This avoids multiplying the rotation queue while widening discovery.
  const buildStart = src.indexOf('export function buildSearches(bot, config) {');
  const catalogFnStart = src.indexOf('function catalogUrl(query)', buildStart);
  if (buildStart < 0 || catalogFnStart < 0) throw new Error('Could not patch buildSearches');

  const buildSearches = `export function buildSearches(bot, config) {
  if (bot === 'clothing') return clothingSpecs.map(([name, query, base]) => ({ name, key:\`${'${name}'}::${'${query}'}\`, buyUrl:catalogUrl(query), maxPrice:round2(base * RADAR_PROFILE.priceMultiplier), minScore:floors.clothing[name] ?? floors.clothing.default }));

  const discoveryQueries = {
    'Nike P-6000': ['p6000','p 6000','p6'],
    'Nike V5 RNR': ['v5 rnr','v5rnr'],
    'Nike Vomero 5': ['vomero 5'],
    'Nike Vomero 18': ['vomero 18'],
    'Nike Vomero Plus': ['vomero plus'],
    'Nike Vomero Premium': ['vomero premium'],
    'Nike Pegasus Premium': ['pegasus premium'],
    'Nike Pegasus Trail 5 GORE-TEX': ['pegasus trail 5','pegasus trail 5 gtx'],
    'Nike TN': ['tn','tns','air max plus'],
    'Nike Air Max Plus 3': ['tn3','air max plus 3'],
    'Nike Air Max Plus VII': ['tn7','air max plus 7','air max plus vii'],
    'Nike Air Max 95': ['air max 95','am95'],
    'Nike Air Max 90': ['air max 90','am90'],
    'Nike Air Max 90 Drift': ['air max 90 drift','90 drift'],
    'Nike Air Max 97': ['air max 97','am97'],
    'Nike Air Max 270': ['air max 270','am270'],
    'Nike Air Max Dn': ['air max dn','airmax dn'],
    'Nike Air Max 1': ['air max 1','am1'],
    'Nike Shox TL': ['shox tl','shoxtl'],
    'Nike Shox R4': ['shox r4','r4 shox'],
    'Nike Shox Ride 2': ['shox ride 2','ride 2 shox'],
    'Nike Air Force 1': ['air force 1','af1'],
    'Nike Dunk Low': ['dunk low'],
    'Air Jordan 1 Low': ['jordan 1 low','aj1 low'],
    'Air Jordan 1 Mid': ['jordan 1 mid','aj1 mid'],
    'Air Jordan 4': ['jordan 4','aj4'],
    'Nike Initiator': ['initiator','nike initiator'],
    'Nike Air Max Moto 2K': ['moto 2k','air max moto 2k'],
    'Nike Metcon 10': ['metcon 10'],
    'Nike Zoom Fly 6': ['zoom fly 6']
  };

  return (config.searches ?? []).filter(s => trainerNames.has(s.name)).map(s => {
    const maxPrice = round2(Number(s.maxPrice) * RADAR_PROFILE.priceMultiplier);
    const configured = new URL(s.buyUrl).searchParams.get('search_text');
    const rawQueries = [...(discoveryQueries[s.name] ?? []), configured, s.name].filter(Boolean);
    const queries = [];
    for (const q of rawQueries) if (!queries.some(existing => normalize(existing) === normalize(q))) queries.push(q);
    const limited = queries.slice(0, 3);
    const buyUrls = limited.map(catalogUrl);
    return { ...s, key:\`${'${s.name}'}::primary\`, buyUrl:buyUrls[0], buyUrls, discoveryQueries:limited, maxPrice, minScore:floors.trainers[s.name] ?? floors.trainers.default };
  });
}

`;
  src = src.slice(0, buildStart) + buildSearches + src.slice(catalogFnStart);

  // Merge multiple alias catalogue pages into one model scan. Each page is validated on its own,
  // then listing IDs are deduplicated before freshness/scoring logic runs. A single non-blocking
  // alias failure no longer discards successful results from the other title spellings.
  const fetchStart = src.indexOf('async function fetchCatalogue(search) {');
  const processStart = src.indexOf('async function processSearch(', fetchStart);
  if (fetchStart < 0 || processStart < 0) throw new Error('Could not patch fetchCatalogue');
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

  const replacements = [
    ["    case 'Nike P-6000': return /\\bp\\s?6000\\b/.test(t)||/\\bp\\s?6000\\b/.test(f);", "    case 'Nike P-6000': return /\\bp\\s*6000\\b/.test(t)||/\\bp\\s*6000\\b/.test(f)||/\\bp6k\\b/.test(t)||(f.includes('nike')&&/\\bp6(?:s)?\\b/.test(t));"],
    ["    case 'Nike TN': { const plusVariant=f.includes('air max plus 3')||f.includes('air max plus vii')||f.includes('air max plus 7'); return !plusVariant&&(/(^|\\s)tns?(\\s|$)/.test(t)||/(^|\\s)tans?(\\s|$)/.test(t)||t.includes('air max plus')||t.includes('tuned')||f.includes('air max plus')); }", "    case 'Nike TN': { const plusVariant=/\\btn\\s?(?:3|7)\\b/.test(f)||f.includes('air max plus 3')||f.includes('air max plus vii')||f.includes('air max plus 7'); return !plusVariant&&(/(^|\\s)tns?(\\s|$)/.test(t)||/(^|\\s)tans?(\\s|$)/.test(t)||t.includes('air max plus')||t.includes('tuned')||f.includes('air max plus')); }"],
    ["    case 'Nike Air Max Plus 3': return f.includes('air max plus')&&/\\b3\\b/.test(f);", "    case 'Nike Air Max Plus 3': return /\\btn\\s?3\\b/.test(f)||(f.includes('air max plus')&&(/\\b3\\b/.test(f)||f.includes('iii')));"],
    ["    case 'Nike Air Max Plus VII': return f.includes('air max plus')&&(f.includes('vii')||/\\b7\\b/.test(f));", "    case 'Nike Air Max Plus VII': return /\\btn\\s?7\\b/.test(f)||/\\btn\\s?vii\\b/.test(f)||(f.includes('air max plus')&&(f.includes('vii')||/\\b7\\b/.test(f)));"],
    ["    case 'Nike Air Max 95': return t.includes('air max 95')||t.includes('am95')||f.includes('air max 95');", "    case 'Nike Air Max 95': return f.includes('air max 95')||/\\bam\\s?95\\b/.test(f)||/\\bmax\\s?95\\b/.test(t);"],
    ["    case 'Nike Air Max 90': return (t.includes('air max 90')||t.includes('am90')||f.includes('air max 90'))&&!f.includes('drift');", "    case 'Nike Air Max 90': return (f.includes('air max 90')||/\\bam\\s?90\\b/.test(f))&&!f.includes('drift');"],
    ["    case 'Nike Air Max 97': return t.includes('air max 97')||t.includes('am97')||f.includes('air max 97');", "    case 'Nike Air Max 97': return f.includes('air max 97')||/\\bam\\s?97\\b/.test(f);"],
    ["    case 'Nike Air Max 270': return f.includes('air max 270')||f.includes('am270');", "    case 'Nike Air Max 270': return f.includes('air max 270')||/\\bam\\s?270\\b/.test(f);"],
    ["    case 'Nike Shox TL': return f.includes('shox')&&/\\btl\\b/.test(f);", "    case 'Nike Shox TL': return (f.includes('shox')||f.includes('shoxtl'))&&(/\\btl\\b/.test(f)||f.includes('shoxtl'));"],
    ["    case 'Nike Shox Ride 2': return f.includes('shox')&&f.includes('ride')&&/\\b2\\b/.test(f);", "    case 'Nike Shox Ride 2': return (f.includes('shox')&&f.includes('ride')&&/\\b2\\b/.test(f))||f.includes('shoxride2')||f.includes('ride2 shox');"],
    ["    case 'Nike Air Force 1': return t.includes('air force')||/(^|\\s)af1(\\s|$)/.test(t)||f.includes('air force 1');", "    case 'Nike Air Force 1': return f.includes('air force 1')||/\\baf\\s?1\\b/.test(f)||f.includes('airforce1');"],
    ["    case 'Air Jordan 1 Low': return f.includes('jordan')&&/\\b1\\b/.test(f)&&f.includes('low');", "    case 'Air Jordan 1 Low': return (f.includes('jordan')&&/\\b1\\b/.test(f)&&f.includes('low'))||(/\\baj\\s?1\\b/.test(f)&&f.includes('low'));"],
    ["    case 'Air Jordan 1 Mid': return f.includes('jordan')&&/\\b1\\b/.test(f)&&f.includes('mid');", "    case 'Air Jordan 1 Mid': return (f.includes('jordan')&&/\\b1\\b/.test(f)&&f.includes('mid'))||(/\\baj\\s?1\\b/.test(f)&&f.includes('mid'));"],
    ["    case 'Air Jordan 4': return f.includes('jordan')&&/\\b4\\b/.test(f);", "    case 'Air Jordan 4': return (f.includes('jordan')&&/\\b4\\b/.test(f))||/\\baj\\s?4\\b/.test(f);"],
    ["    case 'Nike Initiator': return f.includes('nike')&&f.includes('initiator');", "    case 'Nike Initiator': return f.includes('initiator');"],
    ["    case 'Nike Air Max Moto 2K': return f.includes('air max moto')&&any('2k','2000');", "    case 'Nike Air Max Moto 2K': return (f.includes('air max moto')||f.includes('moto'))&&any('2k','2000');"]
  ];
  for (const [before, after] of replacements) {
    if (!src.includes(before)) throw new Error(`Could not harden matcher: ${before.slice(0, 48)}`);
    src = src.replace(before, after);
  }

  await fs.writeFile(radarUrl, src);
}
