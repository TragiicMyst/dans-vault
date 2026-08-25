const nativeFetch = globalThis.fetch;

const PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml'
};

const ebayImageByUrl = new Map();
let ebayToken = null;
let ebayTokenExpiresAt = 0;

// Source policy:
// Vinted: New with tags (6) + New without tags (1) only.
// eBay: condition ID 1000 (New / Brand New) only.
globalThis.fetch = async (input, init = {}) => {
  let url;
  try {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    url = new URL(raw);
  } catch {
    return nativeFetch(input, init);
  }

  if (url.hostname === 'www.vinted.co.uk' && url.pathname === '/catalog') {
    url.searchParams.delete('status_ids[]');
    url.searchParams.delete('status_ids');
    url.searchParams.append('status_ids[]', '6');
    url.searchParams.append('status_ids[]', '1');
    return nativeFetch(url.toString(), init);
  }

  if ((url.hostname === 'www.ebay.co.uk' || url.hostname === 'ebay.co.uk') && url.pathname.startsWith('/sch/')) {
    const apiResponse = await fetchEbayBrowseAsHtml(url);
    if (apiResponse) return apiResponse;
    url.searchParams.set('LH_ItemCondition', '1000');
    return nativeFetch(url.toString(), init);
  }

  // Enhance Discord deal alerts with the exact listing's first/main image.
  if (isDiscordWebhook(url) && String(init?.method || 'GET').toUpperCase() === 'POST' && typeof init?.body === 'string') {
    const enhanced = await addListingImage(init.body);
    return nativeFetch(url.toString(), { ...init, body: enhanced });
  }

  return nativeFetch(url.toString(), init);
};

async function fetchEbayBrowseAsHtml(searchUrl) {
  const clientId = process.env.EBAY_CLIENT_ID || '';
  const clientSecret = process.env.EBAY_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) return null;

  try {
    const token = await getEbayAppToken(clientId, clientSecret);
    const query = searchUrl.searchParams.get('_nkw') || '';
    const api = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
    api.searchParams.set('q', query);
    api.searchParams.set('limit', '35');
    api.searchParams.set('sort', 'newlyListed');
    api.searchParams.set('filter', 'conditionIds:{1000},buyingOptions:{FIXED_PRICE}');

    const response = await nativeFetch(api.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
        'Accept': 'application/json'
      }
    });
    if (!response.ok) throw new Error(`Browse API HTTP ${response.status}`);

    const data = await response.json();
    const items = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
    return new Response(buildEbaySearchHtml(items), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  } catch (error) {
    console.warn(`eBay Browse API failed: ${error.message}`);
    return null;
  }
}

async function getEbayAppToken(clientId, clientSecret) {
  if (ebayToken && Date.now() < ebayTokenExpiresAt - 60000) return ebayToken;

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await nativeFetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
  });
  if (!response.ok) throw new Error(`OAuth HTTP ${response.status}`);

  const data = await response.json();
  if (!data?.access_token) throw new Error('OAuth response did not include an access token');
  ebayToken = data.access_token;
  ebayTokenExpiresAt = Date.now() + Number(data.expires_in || 7200) * 1000;
  return ebayToken;
}

function buildEbaySearchHtml(items) {
  const rows = [];
  for (const item of items) {
    const price = Number(item?.price?.value);
    const currency = String(item?.price?.currency || '');
    const title = String(item?.title || '').trim();
    const itemUrl = String(item?.itemWebUrl || '').trim();
    if (!title || !itemUrl || !Number.isFinite(price) || price <= 0 || currency !== 'GBP') continue;

    const imageUrl = cleanApiEbayImage(item?.image?.imageUrl || item?.thumbnailImages?.[0]?.imageUrl || '');
    if (imageUrl) ebayImageByUrl.set(normaliseListingUrl(itemUrl), imageUrl);

    const bestOffer = Array.isArray(item?.buyingOptions) && item.buyingOptions.includes('BEST_OFFER');
    rows.push(
      `<li class="s-item">` +
      `<a href="${escapeAttr(itemUrl)}">` +
      `<div class="s-item__title">${escapeHtml(title)}</div>` +
      `<span class="s-item__price">£${price.toFixed(2)}</span>` +
      `<span class="s-item__condition">Brand New</span>` +
      `${bestOffer ? '<span>Best Offer</span>' : ''}` +
      `</a></li>`
    );
  }
  return `<!doctype html><html><body><ul>${rows.join('')}</ul></body></html>`;
}

function isDiscordWebhook(url) {
  const host = url.hostname.toLowerCase();
  return (host === 'discord.com' || host === 'discordapp.com') && url.pathname.includes('/api/webhooks/');
}

async function addListingImage(rawBody) {
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return rawBody;
  }

  const embed = body?.embeds?.[0];
  const listingUrl = embed?.url;
  if (!embed || !listingUrl || embed.image?.url) return rawBody;

  const cachedEbayImage = ebayImageByUrl.get(normaliseListingUrl(listingUrl));
  const imageUrl = cachedEbayImage || await fetchExactLeadImage(listingUrl);
  if (!imageUrl) return rawBody;

  embed.image = { url: imageUrl };
  return JSON.stringify(body);
}

async function fetchExactLeadImage(listingUrl) {
  try {
    const parsedListing = new URL(listingUrl);
    const host = parsedListing.hostname.toLowerCase();
    if (!['www.vinted.co.uk', 'vinted.co.uk', 'www.ebay.co.uk', 'ebay.co.uk'].includes(host)) return null;

    // eBay normally comes from the Browse API image cache above. Avoid page scraping if it is blocked.
    if (host.includes('ebay')) return null;

    const response = await nativeFetch(parsedListing.toString(), {
      headers: PAGE_HEADERS,
      redirect: 'follow'
    });
    if (!response.ok) return null;

    const html = await response.text();
    const image = metaContent(html, 'og:image') || metaContent(html, 'twitter:image');
    return cleanListingImageUrl(image, parsedListing.hostname);
  } catch {
    return null;
  }
}

function metaContent(html, key) {
  const wanted = String(key).toLowerCase();
  const tags = String(html).match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const property = attr(tag, 'property').toLowerCase();
    const name = attr(tag, 'name').toLowerCase();
    if (property !== wanted && name !== wanted) continue;
    const content = attr(tag, 'content');
    if (content) return decodeHtml(content);
  }
  return '';
}

function attr(tag, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`${escaped}\\s*=\\s*\"([^\"]*)\"`, 'i'),
    new RegExp(`${escaped}\\s*=\\s*'([^']*)'`, 'i')
  ];
  for (const pattern of patterns) {
    const match = String(tag).match(pattern);
    if (match) return match[1];
  }
  return '';
}

function cleanListingImageUrl(value, listingHost) {
  if (!value) return null;
  let raw = decodeHtml(String(value).trim());
  if (raw.startsWith('//')) raw = `https:${raw}`;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    const fromVinted = listingHost.includes('vinted') && (host === 'vinted.net' || host.endsWith('.vinted.net'));
    const fromEbay = listingHost.includes('ebay') && (host === 'ebayimg.com' || host.endsWith('.ebayimg.com'));
    if (!fromVinted && !fromEbay) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function cleanApiEbayImage(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value));
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || !(host === 'ebayimg.com' || host.endsWith('.ebayimg.com'))) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normaliseListingUrl(value) {
  try {
    const url = new URL(String(value));
    url.hash = '';
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(value || '');
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

await import('./engine.mjs');
