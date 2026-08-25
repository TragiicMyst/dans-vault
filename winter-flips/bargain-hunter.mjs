import fs from 'node:fs/promises';

const BASE = new URL('./', import.meta.url);
const STATE_PATH = new URL('./state.json', BASE);
const WEBHOOK = process.env.DISCORD_WINTER_FLIPS_WEBHOOK_URL || '';
const NOW = Date.now();
const MAX_AGE_MS = 20 * 60 * 1000;
const MAX_ALERTS = 3;

if (!WEBHOOK) process.exit(0);

const state = JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));
state.seen ||= {};

const rules = [
  { brand: 'The North Face', terms: ['the north face', 'north face', 'tnf'], max: 40, ultra: 30 },
  { brand: 'Rab', terms: ['rab'], max: 45, ultra: 35 },
  { brand: 'Patagonia', terms: ['patagonia'], max: 50, ultra: 38 },
  { brand: "Arc'teryx", terms: ["arc'teryx", 'arcteryx', 'arc teryx'], max: 70, ultra: 50 },
  { brand: 'Polo Ralph Lauren', terms: ['ralph lauren', 'polo ralph lauren'], max: 35, ultra: 28 },
  { brand: 'Nike', terms: ['nike'], max: 30, ultra: 24 },
  { brand: 'Berghaus', terms: ['berghaus'], max: 25, ultra: 20 },
  { brand: 'Napapijri', terms: ['napapijri'], max: 35, ultra: 28 }
];

const winterTerms = ['puffer', 'down', 'jacket', 'coat', 'parka', 'nuptse', '700', 'himalayan', 'hmlyn', 'baltoro', 'summit', 'microlight', 'neutrino', 'electron', 'cerium', 'thorium', 'rainforest', 'skidoo', 'insulated'];
const rejectTerms = ['baby', 'babies', 'kid ', 'kids', 'child', 'children', 'boys', 'girls', 'junior', 'youth', 'toddler', 'infant', '12y', '11y', '10y', '9y', '8y', '7y', '6y', '5y', '4y', '3y', '2y'];

let sent = 0;
let reviewed = 0;
let skipped = 0;

for (const [key, item] of Object.entries(state.seen)) {
  if (sent >= MAX_ALERTS) break;
  if (!key.startsWith('VINTED:')) continue;
  if (!item?.freshnessSource) continue;
  if (item.alertedAt || item.manualReviewAlertedAt) continue;
  // If the exact-model engine already evaluated it, respect that decision.
  if (item.evaluation) continue;

  const firstSeen = Date.parse(item.firstSeenAt || 0);
  if (!Number.isFinite(firstSeen) || NOW - firstSeen > MAX_AGE_MS) continue;
  if (!['new', 'new-other'].includes(item.condition)) continue;

  const text = normalise(item.title);
  if (rejectTerms.some(term => text.includes(term))) {
    skipped += 1;
    continue;
  }

  const rule = rules.find(r => r.terms.some(term => text.includes(term)));
  if (!rule) continue;

  const price = Number(item.price);
  if (!Number.isFinite(price) || price <= 0) continue;
  const hasWinterTerm = winterTerms.some(term => text.includes(term));
  const limit = hasWinterTerm ? rule.max : rule.ultra;
  if (price > limit) continue;

  reviewed += 1;
  const imageUrl = await fetchLeadImage(item.url).catch(() => null);
  const body = {
    username: "Dan's Vault Winter Flips",
    embeds: [{
      title: '🟡 VINTED • FRESH BAD-LISTING OPPORTUNITY',
      url: item.url,
      description:
        `🧥 **${rule.brand}**\n` +
        `📝 ${item.title}\n\n` +
        `✨ **Condition:** ${item.condition === 'new' ? 'New with tags' : 'New without tags'}\n` +
        `🏷️ **Buy price:** £${price.toFixed(2)}\n` +
        `⚡ **Freshness:** ${item.freshnessSource === 'age' ? 'listed within freshness window' : 'new listing ID since last scan'}\n\n` +
        `🧠 **Why this pinged:** Fresh branded winter listing priced below the manual-review ceiling (£${limit}). The exact model was not confirmed from the title, so check the photos/model/authenticity before buying.\n\n` +
        `➡️ **[VIEW VINTED LISTING](${item.url})**`,
      color: 16763904,
      ...(imageUrl ? { image: { url: imageUrl } } : {}),
      footer: { text: "Dan's Vault • Winter Flips • Fresh manual review" },
      timestamp: new Date().toISOString()
    }]
  };

  const ok = await postDiscord(body).catch(error => {
    console.log(`Manual-review Discord error ${key}: ${error.message}`);
    return false;
  });
  if (!ok) continue;

  item.manualReviewAlertedAt = new Date().toISOString();
  sent += 1;
}

await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
console.log(JSON.stringify({ manualReviewChecked: reviewed, manualReviewAlerts: sent, manualReviewRejectedKids: skipped }, null, 2));

function normalise(value) {
  return String(value || '').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

async function fetchLeadImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139 Safari/537.36',
        'Accept-Language': 'en-GB,en;q=0.9'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) return null;
    const html = await response.text();
    const tags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const tag of tags) {
      const property = attr(tag, 'property').toLowerCase();
      const name = attr(tag, 'name').toLowerCase();
      if (property !== 'og:image' && name !== 'twitter:image') continue;
      let image = attr(tag, 'content').replace(/&amp;/g, '&');
      if (image.startsWith('//')) image = `https:${image}`;
      try {
        const parsed = new URL(image);
        if (parsed.protocol === 'https:' && (parsed.hostname === 'vinted.net' || parsed.hostname.endsWith('.vinted.net'))) return parsed.toString();
      } catch {}
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function attr(tag, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const double = String(tag).match(new RegExp(`${escaped}\\s*=\\s*\"([^\"]*)\"`, 'i'));
  if (double) return double[1];
  const single = String(tag).match(new RegExp(`${escaped}\\s*=\\s*'([^']*)'`, 'i'));
  return single ? single[1] : '';
}

async function postDiscord(body) {
  const response = await fetch(`${WEBHOOK}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return true;
}
