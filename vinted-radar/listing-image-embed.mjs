import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_LISTING_IMAGE_EMBED_V2';

export async function applyListingImageEmbed() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;

  // Never use an image scraped from the catalogue card. Vinted catalogue markup can
  // contain neighbouring cards close together, which is what caused mismatched photos.
  // For an alert we fetch that exact item's page and only use its lead social image.
  const senderAnchor = 'async function sendDiscord(url,a){const u=new URL(url);';
  if (!src.includes(senderAnchor)) throw new Error('Discord image sender target not found');

  const helpers = `${MARKER}
function cleanExactListingImageUrl(value){
  if(!value)return null;
  const v=decodeHtml(String(value)).replace(/\\\\u0026/gi,'&').replace(/\\\\u002F/gi,'/').replace(/\\\\\\//g,'/').trim();
  return /^https:\/\/images\d*\.vinted\.net\/[^\s\"'<>]+/i.test(v)?v:null;
}
function metaContent(html,key,attribute='property'){
  const raw=String(html);
  const escaped=key.replace(/[.*+?^\${}()|[\]\\]/g,'\\$&');
  const a=new RegExp('<meta[^>]+(?:'+attribute+')=[\"\\\']'+escaped+'[\"\\\'][^>]+content=[\"\\\']([^\"\\\']+)[\"\\\']','i').exec(raw);
  const b=new RegExp('<meta[^>]+content=[\"\\\']([^\"\\\']+)[\"\\\'][^>]+(?:'+attribute+')=[\"\\\']'+escaped+'[\"\\\']','i').exec(raw);
  return decodeHtml(a?.[1]??b?.[1]??'');
}
function listingIdFromUrl(url){return String(url??'').match(/\/items\/(\d+)/)?.[1]??null;}
function extractExactLeadImage(html,itemUrl){
  const expectedId=listingIdFromUrl(itemUrl);
  if(!expectedId)return null;
  const pageUrl=metaContent(html,'og:url')
    ||String(html).match(/<link[^>]+rel=[\"\\\']canonical[\"\\\'][^>]+href=[\"\\\']([^\"\\\']+)[\"\\\']/i)?.[1]
    ||String(html).match(/<link[^>]+href=[\"\\\']([^\"\\\']+)[\"\\\'][^>]+rel=[\"\\\']canonical[\"\\\']/i)?.[1]
    ||'';
  const pageId=listingIdFromUrl(decodeHtml(pageUrl));
  if(pageId&&pageId!==expectedId)return null;
  const og=cleanExactListingImageUrl(metaContent(html,'og:image'));
  if(og)return og;
  return cleanExactListingImageUrl(metaContent(html,'twitter:image','name'));
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
