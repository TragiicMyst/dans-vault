import fs from 'node:fs/promises';

const BASE = new URL('./', import.meta.url);
const config = JSON.parse(await fs.readFile(new URL('./config.json', BASE), 'utf8'));
const stateUrl = new URL('./state.json', BASE);
const inventoryUrl = new URL('./inventory.json', BASE);
const state = await loadJson(stateUrl, { items: {}, market: {}, sellers: {}, images: {} });
const inventory = await loadJson(inventoryUrl, { items: [] });
const webhook = process.env.DISCORD_WEBHOOK_URL;
const testMode = process.env.TEST_MODE === 'true';
const UA = 'Mozilla/5.0 (compatible; DansVaultRadar/3.0; +https://github.com/TragiicMyst/dans-vault)';

if (!webhook) throw new Error('Missing DISCORD_WEBHOOK_URL secret');

if (testMode) {
  await sendTest(webhook);
  console.log('Bargain Finder test alert sent.');
  process.exit(0);
}

const now = new Date();
let alertsSent = 0;

for (const search of config.searches) {
  if (!config.enabled || alertsSent >= config.maxAlertsPerRun) break;
  if (config.blacklistModels.includes(search.name)) continue;

  try {
    const buyHtml = await fetchText(search.buyUrl);
    const candidates = extractItems(buyHtml);

    const cache = state.market[search.name];
    const cacheAge = cache?.updatedAt ? (Date.now() - Date.parse(cache.updatedAt)) / 3600000 : Infinity;
    if (!cache || cacheAge >= config.marketCacheHours) {
      const marketHtml = await fetchText(search.marketUrl);
      state.market[search.name] = {
        updatedAt: now.toISOString(),
        medianBySize: buildMarketMedianBySize(extractItems(marketHtml))
      };
    }

    for (const item of candidates) {
      if (alertsSent >= config.maxAlertsPerRun) break;

      const prior = state.items[item.id];
      const priceDrop = prior ? getPriceDrop(prior.lastPrice, item.price, config.priceDropAlert) : null;

      if (prior?.lastAlertedAt && Date.now() - Date.parse(prior.lastAlertedAt) < 3600000 && !priceDrop) continue;

      const size = inferSize(item.fullText, config.sizes);
      const text = `${item.title} ${item.fullText}`.toLowerCase();

      if (config.avoidKeywords.some((word) => text.includes(word))) {
        remember(item, prior, now, { blockedReason: 'keyword' });
        continue;
      }

      if (config.condition.avoid.some((word) => word !== 'good' && text.includes(word))) {
        remember(item, prior, now, { blockedReason: 'condition' });
        continue;
      }

      if (size === null || !config.sizes.map(String).includes(String(size))) {
        remember(item, prior, now, { blockedReason: 'size' });
        continue;
      }

      const condition = classifyCondition(text, config.condition);
      if (!config.allowedConditionKeywords?.some((word) => text.includes(word))) {
        remember(item, prior, now, { blockedReason: 'condition-not-allowed', size, condition });
        continue;
      }

      const marketMedian = state.market[search.name]?.medianBySize?.[String(size)] ?? null;
      const resale = resaleEstimate(search.name, size, marketMedian, config);
      if (!resale) continue;

      const fixedCosts = config.costs.packaging + (config.costs.cleaning?.[condition] ?? config.costs.cleaning.unknown) + config.costs.vintedSellingFee;
      const netProfit = round2(resale - item.price - fixedCosts);
      const roi = item.price > 0 ? round2((netProfit / item.price) * 100) : 0;
      const demand = seasonalDemand(search.name, config);
      const fakeRisk = fakeRiskLevel(item, text, resale);
      const inventoryCount = countInStock(inventory, search.name);
      const strategy = config.models[search.name]?.strategy ?? config.strategy.default;

      const marginScore = clamp(((resale - item.price) / Math.max(resale, 1)) * 100, 0, 100);
      const roiScore = clamp(roi, 0, 200) / 2;
      const demandScore = clamp(demand, 50, 115);
      const conditionScore = condition === 'new' ? 100 : 88;
      const riskScore = fakeRisk.level === 'LOW' ? 100 : fakeRisk.level === 'MEDIUM' ? 50 : 0;
      const profile = config.strategy.profiles[strategy] ?? config.strategy.profiles.balanced;
      let rawScore = marginScore * profile.marginWeight + roiScore * profile.roiWeight + demandScore * profile.demandWeight + conditionScore * profile.conditionWeight + riskScore * profile.riskWeight;

      if (inventoryCount >= (config.models[search.name]?.maxInventory ?? 3)) rawScore -= 10;
      else if (inventoryCount === (config.models[search.name]?.maxInventory ?? 3) - 1) rawScore -= 4;
      if (priceDrop) rawScore += Math.min(8, 3 + priceDrop.percent * 20);

      const buyScore = clamp(Math.round(rawScore), 0, 100);
      const shouldAlert = buyScore >= search.minScore || Boolean(priceDrop && buyScore >= Math.max(65, search.minScore - 8));

      remember(item, prior, now, { size, condition, buyScore, resale, netProfit, roi, fakeRisk, lastAlertedAt: shouldAlert ? now.toISOString() : (prior?.lastAlertedAt ?? null), lastPriceDrop: priceDrop });
      if (!shouldAlert) continue;

      await sendDiscord(webhook, {
        searchName: search.name,
        item,
        size,
        condition,
        resale,
        netProfit,
        roi,
        buyScore,
        fakeRisk,
        demand,
        strategy,
        priceDrop
      });
      alertsSent += 1;
    }
  } catch (error) {
    console.warn(`${search.name}: ${error.message}`);
  }
}

