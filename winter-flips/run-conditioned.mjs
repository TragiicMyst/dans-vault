const nativeFetch = globalThis.fetch;

// Force source-level condition filters before the Winter Flips engine sees results.
// Vinted status IDs: 6 = New with tags, 1 = New without tags.
// eBay condition ID 1000 = New / Brand New (category display name may vary).
globalThis.fetch = async (input, init) => {
  let url;
  try {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    url = new URL(raw);
  } catch {
    return nativeFetch(input, init);
  }

  if (url.hostname === 'www.vinted.co.uk' && url.pathname === '/catalog') {
    url.searchParams.delete('status_ids[]');
    url.searchParams.delete('status_ids');
    url.searchParams.append('status_ids[]', '6');
    url.searchParams.append('status_ids[]', '1');
  }

  if ((url.hostname === 'www.ebay.co.uk' || url.hostname === 'ebay.co.uk') && url.pathname.startsWith('/sch/')) {
    url.searchParams.set('LH_ItemCondition', '1000');
  }

  return nativeFetch(url.toString(), init);
};

await import('./engine.mjs');
