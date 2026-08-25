import fs from 'node:fs';
import vm from 'node:vm';

const STATE_PATH = 'pokemon-center/state.json';
const WEBHOOK = process.env.POKEMON_CENTRE_WEBHOOK_URL || '';
const PC_BASE = 'https://www.pokemoncenter.com';
const HOTSTOCK_BASE = 'https://www.hotstock.io';
const HOTSTOCK_HOME = `${HOTSTOCK_BASE}/uk`;
const MAX_TRACKED_SLUGS = 60;
const FETCH_CONCURRENCY = 6;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function score(name, price, url = '') {
  const n = `${name || ''} ${url || ''}`.toLowerCase();
  let s = 5.0;

  if (/pokemon[- ]center.*elite[- ]trainer[- ]box|pokémon[- ]center.*elite[- ]trainer[- ]box/.test(n)) s += 4.4;
  else if (/elite[- ]trainer[- ]box/.test(n)) s += 2.8;
  else if (/pokemon[- ]center/.test(n)) s += 2.0;

  if (/ultra[- ]premium collection/.test(n)) s += 2.4;
  if (/super[- ]premium collection/.test(n)) s += 2.0;
  if (/booster display box|booster box/.test(n)) s += 1.8;
  if (/30th|anniversary|celebration/.test(n)) s += 1.5;
  if (/prismatic evolutions|scarlet.*violet.*151|destined rivals|ascended heroes/.test(n)) s += 0.5;
  if (Number.isFinite(price) && price <= 60) s += 0.5;

  return Math.min(10, Math.round(s * 10) / 10);
}

function isInterestingPokemon(text) {
  const n = String(text || '').toLowerCase();
  if (!/pokemon|pokémon/.test(n)) return false;
  return /tcg|trading-card|trading card|elite-trainer|elite trainer|booster|premium|collection|151|prismatic|destined|ascended|anniversary|celebration|30th|pokemon-center/.test(n);
}