state.updatedAt = now.toISOString();
await fs.writeFile(stateUrl, JSON.stringify(state, null, 2) + '\n');
console.log(`Radar complete. Sent ${alertsSent} alert(s).`);

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function extractItems(html) {
  const found = new Map();
  const re = /href=["'](\/items\/([0-9]+)(?:-[^"']*)?)[^"']*["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[2];
    const path = m[1].split('?')[0];
    const context = stripTags(html.slice(m.index, Math.min(html.length, m.index + 6500))).replace(/\s+/g, ' ').trim();
    const pm = context.match(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    if (!pm) continue;
    const title = decodeHtml(path.replace(/^\/items\/[0-9]+-?/, '').replace(/-/g, ' ').trim());
    found.set(id, { id, title, price: Number(pm[1]), fullText: `${title} ${context}`, url: `https://www.vinted.co.uk${path}` });
  }
  return [...found.values()].slice(0, 70);
}

function inferSize(text, sizes) {
  const lower = text.toLowerCase();
  const aliases = { XS:['xs','extra small'], S:['size s',' s ','small'], M:['size m',' m ','medium'], L:['size l',' l ','large'], XL:['xl','extra large'], XXL:['xxl','2xl','extra extra large'] };
  for (const size of sizes) {
    const s = String(size).toUpperCase();
    if (/^\d+(?:\.\d+)?$/.test(String(size))) {
      const n = String(size);
      if (new RegExp(`\\b(?:uk\\s*)?${n}\\b`, 'i').test(lower)) return size;
    } else if (aliases[s]?.some((x) => lower.includes(x))) {
      return s;
    }
  }
  return null;
}

function classifyCondition(text, cfg) {
  if (cfg.new.some((word) => text.includes(word))) return 'new';
  if (cfg.veryGood.some((word) => text.includes(word))) return 'veryGood';
  return 'unknown';
}

function resaleEstimate(modelName, size, marketMedian, cfg) {
  const model = cfg.models[modelName] ?? {};
  const baseline = Number(model.resaleBySize?.[String(size)] ?? model.baselineResale ?? 0);
  if (!marketMedian || marketMedian <= 0) return round2(baseline);
  const marketNetAsk = marketMedian * 0.90;
  const blended = baseline * 0.60 + marketNetAsk * 0.40;
  return round2(clamp(blended, baseline * 0.85, baseline * 1.12));
}

function buildMarketMedianBySize(items) {
  const grouped = {};
  for (const item of items) {
    const size = inferSize(item.fullText, config.sizes);
    if (size === null || item.price <= 0 || item.price > 300) continue;
    (grouped[String(size)] ??= []).push(item.price);
  }
  const out = {};
  for (const [size, prices] of Object.entries(grouped)) out[size] = round2(median(prices));
  return out;
}

function seasonalDemand(modelName, cfg) {
  const month = new Date().getMonth() + 1;
  for (const season of Object.values(cfg.seasonalDemand)) if (season.months.includes(month)) return round2((season[modelName] ?? 1) * 100);
  return 100;
}

function fakeRiskLevel(item, text, resale) {
  const wording = ['replica','fake','counterfeit','1:1','ua ','rep ','mirror','pk batch','not authentic'].filter((x) => text.includes(x));
  if (wording.length || (resale > 0 && item.price <= resale * 0.35)) return { level:'HIGH', note: wording.length ? 'Suspicious authenticity wording' : 'Unusually low against estimated resale' };
  if (resale > 0 && item.price <= resale * 0.50) return { level:'MEDIUM', note:'Manual authenticity checks recommended' };
  return { level:'LOW', note:'No configured major red flags detected' };
}

function getPriceDrop(previousPrice, currentPrice, settings) {
  if (!settings.enabled || !previousPrice || currentPrice >= previousPrice) return null;
  const amount = previousPrice - currentPrice;
  const percent = amount / previousPrice;
  if (amount < settings.minDropAmount || percent < settings.minDropPercent) return null;
  return { from:round2(previousPrice), to:round2(currentPrice), amount:round2(amount), percent };
}

async function sendDiscord(url, d) {
  const resaleRange = `£${Math.max(0, d.resale - 5).toFixed(0)}–£${Math.round(d.resale + 5)}`;
  const verdict = d.buyScore >= 85 ? '🔥 **EXCEPTIONAL BARGAIN**' : d.buyScore >= 78 ? '🟢 **STRONG BUY**' : '🟡 **GOOD BUY**';
  const drop = d.priceDrop ? `\n📉 **Price drop:** £${d.priceDrop.from.toFixed(2)} → **£${d.priceDrop.to.toFixed(2)}**` : '';
  const body = { username:"Dan's Vault Bargain Finder", embeds:[{ title:'🚨 NEW BARGAIN FOUND 🔥', description:`**⭐ ${d.searchName.toUpperCase()}**\n**${d.item.title}**\n\n🏷️ **Buy price:** £${d.item.price.toFixed(2)}\n📏 **Size:** ${d.size}\n📦 **Condition:** ${d.condition==='new'?'🆕 New / NWT / NWOT':'✨ Very good'}\n📈 **Estimated resale:** ${resaleRange}\n💰 **Estimated net profit:** £${d.netProfit.toFixed(2)}\n📊 **ROI:** ${d.roi.toFixed(0)}%\n🎯 **Buy score:** ${d.buyScore}/100\n\n${verdict}${drop}\n🛡️ **Fake-risk screen:** ${d.fakeRisk.level}\n📈 **Demand factor:** ${d.demand.toFixed(0)}/100\n⚡ **Strategy:** ${d.strategy}\n\n${d.fakeRisk.note}\n\n*Resale estimate uses current Vinted market observations plus conservative model baselines. Check photos/authenticity before buying.*`, url:d.item.url, color:d.buyScore>=85?3066993:d.buyScore>=78?3447003:16776960, footer:{text:"Dan's Vault • Bargain Finder"}, timestamp:new Date().toISOString() }] };
  const r = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok) throw new Error(`Discord webhook HTTP ${r.status}`);
}

