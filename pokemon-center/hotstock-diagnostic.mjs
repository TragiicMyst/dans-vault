const home = await fetch('https://www.hotstock.io/uk', { headers: { 'user-agent': 'Mozilla/5.0 DanVaultMonitor/1.0' }, signal: AbortSignal.timeout(20000) }).then(r => r.text());
const scripts = [...home.matchAll(/<script[^>]+src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
console.log('scripts', scripts);
for (const src of scripts) {
  const url = new URL(src, 'https://www.hotstock.io').href;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const js = await r.text();
    console.log('\nFILE', src, 'status', r.status, 'chars', js.length);
    const needles = ['api/proxy','/products','searchSuggestions','suggestions','apiBase','recentproducts','popularproducts'];
    for (const needle of needles) {
      let idx = 0;
      let count = 0;
      while ((idx = js.indexOf(needle, idx)) >= 0 && count < 8) {
        console.log('MATCH', needle, js.slice(Math.max(0, idx - 600), Math.min(js.length, idx + 1400)));
        idx += needle.length;
        count++;
      }
    }
  } catch (e) {
    console.log('FAIL', src, e.message);
  }
}
