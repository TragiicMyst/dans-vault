# Dan's Vault Winter Flips Radar

Dedicated winter resale sourcing engine for **Vinted UK only**.

## Discord channel

Create a dedicated Discord channel such as `#winter-flips`, create a webhook for that channel, then add the webhook URL to the GitHub repository Actions secret:

`DISCORD_WINTER_FLIPS_WEBHOOK_URL`

The workflow deliberately does **not** fall back to the normal clothing/trainer webhooks. If this secret is absent, Winter Flips safely skips live sending.

## Source rules

- Vinted only.
- Condition filter is restricted to **New with tags** and **New without tags**.
- Used, very good, good and other conditions are ignored at source level.

## What it does now

- Searches Vinted across exact-model and broad bad-listing-hunter queries.
- Covers The North Face Nuptse/Himalayan/Baltoro/Summit, Rab, Patagonia, Arc'teryx, Ralph Lauren, Nike, Berghaus and Napapijri winter stock.
- Uses size-specific resale baselines and max-buy prices.
- Estimates Vinted buyer-protection sourcing cost and conservative resale selling fees.
- Calculates conservative expected resale, estimated net profit, ROI and FlipScore.
- Uses current Vinted active-price medians as a supporting market signal.
- Applies a counterfeit-risk gate so suspiciously cheap/high-risk listings are not blindly pinged.
- Detects sharp visible-supply contractions (`Supply Vacuum`) once enough history exists.
- Records rolling Vinted market history and can alert on a `Momentum Breakout` when visible supply tightens while asking-price medians rise.
- Persists seen IDs so the same listing is not repeatedly alerted.
- Keeps a rolling opportunity history for the bankroll allocator.
- Can generate a bankroll allocation from opportunities detected in the previous 48 hours.
- Fetches the exact Vinted listing page for qualifying alerts and adds the listing's first/main image to the Discord embed when available.

## Workflow

`.github/workflows/winter-flips.yml`

Scheduled every 10 minutes. Each scheduled job performs three scan cycles about three minutes apart, rotating through the search groups. The intelligence module runs after successful core scans and persists its own Vinted market history in `intelligence-state.json`.

Manual modes:

- `scan` — run the live Vinted radar.
- `test` — send a test embed to the dedicated Winter Flips Discord channel.
- `allocate` — send a suggested allocation for a specified GBP bankroll.

## Alert threshold

Default minimum score: **82/100** with at least **£18 estimated net profit** and **35% estimated ROI**, unless a deal clears the stronger margin thresholds. High counterfeit-risk candidates cannot qualify.

All resale figures are estimates. Active Vinted listing medians are used only as a supporting signal and are not represented as sold-price proof.

## Remaining optional intelligence layers

- optional vision-based model recognition for poorly titled listings;
- sold-data ingestion for winter models;
- seller-history scoring where reliable source data is available;
- Dan's Vault purchase/sale outcome learning to recalibrate model, size and price thresholds;
- retailer/clearance reverse-sourcing feeds;
- seller-wardrobe bundle mining where marketplace access reliably exposes seller inventory.
