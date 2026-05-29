import { describe, it, expect } from 'vitest';
import { validateUsername } from './username';

describe('validateUsername', () => {
  it('空欄 → エラー', () => {
    expect(validateUsername('')).toBe('ユーザー名を入力してください');
  });

  it('2文字（最小境界値 -1）→ エラー', () => {
    expect(validateUsername('ab')).toBe('ユーザー名は3文字以上にしてください');
  });

  it('3文字（最小境界値）→ null', () => {
    expect(validateUsername('abc')).toBeNull();
  });

  it('20文字（最大境界値）→ null', () => {
    expect(validateUsername('a'.repeat(20))).toBeNull();
  });

  it('21文字（最大境界値 +1）→ エラー', () => {
    expect(validateUsername('a'.repeat(21))).toBe('ユーザー名は20文字以内にしてください');
  });

  it('ハイフン含む → エラー', () => {
    expect(validateUsername('user-name')).toBe(
      'ユーザー名は英数字とアンダースコアのみ使用できます'
    );
  });

  it('スペース含む → エラー', () => {
    expect(validateUsername('user name')).toBe(
      'ユーザー名は英数字とアンダースコアのみ使用できます'
    );
  });

  it('日本語含む → エラー', () => {
    expect(validateUsername('ユーザー')).toBe('ユーザー名は英数字とアンダースコアのみ使用できます');
  });

  it('英字のみ → null', () => {
    expect(validateUsername('username')).toBeNull();
  });

  it('数字のみ → null', () => {
    expect(validateUsername('123')).toBeNull();
  });

  it('英数字+アンダースコア → null', () => {
    expect(validateUsername('user_123')).toBeNull();
  });
});
