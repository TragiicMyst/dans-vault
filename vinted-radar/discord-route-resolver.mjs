const CONDITION_KEYS = ['newWithoutTags', 'newWithTags', 'veryGood'];

export async function resolveDiscordRoutes({ newWithoutTagsWebhook, newWithTagsWebhook, veryGoodWebhook }) {
  const configured = {
    newWithoutTags: newWithoutTagsWebhook,
    newWithTags: newWithTagsWebhook,
    veryGood: veryGoodWebhook
  };

  for (const key of CONDITION_KEYS) {
    if (!configured[key]) throw new Error(`Missing Discord condition webhook for ${key}`);
  }

  const entries = await Promise.all(CONDITION_KEYS.map(async configuredAs => {
    const url = configured[configuredAs];
    try {
      const meta = await inspectWebhook(url);
      return {
        configuredAs,
        url,
        webhookId: meta.id ?? null,
        channelId: meta.channel_id ?? null,
        guildId: meta.guild_id ?? null,
        webhookName: meta.name ?? null,
        detectedCondition: detectCondition(meta.name),
        inspectionError: null
      };
    } catch (error) {
      return {
        configuredAs,
        url,
        webhookId: null,
        channelId: null,
        guildId: null,
        webhookName: null,
        detectedCondition: null,
        inspectionError: error.message
      };
    }
  }));

  const warnings = [];
  const webhookIds = entries.map(x => x.webhookId).filter(Boolean);
  if (webhookIds.length === 3 && new Set(webhookIds).size !== webhookIds.length) {
    warnings.push('two condition secrets point to the same webhook');
  }

  const channelIds = entries.map(x => x.channelId).filter(Boolean);
  if (channelIds.length === 3 && new Set(channelIds).size !== channelIds.length) {
    warnings.push('two condition secrets point to the same Discord channel');
  }

  for (const entry of entries) {
    if (entry.inspectionError) warnings.push(`${entry.configuredAs}: ${entry.inspectionError}`);
  }

  const detected = entries.filter(x => x.detectedCondition);
  const detectedKeys = new Set(detected.map(x => x.detectedCondition));
  let autoCorrected = false;
  let resolved = { ...configured };

  // If all three webhook names clearly identify their destination, trust that evidence and
  // repair swapped secret labels automatically. If names are generic, keep the configured mapping.
  if (detected.length === 3 && detectedKeys.size === 3) {
    resolved = {};
    for (const entry of entries) resolved[entry.detectedCondition] = entry.url;
    autoCorrected = entries.some(entry => entry.configuredAs !== entry.detectedCondition);
  }

  const summary = entries.map(entry => ({
    configuredAs: entry.configuredAs,
    webhookId: entry.webhookId,
    channelId: entry.channelId,
    guildId: entry.guildId,
    webhookName: entry.webhookName,
    detectedCondition: entry.detectedCondition,
    inspectionError: entry.inspectionError
  }));

  console.log('DISCORD ROUTE CHECK', JSON.stringify({ autoCorrected, warnings, routes: summary }));

  return {
    newWithoutTagsWebhook: resolved.newWithoutTags,
    newWithTagsWebhook: resolved.newWithTags,
    veryGoodWebhook: resolved.veryGood,
    autoCorrected,
    warnings,
    summary
  };
}

async function inspectWebhook(url) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': "Dan's Vault Discord Route Checker/1.0" },
      signal: AbortSignal.timeout(8000)
    });
  } catch (error) {
    throw new Error(`could not inspect webhook destination: ${error.message}`);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`webhook inspection HTTP ${response.status}`);
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('webhook inspection returned invalid JSON'); }
  if (!parsed?.id || !parsed?.channel_id) throw new Error('webhook inspection returned no webhook/channel id');
  return parsed;
}

function detectCondition(name) {
  const n = String(name ?? '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  if (n.includes('without tags') || n.includes('no tags') || /\bnwot\b/.test(n)) return 'newWithoutTags';
  if (n.includes('very good') || n.includes('verygood') || /\bvg\b/.test(n)) return 'veryGood';
  if (n.includes('with tags') || /\bnwt\b/.test(n)) return 'newWithTags';
  return null;
}