async function sendTest(url) {
  const body={ username:"Dan's Vault Bargain Finder", embeds:[{title:'🧪 BARGAIN FINDER TEST',description:'✅ **Discord webhook connected**\n\nThe Vinted Bargain Finder can now send alerts here.\n\n🔎 Searches include Nike trainers, Tech Fleece, jackets, tracksuits and activewear.\n✨ Allowed condition: Very good / New / New with tags / New without tags.\n\n*Test message — not a real bargain.*',color:3447003,timestamp:new Date().toISOString(),footer:{text:"Dan's Vault • Bargain Finder"}}]};
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok) throw new Error(`Discord webhook HTTP ${r.status}`);
}

function remember(item, prior, now, extra={}) { state.items[item.id] = {...prior,...extra,lastPrice:item.price,lastSeenAt:now.toISOString()}; }
function countInStock(items,model){return items.filter((x)=>x.model===model&&x.status!=='sold').length;}
function median(values){const s=[...values].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}
function round2(n){return Math.round(n*100)/100;}
function clamp(n,min,max){return Math.max(min,Math.min(max,n));}
function stripTags(s){return s.replace(/<[^>]+>/g,' ');}
function decodeHtml(s){return s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
async function loadJson(url,fallback){try{return JSON.parse(await fs.readFile(url,'utf8'));}catch{return fallback;}}
