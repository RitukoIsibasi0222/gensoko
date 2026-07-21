import { describe, expect, it } from 'vitest';

import { parseApiBaseUrl } from './base-url';

describe('parseApiBaseUrl', () => {
  it('local開発用HTTP URLを正規化して返す', () => {
    expect(
      parseApiBaseUrl('  http://localhost:3000/api/v1  ', {
        allowMissing: false,
        requireHttps: false
      })
    ).toBe('http://localhost:3000/api/v1');
  });

  it('Preview用HTTPS URLを返す', () => {
    expect(
      parseApiBaseUrl('https://staging-api.example.invalid/api/v1', {
        allowMissing: false,
        requireHttps: true
      })
    ).toBe('https://staging-api.example.invalid/api/v1');
  });

  it.each([undefined, '', '   '])('必須環境で未設定・空白の値を拒否する: %s', (value) => {
    expect(() => parseApiBaseUrl(value, { allowMissing: false, requireHttps: true })).toThrow(
      'VITE_API_BASE_URLが設定されていません'
    );
  });

  it('開発環境では未設定を既存の警告用空文字として扱う', () => {
    expect(
      parseApiBaseUrl(undefined, {
        allowMissing: true,
        requireHttps: false
      })
    ).toBe('');
  });

  it.each([
    'not-a-url',
    'ftp://staging-api.example.invalid/api/v1',
    'https://user:password@staging-api.example.invalid/api/v1',
    'https://staging-api.example.invalid/api/v1?debug=true',
    'https://staging-api.example.invalid/api/v1#fragment',
    'https://staging-api.example.invalid',
    'https://staging-api.example.invalid/api/v1/'
  ])('API URL契約外の値を拒否する: %s', (value) => {
    expect(() => parseApiBaseUrl(value, { allowMissing: false, requireHttps: false })).toThrow(
      'VITE_API_BASE_URLの形式が不正です'
    );
  });

  it('PreviewではHTTP URLを拒否する', () => {
    expect(() =>
      parseApiBaseUrl('http://staging-api.example.invalid/api/v1', {
        allowMissing: false,
        requireHttps: true
      })
    ).toThrow('Preview・productionのVITE_API_BASE_URLにはHTTPS URLが必要です');
  });
});
