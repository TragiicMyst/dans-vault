const target = 'https://www.pokemoncenter.com/en-gb/search/pokemon-tcg';
const url = `https://r.jina.ai/${target}`;
const r = await fetch(url, {
  headers: {
    'x-no-cache': 'true',
    'x-cache-tolerance': '0',
    'x-locale': 'en-GB',
    'x-referer': 'https://www.pokemoncenter.com/en-gb/'
  },
  signal: AbortSignal.timeout(60000)
});
const text = await r.text();
console.log('status=', r.status, 'chars=', text.length);
console.log('--- BEGIN SNIPPET ---');
console.log(text.slice(0, 12000));
console.log('--- END SNIPPET ---');
const urls = [...text.matchAll(/https?:\/\/[^\s)\]]+/g)].map(m => m[0]);
console.log('urls=', urls.slice(0, 120));
