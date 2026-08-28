#!/usr/bin/env python3
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

STATE_PATH = Path(__file__).with_name("state.json")
WEBHOOK = os.getenv("DISCORD_WEBHOOK_URL", "").strip()
TIMEOUT = 25
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
)

# Start with high-yield UK designer / sports-fashion pages. Add more URLs freely.
DEFAULT_PAGES = [
    {"site": "House of Fraser", "url": "https://www.houseoffraser.co.uk/brand/calvin-klein"},
    {"site": "House of Fraser", "url": "https://www.houseoffraser.co.uk/sports/golf"},
    {"site": "House of Fraser", "url": "https://www.houseoffraser.co.uk/brand/polo-ralph-lauren"},
    {"site": "House of Fraser", "url": "https://www.houseoffraser.co.uk/brand/boss"},
    {"site": "House of Fraser", "url": "https://www.houseoffraser.co.uk/brand/nike"},
    {"site": "Flannels", "url": "https://www.flannels.com/clearance"},
    {"site": "USC", "url": "https://www.usc.co.uk/sale"},
    {"site": "Sports Direct", "url": "https://www.sportsdirect.com/sale"},
]

PRICE_RE = re.compile(r"£\s*([0-9]+(?:\.[0-9]{1,2})?)")
SPACE_RE = re.compile(r"\s+")
PRODUCT_HINT_RE = re.compile(r"/(?:brand|product|mens|womens|kids|sale)/", re.I)

MIN_TOTAL_DISCOUNT = float(os.getenv("MIN_TOTAL_DISCOUNT", "65"))
MIN_FURTHER_DROP = float(os.getenv("MIN_FURTHER_DROP", "35"))
MAX_ALERT_PRICE = float(os.getenv("MAX_ALERT_PRICE", "120"))
MAX_INITIAL_ALERTS = int(os.getenv("MAX_INITIAL_ALERTS", "8"))
DRY_RUN = os.getenv("DRY_RUN", "0") == "1"


@dataclass
class Product:
    site: str
    name: str
    url: str
    current: float
    original: float | None
    image: str | None = None

    @property
    def key(self):
        return hashlib.sha1(self.url.encode("utf-8")).hexdigest()[:18]

    @property
    def total_discount(self):
        if not self.original or self.original <= 0 or self.current >= self.original:
            return 0.0
        return round((1 - self.current / self.original) * 100, 1)


def load_pages():
    raw = os.getenv("DISCOUNT_MONITOR_PAGES_JSON", "").strip()
    if not raw:
        return DEFAULT_PAGES
    try:
        pages = json.loads(raw)
        if not isinstance(pages, list):
            raise ValueError("must be a JSON array")
        return pages
    except Exception as exc:
        print(f"Invalid DISCOUNT_MONITOR_PAGES_JSON: {exc}", file=sys.stderr)
        return DEFAULT_PAGES


def load_state():
    try:
        return json.loads(STATE_PATH.read_text())
    except Exception:
        return {"products": {}, "bootstrapped": False}


def save_state(state):
    STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")


def clean_text(value):
    return SPACE_RE.sub(" ", value or "").strip()


def get_html(url):
    headers = {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-GB,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Cache-Control": "no-cache",
    }
    r = requests.get(url, headers=headers, timeout=TIMEOUT)
    r.raise_for_status()
    return r.text


def parse_anchor(site, base_url, anchor):
    href = anchor.get("href")
    if not href or href.startswith(("#", "javascript:", "mailto:")):
        return None
    url = urljoin(base_url, href)
    if urlparse(url).netloc != urlparse(base_url).netloc:
        return None

    text = clean_text(anchor.get_text(" ", strip=True))
    prices = [float(x) for x in PRICE_RE.findall(text)]
    if not prices:
        return None

    # Retail listing cards normally show current price first and RRP/was price after it.
    current = prices[0]
    original = max(prices) if len(prices) > 1 else None
    if current <= 0 or current > 5000:
        return None

    name = PRICE_RE.sub("", text)
    name = clean_text(name.replace("From", "").replace("ONE-TIME OFFER", "").replace("PERSONALISE", ""))
    if len(name) < 4:
        return None

    # Avoid nav/footer links that happen to contain a price.
    if not PRODUCT_HINT_RE.search(url) and not re.search(r"-\d{5,}(?:$|[/?#])", url):
        return None

    img = anchor.find("img")
    image = None
    if img:
        image = img.get("src") or img.get("data-src") or img.get("data-lazy")
        if image:
            image = urljoin(base_url, image)

    return Product(site=site, name=name[:180], url=url, current=current, original=original, image=image)


