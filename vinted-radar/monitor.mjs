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
      const score = dealScore({ item, priceLimit: search.maxPrice, resale, sizeMatch, conditionMatch });

      state.seen.push(item.id);
      if (score < search.minScore || !sizeMatch) continue;

      await sendDiscord(webhook, {
        searchName: search.name,
        title: item.title,
        price: item.price,
        url: item.url,
        resale,
        profit,
        score,
        sizeMatch,
        conditionMatch
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

function dealScore({ item, priceLimit, resale, sizeMatch, conditionMatch }) {
  let score = 5;
  const ratio = priceLimit > 0 ? 1 - item.price / priceLimit : 0;
  score += ratio * 3;
  if (sizeMatch) score += 1;
  if (conditionMatch) score += 1;
  if (resale > item.price) score += Math.min(2, (resale - item.price) / Math.max(resale, 1) * 2);
  return Math.min(10, Number(score.toFixed(1)));
}

async function sendDiscord(webhookUrl, deal) {
  const profitText = deal.profit === null ? 'Unknown' : `£${deal.profit.toFixed(2)}`;
  const body = {
    username: "Dan's Vault Radar",
    embeds: [{
      title: `🔥 ${deal.searchName} bargain`,
      description: `**${deal.title}**\n\n💷 **£${deal.price.toFixed(2)}**  •  📈 Resale **£${deal.resale.toFixed(2)}**  •  💰 Profit **${profitText}**`,
      url: deal.url,
      fields: [
        { name: '⭐ Deal score', value: `**${deal.score}/10**`, inline: true },
        { name: '📏 Size', value: deal.sizeMatch ? 'UK 7–10 match' : 'Check size', inline: true },
        { name: '🆕 Condition', value: deal.conditionMatch ? 'Good match' : 'Check listing', inline: true }
      ],
      footer: { text: 'Manual purchase only • Tap the title to view' },
      timestamp: new Date().toISOString()
    }]
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
