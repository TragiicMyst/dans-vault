import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_LISTING_IMAGE_EMBED_V2';

export async function applyListingImageEmbed() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;

  // IMPORTANT: never take the Discord photo from a catalogue/search-result HTML slice.
  // Vinted can render neighbouring cards/images close together in that markup, which can
  // associate the wrong photo with an item. Only read the exact item's own page and use
  // its social-preview image (og:image / twitter:image), which is the listing's lead photo.
  const helperAnchor = 'async function sendDiscord(url,a){const u=new URL(url);';
  if (!src.includes(helperAnchor)) throw new Error('Discord image sender target not found');

  const helpers = `${MARKER}\nfunction cleanExactListingImageUrl(value){\n  if(!value)return null;\n  const v=decodeHtml(String(value)).replace(/\\\\u0026/gi,'&').replace(/\\\\u002F/gi,'/').replace(/\\\\\\//g,'/').trim();\n  return /^https:\\/\\/images\\d*\\.vinted\\.net\\/[^\\s\"'<>]+/i.test(v)?v:null;\n}\nfunction metaContent(html,key,attribute='property'){\n  const raw=String(html);\n  const escaped=key.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&');\n  const a=new RegExp('<meta[^>]+(?:'+attribute+')=[\\\"\\\']'+escaped+'[\\\"\\\'][^>]+content=[\\\"\\\']([^\\\"\\\']+)[\\\"\\\']','i').exec(raw);\n  const b=new RegExp('<meta[^>]+content=[\\\"\\\']([^\\\"\\\']+)[\\\"\\\'][^>]+(?:'+attribute+')=[\\\"\\\']'+escaped+'[\\\"\\\']','i').exec(raw);\n  return decodeHtml(a?.[1]??b?.[1]??'');\n}\nfunction listingIdFromUrl(url){return String(url??'').match(/\\/items\\/(\\d+)/)?.[1]??null;}\nfunction extractExactLeadImage(html,itemUrl){\n  const expectedId=listingIdFromUrl(itemUrl);\n  if(!expectedId)return null;\n  const pageUrl=metaContent(html,'og:url')||String(html).match(/<link[^>]+rel=[\\\"\\\']canonical[\\\"\\\'][^>]+href=[\\\"\\\']([^\\\"\\\']+)[\\\"\\\']/i)?.[1]||String(html).match(/<link[^>]+href=[\\\"\\\']([^\\\"\\\']+)[\\\"\\\'][^>]+rel=[\\\"\\\']canonical[\\\"\\\']/i)?.[1]||'';\n  const pageId=listingIdFromUrl(decodeHtml(pageUrl));\n  // If Vinted tells us this HTML belongs to another item, refuse to show any photo.\n  if(pageId&&pageId!==expectedId)return null;\n  const og=cleanExactListingImageUrl(metaContent(html,'og:image'));\n  if(og)return og;\n  const twitter=cleanExactListingImageUrl(metaContent(html,'twitter:image','name'));\n  return twitter;\n}\nasync function fetchExactLeadImage(itemUrl){\n  if(!itemUrl)return null;\n  try{\n    const html=await fetchText(itemUrl);\n    return extractExactLeadImage(html,itemUrl);\n  }catch(error){\n    console.warn(\\`Exact listing image fetch failed: ${error.message}\\`);\n    return null;\n  }\n}\n\nasync function sendDiscord(url,a){const imageUrl=await fetchExactLeadImage(a?.item?.url);const u=new URL(url);`;

  src = src.replace(helperAnchor, helpers);

  const embedTail = 'timestamp:new Date().toISOString()}]};';
  if (!src.includes(embedTail)) throw new Error('Discord embed image target not found');
  src = src.replace(
    embedTail,
    "timestamp:new Date().toISOString(),...(imageUrl?{image:{url:imageUrl}}:{})}]} ;".replace('}]} ;','}]};')
  );

  await fs.writeFile(radarUrl, src);
}
