const crypto = require('node:crypto');

const PUBLIC_KEY = 'f89a82f1d12ad7dbbcf0fbfe1ac733dcc03fb9ee3765db58e46e2b31d3ce115';
const CONFIG_URL = 'https://raw.githubusercontent.com/TragiicMyst/dans-vault/main/vinted-radar/config.json';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const raw = await readRawBody(req);
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];

    if (!signature || !timestamp || !verifyDiscordSignature(signature, timestamp, raw)) {
      return res.status(401).json({ error: 'Invalid request signature' });
    }

    const interaction = JSON.parse(raw.toString('utf8'));

    if (interaction.type === 1) return res.status(200).json({ type: 1 });

    if (interaction.type !== 2 || interaction.data?.name !== 'price') {
      return res.status(200).json({ type: 4, data: { content: 'Dan\'s Vault command received, but I don\'t know that command yet.', flags: 64 } });
    }

    const options = Object.fromEntries((interaction.data.options || []).map(o => [o.name, o.value]));
    const modelKey = String(options.model || 'p6000').toLowerCase();
    const model = modelKey === 'p6000' ? 'Nike P-6000' : modelKey === 'vomero' ? 'Nike Vomero' : modelKey === 'tn' ? 'Nike TN' : null;
    const size = Number(options.size ?? 8);
    const buyPrice = Number(options.buy_price ?? 35);

    if (!model || !Number.isFinite(size) || !Number.isFinite(buyPrice) || buyPrice <= 0) {
      return res.status(200).json({ type: 4, data: { content: '⚠️ Use `/price` with a valid model, UK size and buy price.', flags: 64 } });
    }

    const configResponse = await fetch(CONFIG_URL);
    if (!configResponse.ok) throw new Error(`Config fetch HTTP ${configResponse.status}`);
    const config = await configResponse.json();
    const modelConfig = config.models?.[model];
    if (!modelConfig) throw new Error(`Model not configured: ${model}`);

    const baseline = Number(modelConfig.resaleBySize?.[String(size)] ?? modelConfig.baselineResale ?? 0);
    const marketUrl = config.searches?.find(x => x.name === model)?.marketUrl;

    let median = null;
    if (marketUrl) {
      try {
        const marketResponse = await fetch(marketUrl, {
          headers: { 'User-Agent': 'DansVaultDiscordPriceChecker/1.0', 'Accept-Language': 'en-GB,en;q=0.9' }
        });
        const html = await marketResponse.text();
        const prices = [...html.matchAll(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/g)]
          .map(m => Number(m[1]))
          .filter(p => p > 0 && p < 500)
          .sort((a, b) => a - b);
        if (prices.length >= 5) median = prices[Math.floor(prices.length / 2)];
      } catch {}
    }

    const marketEstimate = median ? median * 0.88 : baseline;
    const resale = round2(Math.max(baseline * 0.9, Math.min(baseline * 1.1, baseline * 0.65 + marketEstimate * 0.35)));
    const packaging = config.costs?.packaging ?? 0.8;
    const cleaning = config.costs?.cleaning?.veryGood ?? 0.75;
    const netProfit = round2(resale - buyPrice - packaging - cleaning);
    const roi = round2((netProfit / buyPrice) * 100);
    const marginScore = clamp((netProfit / Math.max(resale, 1)) * 150, 0, 100);
    const roiScore = clamp(roi * 1.15, 0, 100);
    const buyScore = Math.round(clamp(marginScore * 0.45 + roiScore * 0.25 + 100 * 0.20 + 75 * 0.10, 0, 100));
    const verdict = buyScore >= 80 ? '🟢 **BUY**' : buyScore >= 65 ? '🟡 **CONSIDER**' : '🔴 **PASS**';
    const maxBuy = round2(resale - cleaning - packaging - 20);

    const content = [
      '💵 **DAN\'S VAULT PRICE CHECK**',
      '',
      `👟 **${model}** • UK ${size}`,
      `💷 **Buy price:** £${buyPrice.toFixed(2)}`,
      `📈 **Estimated resale:** £${resale.toFixed(2)}`,
      `💰 **Estimated net profit:** £${netProfit.toFixed(2)}`,
      `📊 **ROI:** ${roi.toFixed(1)}%`,
      `🎯 **BUY SCORE:** ${buyScore}/100`,
      `🏷️ **Suggested max buy:** £${Math.max(0, maxBuy).toFixed(2)}`,
      '',
      verdict,
      median ? `📡 Observed market median: £${median.toFixed(2)}` : '📡 Market median: limited data',
      '',
      '⚠️ Estimate only — check condition, authenticity and current sold prices before buying.'
    ].join('\n');

    return res.status(200).json({ type: 4, data: { content, allowed_mentions: { parse: [] } } });
  } catch (error) {
    console.error(error);
    return res.status(200).json({ type: 4, data: { content: '⚠️ Price checker hit an error. Try again in a moment.', flags: 64 } });
  }
};

module.exports.config = { api: { bodyParser: false } };

function verifyDiscordSignature(signature, timestamp, rawBody) {
  const signatureBuffer = Buffer.from(signature, 'hex');
  const publicKey = buildEd25519Key(Buffer.from(PUBLIC_KEY, 'hex'));
  return crypto.verify(null, Buffer.concat([Buffer.from(timestamp), rawBody]), publicKey, signatureBuffer);
}

function buildEd25519Key(rawPublicKey) {
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return crypto.createPublicKey({ key: Buffer.concat([prefix, rawPublicKey]), format: 'der', type: 'spki' });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function round2(n) { return Math.round(n * 100) / 100; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
