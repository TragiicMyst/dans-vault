import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_REFERENCE_DISCORD_LAYOUT_V1';

export async function applyReferenceDiscordLayout() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;

  if (!src.includes('// DAN_LISTING_IMAGE_EMBED_V3')) {
    throw new Error('Reference Discord layout requires exact listing image support first');
  }

  const start = src.indexOf('async function sendDiscord(url,a){');
  const end = src.indexOf('\n\nasync function persistState(', start);
  if (start < 0 || end < 0) throw new Error('Discord sender block not found for reference layout');

  const replacement = `${MARKER}
function discordClip(value,max=240){
  const text=String(value??'').replace(/[\\r\\n\\t]+/g,' ').replace(/\\s+/g,' ').trim();
  return text.length>max?text.slice(0,Math.max(0,max-1))+'…':text;
}
function discordConditionLabel(condition){
  if(condition==='newWithTags')return 'New with tags';
  if(condition==='newWithoutTags')return 'New without tags';
  if(condition==='veryGood')return 'Very good';
  return 'Check listing';
}
function discordConditionBadge(condition){
  if(condition==='newWithTags')return '⭐ NWT';
  if(condition==='newWithoutTags')return '⭐ NWOT';
  if(condition==='veryGood')return '⭐ VERY GOOD';
  return '⭐ CHECK CONDITION';
}
function discordListedLabel(item){
  const age=Number(item?.ageMinutes);
  if(Number.isFinite(age)&&age>=0){
    if(age<1)return 'Just now';
    if(age===1)return '1 minute ago';
    if(age<60)return Math.round(age)+' minutes ago';
    const hours=Math.round(age/60);
    return hours===1?'1 hour ago':hours+' hours ago';
  }
  return 'Freshly detected';
}
function discordScoreStars(score){
  const n=Math.max(0,Math.min(100,Number(score)||0));
  const filled=Math.max(1,Math.min(5,Math.round(n/20)));
  return '★'.repeat(filled)+'☆'.repeat(5-filled);
}
function discordDealLine(a){
  if(a?.exceptionalDeal)return 'Exceptional price for a quick flip 🚀';
  if(Number(a?.buyScore)>=85)return 'Great price for quick profit 🚀';
  if(Number(a?.buyScore)>=70)return 'Strong resale margin — worth checking fast ✅';
  return 'Profitable opportunity — check the listing quickly 👀';
}

async function sendDiscord(url,a){
  const imageUrl=await fetchExactLeadImage(a?.item?.url);
  const u=new URL(url);
  u.searchParams.set('wait','true');

  const resaleLow=Math.max(0,Number(a.resale)-5);
  const resaleHigh=Math.max(resaleLow,Number(a.resale)+5);
  const profitLow=Math.max(0,Number(a.netProfit)-5);
  const profitHigh=Math.max(profitLow,Number(a.netProfit)+5);
  const score=Math.max(0,Math.min(100,Number(a.buyScore)||0));
  const score10=(score/10).toFixed(1);
  const conditionLabel=discordConditionLabel(a.condition);
  const conditionBadge=discordConditionBadge(a.condition);
  const riskLevel=String(a?.fakeRisk?.level??'CHECK').toUpperCase();
  const riskNote=discordClip(a?.fakeRisk?.note??'Check photos, product code and seller history before buying.',300);
  const demand=Math.max(0,Math.round(Number(a?.demand)||0));
  const title=discordClip(a?.item?.title??a?.searchName??'Vinted bargain',220);
  const searchName=discordClip(String(a?.searchName??'Nike bargain').toUpperCase(),220);

  const embed={
    title:'✨ '+searchName,
    url:a.item.url,
    description:'**'+title+'**',
    color:5763719,
    fields:[
      {name:'🏷️ Price',value:'**£'+Number(a.item.price).toFixed(2)+'**',inline:true},
      {name:'📏 Size',value:'**'+(typeof a.size==='number'?'UK ':'')+String(a.size)+'**',inline:true},
      {name:'📦 Condition',value:'**'+conditionLabel+'**',inline:true},
      {name:'📍 Location',value:'Vinted UK',inline:true},
      {name:'⏱️ Listed',value:discordListedLabel(a.item),inline:true},
      {name:'💹 ROI',value:'**'+Number(a.roi).toFixed(0)+'%**',inline:true},
      {name:'📈 RESELL ESTIMATE',value:'Estimated Resale: **£'+resaleLow.toFixed(0)+' – £'+resaleHigh.toFixed(0)+'**\\nPotential Profit: **£'+profitLow.toFixed(0)+' – £'+profitHigh.toFixed(0)+'**',inline:false},
      {name:'🎯 DEAL SCORE',value:'**'+score10+' / 10**  '+discordScoreStars(score)+'\\n*'+discordDealLine(a)+'*',inline:false},
      {name:'✅ DEAL CHECKS',value:'✅ UK MARKETPLACE   •   🚚 CHECK SHIPPING\\n'+conditionBadge+'   •   🛡️ '+riskLevel+' RISK   •   📊 DEMAND '+demand+'/100',inline:false},
      {name:'🔗 BUY LINK',value:'[**View on Vinted ↗**]('+a.item.url+')   |   ⚠️ **Check Before Buying!**',inline:false},
      {name:'🛡️ QUICK AUTHENTICITY NOTE',value:riskNote,inline:false}
    ],
    ...(imageUrl?{thumbnail:{url:imageUrl}}:{}),
    footer:{text:"Dan's Vault Radar • Check photos, product code, condition and seller before buying"},
    timestamp:new Date().toISOString()
  };

  const body={
    username:"Dan's Vault Radar",
    content:'🚨 **NEW BARGAIN FOUND** 🔥',
    allowed_mentions:{parse:[]},
    embeds:[embed]
  };

  let last;
  for(let i=1;i<=3;i++){
    try{
      const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
      const text=await r.text();
      if(!r.ok){const e=new Error('Discord HTTP '+r.status);e.retryable=r.status===429||r.status>=500;throw e;}
      const parsed=JSON.parse(text);
      if(!parsed?.id)throw new Error('Discord did not acknowledge message with an id');
      return String(parsed.id);
    }catch(e){
      last=e;
      if(i===3||e.retryable===false)break;
      await sleep(500*i);
    }
  }
  throw last??new Error('Discord delivery failed');
}`;

  src = src.slice(0,start) + replacement + src.slice(end);

  if (!src.includes(MARKER)) throw new Error('Reference Discord layout marker missing after patch');
  if (!src.includes("content:'🚨 **NEW BARGAIN FOUND** 🔥'")) throw new Error('Reference alert header missing after patch');
  if (!src.includes("name:'📈 RESELL ESTIMATE'")) throw new Error('Reference resale section missing after patch');
  if (!src.includes("name:'🎯 DEAL SCORE'")) throw new Error('Reference deal-score section missing after patch');
  if (!src.includes('thumbnail:{url:imageUrl}')) throw new Error('Reference listing thumbnail missing after patch');

  await fs.writeFile(radarUrl, src);
}
