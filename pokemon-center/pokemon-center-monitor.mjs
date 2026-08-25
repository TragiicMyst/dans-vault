import fs from 'node:fs';

const BASE = 'https://www.pokemoncenter.com';
const STATE_PATH = 'pokemon-center/state.json';
const WEBHOOK = process.env.POKEMON_CENTRE_WEBHOOK_URL || '';
const APP_ID = process.env.POKEMON_CENTER_ALGOLIA_APP_ID || 'VEVTPY1V3R';
const API_KEY = process.env.POKEMON_CENTER_ALGOLIA_API_KEY || 'ee47ccc23e7e0fcb1f2a5bddaba9c25b';
const INDEX = process.env.POKEMON_CENTER_ALGOLIA_INDEX || 'prod_products';
const ALGOLIA_URL = `https://${APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`;

function score(name, price) {
  const n = String(name || '').toLowerCase();
  let s = 5.0;
  if (n.includes('pokemon center elite trainer box') || n.includes('pokémon center elite trainer box')) s += 4.4;
  else if (n.includes('elite trainer box')) s += 2.8;
  if (n.includes('ultra-premium collection')) s += 2.4;
  if (n.includes('booster display box') || n.includes('booster box')) s += 1.8;
  if (/30th|anniversary|celebration/.test(n)) s += 1.5;
  if (price && price <= 60) s += 0.5;
  return Math.min(10, Math.round(s * 10) / 10);
}

function extractPrice(hit) {
  const candidates = [
    hit?.priceGBP,
    hit?.price_gbp,
    hit?.price?.GBP,
    hit?.price?.gbp,
    hit?.price,
    hit?.salePrice,
    hit?.listPrice,
    hit?.formattedPrice
  ];
  for (const v of candidates) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const m = v.replace(/,/g, '').match(/(?:£|GBP\s*)?(\d+(?:\.\d{1,2})?)/i);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

function isInStock(hit) {
  if (hit?.outOfStock === true) return false;
  if (hit?.outOfStock === false) return true;
  const status = hit?.stockLevelStatus || hit?.stock?.stockLevelStatus || hit?.availability || '';
  return /in.?stock|available|low.?stock/i.test(String(status));
}

function buildUrl(hit) {
  let path = hit?.url || hit?.productUrl || '';
  if (path.startsWith('http')) {
    try {
      const u = new URL(path);
      path = u.pathname;
    } catch {}
  }
  if (!path && hit?.slug) path = `/product/${hit.slug}`;
  if (!path) return null;
  if (!path.startsWith('/')) path = `/${path}`;
  if (!/^\/en-gb\//i.test(path)) {
    if (/^\/product\//i.test(path)) path = `/en-gb${path}`;
    else if (!/^\/en-[a-z]{2}\//i.test(path)) path = `/en-gb${path}`;
  }
  return BASE + path.split('?')[0];
}

async function queryPage(page) {
  const params = new URLSearchParams({
    hitsPerPage: '100',
    page: String(page),
    facetFilters: JSON.stringify([['productTypeFromCategory:Trading Card Game']]),
    attributesToRetrieve: JSON.stringify([
      'objectID','productName','name','url','productUrl','slug','outOfStock','stockLevelStatus','stock','availability','category','productTypeFromCategory','price','priceGBP','price_gbp','salePrice','listPrice','formattedPrice','currency','locale','market','country'
    ])
  }).toString();

  const r = await fetch(ALGOLIA_URL, {
    method: 'POST',
    headers: {
      'x-algolia-application-id': APP_ID,
      'x-algolia-api-key': API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ requests: [{ indexName: INDEX, params }] })
  });
  if (!r.ok) throw new Error(`Algolia HTTP ${r.status}`);
  const json = await r.json();
  const result = json?.results?.[0];
  if (!result || !Array.isArray(result.hits)) throw new Error('Invalid Algolia response');
  return result;
}

async function fetchCatalog() {
  const found = new Map();
  let page = 0;
  let totalPages = 1;
  while (page < totalPages && page < 25) {
    const result = await queryPage(page);
    totalPages = Math.max(1, Number(result.nbPages || 1));
    for (const hit of result.hits) {
      const name = hit?.productName || hit?.name || '';
      const url = buildUrl(hit);
      if (!name || !url) continue;
      const key = String(hit.objectID || url);
      const price = extractPrice(hit);
      found.set(key, {
        key,
        name,
        price,
        soldOut: !isInStock(hit),
        sku: String(hit.objectID || ''),
        url,
        source: 'pokemon-center-public-search-index'
      });
    }
    page++;
  }
  if (!found.size) throw new Error('Algolia returned zero Pokémon TCG products');
  return [...found.values()];
}

async function postDiscord(payload) {
  if (!WEBHOOK) throw new Error('POKEMON_CENTRE_WEBHOOK_URL is missing');
  const r = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`Discord HTTP ${r.status}`);
}

async function notify(p, type) {
  const rating = score(p.name, p.price);
  const hot = rating >= 9.5 ? '🔥 10/10 FLIP WATCH' : '🟢 HIGH PRIORITY';
  await postDiscord({
    username: "Dan's Vault Pokémon Centre UK",
    embeds: [{
      title: `${hot} — ${type}`,
      description: `**${p.name}**`,
      url: p.url,
      color: rating >= 9.5 ? 0xff3b30 : 0x34c759,
      fields: [
        { name: 'Retail', value: p.price ? `£${p.price.toFixed(2)}` : 'Check Pokémon Centre UK', inline: true },
        { name: 'Stock', value: p.soldOut ? '🔴 Sold out' : '🟢 Available', inline: true },
        { name: 'Resale score', value: `${rating}/10`, inline: true },
        { name: 'SKU / ID', value: p.sku || 'Unknown', inline: true }
      ],
      footer: { text: 'Fast stock signal only — verify exact UK product, price and sold comps before buying.' },
      timestamp: new Date().toISOString()
    }]
  });
}

let state = { initialized: false, products: {}, updatedAt: null, connectedMessageSent: false };
try { state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch {}

const products = await fetchCatalog();
const next = {
  initialized: true,
  products: {},
  updatedAt: new Date().toISOString(),
  connectedMessageSent: state.connectedMessageSent || false
};

let alerts = 0;
for (const p of products) {
  const prev = state.products?.[p.key];
  next.products[p.key] = p;
  if (!state.initialized) continue;

  const isNew = !prev;
  const restocked = prev?.soldOut === true && p.soldOut === false;
  const priceDrop = Number.isFinite(prev?.price) && Number.isFinite(p.price) && p.price < prev.price;
  if (!p.soldOut && (isNew || restocked || priceDrop)) {
    const rating = score(p.name, p.price);
    if (rating >= 8.5) {
      const type = restocked ? 'RESTOCK' : priceDrop ? `PRICE DROP £${prev.price.toFixed(2)} → £${p.price.toFixed(2)}` : 'NEW PRODUCT';
      await notify(p, type);
      alerts++;
      console.log('ALERT', type, rating, p.name, p.url);
    }
  }
}

if (!state.connectedMessageSent) {
  await postDiscord({
    username: "Dan's Vault Pokémon Centre UK",
    content: `✅ Pokémon Centre UK radar connected. Baseline captured: ${products.length} TCG products. Real alerts will fire for qualifying new listings, restocks and price drops.`
  });
  next.connectedMessageSent = true;
}

fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2) + '\n');
console.log(`Pokemon Centre UK scan OK: ${products.length} TCG products tracked, ${alerts} alerts sent.`);
