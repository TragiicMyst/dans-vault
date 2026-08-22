# Dan's Vault eBay Sold Trainers

This bot turns eBay Product Research exports into Discord-ready sold-market intelligence.

## What to provide
Export/save your own eBay Product Research data and place the CSV in `ebay-sold/data/`. Do not provide eBay passwords, cookies, session tokens, or 2FA codes.

The parser accepts common columns such as product/title, sold price, shipping, size, colour/color, condition, date, category and item number. Unknown columns are ignored.

## Output
The analyzer calculates overall sold count, average/median sold price, sold-price range, size breakdown, colourway breakdown, condition breakdown, recent trend and a conservative resale/buying signal.

The data comes from the user's own eBay Product Research access. eBay Product Research provides up to three years of sales data and metrics such as average sales price, sold price range, shipping costs and sell-through rate. See eBay's official Product Research documentation for current availability and features.
