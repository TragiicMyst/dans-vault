# Dan's Vault Vinted Radar

A conservative Nike bargain monitor for Vinted that sends manual-buy alerts to Discord. It does not log into Vinted, message sellers, favourite listings, make offers, or purchase items.

## What the radar now scores

- Buy price, expected resale, estimated net profit before tax, and ROI.
- Size-specific resale estimates.
- Fast-flip, max-profit and balanced strategy scores.
- Seasonal demand weighting.
- Price-drop alerts when an existing listing becomes meaningfully cheaper.
- Product-code checks when a Nike style code can be found and is in the local registry.
- Fake-risk warnings based on explicit red-flag wording, suspicious pricing, code mismatches, seller/listing patterns, and duplicate photos. This is a risk flag, not authentication.
- Photo-evidence strength and first-image capture for Discord.
- Seller-pattern and duplicate-photo tracking across observations.
- Personal model/keyword blacklists.
- Optional inventory awareness through `inventory.json` so the radar can warn when too many pairs of the same model are already in stock.

## Important limits

The bot intentionally does not bypass Vinted protections or use a Vinted login. It only checks pages available to the monitor and stops gracefully when Vinted blocks a request.

The resale numbers are estimates, not guaranteed sale prices. They should be recalibrated against your actual completed sales over time.

The fake-risk system is deliberately conservative. A low-risk result means that no configured red flags were detected; it does not mean the shoes are authenticated.

## Changing your filters

Edit `config.json` to change max prices, sizes, models, seasonal multipliers, resale estimates, blacklist terms, and scoring thresholds.

Add your own stock to `inventory.json` using entries such as:

```json
{
  "model": "Nike P-6000",
  "size": 8,
  "cost": 32,
  "status": "in_stock"
}
```

## Discord

The workflow reads the `DISCORD_WEBHOOK_URL` repository secret. Keep that webhook private. The radar only sends alerts and never performs purchases.
