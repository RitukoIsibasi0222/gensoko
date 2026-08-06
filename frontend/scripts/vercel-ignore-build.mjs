import { spawnSync } from 'node:child_process';

const BUILD = 1;
const SKIP = 0;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

const commitRef = process.env.VERCEL_GIT_COMMIT_REF ?? '';

if (commitRef === 'main') {
  process.exit(BUILD);
}

if (commitRef !== 'develop') {
  process.exit(SKIP);
}

const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA ?? '';
const currentSha = process.env.VERCEL_GIT_COMMIT_SHA ?? '';

if (!SHA_PATTERN.test(previousSha) || !SHA_PATTERN.test(currentSha)) {
  process.exit(BUILD);
}

const result = spawnSync('git', ['diff', '--quiet', previousSha, currentSha, '--', '.'], {
  stdio: 'ignore'
});

if (result.status === SKIP) {
  process.exit(SKIP);
}

process.exit(BUILD);
