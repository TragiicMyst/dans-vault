import fs from 'node:fs/promises';

const CONFIG = JSON.parse(await fs.readFile(new URL('./config.json', import.meta.url), 'utf8'));
const STATE_URL = new URL('./seller-risk-state.json', import.meta.url);
const state = await loadState();
const webhook = process.env.DISCORD_SELLER_RISK_WEBHOOK_URL;
if (!webhook) throw new Error('Missing DISCORD_SELLER_RISK_WEBHOOK_URL secret');

const UA = 'Mozilla/5.0 (compatible; DansVaultSellerRisk/1.0; +https://github.com/TragiicMyst/dans-vault)';
const now = new Date().toISOString();
let alerts = 0;

for (const search of CONFIG.searches) {
  const html = await fetchText(search.buyUrl);
  for (const item of extractItems(html)) {
    const prior = state.items[item.id];
    if (prior && Date.now() - Date.parse(prior.lastSeenAt) < 24 * 3600000) continue;
    const page = await fetchText(item.url).catch(() => '');
    const seller = extractSeller(page);
    if (!seller) continue;

    const flags = [];
    const title = item.title.toLowerCase();
    if (/1:1|replica|fake|counterfeit|ua\b|mirror|pk batch|rep\b/.test(title)) flags.push('Suspicious authenticity wording');
    if (item.price <= (CONFIG.models[search.name]?.baselineResale ?? 70) * 0.5) flags.push('Very low price');
    const itemCount = (page.match(/\/items\/[0-9]+/g) || []).length;
    if (itemCount >= 10) flags.push(`${itemCount} item references visible`);

    const record = state.sellers[seller] ?? { candidateCount: 0, lowPriceCount: 0, flags: 0, lastAlertAt: null };
    record.candidateCount += 1;
    if (item.price <= (CONFIG.models[search.name]?.baselineResale ?? 70) * 0.5) record.lowPriceCount += 1;
    record.flags += flags.length;
    record.lastSeenAt = now;
    state.sellers[seller] = record;

    const lowShare = record.lowPriceCount / Math.max(record.candidateCount, 1);
    const high = flags.length >= 2 || (record.candidateCount >= CONFIG.sellerRisk.suspiciousCandidateCount && lowShare >= CONFIG.sellerRisk.suspiciousLowPriceShare);
    const medium = !high && (flags.length === 1 || record.candidateCount >= 3);
    if (!high && !medium) continue;
    if (record.lastAlertAt && Date.now() - Date.parse(record.lastAlertAt) < 24 * 3600000) continue;

    record.lastAlertAt = now;
    await send(webhook, {
      level: high ? '🔴 HIGH' : '🟠 MEDIUM',
      seller,
      model: search.name,
      price: item.price,
      url: item.url,
      flags,
      candidateCount: record.candidateCount,
      lowShare
    });
    alerts += 1;
    if (alerts >= 5) break;
  }
  if (alerts >= 5) break;
}

await fs.writeFile(STATE_URL, JSON.stringify(state, null, 2) + '\n');
console.log(`Seller risk complete. Sent ${alerts} alert(s).`);

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
    const context = html.slice(m.index, m.index + 5000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const pm = context.match(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    if (!pm) continue;
    const title = path.replace(/^\/items\/[0-9]+-?/, '').replace(/-/g, ' ').trim();
    out.set(id, { id, title, price: Number(pm[1]), url: `https://www.vinted.co.uk${path}` });
  }
  return [...out.values()].slice(0, 50);
}

function extractSeller(html) {
  for (const re of [/"username":"([^"]+)"/i, /"seller":\{"username":"([^"]+)"/i, /"user":\{"login":"([^"]+)"/i]) {
    const m = html.match(re); if (m?.[1]) return m[1];
  }
  return null;
}

async function send(url, d) {
  const body = { username: "Dan's Vault Seller Risk", embeds: [{
    title: '🛡️ SELLER RISK ALERT',
    description: `**${d.level}**\n\n👤 **Seller:** ${d.seller}\n👟 **Model:** ${d.model}\n💷 **Observed price:** £${d.price.toFixed(2)}\n\n${d.flags.length ? d.flags.map(x => `⚠️ ${x}`).join('\n') : '⚠️ Suspicious seller pattern detected'}\n\n📊 **Candidates observed:** ${d.candidateCount}\n📉 **Low-price share:** ${(d.lowShare * 100).toFixed(0)}%\n\n*This is a screening signal, not proof the seller is fraudulent.*`,
    url: d.url,
    color: d.level.includes('HIGH') ? 15158332 : 16753920,
    footer: { text: "Dan's Vault • Seller Risk" },
    timestamp: new Date().toISOString()
  }] };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Discord webhook HTTP ${r.status}`);
}

async function loadState() {
  try { return JSON.parse(await fs.readFile(STATE_URL, 'utf8')); }
  catch { return { sellers: {}, items: {} }; }
}
