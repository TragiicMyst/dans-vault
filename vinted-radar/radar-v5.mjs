import fs from 'node:fs/promises';

const LIVE_FRESHNESS_MINUTES = 10;
const BATCH_SIZE = 3;
const FETCH_TIMEOUT_MS = 10000;
const FETCH_ATTEMPTS = 2;
const BLOCK_COOLDOWN_MS = 75000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

export const TRAINER_SIZES = [7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5];
export const CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

const trainerNames = new Set([
  'Nike P-6000','Nike Vomero','Nike TN','Nike Pegasus Premium','Nike Shox TL',
  'Nike Air Max 95','Nike Air Max 97','Nike Vomero 5','Nike V5 RNR',
  'Nike Air Force 1','Nike Dunk Low'
]);

const clothingSpecs = [
  ['Nike Tech Fleece Hoodie','nike tech fleece hoodie',30],
  ['Nike Tech Fleece Windrunner','nike tech fleece windrunner',32],
  ['Nike Tech Fleece Joggers','nike tech fleece joggers',25],
  ['Nike Tech Fleece Tracksuit','nike tech fleece tracksuit',50],
  ['Nike ACG Fleece','nike acg fleece',40],
  ['Nike ACG Jacket','nike acg jacket',65],
  ['Nike Puffer Jacket','nike puffer jacket',60],
  ['Nike Windrunner Jacket','nike windrunner jacket',35],
  ['Nike Sportswear Tracksuit','nike sportswear tracksuit',45],
  ['Nike Miler Shorts','nike miler shorts',16],
  ['Nike Challenger Shorts','nike challenger shorts',16],
  ['Nike Stride Shorts','nike stride shorts',18],
  ['Nike Pro Training Shorts','nike pro training shorts',15],
  ['Nike Miler Running Top','nike miler running top',15],
  ['Nike Dri-FIT Running Top','nike dri-fit running top',15],
  ['Nike Unlimited Shorts','nike unlimited shorts',18]
];

const models = {
  'Nike P-6000': shoe(65,{7:60,8:65,9:68,10:70}),
  'Nike Vomero': shoe(65,{7:60,8:65,9:68,10:70}),
  'Nike TN': shoe(80,{7:72,8:78,9:82,10:85},'balanced'),
  'Nike Pegasus Premium': shoe(125,{7:115,8:125,9:130,10:135},'balanced'),
  'Nike Shox TL': shoe(100,{7:90,8:100,9:105,10:110}),
  'Nike Air Max 95': shoe(110,{7:100,8:110,9:115,10:120},'balanced'),
  'Nike Air Max 97': shoe(105,{7:95,8:105,9:110,10:115},'balanced'),
  'Nike Vomero 5': shoe(95,{7:85,8:95,9:100,10:105}),
  'Nike V5 RNR': shoe(65,{7:60,8:65,9:68,10:70}),
  'Nike Air Force 1': shoe(70,{7:65,8:70,9:72,10:75}),
  'Nike Dunk Low': shoe(75,{7:70,8:75,9:78,10:80},'balanced'),
  'Nike Tech Fleece Hoodie': clothing(38,{XS:30,S:35,M:38,L:40,XL:42,XXL:42}),
  'Nike Tech Fleece Windrunner': clothing(40,{XS:32,S:38,M:40,L:42,XL:44,XXL:45}),
  'Nike Tech Fleece Joggers': clothing(32,{XS:25,S:30,M:32,L:35,XL:36,XXL:36}),
  'Nike Tech Fleece Tracksuit': clothing(65,{XS:55,S:60,M:65,L:70,XL:72,XXL:75},'balanced'),
  'Nike ACG Fleece': clothing(55,{XS:45,S:50,M:55,L:60,XL:62,XXL:65},'balanced'),
  'Nike ACG Jacket': clothing(85,{XS:70,S:78,M:85,L:90,XL:95,XXL:95},'balanced'),
  'Nike Puffer Jacket': clothing(75,{XS:60,S:68,M:75,L:80,XL:85,XXL:85},'balanced'),
  'Nike Windrunner Jacket': clothing(45,{XS:35,S:40,M:45,L:48,XL:50,XXL:50}),
  'Nike Sportswear Tracksuit': clothing(55,{XS:45,S:50,M:55,L:58,XL:60,XXL:60}),
  'Nike Miler Shorts': clothing(22,{XS:18,S:20,M:22,L:24,XL:25,XXL:25}),
  'Nike Challenger Shorts': clothing(20,{XS:16,S:18,M:20,L:22,XL:24,XXL:24}),
  'Nike Stride Shorts': clothing(25,{XS:20,S:23,M:25,L:27,XL:28,XXL:28}),
  'Nike Pro Training Shorts': clothing(18,{XS:14,S:16,M:18,L:20,XL:20,XXL:20}),
  'Nike Miler Running Top': clothing(18,{XS:14,S:16,M:18,L:20,XL:21,XXL:21}),
  'Nike Dri-FIT Running Top': clothing(16,{XS:12,S:14,M:16,L:18,XL:19,XXL:19}),
  'Nike Unlimited Shorts': clothing(22,{XS:17,S:20,M:22,L:24,XL:25,XXL:25})
};

