import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = join(process.cwd(), 'scripts', 'vercel-ignore-build.mjs');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createRepository(): { frontend: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'gensoko-vercel-ignore-'));
  const frontend = join(root, 'frontend');
  mkdirSync(frontend);
  mkdirSync(join(root, 'docs'));
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Gensoko Test');
  git(root, 'config', 'user.email', 'gensoko-test@example.test');
  writeFileSync(join(frontend, 'app.txt'), 'initial\n');
  writeFileSync(join(root, 'docs', 'runbook.md'), 'initial\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'initial');
  return { frontend, root };
}

function runScript(
  cwd: string,
  commitRef: string,
  previousSha?: string,
  currentSha?: string
): number | null {
  return spawnSync(process.execPath, [SCRIPT_PATH], {
    cwd,
    env: {
      ...process.env,
      VERCEL_GIT_COMMIT_REF: commitRef,
      VERCEL_GIT_PREVIOUS_SHA: previousSha ?? '',
      VERCEL_GIT_COMMIT_SHA: currentSha ?? ''
    },
    encoding: 'utf8'
  }).status;
}

describe('Vercel Ignored Build Step', () => {
  it('developのfrontend無変更commitはskipし、変更commitはbuildする', () => {
    const { frontend, root } = createRepository();
    const initial = git(root, 'rev-parse', 'HEAD');

    writeFileSync(join(root, 'docs', 'runbook.md'), 'docs only\n');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'docs');
    const docsOnly = git(root, 'rev-parse', 'HEAD');
    expect(runScript(frontend, 'develop', initial, docsOnly)).toBe(0);

    writeFileSync(join(frontend, 'app.txt'), 'updated\n');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'frontend');
    const frontendChange = git(root, 'rev-parse', 'HEAD');
    expect(runScript(frontend, 'develop', docsOnly, frontendChange)).toBe(1);
  });

  it('mainは現行production buildを維持し、feature branchはskipする', () => {
    const { frontend, root } = createRepository();
    const sha = git(root, 'rev-parse', 'HEAD');

    expect(runScript(frontend, 'main', sha, sha)).toBe(1);
    expect(runScript(frontend, 'feature/example', sha, sha)).toBe(0);
  });

  it('developで差分判定不能ならfail-openでbuildする', () => {
    const { frontend } = createRepository();

    expect(runScript(frontend, 'develop')).toBe(1);
  });
});
