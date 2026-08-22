import fs from 'node:fs/promises';

const CONFIG_PATH = new URL('./config.json', import.meta.url);
const STATE_PATH = new URL('./state.json', import.meta.url);

const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
const state = await loadState();

const webhook = process.env.DISCORD_WEBHOOK_URL;
if (!webhook) {
  console.error('Missing DISCORD_WEBHOOK_URL secret.');
  process.exit(1);
}

const userAgent = 'Mozilla/5.0 (compatible; DansVaultRadar/1.0; +https://github.com/TragiicMyst/dans-vault)';
let alertsSent = 0;

for (const search of config.searches) {
  if (!config.enabled || alertsSent >= config.maxAlertsPerRun) break;

  try {
    const response = await fetch(search.url, {
      headers: {
        'User-Agent': userAgent,
        'Accept-Language': 'en-GB,en;q=0.9'
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      console.warn(`${search.name}: HTTP ${response.status}`);
      continue;
    }

    const html = await response.text();
    const items = extractItems(html);

    for (const item of items) {
      if (alertsSent >= config.maxAlertsPerRun) break;
      if (!item.id || state.seen.includes(item.id)) continue;
      if (!item.price || item.price > search.maxPrice) continue;

      const titleLower = item.title.toLowerCase();
      if (config.avoidKeywords.some((word) => titleLower.includes(word))) continue;

      const sizeMatch = config.sizeKeywords.length === 0 || config.sizeKeywords.some((word) => titleLower.includes(word));
      const conditionMatch = config.goodConditionKeywords.some((word) => titleLower.includes(word));
      const resale = config.resaleEstimates[search.name] ?? 0;
      const profit = resale > 0 ? resale - item.price : null;
      const fakeRisk = fakeRiskLevel({ item, titleLower, resale });
      const score = dealScore({ item, priceLimit: search.maxPrice, resale, sizeMatch, conditionMatch, fakeRisk });

      state.seen.push(item.id);
      if (score < search.minScore || !sizeMatch) continue;

      const imageUrl = await getListingImage(item.url);

      await sendDiscord(webhook, {
        searchName: search.name,
        title: item.title,
        price: item.price,
        url: item.url,
        resale,
        profit,
        score,
        sizeMatch,
        conditionMatch,
        fakeRisk,
        imageUrl
      });
      alertsSent += 1;
    }
  } catch (error) {
    console.warn(`${search.name}: ${error.message}`);
  }
}

state.seen = state.seen.slice(-2000);
await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
console.log(`Radar complete. Sent ${alertsSent} alert(s).`);

function extractItems(html) {
  const found = new Map();
  const itemRegex = /href=["'](\/items\/([0-9]+)(?:-[^"']*)?)["'][^>]*>/gi;
  let match;

  while ((match = itemRegex.exec(html)) !== null) {
    const rawPath = match[1];
    const path = rawPath.split('?')[0];
    const id = match[2];
    const slug = path.replace(/^\/items\/[0-9]+-?/, '').replace(/-/g, ' ').trim();
    const start = match.index;
    const context = stripTags(html.slice(start, Math.min(html.length, start + 4500))).replace(/\s+/g, ' ').trim();
    const priceMatch = context.match(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    if (!priceMatch) continue;

    const title = cleanTitle(slug || 'Nike listing');
    found.set(id, {
      id,
      title,
      price: Number(priceMatch[1]),
      url: `https://www.vinted.co.uk${path}`
    });
  }

  return [...found.values()].slice(0, 40);
}

async function getListingImage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept-Language': 'en-GB,en;q=0.9'
      },
      redirect: 'follow'
    });

    if (!response.ok) return null;
    const html = await response.text();

    const metaPatterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i
    ];

    for (const pattern of metaPatterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeHtmlEntities(match[1]);
    }

    // Fallback: look for a likely Vinted image URL in the listing page.
    const imageMatch = html.match(/https?:\\?\/\\?\/[^"'\\s<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\s<>]*)?/i);
    return imageMatch?.[0] ? decodeHtmlEntities(imageMatch[0]) : null;
  } catch (error) {
    console.warn(`Image lookup failed: ${error.message}`);
    return null;
  }
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/');
}

