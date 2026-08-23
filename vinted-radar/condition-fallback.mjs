import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_CONDITION_LABELS_V4';

export async function applyConditionFallback() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;

  // Keep the radar's normal safety behaviour: if condition is unknown, fetch the
  // exact listing detail page and require it to resolve to one of our supported
  // condition tiers before an alert is allowed through. The previous fallback
  // let "unconfirmed" condition alerts through, which could be delivered to the
  // legacy primary webhook instead of the three condition-specific channels.
  const oldLabel = "a.condition==='newWithTags'?'🆕 New with tags':'🆕 New without tags'";
  const newLabel = "a.condition==='newWithTags'?'🆕 New with tags':a.condition==='newWithoutTags'?'🆕 New without tags':a.condition==='veryGood'?'✅ Very good':'⚠️ Condition unconfirmed'";
  if (!src.includes(oldLabel)) throw new Error('Condition label patch target not found');
  src = src.replace(oldLabel, newLabel);

  const senderAnchor = 'async function sendDiscord(url,a){';
  if (!src.includes(senderAnchor)) throw new Error('Discord sender marker target not found');
  src = src.replace(senderAnchor, `${MARKER}\n${senderAnchor}`);

  await fs.writeFile(radarUrl, src);
}
