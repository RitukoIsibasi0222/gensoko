// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  assertExpectedApiUrl,
  assertNoFrontendSecrets,
  formatVercelBuildFailure,
  validateFunctionConfigs,
  validateVercelOutputConfig
} from '../scripts/vercel-build-contract.mjs';

describe('Vercel Build Output契約', () => {
  it('検証失敗時はstack traceを含めず安全なmessageだけを出力する', () => {
    const error = new Error('SSR catch-all routeが生成されていません');

    expect(formatVercelBuildFailure(error)).toBe(
      'Vercel Preview build契約の検証に失敗しました: SSR catch-all routeが生成されていません'
    );
    expect(formatVercelBuildFailure(error)).not.toContain(error.stack);
    expect(formatVercelBuildFailure('JWT_SECRET=secret-value')).toBe(
      'Vercel Preview build契約の検証に失敗しました: 不明なエラー'
    );
  });

  it('version 3とSSR catch-all routeを必須にする', () => {
    expect(() =>
      validateVercelOutputConfig({
        version: 3,
        routes: [{ src: '/.*', dest: '/![-]/catchall' }]
      })
    ).not.toThrow();

    expect(() => validateVercelOutputConfig({ version: 2, routes: [] })).toThrow(
      'Vercel Build Outputのversion 3が必要です'
    );
    expect(() => validateVercelOutputConfig({ version: 3, routes: [] })).toThrow(
      'SSR catch-all routeが生成されていません'
    );
  });

  it('すべてのFunctionをNode.js 22へ固定する', () => {
    expect(() => validateFunctionConfigs([{ runtime: 'nodejs22.x' }], 'nodejs22.x')).not.toThrow();
    expect(() => validateFunctionConfigs([{ runtime: 'nodejs24.x' }], 'nodejs22.x')).toThrow(
      'Vercel Function runtimeがnodejs22.xではありません'
    );
  });

  it('client成果物に期待する公開API URLを必須にする', () => {
    const expectedApiUrl = 'https://staging-api.example.invalid/api/v1';

    expect(() =>
      assertExpectedApiUrl(['const api="' + expectedApiUrl + '"'], expectedApiUrl)
    ).not.toThrow();
    expect(() => assertExpectedApiUrl(['const api=""'], expectedApiUrl)).toThrow(
      'VITE_API_BASE_URLが成果物に含まれていません'
    );
  });

  it.each(['DATABASE_URL', 'JWT_SECRET', 'RATE_LIMIT_KEY_SECRET', 'MAIL_API_KEY'])(
    'frontend成果物への%s混入を拒否する',
    (secretName) => {
      expect(() => assertNoFrontendSecrets(['const value="public"'])).not.toThrow();
      expect(() => assertNoFrontendSecrets(['const leaked="' + secretName + '"'])).toThrow(
        'frontend成果物にsecret識別子が含まれています'
      );
    }
  );
});