function cleanTitle(value) {
  return value
    .replace(/\bsize\s+uk\s*\d+(?:\.\d+)?\b.*$/i, '')
    .replace(/\b(fast shipping|quick shipping|free shipping|preloved|very good condition|good condition|new without tags|new with tags)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word)
    .join(' ')
    .slice(0, 120);
}

function stripTags(value) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

function fakeRiskLevel({ item, titleLower, resale }) {
  const redFlags = [
    '1:1', 'ua ', 'rep ', 'replica', 'fake', 'counterfeit', 'not authentic',
    'authentic quality', 'mirror', 'pk batch', 'top quality', 'china'
  ];

  const flagCount = redFlags.filter((word) => titleLower.includes(word)).length;
  const unusuallyCheap = resale > 0 && item.price <= resale * 0.35;

  if (flagCount >= 1 || unusuallyCheap) return '🔴 HIGH';
  if (item.price <= 40 || titleLower.includes('brand new')) return '🟠 MEDIUM';
  return '🟢 LOW';
}

function dealScore({ item, priceLimit, resale, sizeMatch, conditionMatch, fakeRisk }) {
  let score = 5;
  const ratio = priceLimit > 0 ? 1 - item.price / priceLimit : 0;
  score += ratio * 3;
  if (sizeMatch) score += 1;
  if (conditionMatch) score += 1;
  if (resale > item.price) score += Math.min(2, (resale - item.price) / Math.max(resale, 1) * 2);
  if (fakeRisk === '🔴 HIGH') score -= 3;
  if (fakeRisk === '🟠 MEDIUM') score -= 1;
  return Math.min(10, Math.max(0, Number(score.toFixed(1))));
}

async function sendDiscord(webhookUrl, deal) {
  const profitText = deal.profit === null ? 'Unknown' : `£${deal.profit.toFixed(2)}`;
  const riskNote = deal.fakeRisk === '🔴 HIGH'
    ? '⚠️ High fake-risk flags — check photos, labels and code before buying.'
    : '⚠️ Check authenticity before buying.';

  const embed = {
    title: `🚨 NEW BARGAIN FOUND 🔥`,
    description: `**⭐ ${deal.searchName.toUpperCase()}**\n${deal.title}\n\n🏷️ **Price:** £${deal.price.toFixed(2)}\n📏 **Size:** ${deal.sizeMatch ? 'UK 7–10' : 'Check listing'}\n📦 **Condition:** ${deal.conditionMatch ? 'Very good / new match' : 'Check listing'}\n\n📈 **RESELL ESTIMATE**\n**Estimated resale:** £${deal.resale.toFixed(2)}\n**Potential profit:** ${profitText}`,
    url: deal.url,
    color: deal.fakeRisk === '🔴 HIGH' ? 15158332 : deal.fakeRisk === '🟠 MEDIUM' ? 16753920 : 5763719,
    fields: [
      { name: '🎯 DEAL SCORE', value: `**${deal.score}/10**`, inline: true },
      { name: '🛡️ FAKE RISK', value: `**${deal.fakeRisk}**`, inline: true },
      { name: '🇬🇧 MARKET', value: 'UK listing', inline: true }
    ],
    footer: { text: `Dan's Vault Radar • Manual purchase only • ${riskNote}` },
    timestamp: new Date().toISOString()
  };

  if (deal.imageUrl) {
    embed.image = { url: deal.imageUrl };
  }

  const body = {
    username: "Dan's Vault Radar",
    embeds: [embed]
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}`);
}

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));
  } catch {
    return { seen: [] };
  }
}
