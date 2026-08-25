import fs from 'node:fs';

const BASE = 'https://www.pokemoncenter.com';
const STATE_PATH = 'pokemon-center/state.json';
const WEBHOOK = process.env.POKEMON_CENTRE_WEBHOOK_URL || '';
const SEARCHES = [
  '/en-gb/search/pokemon-tcg',
  '/en-gb/search/elite-trainer-box',
  '/en-gb/search/booster-box',
  '/en-gb/search/ultra-premium-collection'
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => s.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();

function score(name, price) {
  const n = name.toLowerCase();
  let s = 5.0;
  if (n.includes('pokemon center elite trainer box')) s += 4.4;
  else if (n.includes('elite trainer box')) s += 2.8;
  if (n.includes('ultra-premium collection')) s += 2.4;
  if (n.includes('booster display box')) s += 1.8;
  if (/30th|anniversary|celebration/.test(n)) s += 1.5;
  if (price && price <= 60) s += 0.5;
  return Math.min(10, Math.round(s * 10) / 10);
}

function parseProducts(html) {
  const out = new Map();
  const re = /href=["'](\/en-gb\/product\/[^"']+)["']/gi;
  for (const m of html.matchAll(re)) {
    const href = m[1];
    const start = Math.max(0, m.index - 900);
    const end = Math.min(html.length, m.index + 1800);
    const chunk = html.slice(start, end);
    const text = strip(chunk);
    const productPath = href.split('?')[0];
    const slug = productPath.split('/').pop()?.replace(/-/g,' ') || 'Pokemon product';
    const titleMatch = text.match(/Pokémon TCG:[^£]{3,180}/i) || text.match(/Pokemon TCG:[^£]{3,180}/i);
    const name = (titleMatch?.[0] || slug).replace(/\s+(SOLD OUT|NEW|PREORDER).*$/i,'').trim();
    const p = text.match(/£\s?(\d+(?:\.\d{2})?)/);
    const price = p ? Number(p[1]) : null;
    const soldOut = /SOLD OUT/i.test(text.slice(0, 900));
    const sku = (text.match(/SKU[:\s]+([A-Z0-9-]+)/i) || [])[1] || null;
    const key = productPath;
    if (!out.has(key)) out.set(key, { key, name, price, soldOut, sku, url: BASE + productPath });
  }
  return [...out.values()];
}

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 DanVaultPokemonMonitor/1.0', 'accept-language': 'en-GB,en;q=0.9' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
}

async function notify(p, type) {
  if (!WEBHOOK) return;
  const rating = score(p.name, p.price);
  const hot = rating >= 9.5 ? '🔥 10/10 FLIP WATCH' : rating >= 8.5 ? '🟢 HIGH PRIORITY' : '🔔 RESTOCK';
  const payload = {
    username: "Dan's Vault Pokémon Centre UK",
    embeds: [{
      title: `${hot} — ${type}`,
      description: `**${p.name}**`,
      url: p.url,
      color: rating >= 9.5 ? 0xff3b30 : 0x34c759,
      fields: [
        { name: 'Retail', value: p.price ? `£${p.price.toFixed(2)}` : 'Check site', inline: true },
        { name: 'Stock', value: p.soldOut ? '🔴 Sold out' : '🟢 Available', inline: true },
        { name: 'Resale score', value: `${rating}/10`, inline: true },
        { name: 'SKU', value: p.sku || 'Not parsed', inline: true }
      ],
      footer: { text: 'Heuristic resale score — verify sold prices before buying.' },
      timestamp: new Date().toISOString()
    }]
  };
  const r = await fetch(WEBHOOK, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload) });
  if (!r.ok) throw new Error(`Discord ${r.status}`);
}

let state = { initialized:false, products:{}, updatedAt:null };
try { state = JSON.parse(fs.readFileSync(STATE_PATH,'utf8')); } catch {}

const found = new Map();
let success = 0;
for (const path of SEARCHES) {
  try {
    const html = await get(BASE + path);
    for (const p of parseProducts(html)) found.set(p.key, p);
    success++;
  } catch (e) {
    console.error('search failed', path, e.message);
  }
  await sleep(1200);
}
if (!success) throw new Error('All Pokémon Center searches failed');

const next = { initialized:true, products:{}, updatedAt:new Date().toISOString() };
for (const p of found.values()) {
  const prev = state.products?.[p.key];
  next.products[p.key] = p;
  if (!state.initialized) continue;
  const isNew = !prev;
  const restocked = prev?.soldOut === true && p.soldOut === false;
  const priceDrop = prev?.price && p.price && p.price < prev.price;
  if ((isNew && !p.soldOut) || restocked || priceDrop) {
    const rating = score(p.name, p.price);
    if (rating >= 8.5) {
      const type = restocked ? 'RESTOCK' : priceDrop ? `PRICE DROP £${prev.price.toFixed(2)} → £${p.price.toFixed(2)}` : 'NEW PRODUCT';
      await notify(p, type);
      console.log('ALERT', type, rating, p.name, p.url);
    }
  }
}
fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2) + '\n');
console.log(`Pokémon Center scan complete: ${found.size} products, ${success}/${SEARCHES.length} searches successful.`);
