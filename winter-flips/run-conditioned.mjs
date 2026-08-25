const nativeFetch = globalThis.fetch;

const PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml'
};

// Force source-level condition filters before the Winter Flips engine sees results.
// Vinted status IDs: 6 = New with tags, 1 = New without tags.
// eBay condition ID 1000 = New / Brand New.
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
  }

  if ((url.hostname === 'www.ebay.co.uk' || url.hostname === 'ebay.co.uk') && url.pathname.startsWith('/sch/')) {
    url.searchParams.set('LH_ItemCondition', '1000');
  }

  // Enhance Discord deal alerts with the exact listing's first/main image.
  if (isDiscordWebhook(url) && String(init?.method || 'GET').toUpperCase() === 'POST' && typeof init?.body === 'string') {
    const enhanced = await addListingImage(init.body);
    return nativeFetch(url.toString(), { ...init, body: enhanced });
  }

  return nativeFetch(url.toString(), init);
};

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

  const imageUrl = await fetchExactLeadImage(listingUrl);
  if (!imageUrl) return rawBody;

  embed.image = { url: imageUrl };
  return JSON.stringify(body);
}

async function fetchExactLeadImage(listingUrl) {
  try {
    const parsedListing = new URL(listingUrl);
    if (!['www.vinted.co.uk', 'vinted.co.uk', 'www.ebay.co.uk', 'ebay.co.uk'].includes(parsedListing.hostname.toLowerCase())) return null;

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

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

await import('./engine.mjs');
