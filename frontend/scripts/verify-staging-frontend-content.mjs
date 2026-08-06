import { pathToFileURL } from 'node:url';

const FIXED_STAGING_URL = 'https://gensoko-frontend-staging-develop.vercel.app/';
const REQUEST_TIMEOUT_MS = 15_000;

function isExpectedUrl(candidateUrl, domainUrl) {
  try {
    const candidate = new URL(candidateUrl);
    const domain = new URL(domainUrl);
    return (
      candidate.protocol === 'https:' &&
      candidate.pathname === '/' &&
      candidate.search === '' &&
      candidate.hash === '' &&
      candidate.username === '' &&
      candidate.password === '' &&
      /^[a-z0-9-]+\.vercel\.app$/.test(candidate.hostname) &&
      candidate.origin !== new URL(FIXED_STAGING_URL).origin &&
      domain.href === FIXED_STAGING_URL
    );
  } catch {
    return false;
  }
}

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

export async function verifyStagingFrontendContent({
  candidateUrl,
  domainUrl,
  smokeMarker,
  bypassSecret,
  fetchImpl = fetch
}) {
  if (
    !isExpectedUrl(candidateUrl, domainUrl) ||
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
    return (
      candidateHtml !== null &&
      domainHtml !== null &&
      candidateHtml === domainHtml &&
      domainHtml.includes(smokeMarker)
    );
  } catch {
    return false;
  }
}

const isCli =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  const verified = await verifyStagingFrontendContent({
    candidateUrl: process.env.STAGING_CANDIDATE_URL ?? '',
    domainUrl: process.env.STAGING_DOMAIN_URL ?? '',
    smokeMarker: process.env.STAGING_SMOKE_MARKER ?? '',
    bypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? ''
  });
  if (!verified) {
    process.exitCode = 1;
  }
}
