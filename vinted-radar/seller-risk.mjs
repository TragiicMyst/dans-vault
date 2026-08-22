import fs from 'node:fs/promises';

const CONFIG = JSON.parse(await fs.readFile(new URL('./config.json', import.meta.url), 'utf8'));
const STATE_URL = new URL('./seller-risk-state.json', import.meta.url);
const state = await loadState();
const webhook = process.env.DISCORD_SELLER_RISK_WEBHOOK_URL;
if (!webhook) throw new Error('Missing DISCORD_SELLER_RISK_WEBHOOK_URL secret');

const TEST_MODE = process.env.SELLER_RISK_TEST_MODE === 'true';
const UA = 'Mozilla/5.0 (compatible; DansVaultSellerRisk/2.0; +https://github.com/TragiicMyst/dans-vault)';
const now = new Date();

if (TEST_MODE) {
  await send(webhook, {
    level: '🧪 TEST', seller: 'Webhook connection test', model: 'Nike test listing', price: 25,
    url: 'https://www.vinted.co.uk/', flags: ['Discord webhook connected', 'Seller Risk monitor is running'], candidateCount: 1, lowShare: 0
  });
  console.log('Seller Risk diagnostic alert sent successfully.');
  process.exit(0);
}

const observations = [];
let scanned = 0;
let sellerFound = 0;

for (const search of CONFIG.searches ?? []) {
  let html = '';
  try { html = await fetchText(search.buyUrl); }
  catch (e) { console.warn(`${search.name}: search fetch failed: ${e.message}`); continue; }

  for (const item of extractItems(html)) {
    scanned += 1;
    const prior = state.items[item.id];
    if (prior?.lastSeenAt && Date.now() - Date.parse(prior.lastSeenAt) < 15 * 60000 && prior.lastPrice === item.price) continue;

    const page = await fetchText(item.url).catch(() => '');
    const seller = extractSeller(page);
    if (!seller) {
      state.items[item.id] = { ...prior, lastSeenAt: now.toISOString(), lastPrice: item.price, sellerFound: false };
      continue;
    }
    sellerFound += 1;

    const text = `${item.title} ${page}`.toLowerCase();
    const flags = [];
    const explicit = ['1:1','replica','fake','counterfeit','mirror','pk batch','not authentic','una ','ua-','rep '].filter(x => text.includes(x));
    if (explicit.length) flags.push('Suspicious authenticity wording');

    const baseline = Number(CONFIG.models?.[search.name]?.baselineResale ?? 70);
    const lowRatio = baseline > 0 ? item.price / baseline : 1;
    if (lowRatio <= 0.35) flags.push('Extremely low price versus model baseline');
    else if (lowRatio <= 0.50) flags.push('Very low price versus model baseline');

    const itemRefs = new Set((page.match(/\/items\/[0-9]+/g) || []).map(x => x.match(/[0-9]+/)[0])).size;
    if (itemRefs >= 15) flags.push(`${itemRefs} item references visible on seller page`);

    const record = state.sellers[seller] ?? { candidateCount: 0, lowPriceCount: 0, flags: 0, distinctModels: {}, lastAlertAt: null };
    record.candidateCount += 1;
    if (lowRatio <= 0.50) record.lowPriceCount += 1;
    record.flags += flags.length;
    record.distinctModels[search.name] = (record.distinctModels[search.name] ?? 0) + 1;
    record.lastSeenAt = now.toISOString();
    state.sellers[seller] = record;

    const lowShare = record.lowPriceCount / Math.max(record.candidateCount, 1);
    const modelCount = Object.keys(record.distinctModels).length;
    const high = explicit.length > 0 ||
      (record.candidateCount >= 5 && lowShare >= 0.70) ||
      (record.candidateCount >= 8 && modelCount >= 2 && lowShare >= 0.55) ||
      (itemRefs >= 15 && lowShare >= 0.50);
    const medium = !high && (flags.length >= 2 || (record.candidateCount >= 4 && lowShare >= 0.50) || (record.candidateCount >= 6 && modelCount >= 2));

    state.items[item.id] = { ...prior, lastSeenAt: now.toISOString(), lastPrice: item.price, seller, sellerFound: true, flags };
    if (!high && !medium) continue;
    if (record.lastAlertAt && Date.now() - Date.parse(record.lastAlertAt) < 12 * 3600000) continue;

    record.lastAlertAt = now.toISOString();
    observations.push({
      level: high ? '🔴 HIGH' : '🟠 MEDIUM', seller, model: search.name, price: item.price,
      url: item.url, flags: flags.length ? flags : ['Suspicious seller pattern detected'], candidateCount: record.candidateCount,
      lowShare, modelCount
    });

    if (observations.length >= 5) break;
  }
  if (observations.length >= 5) break;
}

observations.sort((a,b) => (a.level.includes('HIGH') ? -1 : 1) - (b.level.includes('HIGH') ? -1 : 1));
for (const d of observations.slice(0,5)) await send(webhook, d);

await fs.writeFile(STATE_URL, JSON.stringify(state, null, 2) + '\n');
console.log(`Seller risk complete. Scanned ${scanned}, extracted ${sellerFound} sellers, sent ${observations.length} alert(s).`);

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function extractItems(html) {
  const out = new Map();
  const re = /href=["'](\/items\/([0-9]+)(?:-[^"']*)?)[^"']*["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const path = m[1].split('?')[0];
    const id = m[2];
    const context = html.slice(m.index, m.index + 6000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const pm = context.match(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    if (!pm) continue;
    const title = decodeHtml(path.replace(/^\/items\/[0-9]+-?/, '').replace(/-/g, ' ').trim());
    out.set(id, { id, title, price: Number(pm[1]), url: `https://www.vinted.co.uk${path}` });
  }
  return [...out.values()].slice(0, 70);
}

function extractSeller(html) {
  const patterns = [
    /"username"\s*:\s*"([^"]+)"/ig,
    /"login"\s*:\s*"([^"]+)"/ig,
    /"seller"\s*:\s*\{[^}]*"username"\s*:\s*"([^"]+)"/ig,
    /"user"\s*:\s*\{[^}]*"login"\s*:\s*"([^"]+)"/ig,
    /"seller"\s*:\s*\{[^}]*"login"\s*:\s*"([^"]+)"/ig
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1] && !/^vinted$/i.test(m[1])) return m[1];
  }
  return null;
}

function decodeHtml(s) { return s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>'); }

async function send(url, d) {
  const body = { username: "Dan's Vault Seller Risk", embeds: [{
    title: '🛡️ SELLER RISK ALERT',
    description: `**${d.level}**\n\n👤 **Seller:** ${d.seller}\n👟 **Model:** ${d.model}\n💷 **Observed price:** £${d.price.toFixed(2)}\n\n${d.flags.map(x => `⚠️ ${x}`).join('\n')}\n\n📊 **Candidate listings observed:** ${d.candidateCount}\n📉 **Low-price share:** ${(d.lowShare * 100).toFixed(0)}%\n🧩 **Models observed:** ${d.modelCount ?? 1}\n\n*Screening signal only — not proof of fraud or counterfeit stock.*`,
    url: d.url,
    color: d.level.includes('HIGH') ? 15158332 : d.level.includes('TEST') ? 3447003 : 16753920,
    footer: { text: "Dan's Vault • Seller Risk" }, timestamp: new Date().toISOString()
  }] };
  const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  if (!r.ok) throw new Error(`Discord webhook HTTP ${r.status}`);
}

async function loadState() {
  try { return JSON.parse(await fs.readFile(STATE_URL, 'utf8')); }
  catch { return { sellers: {}, items: {} }; }
}
