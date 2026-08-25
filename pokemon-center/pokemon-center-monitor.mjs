import fs from 'node:fs';

const STATE_PATH = 'pokemon-center/state.json';
const WEBHOOK = process.env.POKEMON_CENTRE_WEBHOOK_URL || '';
const BASE = 'https://www.pokemoncenter.com';
const APP_ID = process.env.POKEMON_CENTER_ALGOLIA_APP_ID || 'VEVTPY1V3R';
const API_KEY = process.env.POKEMON_CENTER_ALGOLIA_API_KEY || 'ee47ccc23e7e0fcb1f2a5bddaba9c25b';
const INDEX = process.env.POKEMON_CENTER_ALGOLIA_INDEX || 'prod_products';

const UK_FEEDS = [
  `${BASE}/en-gb/search/pokemon-tcg`,
  `${BASE}/en-gb/search/elite-trainer-box`,
  `${BASE}/en-gb/search/booster-box`,
  `${BASE}/en-gb/search/ultra-premium-collection`
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function score(name, price) {
  const n = String(name || '').toLowerCase();
  let s = 5;
  if (n.includes('pokemon center elite trainer box') || n.includes('pokémon center elite trainer box')) s += 4.4;
  else if (n.includes('elite trainer box')) s += 2.8;
  if (n.includes('ultra-premium collection')) s += 2.4;
  if (n.includes('booster display box') || n.includes('booster box')) s += 1.8;
  if (/30th|anniversary|celebration/.test(n)) s += 1.5;
  if (price && price <= 60) s += 0.5;
  return Math.min(10, Math.round(s * 10) / 10);
}

function parseMoney(text) {
  const m = String(text || '').replace(/,/g, '').match(/£\s?(\d+(?:\.\d{1,2})?)/i);
  return m ? Number(m[1]) : null;
}

function cleanName(s) {
  return String(s || '')
    .replace(/^!\[[^\]]*\]\s*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(image|view product|shop now)$/i, '')
    .trim();
}

function productIdFromUrl(url) {
  const m = String(url).match(/\/en-gb\/product\/([^\/#?]+)/i);
  return m?.[1] || '';
}

function normalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return null;
  if (u.startsWith('/')) u = BASE + u;
  try {
    const p = new URL(u);
    if (!/pokemoncenter\.com$/i.test(p.hostname)) return null;
    if (!/^\/en-gb\/product\//i.test(p.pathname)) return null;
    return `${p.origin}${p.pathname}`;
  } catch {
    return null;
  }
}

function deriveNameFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const slug = parts.slice(3).join(' ');
    return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || productIdFromUrl(url) || 'Pokémon Centre product';
  } catch {
    return 'Pokémon Centre product';
  }
}

function parseReaderProducts(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const out = new Map();
  const linkRe = /\[([^\]]{0,260})\]\((https?:\/\/www\.pokemoncenter\.com\/en-gb\/product\/[^)\s#?]+|\/en-gb\/product\/[^)\s#?]+)[^)]*\)/gi;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const m of line.matchAll(linkRe)) {
      const url = normalizeUrl(m[2]);
      if (!url) continue;
      const context = lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 16)).join(' ');
      let name = cleanName(m[1]);
      if (!name || name.length < 5 || /^image\b/i.test(name)) name = deriveNameFromUrl(url);
      const price = parseMoney(context);
      const soldSignal = /\b(sold out|currently unavailable|out of stock)\b/i.test(context);
      const availableSignal = /\b(add to cart|add to bag|pre-?order|preorder|in stock|available now)\b/i.test(context);
      const sku = productIdFromUrl(url);

      const prev = out.get(url);
      if (!prev) {
        out.set(url, {
          key: sku || url,
          name,
          url,
          sku,
          price,
          soldOut: soldSignal && !availableSignal,
          availabilityKnown: soldSignal || availableSignal,
          availableSignal,
          soldSignal,
          source: 'jina-uk-browser-reader'
        });
      } else {
        if ((!prev.name || prev.name.length < 5) && name) prev.name = name;
        if (prev.price == null && price != null) prev.price = price;
        prev.availableSignal ||= availableSignal;
        prev.soldSignal ||= soldSignal;
        prev.availabilityKnown ||= soldSignal || availableSignal;
        prev.soldOut = prev.soldSignal && !prev.availableSignal;
      }
    }
  }
  return [...out.values()];
}