const floors = {
  trainers: { default:60,'Nike Pegasus Premium':63,'Nike Air Max 95':62,'Nike Air Max 97':62,'Nike Shox TL':62,'Nike Vomero 5':62,'Nike TN':62 },
  clothing: { default:60,'Nike Tech Fleece Tracksuit':63,'Nike ACG Fleece':63,'Nike ACG Jacket':63,'Nike Puffer Jacket':62 }
};

export async function runRadarV5({ bot, baseConfig, statePath, inventoryPath, webhook }) {
  if (!['trainers','clothing'].includes(bot)) throw new Error(`Invalid BOT_TYPE: ${bot}`);
  if (!webhook) throw new Error('Missing Discord webhook secret');

  const allSearches = buildSearches(bot, baseConfig);
  const sizes = bot === 'clothing' ? CLOTHING_SIZES : TRAINER_SIZES;
  const state = await loadJson(statePath, defaultState());
  const inventory = await loadJson(inventoryPath, { items: [] });
  normalizeState(state);
  migrateLegacyFrontiers(state, allSearches);

  const now = new Date();
  const lastScanMs = Date.parse(state.freshness.lastScanAt || 0);
  const recoveryMode = Number.isFinite(lastScanMs) && lastScanMs > 0 && now.getTime() - lastScanMs > 15 * 60_000;

  if (state.cooldownUntil && Date.parse(state.cooldownUntil) > now.getTime()) {
    throw new Error(`Vinted cooldown active until ${state.cooldownUntil}`);
  }

  const cursor = Number(state.rotationCursor || 0) % allSearches.length;
  const selected = pickCircular(allSearches, cursor, BATCH_SIZE);
  state.rotationCursor = (cursor + selected.length) % allSearches.length;

  const diagnostics = {
    bot,
    radarVersion: 5,
    lastRunAt: now.toISOString(),
    recoveryMode,
    totalSearchGroups: allSearches.length,
    selectedSearches: selected.map(s => s.key),
    successfulSearches: 0,
    failedSearches: 0,
    catalogItems: 0,
    candidateItems: 0,
    freshItems: 0,
    qualifyingAlerts: 0,
    deliveredAlerts: 0,
    discordFailures: 0,
    pendingDeliveries: Object.keys(state.pendingDeliveries).length,
    rejects: {},
    failures: {}
  };

  await retryPending(state, webhook, diagnostics);

  let blocked = false;
  for (let index = 0; index < selected.length; index += 1) {
    const search = selected[index];
    if (index > 0) await sleep(650 + Math.floor(Math.random() * 500));
    try {
      const html = await fetchText(search.buyUrl, { catalog: true });
      const raw = extractItems(html, 80);
      if (raw.length === 0 && !looksLikeEmptyCatalog(html)) {
        throw new Error('No Vinted item cards could be parsed from catalogue');
      }
      diagnostics.successfulSearches += 1;
      diagnostics.catalogItems += raw.length;
      const candidates = raw.filter(item => matchesSearchCandidate(item, search.name));
      diagnostics.candidateItems += candidates.length;
      await processSearch({ bot, search, candidates, sizes, state, inventory, baseConfig, webhook, now, recoveryMode, diagnostics });
    } catch (error) {
      diagnostics.failedSearches += 1;
      diagnostics.failures[search.key] = error.message;
      console.error(`${search.key}: ${error.message}`);
      if (error.blocked) {
        state.cooldownUntil = new Date(Date.now() + BLOCK_COOLDOWN_MS).toISOString();
        blocked = true;
        break;
      }
    }
  }

  state.freshness.lastScanAt = now.toISOString();
  state.updatedAt = now.toISOString();
  state.radarVersion = 5;
  state.diagnostics = diagnostics;
  diagnostics.pendingDeliveries = Object.keys(state.pendingDeliveries).length;
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n');

  console.log(`RADAR V5 ${bot}: ${diagnostics.successfulSearches}/${selected.length} selected searches OK; ${diagnostics.freshItems} fresh; ${diagnostics.deliveredAlerts} delivered; ${diagnostics.pendingDeliveries} pending.`);

  const minimumHealthy = Math.ceil(selected.length * 0.6);
  if (blocked) throw new Error('Vinted returned 403/429/challenge; cooldown started');
  if (diagnostics.successfulSearches < minimumHealthy) {
    throw new Error(`Unhealthy Vinted cycle: only ${diagnostics.successfulSearches}/${selected.length} selected searches succeeded`);
  }
  if (diagnostics.discordFailures > 0) throw new Error(`${diagnostics.discordFailures} Discord delivery failure(s); saved for retry`);
  return diagnostics;
}

