import fs from 'node:fs/promises';

const BASE = new URL('./', import.meta.url);
const CONFIG = JSON.parse(await fs.readFile(new URL('./config.json', BASE), 'utf8'));
const webhook = process.env.DISCORD_PRICE_CHECKER_WEBHOOK_URL;
if (!webhook) throw new Error('Missing DISCORD_PRICE_CHECKER_WEBHOOK_URL secret');

const [modelArg, sizeArg, buyArg] = process.argv.slice(2);
const model = modelArg || 'Nike P-6000';
const size = Number(sizeArg || 8);
const buyPrice = Number(buyArg || 35);

const modelConfig = CONFIG.models[model];
if (!modelConfig) throw new Error(`Unknown model: ${model}`);
if (!Number.isFinite(size) || !Number.isFinite(buyPrice) || buyPrice <= 0) throw new Error('Invalid size or buy price');

const baseline = Number(modelConfig.resaleBySize?.[String(size)] ?? modelConfig.baselineResale ?? 0);
const marketUrl = CONFIG.searches.find(x => x.name === model)?.marketUrl;
let median = null;
if (marketUrl) {
  try {
    const html = await fetchText(marketUrl);
    const prices = extractPrices(html).filter(p => p > 0 && p < 500);
    if (prices.length >= 5) median = medianOf(prices);
  } catch {}
}

const marketEstimate = median ? median * 0.88 : baseline;
const resale = round2(Math.max(baseline * 0.9, Math.min(baseline * 1.1, baseline * 0.65 + marketEstimate * 0.35)));
const packaging = CONFIG.costs.packaging ?? 0.8;
const cleaning = CONFIG.costs.cleaning?.veryGood ?? 0.75;
const netProfit = round2(resale - buyPrice - packaging - cleaning);
const roi = round2((netProfit / buyPrice) * 100);
const marginScore = clamp((netProfit / Math.max(resale, 1)) * 150, 0, 100);
const roiScore = clamp(roi * 1.15, 0, 100);
const demand = 100;
const buyScore = Math.round(clamp(marginScore * 0.45 + roiScore * 0.25 + demand * 0.20 + 75 * 0.10, 0, 100));
const verdict = buyScore >= 80 ? '🟢 BUY' : buyScore >= 65 ? '🟡 CONSIDER' : '🔴 PASS';

await send({ model, size, buyPrice, resale, netProfit, roi, buyScore, verdict, median });

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': "Mozilla/5.0 (compatible; DansVaultPriceChecker/1.0; +https://github.com/TragiicMyst/dans-vault)", 'Accept-Language': 'en-GB,en;q=0.9' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function extractPrices(html) {
  return [...html.matchAll(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/g)].map(m => Number(m[1]));
}
function medianOf(a) { const s = [...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function round2(n) { return Math.round(n * 100) / 100; }
function clamp(n,min,max) { return Math.max(min, Math.min(max,n)); }

async function send(d) {
  const marketLine = d.median ? `📊 Observed market median: **£${d.median.toFixed(2)}**` : '📊 Market median: **not enough reliable data**';
  const body = {
    username: "Dan's Vault Price Checker",
    embeds: [{
      title: '💵 DAN\'S VAULT PRICE CHECK',
      description: `👟 **${d.model}** • UK ${d.size}\n\n💷 **Buy price:** £${d.buyPrice.toFixed(2)}\n📈 **Estimated resale:** £${d.resale.toFixed(2)}\n💰 **Estimated net profit:** £${d.netProfit.toFixed(2)}\n📊 **ROI:** ${d.roi.toFixed(1)}%\n\n🎯 **BUY SCORE: ${d.buyScore}/100**\n\n${d.verdict}\n\n${marketLine}\n\n*Estimate only — check condition, authenticity and current sold prices before buying.*`,
      color: d.buyScore >= 80 ? 3066993 : d.buyScore >= 65 ? 16776960 : 15158332,
      footer: { text: "Dan's Vault • Price Checker" },
      timestamp: new Date().toISOString()
    }]
  };
  const r = await fetch(webhook, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  if (!r.ok) throw new Error(`Discord webhook HTTP ${r.status}`);
}
