import crypto from 'node:crypto';

export const config = { api: { bodyParser: false } };

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function verifyDiscordRequest(body, signature, timestamp) {
  if (!PUBLIC_KEY || !signature || !timestamp) return false;
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(PUBLIC_KEY, 'hex')
      ]),
      format: 'der',
      type: 'spki'
    });
    return crypto.verify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function money(n) { return `£${Number(n).toFixed(2)}`; }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

async function fetchVinted(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DansVaultPriceChecker/1.0)', 'Accept-Language': 'en-GB,en;q=0.9' },
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`Vinted returned HTTP ${response.status}`);
  return response.text();
}

function pricesFromHtml(html) {
  const values = [];
  for (const m of html.matchAll(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/g)) {
    const p = Number(m[1]);
    if (p >= 5 && p <= 250) values.push(p);
  }
  return values;
}

function median(values) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function modelSearch(model) {
  const q = encodeURIComponent(model);
  return `https://www.vinted.co.uk/catalog?search_text=${q}&order=newest_first`;
}

function sellerFromHtml(html) {
  const patterns = [
    /"username":"([^"]+)"/i,
    /"seller":\{"username":"([^"]+)"/i,
    /"user":\{"login":"([^"]+)"/i
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function listingCount(html) {
  return (html.match(/\/items\/[0-9]+/g) || []).length;
}

async function priceCheck(options) {
  const model = options.model || 'Nike P-6000';
  const size = options.size || '8';
  const buy = Number(options.buy_price || 0);
  const html = await fetchVinted(modelSearch(model));
  const prices = pricesFromHtml(html);
  const market = median(prices);
  const conservative = market ? market * 0.88 : 0;
  const expected = market ? clamp(conservative, market * 0.75, market * 0.98) : 0;
  const net = expected - buy - 0.8;
  const roi = buy > 0 ? (net / buy) * 100 : 0;
  const buyScore = buy > 0 && expected > 0 ? clamp(Math.round(((expected - buy) / expected) * 100), 0, 100) : 0;

  return {
    model, size, buy, market, expected, net, roi, buyScore,
    sampleCount: prices.length,
    url: modelSearch(model)
  };
}

async function sellerRisk(url) {
  const html = await fetchVinted(url);
  const seller = sellerFromHtml(html);
  const count = listingCount(html);
  const prices = pricesFromHtml(html);
  const listingPrice = prices.length ? Math.min(...prices) : null;
  let level = '🟢 LOW';
  const reasons = [];
  if (!seller) reasons.push('Seller could not be read from the page');
  if (count >= 10) { level = '🟠 MEDIUM'; reasons.push(`${count} item references visible on the page`); }
  if (listingPrice !== null && listingPrice < 20) { level = '🟠 MEDIUM'; reasons.push('Very low price detected'); }
  if (/1:1|replica|fake|counterfeit|ua\b|mirror/i.test(html)) { level = '🔴 HIGH'; reasons.push('Suspicious authenticity wording detected'); }
  if (!reasons.length) reasons.push('No configured major seller red flags detected');
  return { seller: seller || 'Unknown', level, reasons, listingCount: count, url };
}

function embedForPrice(r) {
  return {
    title: '🏷️ DAN’S VAULT PRICE CHECK',
    description: `**${r.model} • UK ${r.size}**\n\n💷 **Your buy price:** ${money(r.buy)}\n📈 **Market median:** ${r.market ? money(r.market) : 'Unavailable'}\n🎯 **Suggested resale:** ${r.expected ? money(r.expected) : 'Unavailable'}\n💰 **Est. net profit:** ${money(r.net)}\n📊 **ROI:** ${r.roi.toFixed(0)}%\n\n⭐ **BUY SCORE: ${r.buyScore}/100**\n\n*Based on ${r.sampleCount} price observations. This is an estimate, not a guaranteed sale price.*`,
    url: r.url,
    color: r.buyScore >= 80 ? 5763719 : r.buyScore >= 60 ? 16753920 : 15158332,
    footer: { text: "Dan's Vault • Price checker" }
  };
}

function embedForSeller(r) {
  return {
    title: '🛡️ DAN’S VAULT SELLER RISK',
    description: `**Seller:** ${r.seller}\n\n🛡️ **Risk:** **${r.level}**\n\n${r.reasons.map(x => `• ${x}`).join('\n')}\n\n📦 Visible item references: ${r.listingCount}\n\n⚠️ *Risk scoring is a screening tool, not proof that a seller is genuine or fraudulent.*`,
    url: r.url,
    color: r.level.includes('HIGH') ? 15158332 : r.level.includes('MEDIUM') ? 16753920 : 5763719,
    footer: { text: "Dan's Vault • Seller risk" }
  };
}

async function editOriginal(interaction, embed) {
  const appId = interaction.application_id;
  const token = interaction.token;
  await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const bodyBuffer = await rawBody(req);
  const body = bodyBuffer.toString('utf8');
  if (!verifyDiscordRequest(body, req.headers['x-signature-ed25519'], req.headers['x-signature-timestamp'])) {
    return json(res, 401, { error: 'Invalid Discord signature' });
  }

  const interaction = JSON.parse(body);
  if (interaction.type === 1) return json(res, 200, { type: 1 });
  if (interaction.type !== 2) return json(res, 400, { error: 'Unsupported interaction' });

  const command = interaction.data?.name;
  const options = Object.fromEntries((interaction.data?.options || []).map(o => [o.name, o.value]));

  if (command === 'price') {
    res.status(200).json({ type: 5, data: { flags: 64 } });
    try {
      const result = await priceCheck(options);
      await editOriginal(interaction, embedForPrice(result));
    } catch (error) {
      await editOriginal(interaction, { title: '❌ Price check failed', description: error.message, color: 15158332 });
    }
    return;
  }

  if (command === 'seller') {
    res.status(200).json({ type: 5, data: { flags: 64 } });
    try {
      const result = await sellerRisk(options.url);
      await editOriginal(interaction, embedForSeller(result));
    } catch (error) {
      await editOriginal(interaction, { title: '❌ Seller check failed', description: error.message, color: 15158332 });
    }
    return;
  }

  return json(res, 200, { type: 4, data: { content: 'Unknown Dan’s Vault command.' } });
}
