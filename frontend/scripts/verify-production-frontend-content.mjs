import { pathToFileURL } from 'node:url';

import {
  verifyFrontendContent,
  verifySingleFrontendContent
} from './frontend-content-verifier.mjs';

function isProviderHostname(hostname) {
  return ['vercel.app', 'workers.dev'].some(
    (provider) => hostname === provider || hostname.endsWith(`.${provider}`)
  );
}

function isExpectedProductionUrl(candidateUrl, domainUrl) {
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
      !candidate.hostname.includes('staging') &&
      domain.protocol === 'https:' &&
      domain.pathname === '/' &&
      domain.search === '' &&
      domain.hash === '' &&
      domain.username === '' &&
      domain.password === '' &&
      !isProviderHostname(domain.hostname) &&
      !domain.hostname.includes('staging') &&
      candidate.origin !== domain.origin
    );
  } catch {
    return false;
  }
}

function isExpectedProductionCandidateUrl(candidateUrl) {
  try {
    const candidate = new URL(candidateUrl);
    return (
      candidate.protocol === 'https:' &&
      candidate.pathname === '/' &&
      candidate.search === '' &&
      candidate.hash === '' &&
      candidate.username === '' &&
      candidate.password === '' &&
      /^[a-z0-9-]+\.vercel\.app$/.test(candidate.hostname) &&
      !candidate.hostname.includes('staging')
    );
  } catch {
    return false;
  }
}

export async function verifyProductionFrontendCandidate({
  candidateUrl,
  smokeMarker,
  bypassSecret,
  fetchImpl = fetch
}) {
  if (!isExpectedProductionCandidateUrl(candidateUrl)) return false;
  return verifySingleFrontendContent({ candidateUrl, smokeMarker, bypassSecret, fetchImpl });
}

export async function verifyProductionFrontendContent({
  candidateUrl,
  domainUrl,
  smokeMarker,
  bypassSecret,
  fetchImpl = fetch
}) {
  if (!isExpectedProductionUrl(candidateUrl, domainUrl)) return false;
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
  const options = {
    candidateUrl: process.env.PRODUCTION_CANDIDATE_URL ?? '',
    smokeMarker: process.env.PRODUCTION_SMOKE_MARKER ?? '',
    bypassSecret: process.env.PRODUCTION_VERCEL_AUTOMATION_BYPASS_SECRET ?? ''
  };
  const verified =
    process.env.PRODUCTION_VERIFY_MODE === 'candidate'
      ? await verifyProductionFrontendCandidate(options)
      : await verifyProductionFrontendContent({
          ...options,
          domainUrl: process.env.PRODUCTION_DOMAIN_URL ?? ''
        });
  if (!verified) process.exitCode = 1;
}
