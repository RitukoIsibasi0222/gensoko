import { describe, expect, it } from 'vitest';
import {
  validateConfirmPassword,
  validateCurrentPassword,
  validateDeleteAcknowledgement
} from './validation';

describe('validateCurrentPassword', () => {
  it('空欄ならエラー', () => {
    expect(validateCurrentPassword('')).toBe('現在のパスワードを入力してください');
  });

  it('値があればnull', () => {
    expect(validateCurrentPassword('CurrentPass1!')).toBeNull();
  });
});

describe('validateConfirmPassword', () => {
  it('確認用パスワードが空欄ならエラー', () => {
    expect(validateConfirmPassword('NewPass1!', '')).toBe('確認用パスワードを入力してください');
  });

  it('新しいパスワードと不一致ならエラー', () => {
    expect(validateConfirmPassword('NewPass1!', 'WrongPass1!')).toBe(
      '確認用パスワードが一致しません'
    );
  });

  it('一致していればnull', () => {
    expect(validateConfirmPassword('NewPass1!', 'NewPass1!')).toBeNull();
  });
});

describe('validateDeleteAcknowledgement', () => {
  it('未チェックならエラー', () => {
    expect(validateDeleteAcknowledgement(false)).toBe(
      'アカウント削除の確認チェックを入れてください'
    );
  });

  it('チェック済みならnull', () => {
    expect(validateDeleteAcknowledgement(true)).toBeNull();
  });
});