def parse_jsonld(site, base_url, soup):
    out = []
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(script.string or script.get_text())
        except Exception:
            continue
        nodes = data if isinstance(data, list) else [data]
        for node in nodes:
            if not isinstance(node, dict):
                continue
            if node.get("@type") == "ItemList":
                nodes.extend([x.get("item", x) for x in node.get("itemListElement", []) if isinstance(x, dict)])
            if node.get("@type") != "Product":
                continue
            offers = node.get("offers") or {}
            if isinstance(offers, list):
                offers = offers[0] if offers else {}
            try:
                current = float(offers.get("price"))
            except Exception:
                continue
            name = clean_text(node.get("name"))
            url = urljoin(base_url, node.get("url") or "")
            if not name or not url:
                continue
            image = node.get("image")
            if isinstance(image, list):
                image = image[0] if image else None
            out.append(Product(site, name[:180], url, current, None, image))
    return out


def scrape_page(site, url):
    html = get_html(url)
    soup = BeautifulSoup(html, "html.parser")
    found = {}

    for a in soup.find_all("a", href=True):
        product = parse_anchor(site, url, a)
        if product:
            old = found.get(product.url)
            if not old or (product.original or 0) > (old.original or 0):
                found[product.url] = product

    for product in parse_jsonld(site, url, soup):
        found.setdefault(product.url, product)

    return list(found.values())


def money(value):
    return "—" if value is None else f"£{value:.2f}"


def should_alert(product, previous, bootstrapped):
    total = product.total_discount
    previous_price = previous.get("current") if previous else None
    further = 0.0
    if previous_price and product.current < previous_price:
        further = (1 - product.current / float(previous_price)) * 100

    extreme_now = total >= MIN_TOTAL_DISCOUNT and product.current <= MAX_ALERT_PRICE
    huge_now = total >= 80
    major_drop = further >= MIN_FURTHER_DROP and product.current <= MAX_ALERT_PRICE

    if not bootstrapped:
        return (extreme_now or huge_now), further
    return (major_drop or extreme_now or huge_now), further


def post_discord(product, previous, further):
    if not WEBHOOK:
        print("No DISCORD_WEBHOOK_URL set; alert suppressed")
        return

    previous_price = previous.get("current") if previous else None
    total = product.total_discount
    title = f"🔥 {product.name}" if total >= 80 or further >= 50 else product.name
    fields = [
        {"name": "Site", "value": product.site, "inline": True},
        {"name": "Original Price", "value": money(product.original), "inline": True},
        {"name": "Previous Price", "value": money(previous_price), "inline": True},
        {"name": "🚨 Current Price", "value": f"**{money(product.current)}**", "inline": True},
        {"name": "Total Discount", "value": f"**{total:.1f}%**" if total else "—", "inline": True},
        {"name": "Further Drop", "value": f"**{further:.1f}%**" if further else "—", "inline": True},
    ]
    embed = {
        "title": title[:256],
        "url": product.url,
        "description": "**RIDICULOUS DISCOUNT DETECTED** — check stock/size immediately before buying.",
        "fields": fields,
        "footer": {"text": "Dan's Vault • Designer Discount Monitor"},
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if product.image:
        embed["thumbnail"] = {"url": product.image}

    payload = {"username": "Dan's Vault Discount Bot", "embeds": [embed]}
    if DRY_RUN:
        print(json.dumps(payload, indent=2))
        return
    r = requests.post(WEBHOOK, json=payload, timeout=TIMEOUT)
    r.raise_for_status()


def main():
    state = load_state()
    products_state = state.setdefault("products", {})
    bootstrapped = bool(state.get("bootstrapped"))
    alerts = []
    scraped = 0

    for page in load_pages():
        site = page.get("site") or urlparse(page["url"]).netloc
        url = page["url"]
        try:
            products = scrape_page(site, url)
            print(f"{site}: {len(products)} products parsed from {url}")
        except Exception as exc:
            print(f"WARN {site} {url}: {exc}", file=sys.stderr)
            continue

        scraped += len(products)
        for product in products:
            previous = products_state.get(product.key, {})
            alert, further = should_alert(product, previous, bootstrapped)
            alert_fingerprint = f"{product.current:.2f}"
            if alert and previous.get("last_alert_price") != alert_fingerprint:
                alerts.append((product, previous.copy(), further))

            record = asdict(product)
            record["last_seen"] = int(time.time())
            if previous.get("last_alert_price"):
                record["last_alert_price"] = previous["last_alert_price"]
            products_state[product.key] = record

    # On the first ever run, cap the burst so a huge sale page doesn't spam Discord.
    if not bootstrapped:
        alerts.sort(key=lambda x: (x[0].total_discount, -x[0].current), reverse=True)
        alerts = alerts[:MAX_INITIAL_ALERTS]

    for product, previous, further in alerts:
        try:
            post_discord(product, previous, further)
            products_state[product.key]["last_alert_price"] = f"{product.current:.2f}"
        except Exception as exc:
            print(f"WARN Discord alert failed for {product.url}: {exc}", file=sys.stderr)

    state["bootstrapped"] = True
    state["last_run"] = int(time.time())
    state["last_scraped_count"] = scraped
    state["last_alert_count"] = len(alerts)
    save_state(state)
    print(f"Done: scraped={scraped}, alerts={len(alerts)}, bootstrapped_was={bootstrapped}")


if __name__ == "__main__":
    main()