async function fetchReader(url) {
  const readerUrl = `https://r.jina.ai/${url}`;
  const headerSets = [
    {
      'x-no-cache': 'true',
      'x-cache-tolerance': '0',
      'x-proxy': 'gb',
      'x-locale': 'en-GB',
      'x-referer': `${BASE}/en-gb/`,
      'x-user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    },
    {
      'x-no-cache': 'true',
      'x-cache-tolerance': '0',
      'x-locale': 'en-GB',
      'x-referer': `${BASE}/en-gb/`
    }
  ];

  let last = null;
  for (const headers of headerSets) {
    try {
      const r = await fetch(readerUrl, { headers, signal: AbortSignal.timeout(55000) });
      const text = await r.text();
      if (!r.ok) {
        last = new Error(`Reader HTTP ${r.status}: ${text.slice(0, 160)}`);
        continue;
      }
      if (/access denied|temporarily unavailable|error 17|something went wrong/i.test(text) && !/\/en-gb\/product\//i.test(text)) {
        last = new Error('Reader received Pokemon Centre block/error page');
        continue;
      }
      return text;
    } catch (e) { last = e; }
  }
  throw last || new Error('Reader fetch failed');
}

async function fetchCatalogViaReader() {
  const all = new Map();
  let successfulFeeds = 0;
  for (const feed of UK_FEEDS) {
    try {
      const md = await fetchReader(feed);
      const parsed = parseReaderProducts(md);
      console.log(`UK reader feed ${feed.split('/').pop()}: ${parsed.length} product links`);
      if (parsed.length) successfulFeeds++;
      for (const p of parsed) {
        const prev = all.get(p.key);
        if (!prev) all.set(p.key, p);
        else {
          if (prev.price == null && p.price != null) prev.price = p.price;
          if ((!prev.name || prev.name.length < 5) && p.name) prev.name = p.name;
          prev.availableSignal ||= p.availableSignal;
          prev.soldSignal ||= p.soldSignal;
          prev.availabilityKnown ||= p.availabilityKnown;
          prev.soldOut = prev.soldSignal && !prev.availableSignal;
        }
      }
    } catch (e) {
      console.warn(`UK reader feed failed ${feed}: ${e.message}`);
    }
    await sleep(750);
  }
  if (!successfulFeeds || !all.size) throw new Error('Fresh UK browser-reader feeds returned no products');
  return [...all.values()];
}

function extractApiProducts(data) {
  const candidates = [];
  const walk = (v, depth = 0) => {
    if (depth > 7 || v == null) return;
    if (Array.isArray(v)) {
      if (v.length && v.some(x => x && typeof x === 'object' && (x.productName || x.name || x.title) && (x.url || x.productUrl || x.slug || x.code || x.sku))) {
        candidates.push(...v.filter(x => x && typeof x === 'object'));
      }
      for (const x of v.slice(0, 200)) walk(x, depth + 1);
    } else if (typeof v === 'object') {
      for (const x of Object.values(v)) walk(x, depth + 1);
    }
  };
  walk(data);
  return candidates;
}

function apiProductToRecord(hit) {
  const name = hit?.productName || hit?.name || hit?.title || '';
  let rawUrl = hit?.url || hit?.productUrl || hit?.pdpUrl || hit?.slug || '';
  if (rawUrl && !String(rawUrl).includes('/product/')) {
    const code = hit?.code || hit?.sku || hit?.productId || hit?.id;
    if (code) rawUrl = `/en-gb/product/${code}/${String(rawUrl).replace(/^\/+/, '')}`;
  }
  if (rawUrl && !String(rawUrl).startsWith('http') && !String(rawUrl).startsWith('/en-gb/')) rawUrl = `/en-gb${String(rawUrl).startsWith('/') ? '' : '/'}${rawUrl}`;
  const url = normalizeUrl(rawUrl);
  if (!name || !url) return null;

  const status = String(hit?.stockLevelStatus || hit?.availability || hit?.stock?.stockLevelStatus || hit?.inventoryStatus || '').toLowerCase();
  const sold = hit?.outOfStock === true || /out.?of.?stock|unavailable|sold.?out/.test(status);
  const available = hit?.outOfStock === false || /in.?stock|available|pre.?order/.test(status);
  const price = parseMoney(JSON.stringify(hit)) || (typeof hit?.price === 'number' ? hit.price : null);
  const sku = productIdFromUrl(url) || String(hit?.code || hit?.sku || hit?.productId || hit?.id || '');
  return {
    key: sku || url,
    name,
    url,
    sku,
    price,
    soldOut: sold && !available,
    availabilityKnown: sold || available,
    availableSignal: available,
    soldSignal: sold,
    source: 'pokemon-center-internal-search-api'
  };
}

async function fetchCatalogViaInternalApi() {
  const queries = ['Pokemon TCG', 'Elite Trainer Box', 'Booster Box', 'Ultra-Premium Collection'];
  const endpoints = [
    `${BASE}/en-gb/tpci-ecommweb-api/product-search`,
    `${BASE}/tpci-ecommweb-api/product-search`
  ];
  const out = new Map();
  let ok = 0;

  for (const endpoint of endpoints) {
    for (const q of queries) {
      try {
        const u = new URL(endpoint);
        u.searchParams.set('q', q);
        u.searchParams.set('count', '100');
        u.searchParams.set('offset', '0');
        u.searchParams.set('format', 'nodatalinks');
        const r = await fetch(u, {
          headers: {
            accept: 'application/json',
            'accept-language': 'en-GB,en;q=0.9',
            referer: `${BASE}/en-gb/`,
            'x-application-name': 'tempo',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36'
          },
          signal: AbortSignal.timeout(15000)
        });
        if (!r.ok) {
          console.warn(`Internal API ${r.status} ${u.pathname} q=${q}`);
          continue;
        }
        const data = await r.json();
        const hits = extractApiProducts(data);
        for (const hit of hits) {
          const p = apiProductToRecord(hit);
          if (p) out.set(p.key, p);
        }
        ok++;
      } catch (e) {
        console.warn(`Internal API failed ${endpoint} q=${q}: ${e.message}`);
      }
    }
    if (out.size) break;
  }
  if (!ok || !out.size) throw new Error('Pokemon Centre internal search API unavailable');
  return [...out.values()];
}

function algoliaPrice(hit) {
  const vals = [hit?.priceGBP, hit?.price_gbp, hit?.price?.GBP, hit?.price?.gbp, hit?.price, hit?.salePrice, hit?.listPrice, hit?.formattedPrice];
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const p = parseMoney(v);
    if (p != null) return p;
  }
  return null;
}