async function processSearch({ bot, search, candidates, sizes, state, inventory, baseConfig, webhook, now, recoveryMode, diagnostics }) {
  const frontierKey = search.key;
  const frontier = state.freshness.frontiers[frontierKey];
  const frontierMax = frontier?.maxId ? String(frontier.maxId) : null;
  let maxRelevant = frontierMax;
  const firstRunForSearch = !frontierMax;

  for (const item of candidates) {
    if (maxRelevant === null || compareIds(item.id, maxRelevant) > 0) maxRelevant = String(item.id);
    const prior = state.items[item.id];
    const ageFresh = item.ageMinutes !== null && item.ageMinutes <= LIVE_FRESHNESS_MINUTES;
    const idNewer = frontierMax ? compareIds(item.id, frontierMax) > 0 : false;
    const freshnessSignal = ageFresh || (!recoveryMode && item.ageMinutes === null && idNewer);

    if (firstRunForSearch) {
      remember(state, item, prior, { bootstrapSeen:true });
      continue;
    }
    if (prior?.lastAlertedAt || state.pendingDeliveries[item.id]) continue;
    if (!freshnessSignal && !(prior && ageFresh)) {
      remember(state, item, prior, { blockedReason:'stale-or-no-freshness-signal' });
      reject(diagnostics,'stale');
      continue;
    }

    diagnostics.freshItems += 1;
    const summaryText = normalize(`${item.title} ${item.fullText}`);
    if (containsBlocked(summaryText, baseConfig.avoidKeywords ?? [])) {
      remember(state,item,prior,{blockedReason:'keyword'}); reject(diagnostics,'keyword'); continue;
    }
    if (hasBadCondition(summaryText, baseConfig.condition?.avoid ?? [])) {
      remember(state,item,prior,{blockedReason:'condition'}); reject(diagnostics,'condition'); continue;
    }
    if (Number.isFinite(search.maxPrice) && item.price > search.maxPrice) {
      remember(state,item,prior,{blockedReason:'price'}); reject(diagnostics,'price'); continue;
    }

    let size = inferSize(item.fullText, sizes, bot);
    let condition = classifyCondition(summaryText);
    let detailText = '';
    if (size === null || condition === 'unknown') {
      try {
        await sleep(250 + Math.floor(Math.random()*250));
        detailText = normalize(stripTags(await fetchText(item.url)));
      } catch (error) {
        remember(state,item,prior,{blockedReason:'detail-fetch-failed',detailError:error.message});
        reject(diagnostics,'detail-fetch-failed');
        if (error.blocked) throw error;
        continue;
      }
      if (size === null) size = inferSize(detailText, sizes, bot);
      if (condition === 'unknown') condition = classifyCondition(detailText);
    }

    if (size === null) { remember(state,item,prior,{blockedReason:'size'}); reject(diagnostics,'size'); continue; }
    if (condition === 'unknown') { remember(state,item,prior,{blockedReason:'condition-not-confirmed',size}); reject(diagnostics,'condition-not-confirmed'); continue; }

    const resale = resaleEstimate(search.name, size);
    if (!resale) { remember(state,item,prior,{blockedReason:'no-resale-baseline',size,condition}); reject(diagnostics,'no-resale-baseline'); continue; }
    const fixed = Number(baseConfig.costs?.packaging ?? 0.8) + Number(baseConfig.costs?.cleaning?.new ?? 0) + Number(baseConfig.costs?.vintedSellingFee ?? 0);
    const profit = round2(resale - item.price - fixed);
    const roi = item.price > 0 ? round2(profit / item.price * 100) : 0;
    if (profit < 10 || roi < 25) {
      remember(state,item,prior,{blockedReason:'weak-margin',size,condition,resale,netProfit:profit,roi}); reject(diagnostics,'weak-margin'); continue;
    }

    const risk = fakeRisk(item, `${summaryText} ${detailText}`, resale);
    const demand = seasonalDemand(search.name, baseConfig);
    const strategy = models[search.name]?.strategy ?? 'balanced';
    const score = buyScore({searchName:search.name,resale,price:item.price,profit,roi,risk,demand,strategy,stock:countStock(inventory.items ?? [], search.name)});
    const threshold = search.minScore;
    const strong = profit >= 15 && roi >= 40 && risk.level !== 'HIGH';
    const exceptional = profit >= 25 && roi >= 65 && risk.level !== 'HIGH';
    if (!(score >= threshold || strong || exceptional)) {
      remember(state,item,prior,{blockedReason:'score',size,condition,resale,netProfit:profit,roi,buyScore:score,fakeRisk:risk}); reject(diagnostics,'score'); continue;
    }

    diagnostics.qualifyingAlerts += 1;
    const alert = {searchName:search.name,item,size,condition,resale,netProfit:profit,roi,buyScore:score,fakeRisk:risk,demand,strategy,exceptionalDeal:exceptional};
    try {
      const messageId = await sendDiscord(webhook, alert);
      diagnostics.deliveredAlerts += 1;
      remember(state,item,prior,{size,condition,resale,netProfit:profit,roi,buyScore:score,fakeRisk:risk,lastAlertedAt:new Date().toISOString(),discordMessageId:messageId});
      console.log(`ALERT DELIVERED ${messageId}: ${search.name} | ${item.title} | £${item.price}`);
    } catch (error) {
      diagnostics.discordFailures += 1;
      state.pendingDeliveries[item.id] = { alert, attempts:1, firstFailedAt:new Date().toISOString(), lastError:error.message };
      remember(state,item,prior,{blockedReason:'discord-pending',size,condition,resale,netProfit:profit,roi,buyScore:score,fakeRisk:risk});
    }
  }

  if (maxRelevant !== null) state.freshness.frontiers[frontierKey] = { maxId:maxRelevant, updatedAt:now.toISOString() };
}

