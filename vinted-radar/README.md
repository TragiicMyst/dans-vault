# Dan's Vault Vinted Radar

This monitor checks public Vinted catalogue/search pages and sends matching Nike bargains to Discord.

## Safety design

- No Vinted username, password, cookies or account token.
- No automatic purchases.
- No automatic offers, messages, favourites or account actions.
- Discord notification only; you open the listing and decide yourself.

## Setup

1. In Discord, create a private channel for the alerts.
2. Channel Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.
3. In GitHub, open this repository → Settings → Secrets and variables → Actions → New repository secret.
4. Name the secret `DISCORD_WEBHOOK_URL` and paste the webhook URL as the value.
5. Open Actions → **Dan's Vault Vinted Radar** → Run workflow.
6. After that, the workflow is scheduled every 10 minutes. GitHub scheduled jobs can be delayed.

## Filters

Edit `vinted-radar/config.json` to change search URLs, maximum prices, target size keywords, condition keywords and resale estimates.

## Important

Vinted can block automated requests with anti-bot protection. This project does not try to defeat those checks. If a request is blocked, the run logs the HTTP status and does not log into or manipulate your Vinted account.
