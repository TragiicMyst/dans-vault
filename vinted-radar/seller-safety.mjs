import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_INTEGRATED_SELLER_SAFETY_V1';

export async function applySellerSafety() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;
  if (!src.includes('// DAN_DEFERRED_CONDITION_CONFIRMATION_V5')) throw new Error('Condition fallback must be applied before seller safety');
  if (!src.includes('// DAN_TRAINER_DETAIL_FETCH_BUDGET_V1')) throw new Error('Trainer detail fetch budget must be present before seller safety');

  const detailDecl = "    let detailText = '';";
  if (!src.includes(detailDecl)) throw new Error('Seller safety detail declaration target not found');
  src = src.replace(detailDecl, `${detailDecl}\n    let detailRaw = '';`);

  const detailFetch = 'detailText = normalize(visibleText(await fetchText(item.url)));';
  const occurrences = src.split(detailFetch).length - 1;
  if (occurrences < 1) throw new Error('Seller safety could not find listing detail fetches');
  src = src.split(detailFetch).join("detailRaw = await fetchText(item.url);\n        detailText = normalize(visibleText(detailRaw));");

  const riskAnchor = "    const risk = fakeRisk(item, `${summaryText} ${detailText}`, resale);";
  if (!src.includes(riskAnchor)) throw new Error('Seller safety risk anchor not found');
  const gate = `${MARKER}\n    // Every trainer alert must have a seller sanity check. Reuse an existing detail-page\n    // response when size/condition already needed one; otherwise spend one cycle-budgeted\n    // detail fetch. This prevents seller checks from doubling Vinted traffic.\n    if (bot === 'trainers' && !detailRaw) {\n      if (!canFetchDetail()) {\n        remember(state, item, prior, { blockedReason: 'seller-check-budget-exhausted', size, condition, resale, netProfit: profit, roi });\n        reject(diagnostics, 'seller-check-budget-exhausted');\n        continue;\n      }\n      claimDetailFetch();\n      try {\n        detailRaw = await fetchText(item.url);\n        detailText = normalize(visibleText(detailRaw));\n      } catch (error) {\n        remember(state, item, prior, { blockedReason: 'seller-check-failed', detailError: error.message, size, condition, resale, netProfit: profit, roi });\n        reject(diagnostics, 'seller-check-failed');\n        if (error.blocked) throw error;\n        continue;\n      }\n    }\n\n    const sellerRisk = bot === 'trainers' ? assessSellerRisk(detailRaw, item, resale) : { level:'LOW', note:'Seller screening not required for this bot', score:0 };\n    const sellerBlocked = sellerRisk.level === 'HIGH' || (sellerRisk.level === 'MEDIUM' && item.price <= resale * 0.45);\n    if (sellerBlocked) {\n      remember(state, item, prior, { blockedReason: 'seller-risk', size, condition, resale, netProfit: profit, roi, sellerRisk });\n      reject(diagnostics, 'seller-risk');\n      continue;\n    }\n\n    const risk = mergeRisk(fakeRisk(item, \`${'${summaryText}'} ${'${detailText}'}\`, resale), sellerRisk);`;
  src = src.replace(riskAnchor, gate);

  const helperAnchor = 'function fakeRisk(item,text,resale){';
  const helperIndex = src.indexOf(helperAnchor);
  if (helperIndex < 0) throw new Error('Seller safety helper insertion target not found');

  const helpers = String.raw`function normalizeSellerSource(raw){
  return decodeHtml(String(raw??''))
    .replace(/\\u0022/gi,'"')
    .replace(/\\u0026/gi,'&')
    .replace(/\\u003c/gi,'<')
    .replace(/\\u003e/gi,'>')
    .replace(/\\"/g,'"');
}
function sellerFirstNumber(source,patterns){for(const re of patterns){const m=source.match(re);if(m){const n=Number(m[1]);if(Number.isFinite(n))return n;}}return null;}
function sellerFirstText(source,patterns){for(const re of patterns){const m=source.match(re);if(m?.[1])return String(m[1]).trim();}return null;}
function assessSellerRisk(rawHtml,item,resale){
  const source=normalizeSellerSource(rawHtml);
  const visible=visibleText(source).toLowerCase();
  const reviewCount=sellerFirstNumber(source,[/"feedback_count"\s*:\s*(\d+)/i,/"reviews_count"\s*:\s*(\d+)/i,/"review_count"\s*:\s*(\d+)/i,/"ratings_count"\s*:\s*(\d+)/i,/"feedbackCount"\s*:\s*(\d+)/i,/"reviewsCount"\s*:\s*(\d+)/i]);
  const reputationRaw=sellerFirstNumber(source,[/"feedback_reputation"\s*:\s*([0-9.]+)/i,/"feedbackReputation"\s*:\s*([0-9.]+)/i,/"reputation"\s*:\s*([0-9.]+)/i]);
  const reputation=reputationRaw===null?null:(reputationRaw>1?reputationRaw/5:reputationRaw);
  const itemCount=sellerFirstNumber(source,[/"item_count"\s*:\s*(\d+)/i,/"items_count"\s*:\s*(\d+)/i,/"itemCount"\s*:\s*(\d+)/i]);
  const seller=sellerFirstText(source,[/"login"\s*:\s*"([^"]+)"/i,/"username"\s*:\s*"([^"]+)"/i,/\/members?\/\d+(?:-|\/)([a-z0-9._-]+)/i,/\/users?\/\d+(?:-|\/)([a-z0-9._-]+)/i]);
  const noHistoryText=/\b(?:no reviews|0 reviews|no feedback|0 feedback)\b/i.test(visible);
  const ratio=Number(resale)>0?Number(item?.price??0)/Number(resale):1;
  let score=0;
  const flags=[];

  if(reviewCount===0){score+=3;flags.push('seller has 0 recorded reviews');}
  else if(reviewCount!==null&&reviewCount<=2){score+=2;flags.push('seller has only '+reviewCount+' review(s)');}
  else if(reviewCount!==null&&reviewCount<=5){score+=1;flags.push('seller has limited feedback history');}
  else if(reviewCount===null&&noHistoryText){score+=2;flags.push('listing page indicates no seller feedback');}

  if(reputation!==null&&reviewCount!==0){
    if(reputation<0.70){score+=3;flags.push('seller feedback reputation is poor');}
    else if(reputation<0.85){score+=2;flags.push('seller feedback reputation is below normal');}
  }

  if(itemCount!==null&&itemCount>=8&&(reviewCount===0||noHistoryText)){score+=2;flags.push('many listings with no established feedback');}
  if(ratio<=0.30){score+=3;flags.push('price is at or below 30% of expected resale');}
  else if(ratio<=0.40){score+=2;flags.push('price is at or below 40% of expected resale');}
  else if(ratio<=0.50){score+=1;flags.push('price is at or below 50% of expected resale');}
  if(!seller){score+=1;flags.push('seller identity could not be verified from listing metadata');}

  const level=score>=6?'HIGH':score>=4?'MEDIUM':'LOW';
  const note=flags.length?flags.join('; '):'No stacked seller-account scam signals detected';
  return {level,note,score,seller:seller??null,reviewCount,reputation,itemCount,priceToResaleRatio:round2(ratio)};
}
function mergeRisk(itemRisk,sellerRisk){
  const rank={LOW:1,MEDIUM:2,HIGH:3};
  const level=(rank[sellerRisk?.level]??0)>(rank[itemRisk?.level]??0)?sellerRisk.level:itemRisk.level;
  const notes=[];
  if(itemRisk?.note)notes.push(itemRisk.note);
  if(sellerRisk?.note&&sellerRisk.note!=='No stacked seller-account scam signals detected')notes.push('Seller: '+sellerRisk.note);
  return {level,note:notes.join(' | ')||'No configured major authenticity or seller red flags detected'};
}
`;
  src = src.slice(0, helperIndex) + helpers + src.slice(helperIndex);

  if (!src.includes(MARKER)) throw new Error('Seller safety marker missing after patch');
  await fs.writeFile(radarUrl, src);
}
