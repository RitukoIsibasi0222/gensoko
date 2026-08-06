// @vitest-environment node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = fileURLToPath(
  new URL('../../.github/workflows/frontend-pr-quality.yml', import.meta.url)
);
const PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url));
const ACTION_PATH = fileURLToPath(
  new URL('../../.github/actions/frontend-quality/action.yml', import.meta.url)
);

describe('frontend pull request quality workflow', () => {
  it('develop・main向けPRのfrontend変更で必須品質checkをNode.js 22上で実行する', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    const action = readFileSync(ACTION_PATH, 'utf8');
    const qualityContract = `${workflow}\n${action}`;

    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('branches: [develop, main]');
    expect(workflow).toContain('"frontend/**"');
    expect(workflow).toContain('".github/actions/frontend-quality/**"');
    expect(workflow).toContain('".github/workflows/production-deploy.yml"');
    expect(workflow).toContain('uses: ./.github/actions/frontend-quality');
    expect(qualityContract).toContain('node-version: 22');
    expect(qualityContract).toContain('npm ci');
    expect(qualityContract).toContain('npm run test:run');
    expect(qualityContract).toContain('npm run lint');
    expect(qualityContract).toContain('npm run check');
    expect(qualityContract).toContain('npm run format:check');
    expect(qualityContract).toContain('npm run build:preview');
    expect(qualityContract).toContain('npm audit --audit-level=moderate');
  });

  it('fixture公開URL・最小権限・重複実行cancel・timeoutを設定する', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    const action = readFileSync(ACTION_PATH, 'utf8');
    const qualityContract = `${workflow}\n${action}`;

    expect(qualityContract).toContain('VERCEL_ENV: preview');
    expect(workflow).toContain('git-ref: ${{ github.base_ref }}');
    expect(qualityContract).toContain(
      'VITE_API_BASE_URL: https://staging-api.example.invalid/api/v1'
    );
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('cancel-in-progress: true');
    expect(workflow).toContain('timeout-minutes: 15');
  });

  it('lintとformat確認を生成物を除外した非破壊scriptにする', () => {
    const packageManifest = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageManifest.scripts?.lint).toBe('eslint .');
    expect(packageManifest.scripts?.['format:check']).toBe('prettier --check .');
  });
});
