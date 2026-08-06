// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function repositoryFile(path: string): string {
  const filePath = join(REPOSITORY_ROOT, path);
  expect(existsSync(filePath)).toBe(true);
  return readFileSync(filePath, 'utf8');
}

describe('Vercel CLI CI scope contract', () => {
  it('team IDをslug用--scopeへ渡さずCI環境IDでprojectを固定する', () => {
    const sources = [
      repositoryFile('.github/workflows/staging-frontend-deploy.yml'),
      repositoryFile('.github/actions/vercel-preview-alias/action.yml'),
      repositoryFile('.github/workflows/staging-release-candidate-campaign.yml')
    ];

    for (const source of sources) {
      expect(source).toContain('VERCEL_ORG_ID');
      expect(source).toContain('VERCEL_PROJECT_ID');
      expect(source).not.toMatch(/--scope(?:=|\s+)[^\n]*VERCEL_ORG_ID/);
    }
  });
});