async function fetchCatalogViaAlgolia() {
  const host = `${APP_ID.toLowerCase()}-dsn.algolia.net`;
  const params = new URLSearchParams({
    hitsPerPage: '100',
    page: '0',
    facetFilters: JSON.stringify([['productTypeFromCategory:Trading Card Game']]),
    attributesToRetrieve: JSON.stringify(['objectID','productName','name','url','slug','outOfStock','stockLevelStatus','stock','availability','price','priceGBP','price_gbp','salePrice','listPrice','formattedPrice'])
  }).toString();
  const r = await fetch(`https://${host}/1/indexes/*/queries`, {
    method: 'POST',
    headers: { 'x-algolia-application-id': APP_ID, 'x-algolia-api-key': API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ requests: [{ indexName: INDEX, params }] }),
    signal: AbortSignal.timeout(12000)
  });
  if (!r.ok) throw new Error(`Algolia HTTP ${r.status}`);
  const j = await r.json();
  const hits = j?.results?.[0]?.hits || [];
  const out = [];
  for (const hit of hits) {
    const name = hit?.productName || hit?.name || '';
    let rawUrl = hit?.url || (hit?.slug ? `/en-gb/product/${hit.slug}` : '');
    if (rawUrl && !String(rawUrl).startsWith('http') && !String(rawUrl).startsWith('/en-gb/')) rawUrl = `/en-gb${String(rawUrl).startsWith('/') ? '' : '/'}${rawUrl}`;
    const url = normalizeUrl(rawUrl);
    if (!name || !url) continue;
    const status = String(hit?.stockLevelStatus || hit?.stock?.stockLevelStatus || hit?.availability || '');
    const sold = hit?.outOfStock === true || /out.?of.?stock|unavailable/i.test(status);
    const available = hit?.outOfStock === false || /in.?stock|available/i.test(status);
    out.push({
      key: String(hit.objectID || productIdFromUrl(url) || url),
      name,
      url,
      sku: String(hit.objectID || productIdFromUrl(url) || ''),
      price: algoliaPrice(hit),
      soldOut: sold && !available,
      availabilityKnown: sold || available,
      availableSignal: available,
      soldSignal: sold,
      source: 'pokemon-center-public-search-index'
    });
  }
  if (!out.length) throw new Error('Algolia returned zero products');
  return out;
}

