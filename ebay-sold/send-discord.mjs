import fs from 'node:fs/promises';

const webhook = process.env.DISCORD_EBAY_SOLD_WEBHOOK_URL;
if (!webhook) throw new Error('Missing DISCORD_EBAY_SOLD_WEBHOOK_URL secret');

const { title, description } = JSON.parse(await fs.readFile(new URL('./latest-report.json', import.meta.url), 'utf8'));

const payload = {
  username: "Dan's Vault eBay Sold",
  embeds: [{
    title,
    description,
    color: 3447003,
    footer: { text: "Dan's Vault • eBay Product Research" },
    timestamp: new Date().toISOString()
  }]
};

const r = await fetch(webhook, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
if (!r.ok) throw new Error(`Discord webhook HTTP ${r.status}`);
console.log('eBay sold report sent to Discord.');
