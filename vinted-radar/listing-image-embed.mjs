import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_LISTING_IMAGE_EMBED_V3';

export async function applyListingImageEmbed() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;

  // Do not use catalogue-card images: neighbouring Vinted cards can be interleaved in
  // catalogue HTML and caused the wrong listing photo to be attached. For every alert,
  // fetch that exact Vinted item page and use only its own lead social-preview image.
  const senderAnchor = 'async function sendDiscord(url,a){const u=new URL(url);';
  if (!src.includes(senderAnchor)) throw new Error('Discord image sender target not found');

  const helpers = `${MARKER}
function htmlAttr(tag,name){
  const raw=String(tag);
  const lower=raw.toLowerCase();
  const attr=String(name).toLowerCase();
  for(const quote of ['\"',"'"]){
    const needle=attr+'='+quote;
    const index=lower.indexOf(needle);
    if(index<0)continue;
    const start=index+needle.length;
    const end=raw.indexOf(quote,start);
    if(end>start)return decodeHtml(raw.slice(start,end));
  }
  return '';
}
function firstHtmlTag(html,tagName,predicate){
  const raw=String(html);
  const lower=raw.toLowerCase();
  const open='<'+String(tagName).toLowerCase();
  let pos=0;
  while(true){
    const start=lower.indexOf(open,pos);
    if(start<0)return '';
    const end=lower.indexOf('>',start);
    if(end<0)return '';
    const tag=raw.slice(start,end+1);
    if(predicate(tag))return tag;
    pos=end+1;
  }
}
function metaContent(html,key){
  const wanted=String(key).toLowerCase();
  const tag=firstHtmlTag(html,'meta',t=>htmlAttr(t,'property').toLowerCase()===wanted||htmlAttr(t,'name').toLowerCase()===wanted);
  return tag?htmlAttr(tag,'content'):'';
}
function canonicalPageUrl(html){
  const tag=firstHtmlTag(html,'link',t=>htmlAttr(t,'rel').toLowerCase().split(' ').includes('canonical'));
  return tag?htmlAttr(tag,'href'):'';
}
function listingIdFromUrl(url){
  try{
    const path=new URL(String(url)).pathname;
    const rest=path.split('/items/')[1]||'';
    const id=(rest.split('-')[0]||'').split('/')[0];
    if(!id)return null;
    for(const ch of id)if(ch<'0'||ch>'9')return null;
    return id;
  }catch{return null;}
}
function cleanExactListingImageUrl(value){
  if(!value)return null;
  let v=decodeHtml(String(value)).trim();
  if(v.startsWith('//'))v='https:'+v;
  try{
    const parsed=new URL(v);
    const host=parsed.hostname.toLowerCase();
    if(parsed.protocol!=='https:'||!host.startsWith('images')||!host.endsWith('.vinted.net'))return null;
    return parsed.toString();
  }catch{return null;}
}
function extractExactLeadImage(html,itemUrl){
  const expectedId=listingIdFromUrl(itemUrl);
  if(!expectedId)return null;
  const declaredUrl=metaContent(html,'og:url')||canonicalPageUrl(html);
  const declaredId=listingIdFromUrl(declaredUrl);
  if(declaredId&&declaredId!==expectedId)return null;
  return cleanExactListingImageUrl(metaContent(html,'og:image'))||cleanExactListingImageUrl(metaContent(html,'twitter:image'));
}
async function fetchExactLeadImage(itemUrl){
  if(!itemUrl)return null;
  try{
    const html=await fetchText(itemUrl);
    return extractExactLeadImage(html,itemUrl);
  }catch(error){
    console.warn('Exact listing image fetch failed: '+error.message);
    return null;
  }
}

async function sendDiscord(url,a){const imageUrl=await fetchExactLeadImage(a?.item?.url);const u=new URL(url);`;

  src = src.replace(senderAnchor, helpers);

  const embedTail = 'timestamp:new Date().toISOString()}]};';
  if (!src.includes(embedTail)) throw new Error('Discord embed image target not found');
  src = src.replace(
    embedTail,
    'timestamp:new Date().toISOString(),...(imageUrl?{image:{url:imageUrl}}:{})}]};'
  );

  await fs.writeFile(radarUrl, src);
}
