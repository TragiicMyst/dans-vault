import fs from 'node:fs';
import https from 'node:https';

const STATE_PATH = 'pokemon-center/state.json';
const WEBHOOK = process.env.POKEMON_CENTRE_WEBHOOK_URL || '';
const APP_ID = process.env.POKEMON_CENTER_ALGOLIA_APP_ID || 'VEVTPY1V3R';
const API_KEY = process.env.POKEMON_CENTER_ALGOLIA_API_KEY || 'ee47ccc23e7e0fcb1f2a5bddaba9c25b';
const INDEX = process.env.POKEMON_CENTER_ALGOLIA_INDEX || 'prod_products';
const BASE = 'https://www.pokemoncenter.com';

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

function extractPrice(hit) {
  const vals = [
    hit?.priceGBP, hit?.price_gbp, hit?.price?.GBP, hit?.price?.gbp,
    hit?.price, hit?.salePrice, hit?.listPrice, hit?.formattedPrice,
    hit?.prices?.GBP?.value, hit?.prices?.gbp?.value
  ];
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const m = v.replace(/,/g, '').match(/(?:£|GBP\s*)?(\d+(?:\.\d{1,2})?)/i);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

function inStock(hit) {
  if (hit?.outOfStock === true) return false;
  if (hit?.outOfStock === false) return true;
  const s = hit?.stockLevelStatus || hit?.stock?.stockLevelStatus || hit?.availability || '';
  return /in.?stock|available|low.?stock/i.test(String(s));
}

function productUrl(hit) {
  let p = hit?.url || hit?.productUrl || '';
  if (p.startsWith('http')) {
    try { p = new URL(p).pathname; } catch {}
  }
  if (!p && hit?.slug) p = `/product/${hit.slug}`;
  if (!p) return null;
  if (!p.startsWith('/')) p = `/${p}`;
  if (/^\/product\//i.test(p)) p = `/en-gb${p}`;
  if (!/^\/en-[a-z]{2}\//i.test(p) && !/^\/en-gb\//i.test(p)) p = `/en-gb${p}`;
  return `${BASE}${p.split('?')[0]}`;
}

function isUKHit(hit) {
  const values = [hit?.locale, hit?.market, hit?.country, hit?.currency, hit?.site, hit?.region]
    .filter(Boolean).map(v => String(v).toLowerCase());
  if (!values.length) return true;
  if (values.some(v => /gb|uk|en-gb|gbr|gbp|united kingdom/.test(v))) return true;
  if (values.some(v => /us|usa|en-us|usd|canada|ca|cad/.test(v))) return false;
  return true;
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

async function resolveWithDoh(host) {
  const providers = [
    `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`,
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`
  ];
  let last = null;
  for (const url of providers) {
    try {
      const headers = url.includes('cloudflare') ? { accept: 'application/dns-json' } : { accept: 'application/json' };
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`DoH HTTP ${r.status}`);
      const j = await r.json();
      const ips = (j.Answer || []).filter(a => a.type === 1 && /^\d+\.\d+\.\d+\.\d+$/.test(a.data)).map(a => a.data);
      if (ips.length) return ips;
      last = new Error(`DoH returned no A records for ${host}`);
    } catch (e) { last = e; }
  }
  throw last || new Error(`Unable to resolve ${host}`);
}

function httpsPostViaIp(host, ip, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: ip,
      servername: host,
      method: 'POST',
      path,
      headers: { ...headers, host, 'content-length': Buffer.byteLength(body) },
      timeout: 12000,
      rejectUnauthorized: true
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('HTTPS timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function algoliaRequest(host, body) {
  const path = '/1/indexes/*/queries';
  const headers = {
    'x-algolia-application-id': APP_ID,
    'x-algolia-api-key': API_KEY,
    'content-type': 'application/json'
  };

  try {
    const r = await fetch(`https://${host}${path}`, {
      method: 'POST', headers, body, signal: AbortSignal.timeout(12000)
    });
    const text = await r.text();
    return { status: r.status, text, route: 'normal-dns' };
  } catch (normalErr) {
    console.warn(`Normal DNS failed for ${host}: ${normalErr?.cause?.code || normalErr.message}`);
  }

  const ips = await resolveWithDoh(host);
  let last = null;
  for (const ip of ips.slice(0, 3)) {
    try {
      const r = await httpsPostViaIp(host, ip, path, headers, body);
      return { ...r, route: `doh:${ip}` };
    } catch (e) { last = e; }
  }
  throw last || new Error(`All resolved IPs failed for ${host}`);
}

async function algoliaPage(page) {
  const id = APP_ID.toLowerCase();
  const hosts = [
    `${id}-dsn.algolia.net`,
    `${id}.algolia.net`,
    `${id}-1.algolianet.com`,
    `${id}-2.algolianet.com`,
    `${id}-3.algolianet.com`
  ];
  const params = new URLSearchParams({
    hitsPerPage: '100',
    page: String(page),
    facetFilters: JSON.stringify([['productTypeFromCategory:Trading Card Game']]),
    attributesToRetrieve: JSON.stringify([
      'objectID','productName','name','url','productUrl','slug','outOfStock','stockLevelStatus','stock','availability',
      'price','priceGBP','price_gbp','salePrice','listPrice','formattedPrice','prices','currency','locale','market','country','site','region','category','productTypeFromCategory'
    ])
  }).toString();
  const body = JSON.stringify({ requests: [{ indexName: INDEX, params }] });
  let last = null;

  for (const host of hosts) {
    try {
      const r = await algoliaRequest(host, body);
      if (r.status < 200 || r.status >= 300) {
        last = new Error(`${host} HTTP ${r.status}: ${r.text.slice(0, 180)}`);
        console.warn(last.message);
        continue;
      }
      const j = JSON.parse(r.text);
      const result = j?.results?.[0];
      if (!result || !Array.isArray(result.hits)) {
        last = new Error(`${host} invalid response`);
        continue;
      }
      console.log(`Pokemon catalog source OK via ${host} (${r.route})`);
      return result;
    } catch (e) {
      last = e;
      console.warn(`Catalog host failed ${host}: ${e.message}`);
    }
  }
  throw last || new Error('No Pokemon catalog host reachable');
}

async function fetchCatalog() {
  const out = new Map();
  let page = 0, pages = 1;
  while (page < pages && page < 25) {
    const r = await algoliaPage(page);
    pages = Math.max(1, Number(r.nbPages || 1));
    for (const hit of r.hits) {
      if (!isUKHit(hit)) continue;
      const name = hit?.productName || hit?.name || '';
      const url = productUrl(hit);
      if (!name || !url) continue;
      const key = String(hit.objectID || url);
      out.set(key, {
        key,
        name,
        url,
        sku: String(hit.objectID || ''),
        price: extractPrice(hit),
        soldOut: !inStock(hit),
        source: 'pokemon-center-public-search-index'
      });
    }
    page++;
  }
  if (!out.size) throw new Error('Catalog returned zero UK TCG products');
  return [...out.values()];
}

async function queueSignal() {
  const ids = ['pokemoncenter','pokemon','tpci'];
  for (const id of ids) {
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
      footer: { text: 'Fast stock signal. Check resale sold comps before buying.' },
      timestamp: new Date().toISOString()
    }]
  });
}