async function retryPending(state, webhook, diagnostics) {
  const entries = Object.entries(state.pendingDeliveries).slice(0, 4);
  for (const [id, pending] of entries) {
    try {
      const messageId = await sendDiscord(webhook, pending.alert);
      delete state.pendingDeliveries[id];
      const item = state.items[id] ?? {};
      item.lastAlertedAt = new Date().toISOString();
      item.discordMessageId = messageId;
      delete item.blockedReason;
      state.items[id] = item;
      diagnostics.deliveredAlerts += 1;
    } catch (error) {
      pending.attempts = Number(pending.attempts || 0) + 1;
      pending.lastError = error.message;
      pending.lastAttemptAt = new Date().toISOString();
      diagnostics.discordFailures += 1;
    }
  }
}

export function buildSearches(bot, config) {
  if (bot === 'clothing') return clothingSpecs.map(([name,q,base]) => ({ name, key:`${name}::${q}`, buyUrl:catalogUrl(q,round2(base*1.3)), maxPrice:round2(base*1.3), minScore:floors.clothing[name] ?? floors.clothing.default }));
  const searches = (config.searches ?? []).filter(s => trainerNames.has(s.name)).map(s => {
    const maxPrice = round2(Number(s.maxPrice) * 1.3);
    const u = new URL(s.buyUrl); u.searchParams.set('order','newest_first'); u.searchParams.set('price_to',String(maxPrice));
    return {...s,key:`${s.name}::primary`,buyUrl:u.toString(),maxPrice,minScore:floors.trainers[s.name] ?? floors.trainers.default};
  });
  const tn = searches.find(s => s.name === 'Nike TN');
  if (tn) {
    searches.push({...tn,key:'Nike TN::air-max-plus',buyUrl:catalogUrl('nike air max plus',tn.maxPrice)});
    searches.push({...tn,key:'Nike TN::tans',buyUrl:catalogUrl('nike tans',tn.maxPrice)});
  }
  return searches;
}

