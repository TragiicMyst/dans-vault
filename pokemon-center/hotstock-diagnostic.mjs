import vm from 'node:vm';
const homeUrl = 'https://www.hotstock.io/uk';
const home = await fetch(homeUrl, { headers: { 'user-agent': 'Mozilla/5.0 DanVaultMonitor/1.0' }, signal: AbortSignal.timeout(20000) }).then(r => r.text());
const m = home.match(/<script>window\.__NUXT__=([\s\S]*?)<\/script>/);
if (!m) throw new Error('NUXT state missing');
let expr = m[1].trim();
if (expr.endsWith(';')) expr = expr.slice(0,-1);
const data = vm.runInNewContext(expr, Object.create(null), { timeout: 3000 });
const apiBase = data?.config?.public?.apiBase;
const apiSecret = data?.config?.public?.apiSecret;
console.log('apiBase', apiBase, 'tokenLength', String(apiSecret || '').length);
for (const q of ['pokemon','pokemon tcg','elite trainer box','pokemon center']) {
  const url = `${apiBase}/api/searchsuggestions/${encodeURIComponent(q)}`;
  const r = await fetch(url, {
    headers: { token: apiSecret, region: 'uk', 'user-agent': 'Mozilla/5.0 DanVaultMonitor/1.0' },
    signal: AbortSignal.timeout(20000)
  });
  const text = await r.text();
  console.log('\nQUERY', q, 'status', r.status, 'chars', text.length);
  console.log(text.slice(0, 20000));
}
