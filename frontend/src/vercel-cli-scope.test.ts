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
      repositoryFile('.github/actions/vercel-preview-domain/action.yml'),
      repositoryFile('.github/workflows/staging-release-candidate-campaign.yml')
    ];

    for (const source of sources) {
      expect(source).toContain('VERCEL_ORG_ID');
      expect(source).toContain('VERCEL_PROJECT_ID');
      expect(source).not.toMatch(/--scope(?:=|\s+)[^\n]*VERCEL_ORG_ID/);
    }
  });

  it('project限定tokenではlistとread-only content照合だけを使いprovider状態を変更しない', () => {
    const action = repositoryFile('.github/actions/vercel-preview-domain/action.yml');

    expect(action).toContain('list gensoko-frontend-staging');
    expect(action).toContain('frontend/scripts/verify-staging-frontend-content.mjs');
    expect(action).not.toContain('alias ls');
    expect(action).not.toContain(' inspect ');
    expect(action).not.toContain('alias set');
    expect(action).not.toContain('alias rm');
    expect(action).not.toMatch(/vercel@[^\n]+ deploy/);
    expect(action).not.toContain('api.vercel.com/v9/projects/');
    expect(action).not.toContain('/v13/deployments/');
  });
});
