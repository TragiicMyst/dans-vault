import fs from 'node:fs/promises';

const nativeFetch = globalThis.fetch;
if (typeof nativeFetch !== 'function') throw new Error('Global fetch is unavailable');

const cooldownFile = new URL('./.fetch-cooldown.json', import.meta.url);
let lastVintedRequestAt = 0;

async function readCooldown() {
  try {
    const data = JSON.parse(await fs.readFile(cooldownFile, 'utf8'));
    const until = Date.parse(data.until ?? 0);
    return Number.isFinite(until) ? until : 0;
  } catch {
    return 0;
  }
}

async function writeCooldown(ms, reason) {
  const until = new Date(Date.now() + ms).toISOString();
  await fs.writeFile(cooldownFile, JSON.stringify({ until, reason, updatedAt: new Date().toISOString() }, null, 2));
  console.warn(`Vinted cooldown engaged until ${until}: ${reason}`);
}

function isVinted(input) {
  try {
    const url = typeof input === 'string' || input instanceof URL ? new URL(input) : new URL(input.url);
    return /(^|\.)vinted\.co\.uk$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.round(min + Math.random() * (max - min));
}

globalThis.fetch = async function guardedFetch(input, init) {
  if (!isVinted(input)) return nativeFetch(input, init);

  const persistedCooldown = await readCooldown();
  if (persistedCooldown > Date.now()) {
    const remainingMs = persistedCooldown - Date.now();
    // Do not sleep inside fetch while a scanner/process timeout is ticking. A previous
    // 403/429 used to make the retry wait 45-120s here, which could kill the whole
    // GitHub Actions cycle before radar-v6 had a chance to persist its heartbeat/state.
    // Fail fast instead; radar-v6 recognises blocked errors and records a cooldown.
    const error = new Error(`Vinted guard cooldown active for ${Math.ceil(remainingMs / 1000)}s`);
    error.blocked = true;
    error.retryable = true;
    throw error;
  }

  const minGap = randomBetween(1800, 3200);
  const sinceLast = Date.now() - lastVintedRequestAt;
  if (sinceLast < minGap) await sleep(minGap - sinceLast);

  lastVintedRequestAt = Date.now();
  const response = await nativeFetch(input, init);

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'));
    const cooldownMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 120000)
      : 60000;
    await writeCooldown(cooldownMs, 'HTTP 429 rate limit');
  } else if (response.status === 403) {
    await writeCooldown(45000, 'HTTP 403 block');
  }

  return response;
};

console.log('Vinted fetch guard active: paced requests + fail-fast 403/429 cooldown.');
