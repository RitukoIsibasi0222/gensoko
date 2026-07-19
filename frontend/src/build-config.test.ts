// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import config from '../svelte.config.js';

type PackageManifest = {
  devDependencies?: Record<string, string>;
};

type PackageLock = {
  packages?: Record<string, PackageManifest>;
};

const frontendRoot = process.cwd();

async function readFrontendFile(path: string): Promise<string> {
  return readFile(resolve(frontendRoot, path), 'utf8');
}

describe('Vercel Preview build設定契約', () => {
  it('adapter-vercelを明示的に使用する', () => {
    expect(config.kit?.adapter?.name).toBe('@sveltejs/adapter-vercel');
  });

  it('adapter-vercelだけを直接依存としてlockする', async () => {
    const packageManifest = JSON.parse(await readFrontendFile('package.json')) as PackageManifest;
    const packageLock = JSON.parse(await readFrontendFile('package-lock.json')) as PackageLock;

    expect(packageManifest.devDependencies?.['@sveltejs/adapter-vercel']).toBeDefined();
    expect(packageManifest.devDependencies?.['@sveltejs/adapter-auto']).toBeUndefined();
    expect(packageLock.packages?.['']?.devDependencies?.['@sveltejs/adapter-vercel']).toBeDefined();
    expect(packageLock.packages?.['']?.devDependencies?.['@sveltejs/adapter-auto']).toBeUndefined();
    expect(packageLock.packages?.['node_modules/@sveltejs/adapter-vercel']).toBeDefined();
  });

  it('Previewの公開API URLだけを例示しsecretやproduction URLを保持しない', async () => {
    const envExample = await readFrontendFile('.env.example');
    const activeKeys = envExample
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => line.split('=', 1)[0]);

    expect(activeKeys).toEqual(['VITE_API_BASE_URL']);
    expect(envExample).toContain('develop');
    expect(envExample).toContain('Preview');
    expect(envExample).toContain('公開');
    expect(envExample).toContain('secret');
    expect(envExample).not.toContain('api.gensoko.workers.dev');
    expect(envExample).not.toMatch(
      /^\s*(DATABASE_URL|JWT_SECRET|RATE_LIMIT_KEY_SECRET|MAIL_API_KEY)=/m
    );
  });
});
