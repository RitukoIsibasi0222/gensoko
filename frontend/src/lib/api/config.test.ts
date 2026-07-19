import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('API config', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('開発環境では空白だけのAPI URLを未設定として警告する', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '   ');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { API_BASE_URL } = await import('./config');

    expect(API_BASE_URL).toBe('');
    expect(warn).toHaveBeenCalledOnce();
  });
});
