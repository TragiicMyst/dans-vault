import fs from 'node:fs/promises';

const BASE = new URL('./', import.meta.url);
const config = JSON.parse(await fs.readFile(new URL('./demand-config.json', BASE), 'utf8'));
const statePath = new URL('./demand-state.json', BASE);
const state = JSON.parse(await fs.readFile(statePath, 'utf8').catch(() => '{"items":{}}'));
const webhook = process.env.DISCORD_DEMAND_WEBHOOK_URL;
if (!webhook) throw new Error('Missing DISCORD_DEMAND_WEBHOOK_URL secret');

const ua = 'Mozilla/5.0 (compatible; DansVaultDemandRadar/2.0; +https://github.com/TragiicMyst/dans-vault)';
const month = new Date().getMonth() + 1;
const season = config.seasonWeights[String(month)] ?? config.seasonWeights['8'];
const ebayDataset = await loadJson(new URL('../ebay-sold/dataset.json', BASE), { models: {} });

const extras = [
  {name:'Nike Pegasus Premium', query:'nike pegasus premium', category:'trainers', retailBaseline:165, targetBuy:85},
  {name:'Nike Vomero 18 Plus', query:'nike vomero 18 plus', category:'trainers', retailBaseline:165, targetBuy:65},
  {name:'Nike Miler Shorts', query:'nike miler shorts', category:'activewear', retailBaseline:35, targetBuy:10},
  {name:'Nike Challenger Shorts', query:'nike challenger shorts', category:'activewear', retailBaseline:45, targetBuy:12},
  {name:'Nike Stride Shorts', query:'nike stride shorts', category:'activewear', retailBaseline:45, targetBuy:12},
  {name:'Nike Pro Training Shorts', query:'nike pro training shorts', category:'activewear', retailBaseline:40, targetBuy:10},
  {name:'Nike Miler Running Top', query:'nike miler running top', category:'activewear', retailBaseline:40, targetBuy:10},
  {name:'Nike Dri-FIT Running Top', query:'nike dri-fit running top', category:'activewear', retailBaseline:45, targetBuy:12},
  {name:'Nike Unlimited Shorts', query:'nike unlimited shorts', category:'activewear', retailBaseline:50, targetBuy:12}
];
const items = dedupe([...config.items, ...extras]);

const nikeHtml = await Promise.all((config.nikeSources ?? []).map(async (url) => {
  try { return await fetchText(url); } catch { return ''; }
}));
const nikeText = nikeHtml.join('\n').toLowerCase();

const results = [];
for (const item of items) {
  try {
    const url = `https://www.vinted.co.uk/catalog?search_text=${encodeURIComponent(item.query)}&order=newest_first`;
    const html = await fetchText(url);
    const listings = extractListings(html);
    const prices = listings.map(x => x.price).filter(Number.isFinite).filter(x => x > 0 && x < 1000);
    const median = medianOf(prices);
    const belowTarget = prices.filter(p => p <= item.targetBuy).length;
    const cheapShare = prices.length ? belowTarget / prices.length : 0;
    const bestseller = bestsellerNear(nikeText, item.query);
    const seasonal = season[item.category] ?? season.trainers ?? 1;
    const previous = state.items[item.name];
    const priceTrend = previous?.median && median ? clamp(((previous.median - median) / previous.median) * 100, -50, 50) : 0;
    const supply = clamp(listings.length / 60, 0, 1);
    const ebay = ebaySignal(item.name, ebayDataset);

    const resaleOpportunity = median && item.retailBaseline ? clamp((item.retailBaseline - median) / item.retailBaseline * 100, -50, 50) : 0;
    const eBayStrength = ebay ? ebayStrength(ebay) : 0;

    const demandScore = Math.round(clamp(
      26 * (seasonal / 1.30) +
      18 * (bestseller ? 1 : 0.35) +
      18 * (1 - supply * 0.45) +
      14 * Math.min(Math.max(cheapShare / 0.30, 0), 1) +
      12 * (priceTrend > 0 ? Math.min(priceTrend / 10, 1) : 0) +
      12 * (resaleOpportunity > 0 ? Math.min(resaleOpportunity / 40, 1) : 0) +
      10 * (eBayStrength / 100),
      0, 100
    ));

    const confidence = listings.length >= 35 && median ? (ebay?.confidence === 'high' || bestseller ? 'HIGH' : 'MEDIUM') : listings.length >= 15 ? 'MEDIUM' : 'LOW';
    const action = demandScore >= 82 ? '🔥 PRIORITY BUY' : demandScore >= 72 ? '🟢 BUY IF CHEAP' : demandScore >= 62 ? '🟡 WATCH' : '🔴 LOW PRIORITY';

    results.push({ ...item, listings: listings.length, median, belowTarget, cheapShare, bestseller, seasonal, priceTrend, resaleOpportunity, ebay, eBayStrength, demandScore, confidence, action });
  } catch (error) {
    console.warn(`${item.name}: ${error.message}`);
  }
}

results.sort((a,b) => b.demandScore - a.demandScore || (b.ebayStrength ?? 0) - (a.ebayStrength ?? 0));
const maxResults = Math.max(10, Number(config.maxResults ?? 8));
const top = results.slice(0, maxResults);
const priority = top.filter(x => x.demandScore >= Number(config.minScoreToHighlight ?? 62)).slice(0, 7);