function catalogUrl(query,maxPrice){const u=new URL('https://www.vinted.co.uk/catalog');u.searchParams.set('search_text',query);u.searchParams.set('order','newest_first');u.searchParams.set('price_to',String(maxPrice));return u.toString();}

export function extractItems(html, limit=80) {
  const found = new Map();
  const patterns = [
    /href=["'](?:https?:\/\/www\.vinted\.co\.uk)?(\/items\/(\d+)(?:-[^"']*)?)[^"']*["']/gi,
    /["'](?:url|path)["']\s*:\s*["'](?:https?:\/\/www\.vinted\.co\.uk)?(\/items\/(\d+)(?:-[^"'\\]*)?)["']/gi,
    /\\u002Fitems\\u002F(\d+)([^"'\\]*)/gi
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const id = m[2] || m[1];
      let path = m[1]?.startsWith('/items/') ? m[1] : `/items/${id}${m[2] && !/^\d+$/.test(m[2]) ? m[2] : ''}`;
      path = path.replace(/\\u002F/g,'/').split('?')[0];
      const start = Math.max(0, m.index - 1400), end = Math.min(html.length, m.index + 2600);
      const context = stripTags(html.slice(start,end)).replace(/\s+/g,' ').trim();
      const price = parsePrice(context);
      if (!Number.isFinite(price) || price <= 0 || price > 500) continue;
      const slug = path.replace(/^\/items\/\d+-?/,'').replace(/-/g,' ').trim();
      const title = decodeHtml(slug || extractTitle(context) || 'Vinted item');
      found.set(String(id), {id:String(id),title,price,ageMinutes:parseAgeMinutes(context),fullText:`${title} ${context}`,url:`https://www.vinted.co.uk${path}`});
      if (found.size >= limit) break;
    }
    if (found.size >= limit) break;
  }
  return [...found.values()].slice(0,limit);
}

function parsePrice(text){
  const pound=[...text.matchAll(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/g)].map(m=>Number(m[1])).filter(n=>n>0&&n<500);
  if(pound.length) return pound[0];
  const json=text.match(/(?:price|amount)["'\s:]+([0-9]+(?:\.[0-9]{1,2})?)/i); return json?Number(json[1]):NaN;
}
function extractTitle(text){const m=text.match(/(?:title|name)\s*[:\-]\s*([^|]{3,100})/i);return m?.[1]?.trim()??'';}
function looksLikeEmptyCatalog(html){const t=normalize(stripTags(html));return t.includes('no items')||t.includes('no results')||t.includes('nothing found');}

export function matchesSearchCandidate(item,name){
  const t=normalize(item?.title??''); const f=normalize(`${item?.title??''} ${item?.fullText??''}`); const has=(...p)=>p.every(x=>t.includes(x)); const any=(...p)=>p.some(x=>f.includes(x));
  switch(name){
    case 'Nike P-6000': return /\bp\s?6000\b/.test(t);
    case 'Nike Vomero 5': return has('vomero','5');
    case 'Nike Vomero': return t.includes('vomero');
    case 'Nike TN': return /(^|\s)tns?(\s|$)/.test(t)||/(^|\s)tans?(\s|$)/.test(t)||t.includes('air max plus')||t.includes('tuned');
    case 'Nike Pegasus Premium': return has('pegasus','premium');
    case 'Nike Shox TL': return t.includes('shox');
    case 'Nike Air Max 95': return t.includes('air max 95')||t.includes('am95');
    case 'Nike Air Max 97': return t.includes('air max 97')||t.includes('am97');
    case 'Nike V5 RNR': return has('v5','rnr');
    case 'Nike Air Force 1': return t.includes('air force')||/(^|\s)af1(\s|$)/.test(t);
    case 'Nike Dunk Low': return t.includes('dunk');
    case 'Nike Tech Fleece Hoodie': return f.includes('tech')&&f.includes('fleece')&&any('hoodie','hoody','zip','windrunner');
    case 'Nike Tech Fleece Windrunner': return f.includes('tech')&&f.includes('fleece')&&any('windrunner','jacket','zip');
    case 'Nike Tech Fleece Joggers': return f.includes('tech')&&f.includes('fleece')&&any('jogger','trouser','bottom');
    case 'Nike Tech Fleece Tracksuit': return f.includes('tech')&&f.includes('fleece')&&any('tracksuit','track suit','set','full');
    case 'Nike ACG Fleece': return f.includes('acg')&&f.includes('fleece');
    case 'Nike ACG Jacket': return f.includes('acg')&&any('jacket','coat','shell');
    case 'Nike Puffer Jacket': return f.includes('nike')&&any('puffer','down jacket','down coat');
    case 'Nike Windrunner Jacket': return f.includes('windrunner');
    case 'Nike Sportswear Tracksuit': return f.includes('nike')&&any('tracksuit','track suit','set');
    case 'Nike Miler Shorts': return f.includes('miler')&&any('short','shorts');
    case 'Nike Challenger Shorts': return f.includes('challenger')&&any('short','shorts');
    case 'Nike Stride Shorts': return f.includes('stride')&&any('short','shorts');
    case 'Nike Pro Training Shorts': return f.includes('nike')&&f.includes('pro')&&any('short','shorts');
    case 'Nike Miler Running Top': return f.includes('miler')&&any('top','shirt','tee','t shirt');
    case 'Nike Dri-FIT Running Top': return any('dri fit','drifit')&&any('top','shirt','tee','t shirt');
    case 'Nike Unlimited Shorts': return f.includes('unlimited')&&any('short','shorts');
    default:return false;
  }
}

export function inferSize(text,sizes,bot){const n=normalize(text);if(bot==='clothing'){const p=[[/\b(?:size\s*[:\-]?\s*)?(xxl|2xl)\b/i,'XXL'],[/\b(?:size\s*[:\-]?\s*)?xl\b/i,'XL'],[/\b(?:size\s*[:\-]?\s*)?xs\b/i,'XS'],[/\bsize\s*[:\-]?\s*s\b/i,'S'],[/\bsize\s*[:\-]?\s*m\b/i,'M'],[/\bsize\s*[:\-]?\s*l\b/i,'L'],[/\bextra small\b/i,'XS'],[/\bsmall\b/i,'S'],[/\bmedium\b/i,'M'],[/\blarge\b/i,'L'],[/\bextra large\b/i,'XL']];for(const [r,v] of p)if(r.test(n)&&sizes.includes(v))return v;return null;}for(const s of [...sizes].sort((a,b)=>String(b).length-String(a).length)){const e=String(s).replace('.','\\.');const ps=[new RegExp(`\\b(?:uk|size)\\s*[:\\-]?\\s*${e}(?!\\.\\d)\\b`,'i'),new RegExp(`\\b${e}(?!\\.\\d)\\s*uk\\b`,'i')];if(ps.some(r=>r.test(n)))return Number(s);}return null;}
export function classifyCondition(text){const n=normalize(text);if(/\bnew without tags\b/.test(n))return'newWithoutTags';if(/\bnew with tags\b/.test(n))return'newWithTags';return'unknown';}
export function parseAgeMinutes(text){const n=normalize(text);if(/\bjust now\b|\bnow\b/.test(n))return 0;let m=n.match(/\b(?:uploaded\s*)?(\d+)\s*(?:minute|minutes|min)\s+ago\b/);if(m)return Number(m[1]);m=n.match(/\b(?:uploaded\s*)?(\d+)\s*(?:hour|hours|hr|hrs)\s+ago\b/);if(m)return Number(m[1])*60;m=n.match(/\b(?:uploaded\s*)?(\d+)\s*(?:day|days)\s+ago\b/);return m?Number(m[1])*1440:null;}

async function fetchText(url,{catalog=false}={}){let last;for(let a=1;a<=FETCH_ATTEMPTS;a++){try{const r=await fetch(url,{headers:{'User-Agent':USER_AGENT,'Accept':'text/html,application/xhtml+xml','Accept-Language':'en-GB,en;q=0.9','Cache-Control':'no-cache'},redirect:'follow',signal:AbortSignal.timeout(FETCH_TIMEOUT_MS)});const body=await r.text();if(!r.ok){const e=new Error(`HTTP ${r.status}`);e.blocked=r.status===403||r.status===429;e.retryable=e.blocked||r.status>=500;throw e;}const low=body.toLowerCase();if(low.includes('captcha')||low.includes('access denied')||low.includes('cf-chl-')){const e=new Error('Vinted returned a challenge/block page');e.blocked=true;e.retryable=true;throw e;}if(catalog&&body.length<1200){const e=new Error('Vinted catalogue response unexpectedly short');e.retryable=true;throw e;}return body;}catch(e){last=e;if(a===FETCH_ATTEMPTS||e.retryable===false)break;await sleep(1400*a+Math.floor(Math.random()*700));}}throw last??new Error('Vinted request failed');}

async function sendDiscord(url,a){const u=new URL(url);u.searchParams.set('wait','true');const range=`£${Math.max(0,a.resale-5).toFixed(0)}–£${Math.round(a.resale+5)}`;const body={username:"Dan's Vault Fresh Bargain Finder",embeds:[{title:'🚨 NEW VINTED BARGAIN 🔥',description:`**⭐ ${a.searchName.toUpperCase()}**\n**${a.item.title}**\n\n🕐 ${a.item.ageMinutes===null?'Newly detected':`Listed ~${a.item.ageMinutes} min ago`}\n🏷️ **Buy:** £${a.item.price.toFixed(2)}\n📏 **Size:** ${a.size}\n📦 **Condition:** ${a.condition==='newWithTags'?'🆕 New with tags':'🆕 New without tags'}\n📈 **Est. resale:** ${range}\n💰 **Est. profit:** £${a.netProfit.toFixed(2)}\n📊 **ROI:** ${a.roi.toFixed(0)}%\n🎯 **Score:** ${a.buyScore}/100\n\n${a.exceptionalDeal?'🔥 **EXCEPTIONAL BARGAIN**':a.buyScore>=85?'🟢 **STRONG BUY**':'🟡 **GOOD BUY**'}\n🛡️ **Authenticity screen:** ${a.fakeRisk.level}\n📈 **Demand:** ${a.demand.toFixed(0)}/100\n\n${a.fakeRisk.note}\n\n*Check photos, product code, condition and seller before buying.*`,url:a.item.url,color:a.exceptionalDeal?3066993:a.buyScore>=85?3447003:16776960,timestamp:new Date().toISOString()}]};let last;for(let i=1;i<=3;i++){try{const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});const text=await r.text();if(!r.ok){const e=new Error(`Discord HTTP ${r.status}`);e.retryable=r.status===429||r.status>=500;throw e;}const parsed=JSON.parse(text);if(!parsed?.id)throw new Error('Discord did not acknowledge message with an id');return String(parsed.id);}catch(e){last=e;if(i===3||e.retryable===false)break;await sleep(500*i);}}throw last??new Error('Discord delivery failed');}

function migrateLegacyFrontiers(state,searches){for(const s of searches){if(state.freshness.frontiers[s.key])continue;const legacy=state.freshness.frontiers[s.name];if(legacy?.maxId)state.freshness.frontiers[s.key]={...legacy,migratedFromLegacy:true};}}
function normalizeState(s){s.items??={};s.freshness??={frontiers:{},lastScanAt:null};s.freshness.frontiers??={};s.pendingDeliveries??={};if(!Number.isFinite(Number(s.rotationCursor)))s.rotationCursor=0;}
function defaultState(){return{items:{},freshness:{frontiers:{},lastScanAt:null},pendingDeliveries:{},rotationCursor:0,radarVersion:5};}
function pickCircular(a,start,count){const out=[];for(let i=0;i<Math.min(count,a.length);i++)out.push(a[(start+i)%a.length]);return out;}
function remember(state,item,prior,extra){state.items[item.id]={...(prior??{}),...Object.fromEntries(Object.entries(extra).filter(([,v])=>v!==undefined)),title:item.title,url:item.url,lastPrice:item.price,firstSeenAt:prior?.firstSeenAt??new Date().toISOString(),lastSeenAt:new Date().toISOString()};if(extra.blockedReason===undefined)delete state.items[item.id].blockedReason;}
function reject(d,k){d.rejects[k]=(d.rejects[k]??0)+1;}
function containsBlocked(text,words){return words.some(x=>{const w=normalize(x);if(!w)return false;if(w.length<=3&&!w.includes(' '))return new RegExp(`(^|[^a-z0-9])${escapeRegExp(w)}($|[^a-z0-9])`,'i').test(text);return text.includes(w);});}
function hasBadCondition(text,words){return words.some(x=>{const w=normalize(x);if(!w||w==='good')return false;return text.includes(w);});}
function resaleEstimate(name,size){const m=models[name]??{};const by=m.resaleBySize??{};let b=Number(by[String(size)]??m.baselineResale??0);if(!b&&Number.isFinite(Number(size))){const ks=Object.keys(by).map(Number).filter(Number.isFinite);if(ks.length){const n=ks.sort((a,c)=>Math.abs(a-Number(size))-Math.abs(c-Number(size)))[0];b=Number(by[String(n)]??0);}}return round2(b);}
function seasonalDemand(name,cfg){const month=new Date().getMonth()+1;for(const s of Object.values(cfg.seasonalDemand??{}))if(s.months?.includes(month))return round2((s[name]??1)*100);return 100;}
function fakeRisk(item,text,resale){if(['replica','fake','counterfeit','1:1','ua ','ua-','rep ','mirror','pk batch','not authentic'].some(x=>text.includes(x)))return{level:'HIGH',note:'Explicit suspicious-authenticity wording detected'};if(item.price<=resale*.3)return{level:'MEDIUM',note:'Extremely low price versus expected resale; inspect photos, code and seller history'};return{level:'LOW',note:'No configured major authenticity red flags detected'};}
function buyScore({searchName,resale,price,profit,roi,risk,demand,strategy,stock}){const margin=clamp((resale-price)/Math.max(resale,1)*100,0,100),roiS=clamp(roi,0,200)/2,riskS=risk.level==='HIGH'?20:risk.level==='MEDIUM'?75:100;const p={fastFlip:[.35,.20,.30,.10,.05],balanced:[.45,.20,.20,.10,.05],maxProfit:[.50,.25,.10,.10,.05]}[strategy]??[.45,.20,.20,.10,.05];let score=margin*p[0]+roiS*p[1]+clamp(demand,50,115)*p[2]+100*p[3]+riskS*p[4];if(stock>=Number(models[searchName]?.maxInventory??3))score-=8;if(profit>=20)score+=4;if(profit>=30)score+=4;if(roi>=80)score+=3;if(risk.level==='HIGH')score-=12;return clamp(Math.round(score),0,100);}
function countStock(items,name){return items.filter(x=>x.model===name&&x.status!=='sold').length;}
function shoe(b,s,strategy='fastFlip'){return{baselineResale:b,resaleBySize:s,strategy,maxInventory:4};}function clothing(b,s,strategy='fastFlip'){return{baselineResale:b,resaleBySize:s,strategy,maxInventory:5};}
function compareIds(a,b){try{const aa=BigInt(String(a)),bb=BigInt(String(b));return aa>bb?1:aa<bb?-1:0;}catch{return String(a).localeCompare(String(b),undefined,{numeric:true});}}
function normalize(v){return String(v).toLowerCase().replace(/[-_/]+/g,' ').replace(/\s+/g,' ').trim();}function stripTags(v){return String(v).replace(/<[^>]+>/g,' ');}function decodeHtml(v){return String(v).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');}function escapeRegExp(v){return String(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}function round2(v){return Math.round(Number(v)*100)/100;}function clamp(v,min,max){return Math.max(min,Math.min(max,v));}function sleep(ms){return new Promise(r=>setTimeout(r,ms));}async function loadJson(path,fallback){try{return JSON.parse(await fs.readFile(path,'utf8'));}catch{return fallback;}}
