const webhook = process.env.DISCORD_WINTER_FLIPS_WEBHOOK_URL;
if (!webhook) throw new Error('Missing DISCORD_WINTER_FLIPS_WEBHOOK_URL');

const body = {
  username: "Dan's Vault Winter Flips",
  embeds: [{
    title: '🧥 WINTER FLIPS • TEST ALERT',
    description:
      '✅ Dedicated Winter Flips channel connected.\n\n' +
      'This radar is configured to scan **Vinted + eBay together** and only send high-scoring winter resale opportunities into this channel.\n\n' +
      '**Example alert format**\n' +
      '🟢 Vinted / 🔵 eBay\n' +
      '🏷️ Buy price\n' +
      '📈 Conservative resale estimate\n' +
      '💰 Estimated net profit\n' +
      '📊 ROI + FlipScore\n' +
      '🌐 Cross-market price signal\n' +
      '🧠 Model confidence\n' +
      '🛡️ Counterfeit risk gate',
    color: 3066993,
    footer: { text: "Dan's Vault • Winter Flips • Dedicated channel" },
    timestamp: new Date().toISOString()
  }]
};

const response = await fetch(`${webhook}?wait=true`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});
if (!response.ok) throw new Error(`Discord HTTP ${response.status}`);
console.log('Winter Flips test alert sent successfully.');
