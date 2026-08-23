import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_CONDITION_TIERS_V1';

export async function applyConditionTierExpansion() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;

  const oldFn = "export function classifyCondition(text){const n=normalize(text);if(/\\bnew without tags\\b/.test(n))return'newWithoutTags';if(/\\bnew with tags\\b/.test(n))return'newWithTags';return'unknown';}";
  const newFn = `${MARKER}\nexport function classifyCondition(text){\n  const n=normalize(String(text??'')\n    .replace(/\\\\u0020/gi,' ')\n    .replace(/\\\\u0022/gi,' ')\n    .replace(/\\\\u0026/gi,'&')\n    .replace(/\\\\n|\\\\r|\\\\t/g,' '));\n  if(/\\b(?:brand\\s+)?new\\s+(?:without|w\\s*o|no)\\s+tags?\\b/.test(n)||/\\bnwot\\b/.test(n))return'newWithoutTags';\n  if(/\\b(?:brand\\s+)?new\\s+(?:with|w)\\s+tags?\\b/.test(n)||/\\bnwt\\b/.test(n))return'newWithTags';\n  if(/\\bvery\\s*good\\b/.test(n))return'veryGood';\n  return'unknown';\n}`;
  if (!src.includes(oldFn)) throw new Error('Condition classifier patch target not found');
  src = src.replace(oldFn, newFn);

  await fs.writeFile(radarUrl, src);
}