async function fetchCatalog() {
  const strategies = [
    ['fresh UK browser reader', fetchCatalogViaReader],
    ['internal product search API', fetchCatalogViaInternalApi],
    ['public search index', fetchCatalogViaAlgolia]
  ];
  const errors = [];
  for (const [name, fn] of strategies) {
    try {
      const products = await fn();
      const known = products.filter(p => p.availabilityKnown).length;
      console.log(`Catalog source selected: ${name}; products=${products.length}; availabilityKnown=${known}`);
      return { products, source: name };
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
      console.warn(`Catalog strategy failed — ${name}: ${e.message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

async function postDiscord(payload) {
  if (!WEBHOOK) throw new Error('POKEMON_CENTRE_WEBHOOK_URL is missing');
  const r = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000)
  });
  if (!r.ok) throw new Error(`Discord HTTP ${r.status}`);
}

async function queueSignal() {
  for (const id of ['pokemoncenter','pokemon','tpci']) {
    const url = `https://${id}.queue-it.net/`;
    try {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
      const location = r.headers.get('location') || '';
      const text = r.status === 200 ? (await r.text()).slice(0, 5000) : '';
      const looksLive = /queue|waiting room|you are in line|eventid|queueit/i.test(text) || /queue-it\.net\/.+/i.test(location);
      if (looksLive && r.status !== 404) return { live: true, url: location || url, status: r.status, id };
    } catch {}
  }
  return { live: false };
}

async function sendProduct(p, type) {
  const rating = score(p.name, p.price);
  await postDiscord({
    username: "Dan's Vault Pokémon Centre UK",
    embeds: [{
      title: `${rating >= 9.5 ? '🔥 FLIP WATCH' : '🟢 HIGH PRIORITY'} — ${type}`,
      description: `**${p.name}**`,
      url: p.url,
      color: rating >= 9.5 ? 0xff3b30 : 0x34c759,
      fields: [
        { name: 'Retail', value: p.price ? `£${p.price.toFixed(2)}` : 'Check Pokémon Centre UK', inline: true },
        { name: 'Stock', value: p.soldOut ? '🔴 Sold out' : '🟢 Available', inline: true },
        { name: 'Opportunity score', value: `${rating}/10`, inline: true },
        { name: 'SKU / ID', value: p.sku || 'Unknown', inline: true }
      ],
      footer: { text: 'Fast stock signal. Check sold comps before buying; score is a filter, not guaranteed profit.' },
      timestamp: new Date().toISOString()
    }]
  });
}

let state = {
  initialized: false,
  products: {},
  updatedAt: null,
  connectedMessageSent: false,
  queueLive: false,
  catalogAvailable: false,
  catalogSource: null
};
try { state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch {}

let products = [];
let catalogAvailable = false;
let catalogError = null;
let catalogSource = null;
try {
  const catalog = await fetchCatalog();
  products = catalog.products;
  catalogSource = catalog.source;
  catalogAvailable = true;
} catch (e) {
  catalogError = String(e?.message || e);
  console.warn(`Catalog unavailable: ${catalogError}`);
}

const queue = await queueSignal();
if (queue.live && !state.queueLive) {
  await postDiscord({
    username: "Dan's Vault Pokémon Centre UK",
    content: `🚨 **POKÉMON CENTRE QUEUE SIGNAL DETECTED**\nA Pokémon Center waiting-room/queue signal appears active. Open Pokémon Centre UK now and check the drop.\n${queue.url}`
  });
}

const next = {
  initialized: state.initialized || catalogAvailable,
  products: catalogAvailable ? {} : (state.products || {}),
  updatedAt: new Date().toISOString(),
  connectedMessageSent: state.connectedMessageSent || false,
  queueLive: queue.live,
  catalogAvailable,
  catalogError,
  catalogSource
};

let alerts = 0;
if (catalogAvailable) {
  for (const p of products) {
    const prev = state.products?.[p.key];
    next.products[p.key] = p;
    if (!state.initialized || !state.catalogAvailable) continue;

    const isNew = !prev;
    const restock = prev?.soldOut === true && p.availabilityKnown && p.soldOut === false;
    const priceDrop = Number.isFinite(prev?.price) && Number.isFinite(p.price) && p.price < prev.price;
    const definitelyAvailable = p.availabilityKnown && p.soldOut === false;

    if (definitelyAvailable && (isNew || restock || priceDrop) && score(p.name, p.price) >= 8.5) {
      const type = restock ? 'RESTOCK' : priceDrop ? `PRICE DROP £${prev.price.toFixed(2)} → £${p.price.toFixed(2)}` : 'NEW PRODUCT';
      await sendProduct(p, type);
      alerts++;
    }
  }
}

if (!state.connectedMessageSent) {
  await postDiscord({
    username: "Dan's Vault Pokémon Centre UK",
    content: catalogAvailable
      ? `✅ Pokémon Centre UK radar connected. ${products.length} UK products baselined via ${catalogSource}; genuine high-priority new listings/restocks will alert here.`
      : `✅ Pokémon Centre UK radar connected. Discord + queue monitoring are live. Product catalogue access is temporarily unavailable, so the monitor is staying healthy instead of failing.`
  });
  next.connectedMessageSent = true;
} else if (catalogAvailable && state.catalogAvailable === false) {
  await postDiscord({
    username: "Dan's Vault Pokémon Centre UK",
    content: `✅ **FULL POKÉMON CENTRE UK PRODUCT MONITORING RESTORED**\n${products.length} products are now tracked via ${catalogSource} for new listings, restocks and price drops.`
  });
}

fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2) + '\n');
console.log(`Pokemon Centre radar completed: catalog=${catalogAvailable ? products.length : 'fallback'}, source=${catalogSource || 'none'}, queue=${queue.live}, alerts=${alerts}`);
