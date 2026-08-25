const urls = [
  'https://www.hotstock.io/uk',
  'https://www.hotstock.io/sitemap.xml',
  'https://www.hotstock.io/uk/sitemap.xml',
  'https://www.hotstock.io/sitemap_index.xml'
];
for (const url of urls) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 DanVaultMonitor/1.0', accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' }, signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    console.log('\nURL', url, 'status', r.status, 'chars', text.length, 'type', r.headers.get('content-type'));
    console.log(text.slice(0, 5000));
    const productLinks = [...text.matchAll(/(?:https:\/\/www\.hotstock\.io)?\/uk\/p\/[^"'<>\s)]+/g)].map(m => m[0]);
    console.log('productLinks', [...new Set(productLinks)].slice(0, 50));
  } catch (e) { console.log('FAIL', url, e.message); }
}
