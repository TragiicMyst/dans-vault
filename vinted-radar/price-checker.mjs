import fs from 'node:fs/promises';

const BASE = new URL('./', import.meta.url);
const CONFIG = JSON.parse(await fs.readFile(new URL('./config.json', BASE), 'utf8'));
const webhook = process.env.DISCORD_PRICE_CHECKER_WEBHOOK_URL;
if (!webhook) throw new Error('Missing DISCORD_PRICE_CHECKER_WEBHOOK_URL secret');

const [modelArg, sizeArg, buyArg, conditionArg] = process.argv.slice(2);
const model = modelArg || 'Nike P-6000';
const size = Number(sizeArg || 8);
const buyPrice = Number(buyArg || 35);
const condition = normaliseCondition(conditionArg || 'very good');

const modelConfig = CONFIG.models[model];
if (!modelConfig) throw new Error(`Unknown model: ${model}`);
if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(buyPrice) || buyPrice <= 0) throw new Error('Invalid size or buy price');

const baseline = Number(modelConfig.resaleBySize?.[String(size)] ?? modelConfig.baselineResale ?? 0);
if (!baseline) throw new Error(`No resale baseline configured for ${model}`);

const searchConfig = CONFIG.searches.find(x => x.name === model);
const marketUrl = searchConfig?.marketUrl;
let observedPrices = [];
if (marketUrl) {
  try {
    const html = await fetchText(marketUrl);
    observedPrices = extractPrices(html).filter(p => p >= 15 && p < 500);
  } catch {}
}

const median = observedPrices.length >= 5 ? medianOf(observedPrices) : null;
const marketEstimate = median ?? baseline;
const conditionMultiplier = { new: 1.00, 'very good': 0.96, good: 0.90, preloved: 0.84, unknown: 0.82 }[condition] ?? 0.90;
const rawResale = baseline * 0.65 + marketEstimate * 0.35;
const resale = round2(clamp(rawResale * conditionMultiplier, baseline * 0.65, baseline * 1.10));

const packaging = Number(CONFIG.costs.packaging ?? 0.8);
const cleaning = Number(CONFIG.costs.cleaning?.[cleaningKey(condition)] ?? CONFIG.costs.cleaning?.unknown ?? 2.5);
const totalCost = round2(buyPrice + packaging + cleaning);
const netProfit = round2(resale - totalCost);
const roi = round2((netProfit / buyPrice) * 100);

const maxBuyFor30Roi = round2(Math.max(0, (resale - packaging - cleaning) / 1.30));
const maxBuyFor25Profit = round2(Math.max(0, resale - packaging - cleaning - 25));
const recommendedMaxBuy = round2(Math.min(maxBuyFor30Roi, maxBuyFor25Profit));

const demand = Number(modelConfig.demandScore ?? 80);
const demandMultiplier = getSeasonalMultiplier(model, CONFIG.seasonalDemand);
const demandScore = clamp(demand * demandMultiplier, 0, 100);
const marginScore = clamp((netProfit / Math.max(resale, 1)) * 150, 0, 100);
const roiScore = clamp(roi * 1.15, 0, 100);
const conditionScore = { new: 100, 'very good': 90, good: 78, preloved: 65, unknown: 50 }[condition] ?? 50;
const buyScore = Math.round(clamp(marginScore * 0.40 + roiScore * 0.25 + demandScore * 0.20 + conditionScore * 0.10 + 75 * 0.05, 0, 100));

const verdict = buyScore >= 82 ? '🟢 STRONG BUY' : buyScore >= 70 ? '🟡 BUY IF CLEAN / AUTHENTIC' : buyScore >= 58 ? '🟠 MARGINAL' : '🔴 PASS';
const confidence = median ? (observedPrices.length >= 12 ? 'HIGH' : 'MEDIUM') : 'LOW';

await send({ model, size, buyPrice, condition, resale, totalCost, netProfit, roi, buyScore, verdict, median, observedCount: observedPrices.length, recommendedMaxBuy, confidence });

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': "Mozilla/5.0 (compatible; DansVaultPriceChecker/1.0; +https://github.com/TragiicMyst/dans-vault)", 'Accept-Language': 'en-GB,en;q=0.9' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
function extractPrices(html) { return [...html.matchAll(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/g)].map(m => Number(m[1])); }
function medianOf(a) { const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function round2(n) { return Math.round(n*100)/100; }
function clamp(n,min,max) { return Math.max(min,Math.min(max,n)); }
function normaliseCondition(value) { const v=String(value).toLowerCase().trim(); if(v.includes('new'))return'new'; if(v.includes('very'))return'very good'; if(v.includes('pre'))return'preloved'; if(v.includes('good'))return'good'; return'unknown'; }
function cleaningKey(condition) { if(condition==='new')return'new'; if(condition==='very good')return'veryGood'; if(condition==='good'||condition==='preloved')return'good'; return'unknown'; }
function getSeasonalMultiplier(model, seasonalDemand={}) { const month=new Date().getMonth()+1; for(const season of Object.values(seasonalDemand)){ if(Array.isArray(season.months)&&season.months.includes(month))return Number(season[model]??1); } return 1; }

async function send(d) {
  const marketLine=d.median?`📊 **Market median:** £${d.median.toFixed(2)}  •  ${d.observedCount} prices observed`:'📊 **Market data:** not enough reliable live prices';
  const buyLine=d.buyPrice<=d.recommendedMaxBuy?'✅ **Buy price is inside the recommended range**':'⚠️ **Buy price is above the recommended maximum**';
  const body={username:"Dan's Vault Price Checker",embeds:[{title:'💷 DAN\'S VAULT • PRICE CHECK',description:`👟 **${d.model}** • 🇬🇧 UK ${d.size}\n✨ Condition: **${d.condition}**\n\n🏷️ **Buy:** £${d.buyPrice.toFixed(2)}\n📈 **Realistic resale:** £${d.resale.toFixed(2)}\n💰 **Net profit:** £${d.netProfit.toFixed(2)}\n📊 **ROI:** ${d.roi.toFixed(1)}%\n\n🎯 **BUY SCORE**\n**${d.buyScore}/100**  ${d.verdict}\n\n🧮 **Recommended max buy:** £${d.recommendedMaxBuy.toFixed(2)}\n${buyLine}\n\n${marketLine}\n📡 **Confidence:** ${d.confidence}\n\n*Estimate only. Check authenticity, condition and current sold prices before buying.*`,color:d.buyScore>=82?3066993:d.buyScore>=70?16776960:15158332,footer:{text:"Dan's Vault • Price Checker"},timestamp:new Date().toISOString()}]};
  const r=await fetch(webhook,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok)throw new Error(`Discord webhook HTTP ${r.status}`);
}
