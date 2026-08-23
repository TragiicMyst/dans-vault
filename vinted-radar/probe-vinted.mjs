import fs from 'node:fs/promises';

const urls = [
  ['p6000','https://www.vinted.co.uk/catalog?search_text=nike%20p-6000&order=newest_first'],
  ['air-force-1','https://www.vinted.co.uk/catalog?search_text=nike%20air%20force%201&order=newest_first'],
  ['tech-fleece','https://www.vinted.co.uk/catalog?search_text=nike%20tech%20fleece&order=newest_first']
];

const headers = {
  'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  'Accept':'text/html,application/xhtml+xml',
  'Accept-Language':'en-GB,en;q=0.9',
  'Cache-Control':'no-cache'
};

const out = [];
for (const [name,url] of urls) {
  try {
    const r = await fetch(url,{headers,redirect:'follow',signal:AbortSignal.timeout(12000)});
    const body = await r.text();
    const low = body.toLowerCase();
    const text = body.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g,' ').trim() ?? null;
    const counts = {
      itemHref: (body.match(/\/items\/\d+/g)||[]).length,
      unicodeItemHref: (body.match(/\\u002Fitems\\u002F\d+/g)||[]).length,
      itemId: (body.match(/"item_id"\s*:/g)||[]).length,
      itemIdCamel: (body.match(/"itemId"\s*:/g)||[]).length,
      idFields: (body.match(/"id"\s*:\s*\d+/g)||[]).length,
      itemsKeys: (body.match(/"items"\s*:/g)||[]).length
    };
    const phrases = ['no items','no results','nothing found','captcha','access denied','cf-chl-','please verify'];
    out.push({name,url,status:r.status,ok:r.ok,finalUrl:r.url,bodyLength:body.length,title,counts,phrases:Object.fromEntries(phrases.map(p=>[p,low.includes(p)])),textHead:text.slice(0,1500)});
  } catch (e) {
    out.push({name,url,error:String(e?.stack||e)});
  }
  await new Promise(r=>setTimeout(r,2200));
}
await fs.writeFile(new URL('./probe-result.json',import.meta.url), JSON.stringify({at:new Date().toISOString(),results:out},null,2)+'\n');
console.log(JSON.stringify(out,null,2));
