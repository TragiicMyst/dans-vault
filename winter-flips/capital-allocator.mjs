import fs from 'node:fs/promises';

const BASE = new URL('./', import.meta.url);
const webhook = process.env.DISCORD_WINTER_FLIPS_WEBHOOK_URL;
if (!webhook) throw new Error('Missing DISCORD_WINTER_FLIPS_WEBHOOK_URL');

const bankroll = Number(process.argv[2] || 200);
if (!Number.isFinite(bankroll) || bankroll <= 0) throw new Error('Bankroll must be a positive number');

const state = JSON.parse(await fs.readFile(new URL('./state.json', BASE), 'utf8'));
const cutoff = Date.now() - 48 * 3600000;
const recent = (state.opportunities || [])
  .filter(x => Date.parse(x.at || 0) >= cutoff)
  .filter(x => Number(x.buyPrice) > 0 && Number(x.score) >= 82)
  .sort((a, b) => allocationValue(b) - allocationValue(a));

const chosen = [];
const usedModels = new Map();
let spent = 0;
let expectedProfit = 0;

for (const item of recent) {
  const price = Number(item.buyPrice);
  if (spent + price > bankroll) continue;
  const modelCount = usedModels.get(item.modelId) || 0;
  if (modelCount >= 2) continue;
  chosen.push(item);
  spent += price;
  expectedProfit += Number(item.estimatedNetProfit || 0);
  usedModels.set(item.modelId, modelCount + 1);
}

const reserve = bankroll - spent;
const lines = chosen.length
  ? chosen.map((x, i) => `${i + 1}. **${x.title.slice(0, 80)}**\n   ${x.platform} • Buy **£${Number(x.buyPrice).toFixed(2)}** • Score **${x.score}/100** • Est. profit **£${Number(x.estimatedNetProfit).toFixed(2)}**\n   [Open listing](${x.url})`).join('\n\n')
  : 'No recent 82+/100 Winter Flips opportunities fit this bankroll yet.';

const body = {
  username: "Dan's Vault Winter Flips",
  embeds: [{
    title: `💷 CAPITAL ALLOCATOR • £${bankroll.toFixed(0)} BANKROLL`,
    description:
      `${lines}\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `💸 **Suggested deployed capital:** £${spent.toFixed(2)}\n` +
      `🧮 **Estimated combined net profit:** £${expectedProfit.toFixed(2)}\n` +
      `🏦 **Cash reserve:** £${reserve.toFixed(2)}\n\n` +
      `*Uses opportunities detected in the last 48 hours and limits concentration to two units per model. Re-check availability, authenticity and condition before buying.*`,
    color: 3447003,
    footer: { text: "Dan's Vault • Winter Flips • Capital Allocator" },
    timestamp: new Date().toISOString()
  }]
};

const response = await fetch(`${webhook}?wait=true`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});
if (!response.ok) throw new Error(`Discord HTTP ${response.status}`);
console.log(`Capital allocation sent for £${bankroll.toFixed(2)} bankroll.`);

function allocationValue(x) {
  const score = Number(x.score || 0);
  const roi = Math.min(Number(x.roi || 0), 180);
  const profit = Math.min(Number(x.estimatedNetProfit || 0), 80);
  return score * 0.5 + roi * 0.3 + profit * 0.2;
}