const lines = top.map((x, i) => {
  const med = x.median ? `£${x.median.toFixed(0)}` : 'n/a';
  const trend = x.priceTrend > 1 ? `↗ ${x.priceTrend.toFixed(0)}%` : x.priceTrend < -1 ? `↘ ${Math.abs(x.priceTrend).toFixed(0)}%` : '→ flat';
  const ebayLine = x.ebay ? ` • eBay sold ${x.ebay.avgSold ? `£${x.ebay.avgSold.toFixed(0)} avg` : ''}${x.ebay.sellThrough ? ` • ${x.ebay.sellThrough.toFixed(1)}% ST` : ''}` : '';
  const best = x.bestseller ? ' • Nike bestseller signal' : '';
  const buy = `£${x.targetBuy}`;
  return `**${i + 1}. ${x.name}** — **${x.demandScore}/100** ${x.action}\n   📦 ${x.listings} live Vinted • median ${med} • target buy ${buy}\n   📈 Trend ${trend} • 💷 retail £${x.retailBaseline} • 🎯 under-target ${Math.round(x.cheapShare * 100)}%${ebayLine}${best}\n   🗓️ ${x.category} • confidence ${x.confidence}`;
});

const buyLine = priority.length ? priority.map(x => `**${x.name}** (£${x.targetBuy} or less)`).join(' • ') : 'No priority buys today.';
const activewearLine = results.filter(x => x.category === 'activewear').sort((a,b)=>b.demandScore-a.demandScore).slice(0,3).map(x => `${x.name} ${x.demandScore}/100`).join(' • ') || 'n/a';

const body = {
  username: "Dan's Vault Demand Radar",
  embeds: [{
    title: '📈 DAN\'S VAULT • CURRENT NIKE DEMAND',
    description: `Daily UK Nike resale-demand scan.\n\n🎯 **Top current buy targets:** ${buyLine}\n\n🏃 **Activewear watch:** ${activewearLine}\n\n${lines.join('\n\n')}\n\n*Score blends live Vinted supply/pricing, target-buy availability, Nike retail/bestseller signals, seasonality, recent price movement and the local eBay sold snapshot where available. It is a sourcing signal, not guaranteed sales volume.*`,
    color: 3447003,
    footer: { text: "Dan's Vault • Nike Demand Radar • Daily" },
    timestamp: new Date().toISOString()
  }]
};

const response = await fetch(webhook, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
if (!response.ok) throw new Error(`Discord webhook HTTP ${response.status}`);

state.updatedAt = new Date().toISOString();
for (const x of results) state.items[x.name] = { median:x.median, demandScore:x.demandScore, listings:x.listings, cheapShare:x.cheapShare, ebay:x.ebay ?? null, updatedAt:state.updatedAt };
await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
console.log(`Nike demand radar sent ${top.length} ranked items.`);

async function fetchText(url) {
  const r = await fetch(url, {headers:{'User-Agent':ua,'Accept-Language':'en-GB,en;q=0.9'},redirect:'follow'});
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
function extractListings(html) {
  const found = new Map();
  const re = /href=["'](\/items\/([0-9]+)(?:-[^"']*)?)[^"']*["'][^>]*>/gi;
  let m;
  while ((m=re.exec(html))!==null) {
    const id=m[2], path=m[1].split('?')[0];
    const context=stripTags(html.slice(m.index,Math.min(html.length,m.index+5000))).replace(/\s+/g,' ');
    const price=context.match(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    if(!price) continue;
    found.set(id,{id,price:Number(price[1]),url:`https://www.vinted.co.uk${path}`});
  }
  return [...found.values()].slice(0,70);
}
function bestsellerNear(text, query){const words=query.toLowerCase().split(/\s+/).filter(Boolean); const idx=text.indexOf(words[0]); if(idx<0)return false; const w=text.slice(Math.max(0,idx-700),idx+1200); return w.includes('bestseller')||w.includes('best seller');}
function ebaySignal(name,dataset){const map={'Nike P-6000':'Nike P-6000','Nike Air Max 95':null,'Nike Air Max 97':null,'Nike Air Max Plus / TN':'Nike Air Max Plus / TN','Nike Shox TL':'Nike Shox TL','Nike Vomero 5':null,'Nike Vomero 18':'Nike Vomero 18 Plus','Nike Pegasus Premium':'Nike Pegasus Premium','Nike Vomero 18 Plus':'Nike Vomero 18 Plus'}; const key=map[name]; return key&&dataset.models?.[key]?dataset.models[key]:null;}
function ebayStrength(d){let s=0; if(d.salesCount)s+=Math.min(45,d.salesCount/10); if(d.totalSellers)s+=Math.min(20,d.totalSellers/50); if(d.sellThrough)s+=Math.min(25,d.sellThrough/2); if(d.confidence==='high')s+=10; return clamp(s,0,100);}
function dedupe(arr){const m=new Map(); for(const x of arr)m.set(x.name,x); return [...m.values()];}
function medianOf(a){if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}
function clamp(n,min,max){return Math.max(min,Math.min(max,n));}
function stripTags(s){return s.replace(/<[^>]+>/g,' ');}
async function loadJson(url,fallback){try{return JSON.parse(await fs.readFile(url,'utf8'));}catch{return fallback;}}
