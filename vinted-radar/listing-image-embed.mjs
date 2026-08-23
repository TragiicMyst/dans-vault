import fs from 'node:fs/promises';

const radarUrl = new URL('./radar-v6.mjs', import.meta.url);
const MARKER = '// DAN_LISTING_IMAGE_EMBED_V1';

export async function applyListingImageEmbed() {
  let src = await fs.readFile(radarUrl, 'utf8');
  if (src.includes(MARKER)) return;

  const itemAnchor = "    found.push({ id:current.id, title, price, ageMinutes:parseAgeMinutes(context), fullText:`${title} ${context}`, url:`https://www.vinted.co.uk${current.path}` });";
  if (!src.includes(itemAnchor)) throw new Error('Listing image item-parser target not found');
  src = src.replace(
    itemAnchor,
    "    const itemHtml=html.slice(current.index,end);\n    found.push({ id:current.id, title, price, ageMinutes:parseAgeMinutes(context), fullText:`${title} ${context}`, url:`https://www.vinted.co.uk${current.path}`, imageUrl:extractFirstListingImage(itemHtml) });"
  );

  const helperAnchor = 'function looksLikeEmptyCatalog(html) {';
  if (!src.includes(helperAnchor)) throw new Error('Listing image helper target not found');
  src = src.replace(
    helperAnchor,
    `function cleanListingImageUrl(value){\n  if(!value)return null;\n  let v=decodeHtml(String(value)).replace(/\\\\u0026/gi,'&').replace(/\\\\u002F/gi,'/').replace(/\\\\\\//g,'/').trim();\n  v=v.replace(/[),]+$/g,'');\n  return /^https:\\/\\/images\\d*\\.vinted\\.net\\//i.test(v)?v:null;\n}\nfunction extractFirstListingImage(fragment){\n  const raw=decodeHtml(String(fragment)).replace(/\\\\u0026/gi,'&').replace(/\\\\u002F/gi,'/').replace(/\\\\\\//g,'/');\n  const attr=raw.match(/(?:src|data-src|content)=[\"'](https:\\/\\/images\\d*\\.vinted\\.net\\/[^\"'<>\\s]+)[\"']/i);\n  if(attr)return cleanListingImageUrl(attr[1]);\n  const any=raw.match(/https:\\/\\/images\\d*\\.vinted\\.net\\/[^\"'<>\\s]+/i);\n  return cleanListingImageUrl(any?.[0]);\n}\nfunction extractOgListingImage(html){\n  const raw=decodeHtml(String(html)).replace(/\\\\u0026/gi,'&').replace(/\\\\u002F/gi,'/').replace(/\\\\\\//g,'/');\n  const a=raw.match(/<meta[^>]+property=[\"']og:image[\"'][^>]+content=[\"']([^\"']+)[\"']/i);\n  const b=raw.match(/<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+property=[\"']og:image[\"']/i);\n  return cleanListingImageUrl(a?.[1]??b?.[1])??extractFirstListingImage(raw);\n}\nasync function fetchFirstListingImage(url){\n  if(!url)return null;\n  try{return extractOgListingImage(await fetchText(url));}catch(error){console.warn(\`Listing image fetch failed: ${'${'}error.message}\`);return null;}\n}\n\n${helperAnchor}`
  );

  const senderAnchor = 'async function sendDiscord(url,a){const u=new URL(url);';
  if (!src.includes(senderAnchor)) throw new Error('Discord image sender target not found');
  src = src.replace(
    senderAnchor,
    `${MARKER}\nasync function sendDiscord(url,a){const imageUrl=a?.item?.imageUrl||await fetchFirstListingImage(a?.item?.url);const u=new URL(url);`
  );

  const embedTail = 'timestamp:new Date().toISOString()}]};';
  if (!src.includes(embedTail)) throw new Error('Discord embed image target not found');
  src = src.replace(
    embedTail,
    "timestamp:new Date().toISOString(),...(imageUrl?{image:{url:imageUrl}}:{})}]};"
  );

  await fs.writeFile(radarUrl, src);
}
