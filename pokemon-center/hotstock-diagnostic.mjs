const url = 'https://www.hotstock.io/uk/p/pokemon-tcg-scarlet-and-violet-151-elite-trainer-box-9-boosters-and-premium-accessories';
const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 DanVaultMonitor/1.0', accept: 'text/html,*/*' }, signal: AbortSignal.timeout(20000) });
const text = await r.text();
console.log('status', r.status, 'chars', text.length);
for (const needle of ['Pokemon Center','OUT OF STOCK','IN STOCK','__NUXT__','api/','productRetailers','retailer']) {
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  console.log('\nNEEDLE', needle, 'index', idx);
  if (idx >= 0) console.log(text.slice(Math.max(0, idx - 2500), Math.min(text.length, idx + 5000)));
}
const scripts = [...text.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
console.log('\nSCRIPTS', scripts);
const apiish = [...text.matchAll(/https?:\\?\/\\?\/[^"'<>\s]+|\/api\/[^"'<>\s]+/g)].map(m=>m[0]);
console.log('\nAPIISH', [...new Set(apiish)].slice(0,150));