function htmlDecode(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function productIdFromUrl(url) {
  const match = String(url || '').match(/\/en-gb\/product\/([^\/#?]+)/i);
  return match?.[1] || '';
}

function normalisePokemonCenterUrl(raw) {
  let value = htmlDecode(raw).trim();
  if (!value) return null;

  if (/go\.skimresources\.com/i.test(value)) {
    try {
      const affiliate = new URL(value);
      const target = affiliate.searchParams.get('url');
      if (target) value = target;
    } catch {}
  }

  try {
    const url = new URL(value, PC_BASE);
    if (!/(^|\.)pokemoncenter\.com$/i.test(url.hostname)) return null;
    if (!/^\/en-gb\/product\//i.test(url.pathname)) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function extractNuxtState(html) {
  const match = String(html).match(/<script>window\.__NUXT__=([\s\S]*?)<\/script>/i);
  if (!match) return null;

  let expression = match[1].trim();
  if (expression.endsWith(';')) expression = expression.slice(0, -1);

  try {
    return vm.runInNewContext(expression, Object.create(null), { timeout: 3000 });
  } catch (error) {
    console.warn(`HotStock Nuxt state parse failed: ${error.message}`);
    return null;
  }
}

function objectIdTime(id) {
  const value = String(id || '');
  if (!/^[0-9a-f]{24}$/i.test(value)) return 0;
  const seconds = Number.parseInt(value.slice(0, 8), 16);
  return Number.isFinite(seconds) ? seconds * 1000 : 0;
}

function discoverHotStockCandidates(html) {
  const candidates = new Map();
  const add = (slug, meta = {}) => {
    const clean = String(slug || '').replace(/^\/+|\/$/g, '');
    if (!clean || !isInterestingPokemon(`${meta.name || ''} ${clean}`)) return;
    const previous = candidates.get(clean) || {};
    candidates.set(clean, {
      slug: clean,
      name: meta.name || previous.name || '',
      id: meta.id || previous.id || '',
      homepage: Boolean(meta.homepage || previous.homepage),
      search: Boolean(meta.search || previous.search),
      previous: Boolean(meta.previous || previous.previous)
    });
  };

  for (const match of String(html).matchAll(/(?:https?:\/\/www\.hotstock\.io)?\/uk\/p\/([^"'<>\s?#)]+)/gi)) {
    add(match[1], { homepage: true });
  }

  const nuxt = extractNuxtState(html);
  const groups = [nuxt?.pinia?.products?.recentproducts, nuxt?.pinia?.products?.popularproducts];
  for (const list of groups) {
    if (!Array.isArray(list)) continue;
    for (const product of list) {
      add(product?.slug, { name: product?.name, id: product?._id || product?.id, homepage: true });
    }
  }

  return { candidates, nuxt };
}

async function discoverViaHotStockSearch(nuxt) {
  const apiBase = nuxt?.config?.public?.apiBase;
  const apiSecret = nuxt?.config?.public?.apiSecret;
  if (!apiBase || !apiSecret) {
    console.warn('HotStock public search config unavailable; homepage discovery only.');
    return [];
  }

  // These are the same public search suggestions the HotStock UK browser UI uses.
  const queries = [
    'pokemon center',
    'elite trainer box',
    'pokemon tcg',
    'pokemon 151',
    'prismatic evolutions',
    'booster box',
    'ultra premium collection',
    'pokemon 30th'
  ];

  const found = new Map();
  for (const query of queries) {
    try {
      const response = await fetch(`${apiBase}/api/searchsuggestions/${encodeURIComponent(query)}`, {
        headers: {
          token: String(apiSecret),
          region: 'uk',
          'user-agent': 'Mozilla/5.0 DanVaultPokemonMonitor/2.1'
        },
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) {
        console.warn(`HotStock search '${query}' HTTP ${response.status}`);
        continue;
      }
      const payload = await response.json();
      const results = Array.isArray(payload?.results) ? payload.results : [];
      for (let rank = 0; rank < results.length; rank++) {
        const item = results[rank];
        if (item?.type && item.type !== 'product') continue;
        const slug = String(item?.slug || '').trim();
        if (!slug || !isInterestingPokemon(`${item?.name || ''} ${slug}`)) continue;
        const existing = found.get(slug);
        const candidate = {
          slug,
          name: String(item?.name || ''),
          id: String(item?._id || item?.id || ''),
          rank,
          query
        };
        if (!existing || rank < existing.rank) found.set(slug, candidate);
      }
    } catch (error) {
      console.warn(`HotStock search '${query}' failed: ${error.message}`);
    }
    await sleep(120);
  }

  console.log(`HotStock public search discovery: ${found.size} relevant Pokémon products`);
  return [...found.values()];
}

function findHotStockProductObject(nuxt) {
  const data = nuxt?.data;
  if (!data || typeof data !== 'object') return null;

  for (const value of Object.values(data)) {
    if (value && typeof value === 'object' && Array.isArray(value.productShops)) return value;
  }
  return null;
}

function parsePokemonCenterRowFallback(html, slug) {
  const source = String(html);
  const markerCandidates = ['shoplogo_pokemoncenter', '>Pokemon Center<', '>Pokémon Center<'];
  let marker = -1;
  for (const candidate of markerCandidates) {
    marker = source.toLowerCase().indexOf(candidate.toLowerCase());
    if (marker >= 0) break;
  }
  if (marker < 0) return null;

  const rowStart = source.lastIndexOf('<tr', marker);
  const rowEnd = source.indexOf('</tr>', marker);
  if (rowStart < 0 || rowEnd < 0) return null;
  const row = source.slice(rowStart, rowEnd + 5);

  let directUrl = null;
  for (const hrefMatch of row.matchAll(/href="([^"]+)"/gi)) {
    const candidate = normalisePokemonCenterUrl(hrefMatch[1]);
    if (candidate) {
      directUrl = candidate;
      break;
    }
  }
  if (!directUrl) return null;

  const nameMatch = row.match(/text-cell-productshopname[^>]*>([^<]+)</i);
  const priceMatch = row.match(/£\s*(\d+(?:\.\d{1,2})?)/i);
  const inStock = /button-instock|>\s*IN STOCK\s*</i.test(row);
  const outOfStock = />\s*OUT OF STOCK\s*</i.test(row);

  return {
    key: productIdFromUrl(directUrl) || directUrl,
    name: htmlDecode(nameMatch?.[1] || slug.replace(/-/g, ' ')).trim(),
    url: directUrl,
    sku: productIdFromUrl(directUrl),
    price: priceMatch ? Number(priceMatch[1]) : null,
    soldOut: outOfStock && !inStock,
    availabilityKnown: inStock || outOfStock,
    availableSignal: inStock,
    soldSignal: outOfStock,
    checkedAt: null,
    source: 'hotstock-pokemon-center-uk',
    hotstockSlug: slug,
    hotstockUrl: `${HOTSTOCK_BASE}/uk/p/${slug}`
  };
}

function parseHotStockProduct(html, slug) {
  const nuxt = extractNuxtState(html);
  const product = findHotStockProductObject(nuxt);

  if (product) {
    const shop = product.productShops.find(item => /pokemon\s*center|pokémon\s*center/i.test(`${item?.text || ''} ${item?.ltext || ''}`));
    if (shop) {
      const directUrl = normalisePokemonCenterUrl(shop.productUrl || shop.goUrl || '');
      if (directUrl) {
        const hasStockKnown = typeof shop.hasStock === 'boolean';
        const rawPrice = shop.price;
        const price = rawPrice !== null && rawPrice !== undefined && rawPrice !== '' && Number.isFinite(Number(rawPrice))
          ? Number(rawPrice)
          : null;
        const checkedAt = shop.shopLastCheckedAt || shop.lastCheckedAt || shop.updatedAt || product.updatedAt || null;
        const productName = shop.productName || shop.fallbackProductName || product.name || slug.replace(/-/g, ' ');

        return {
          key: productIdFromUrl(directUrl) || directUrl,
          name: String(productName).trim(),
          url: directUrl,
          sku: productIdFromUrl(directUrl),
          price,
          soldOut: hasStockKnown ? !shop.hasStock : false,
          availabilityKnown: hasStockKnown,
          availableSignal: hasStockKnown ? shop.hasStock : false,
          soldSignal: hasStockKnown ? !shop.hasStock : false,
          checkedAt,
          lastStockChangeAt: shop.hasStockChangedAt || null,
          source: 'hotstock-pokemon-center-uk',
          hotstockSlug: slug,
          hotstockUrl: `${HOTSTOCK_BASE}/uk/p/${slug}`,
          hotstockUpdatedAt: product.updatedAt || null
        };
      }
    }
  }

  return parsePokemonCenterRowFallback(html, slug);
}

async function fetchText(url, timeoutMs = 15000) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 DanVaultPokemonMonitor/2.1',
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-GB,en;q=0.9',
      'cache-control': 'no-cache'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response.text();
}

function priorityForCandidate(candidate) {
  const slug = String(candidate?.slug || '').toLowerCase();
  let priority = 0;

  if (candidate?.homepage) priority += 1000;
  if (candidate?.previous) priority += 700;
  if (candidate?.search) priority += 300;

  if (/pokemon-center/.test(slug)) priority += 600;
  if (/elite-trainer/.test(slug)) priority += 300;
  if (/30th|anniversary|celebration/.test(slug)) priority += 250;
  if (/151|prismatic|destined-rivals|ascended-heroes/.test(slug)) priority += 200;
  if (/ultra-premium|super-premium|premium-collection/.test(slug)) priority += 150;
  if (/booster-box|booster-bundle/.test(slug)) priority += 100;

  const createdAt = objectIdTime(candidate?.id);
  if (createdAt) {
    const ageDays = (Date.now() - createdAt) / 86400000;
    if (ageDays <= 180) priority += 350;
    else if (ageDays <= 365) priority += 250;
    else if (ageDays <= 730) priority += 100;
  }

  if (Number.isFinite(candidate?.rank)) priority += Math.max(0, 80 - candidate.rank);
  return priority;
}

async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function run() {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      try {
        results[current] = await worker(items[current], current);
      } catch (error) {
        results[current] = { error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

async function fetchHotStockCatalog(previousSlugs = []) {
  const homeHtml = await fetchText(HOTSTOCK_HOME, 20000);
  const { candidates, nuxt } = discoverHotStockCandidates(homeHtml);

  for (const slug of previousSlugs) {
    const clean = String(slug || '').trim();
    if (!clean || !isInterestingPokemon(clean)) continue;
    const existing = candidates.get(clean) || { slug: clean };
    candidates.set(clean, { ...existing, previous: true });
  }

  const searchResults = await discoverViaHotStockSearch(nuxt);
  for (const item of searchResults) {
    const existing = candidates.get(item.slug) || { slug: item.slug };
    candidates.set(item.slug, {
      ...existing,
      name: item.name || existing.name || '',
      id: item.id || existing.id || '',
      search: true,
      rank: Number.isFinite(item.rank) ? item.rank : existing.rank
    });
  }

  const selected = [...candidates.values()]
    .filter(candidate => isInterestingPokemon(`${candidate.name || ''} ${candidate.slug}`))
    .sort((a, b) => priorityForCandidate(b) - priorityForCandidate(a) || a.slug.localeCompare(b.slug))
    .slice(0, MAX_TRACKED_SLUGS);
  const slugs = selected.map(candidate => candidate.slug);

  if (!slugs.length) throw new Error('HotStock UK returned no relevant Pokémon product pages');

  console.log(`HotStock UK discovery: candidates=${candidates.size}, checking=${slugs.length}`);

  const results = await mapConcurrent(slugs, FETCH_CONCURRENCY, async slug => {
    const html = await fetchText(`${HOTSTOCK_BASE}/uk/p/${slug}`, 15000);
    const product = parseHotStockProduct(html, slug);
    if (!product) return { slug, product: null };
    return { slug, product };
  });

  const productsByKey = new Map();
  let failed = 0;
  let noPcRetailer = 0;
  for (const result of results) {
    if (result?.error) {
      failed++;
      console.warn(`HotStock product check failed: ${result.error.message}`);
      continue;
    }
    if (!result?.product) {
      noPcRetailer++;
      continue;
    }
    productsByKey.set(result.product.key, result.product);
  }

  const products = [...productsByKey.values()];
  if (!products.length) throw new Error(`HotStock pages loaded but no Pokémon Center UK retailer records found (failed=${failed}, noPc=${noPcRetailer})`);

  const known = products.filter(product => product.availabilityKnown).length;
  const inStock = products.filter(product => product.availabilityKnown && !product.soldOut).length;
  console.log(`HotStock Pokémon Center UK: tracked=${products.length}, availabilityKnown=${known}, inStock=${inStock}, failed=${failed}, noPc=${noPcRetailer}`);

  return {
    products,
    slugs,
    source: 'HotStock UK — Pokémon Center'
  };
}

async function postDiscord(payload) {
  if (!WEBHOOK) throw new Error('POKEMON_CENTRE_WEBHOOK_URL is missing');
  const response = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Discord HTTP ${response.status}`);
}

async function queueSignal() {
  for (const id of ['pokemoncenter', 'pokemon', 'tpci']) {
    const url = `https://${id}.queue-it.net/`;
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
      const location = response.headers.get('location') || '';
      const text = response.status === 200 ? (await response.text()).slice(0, 5000) : '';
      const looksLive = /queue|waiting room|you are in line|eventid|queueit/i.test(text) || /queue-it\.net\/.+/i.test(location);
      if (looksLive && response.status !== 404) return { live: true, url: location || url, status: response.status, id };
    } catch {}
  }
  return { live: false };
}

async function sendProduct(product, type) {
  const rating = score(product.name, product.price, product.url);
  await postDiscord({
    username: "Dan's Vault Pokémon Centre UK",
    embeds: [{
      title: `${rating >= 9.5 ? '🔥 10/10 FLIP WATCH' : '🟢 HIGH PRIORITY'} — ${type}`,
      description: `**${product.name}**`,
      url: product.url,
      color: rating >= 9.5 ? 0xff3b30 : 0x34c759,
      fields: [
        { name: 'Retail', value: Number.isFinite(product.price) ? `£${product.price.toFixed(2)}` : 'Check Pokémon Centre UK', inline: true },
        { name: 'Stock', value: product.soldOut ? '🔴 Sold out' : '🟢 Available', inline: true },
        { name: 'Opportunity score', value: `${rating}/10`, inline: true },
        { name: 'SKU / ID', value: product.sku || 'Unknown', inline: true },
        { name: 'Stock source', value: 'HotStock UK → Pokémon Center', inline: true },
        { name: 'Last checked', value: product.checkedAt ? String(product.checkedAt).slice(0, 19).replace('T', ' ') : 'Live page check', inline: true }
      ],
      footer: { text: 'Independent stock signal. Verify the live Pokémon Centre page and sold comps before buying.' },
      timestamp: new Date().toISOString()
    }]
  });
}

let state = {
  initialized: false,
  products: {},
  hotstockSlugs: [],
  updatedAt: null,
  connectedMessageSent: false,
  queueLive: false,
  catalogAvailable: false,
  catalogSource: null,
  catalogError: null
};
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) };
} catch {}

let catalog = null;
let catalogError = null;
try {
  catalog = await fetchHotStockCatalog(Array.isArray(state.hotstockSlugs) ? state.hotstockSlugs : []);
} catch (error) {
  catalogError = String(error?.message || error);
  console.warn(`Catalog unavailable: ${catalogError}`);
}

const queue = await queueSignal();
if (queue.live && !state.queueLive) {
  await postDiscord({
    username: "Dan's Vault Pokémon Centre UK",
    content: `🚨 **POKÉMON CENTRE QUEUE SIGNAL DETECTED**\nA Pokémon Center waiting-room/queue signal appears active. Open Pokémon Centre UK now and check the drop.\n${queue.url}`
  });
}

const catalogAvailable = Boolean(catalog?.products?.length);
const nextProducts = { ...(state.products || {}) };
const next = {
  ...state,
  initialized: state.initialized || catalogAvailable,
  products: nextProducts,
  hotstockSlugs: catalog?.slugs || state.hotstockSlugs || [],
  updatedAt: new Date().toISOString(),
  queueLive: queue.live,
  catalogAvailable,
  catalogSource: catalog?.source || null,
  catalogError
};

let alerts = 0;
if (catalogAvailable) {
  const now = new Date().toISOString();

  for (const product of catalog.products) {
    const previous = state.products?.[product.key];
    const current = { ...product, lastSeenAt: now };
    next.products[product.key] = current;

    // A first successful HotStock catalogue scan is a baseline, not a flood of alerts.
    if (!state.initialized || !state.catalogAvailable) continue;

    const definitelyAvailable = current.availabilityKnown && current.soldOut === false;
    const isNew = !previous;
    const restock = previous?.availabilityKnown && previous?.soldOut === true && definitelyAvailable;
    const becameKnownAvailable = previous && previous.availabilityKnown === false && definitelyAvailable;
    const priceDrop = Number.isFinite(previous?.price) && Number.isFinite(current.price) && current.price < previous.price;
    const rating = score(current.name, current.price, current.url);

    if (definitelyAvailable && (isNew || restock || becameKnownAvailable || priceDrop) && rating >= 8.5) {
      const type = restock || becameKnownAvailable
        ? 'RESTOCK / AVAILABLE'
        : priceDrop
          ? `PRICE DROP £${previous.price.toFixed(2)} → £${current.price.toFixed(2)}`
          : 'NEW PRODUCT';
      await sendProduct(current, type);
      alerts++;
    }
  }

  // Keep state compact without losing products during short-lived source failures.
  const cutoff = Date.now() - 45 * 24 * 60 * 60 * 1000;
  for (const [key, product] of Object.entries(next.products)) {
    const seen = Date.parse(product?.lastSeenAt || 0);
    if (Number.isFinite(seen) && seen > 0 && seen < cutoff) delete next.products[key];
  }
}

if (!state.connectedMessageSent) {
  await postDiscord({
    username: "Dan's Vault Pokémon Centre UK",
    content: catalogAvailable
      ? `✅ Pokémon Centre UK radar connected. ${catalog.products.length} Pokémon Center UK listings are now baselined via HotStock UK.`
      : '✅ Pokémon Centre UK radar connected. Discord and queue monitoring are live; product stock feed is temporarily unavailable.'
  });
  next.connectedMessageSent = true;
} else if (catalogAvailable && !state.catalogAvailable) {
  await postDiscord({
    username: "Dan's Vault Pokémon Centre UK",
    content: `✅ **FULL POKÉMON CENTRE UK PRODUCT MONITORING RESTORED**\nTracking ${catalog.products.length} Pokémon Center UK products with exact direct purchase URLs and live stock states via HotStock UK.`
  });
}

fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2) + '\n');
console.log(`Pokemon Centre radar completed: catalog=${catalogAvailable ? catalog.products.length : 'fallback'}, source=${catalog?.source || 'none'}, queue=${queue.live}, alerts=${alerts}`);
