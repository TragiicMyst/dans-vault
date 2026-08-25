import fs from 'node:fs/promises';

const BASE = new URL('./', import.meta.url);
const RADAR_STATE = JSON.parse(await fs.readFile(new URL('./state.json', BASE), 'utf8'));
const INTEL_PATH = new URL('./intelligence-state.json', BASE);
const WEBHOOK = process.env.DISCORD_WINTER_FLIPS_WEBHOOK_URL || '';

if (!WEBHOOK) {
  console.log('Winter intelligence disabled: dedicated webhook missing.');
  process.exit(0);
}

const intel = await loadJson(INTEL_PATH, {
  version: 2,
  history: {},
  momentumAlerts: {},
  lastRunAt: null
});
intel.version = 2;
intel.history ||= {};
intel.momentumAlerts ||= {};
delete intel.staleAlerts;

const diagnostics = {
  at: new Date().toISOString(),
  source: 'VINTED',
  snapshotsAdded: 0,
  momentumAlerts: 0,
  failures: []
};

recordMarketSnapshots();
await detectMomentumBreakouts();

intel.lastRunAt = new Date().toISOString();
pruneIntel();
await fs.writeFile(INTEL_PATH, JSON.stringify(intel, null, 2) + '\n');
console.log(JSON.stringify(diagnostics, null, 2));

function recordMarketSnapshots() {
  for (const [key, snap] of Object.entries(RADAR_STATE.market || {})) {
    const at = Date.parse(snap.at || 0);
    if (!Number.isFinite(at) || at <= 0) continue;
    const history = intel.history[key] ||= [];
    if (history.some(x => x.at === snap.at)) continue;
    history.push({
      at: snap.at,
      count: Number(snap.count || 0),
      median: Number.isFinite(Number(snap.median)) ? Number(snap.median) : null
    });
    history.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    intel.history[key] = history.slice(-36);
    diagnostics.snapshotsAdded += 1;
  }
}

async function detectMomentumBreakouts() {
  for (const [key, history] of Object.entries(intel.history)) {
    if (!Array.isArray(history) || history.length < 4) continue;
    const latest = history.at(-1);
    if (!latest || latest.count < 3 || !Number.isFinite(latest.median)) continue;

    const candidates = history.filter(x => {
      const age = Date.parse(latest.at) - Date.parse(x.at);
      return age >= 30 * 60_000 && age <= 8 * 3600_000 && x.count >= 5 && Number.isFinite(x.median);
    });
    if (!candidates.length) continue;

    const baseline = candidates[0];
    const supplyDrop = 1 - latest.count / baseline.count;
    const priceRise = latest.median / baseline.median - 1;
    if (supplyDrop < 0.22 || priceRise < 0.06) continue;

    const last = Date.parse(intel.momentumAlerts[key] || 0);
    if (Number.isFinite(last) && last > 0 && Date.now() - last < 12 * 3600_000) continue;

    const body = {
      username: "Dan's Vault Winter Flips",
      embeds: [{
        title: '🚀 VINTED WINTER FLIPS • MOMENTUM BREAKOUT',
        description:
          `**${humaniseKey(key)}**\n\n` +
          `📦 Visible Vinted supply: **${baseline.count} → ${latest.count}** (**-${Math.round(supplyDrop * 100)}%**)\n` +
          `💷 Active median: **£${baseline.median.toFixed(0)} → £${latest.median.toFixed(0)}** (**+${Math.round(priceRise * 100)}%**)\n` +
          `🕒 Signal developed across **${Math.round((Date.parse(latest.at) - Date.parse(baseline.at)) / 60000)} minutes**.\n\n` +
          `🧠 This is a Vinted market-momentum signal: visible stock is tightening while asking prices are rising. It is not sold-data proof.`,
        color: 10181046,
        footer: { text: "Dan's Vault • Winter Flips • Vinted Momentum" },
        timestamp: new Date().toISOString()
      }]
    };

    const sent = await postDiscord(body).catch(error => {
      diagnostics.failures.push(`Momentum ${key}: ${error.message}`);
      return false;
    });
    if (sent) {
      intel.momentumAlerts[key] = new Date().toISOString();
      diagnostics.momentumAlerts += 1;
    }
  }
}

async function postDiscord(body) {
  const response = await fetch(`${WEBHOOK}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return true;
}

function humaniseKey(key) {
  return String(key)
    .replace(/^hunter:/, 'Hunter: ')
    .replace(/^[^:]+:/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function pruneIntel() {
  const cutoff = Date.now() - 14 * 86400000;
  for (const [key, history] of Object.entries(intel.history)) {
    intel.history[key] = (history || []).filter(x => Date.parse(x.at || 0) >= cutoff).slice(-36);
    if (!intel.history[key].length) delete intel.history[key];
  }
}

async function loadJson(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch { return structuredClone(fallback); }
}
