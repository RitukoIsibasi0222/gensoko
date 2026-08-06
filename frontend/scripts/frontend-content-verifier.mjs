const REQUEST_TIMEOUT_MS = 15_000;

async function fetchHtml(url, headers, fetchImpl) {
  const response = await fetchImpl(url, {
    cache: 'no-store',
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (
    response.status !== 200 ||
    new URL(response.url).origin !== new URL(url).origin ||
    !response.headers.get('content-type')?.includes('text/html')
  ) {
    return null;
  }
  return response.text();
}

export function immutableAssetFingerprint(html, pageUrl) {
  const pageOrigin = new URL(pageUrl).origin;
  const assets = new Set();
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    try {
      const asset = new URL(match[1], pageUrl);
      if (asset.origin === pageOrigin && asset.pathname.startsWith('/_app/immutable/')) {
        assets.add(`${asset.pathname}${asset.search}`);
      }
    } catch {
      // Malformed provider markup is outside the application fingerprint.
    }
  }
  return [...assets].sort();
}

export async function verifyFrontendContent({
  candidateUrl,
  domainUrl,
  smokeMarker,
  bypassSecret,
  fetchImpl = fetch
}) {
  if (
    typeof smokeMarker !== 'string' ||
    smokeMarker.length === 0 ||
    typeof bypassSecret !== 'string'
  ) {
    return false;
  }
  const headers = {
    'cache-control': 'no-cache',
    ...(bypassSecret ? { 'x-vercel-protection-bypass': bypassSecret } : {})
  };
  try {
    const [candidateHtml, domainHtml] = await Promise.all([
      fetchHtml(candidateUrl, headers, fetchImpl),
      fetchHtml(domainUrl, headers, fetchImpl)
    ]);
    if (candidateHtml === null || domainHtml === null) return false;
    const candidateAssets = immutableAssetFingerprint(candidateHtml, candidateUrl);
    const domainAssets = immutableAssetFingerprint(domainHtml, domainUrl);
    return (
      candidateHtml.includes(smokeMarker) &&
      domainHtml.includes(smokeMarker) &&
      candidateAssets.length > 0 &&
      candidateAssets.length === domainAssets.length &&
      candidateAssets.every((asset, index) => asset === domainAssets[index])
    );
  } catch {
    return false;
  }
}

export async function verifySingleFrontendContent({
  candidateUrl,
  smokeMarker,
  bypassSecret,
  fetchImpl = fetch
}) {
  if (
    typeof smokeMarker !== 'string' ||
    smokeMarker.length === 0 ||
    typeof bypassSecret !== 'string'
  ) {
    return false;
  }
  const headers = {
    'cache-control': 'no-cache',
    ...(bypassSecret ? { 'x-vercel-protection-bypass': bypassSecret } : {})
  };
  try {
    const html = await fetchHtml(candidateUrl, headers, fetchImpl);
    return (
      html !== null &&
      html.includes(smokeMarker) &&
      immutableAssetFingerprint(html, candidateUrl).length > 0
    );
  } catch {
    return false;
  }
}
