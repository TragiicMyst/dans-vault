const webhook = process.env.DISCORD_WINTER_FLIPS_WEBHOOK_URL;
if (!webhook) throw new Error('Missing DISCORD_WINTER_FLIPS_WEBHOOK_URL');

const body = {
  username: "Dan's Vault Winter Flips",
  embeds: [{
    title: '🧥 VINTED WINTER FLIPS • TEST ALERT',
    description:
      '✅ Dedicated Winter Flips channel connected.\n\n' +
      'This radar is configured for **Vinted UK only** and only considers **New with tags** or **New without tags** winter resale opportunities.\n\n' +
      '**Alert format**\n' +
      '🟢 Vinted listing\n' +
      '🖼️ First/main listing photo\n' +
      '🏷️ Buy price\n' +
      '📈 Conservative resale estimate\n' +
      '💰 Estimated net profit\n' +
      '📊 ROI + FlipScore\n' +
      '💷 Vinted active-price signal\n' +
      '🧠 Model confidence\n' +
      '🛡️ Counterfeit risk gate',
    color: 3066993,
    footer: { text: "Dan's Vault • Winter Flips • Vinted only" },
    timestamp: new Date().toISOString()
  }]
};

const response = await fetch(`${webhook}?wait=true`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});
if (!response.ok) throw new Error(`Discord HTTP ${response.status}`);
console.log('Vinted Winter Flips test alert sent successfully.');
