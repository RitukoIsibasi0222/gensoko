import { pathToFileURL } from 'node:url';

import { verifyFrontendContent } from './frontend-content-verifier.mjs';

const FIXED_STAGING_URL = 'https://gensoko-frontend-staging-develop.vercel.app/';

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

  return verifyFrontendContent({
    candidateUrl,
    domainUrl,
    smokeMarker,
    bypassSecret,
    fetchImpl
  });
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