let state = { initialized: false, products: {}, updatedAt: null, connectedMessageSent: false, queueLive: false, catalogAvailable: false };
try { state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch {}

let products = [];
let catalogAvailable = false;
let catalogError = null;
try {
  products = await fetchCatalog();
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
  catalogError
};

let alerts = 0;
if (catalogAvailable) {
  for (const p of products) {
    const prev = state.products?.[p.key];
    next.products[p.key] = p;
    if (!state.initialized || !state.catalogAvailable) continue;
    const isNew = !prev;
    const restock = prev?.soldOut === true && p.soldOut === false;
    const priceDrop = Number.isFinite(prev?.price) && Number.isFinite(p.price) && p.price < prev.price;
    if (!p.soldOut && (isNew || restock || priceDrop) && score(p.name, p.price) >= 8.5) {
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
      ? `✅ Pokémon Centre UK radar connected. ${products.length} UK TCG products baselined; genuine new listings/restocks will now alert here.`
      : `✅ Pokémon Centre UK radar connected. Discord + queue monitoring are live. Product catalogue access is temporarily unavailable, so the monitor is staying healthy instead of failing.`
  });
  next.connectedMessageSent = true;
} else if (catalogAvailable && state.catalogAvailable === false) {
  await postDiscord({
    username: "Dan's Vault Pokémon Centre UK",
    content: `✅ **FULL POKÉMON CENTRE UK PRODUCT MONITORING RESTORED**\n${products.length} TCG products are now being tracked for new listings, restocks and price drops.`
  });
}

fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2) + '\n');
console.log(`Pokemon Centre radar completed: catalog=${catalogAvailable ? products.length : 'fallback'}, queue=${queue.live}, alerts=${alerts}`);
