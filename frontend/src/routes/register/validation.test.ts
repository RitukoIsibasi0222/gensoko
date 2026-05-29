import { describe, it, expect } from 'vitest';
import { validateEmail, validatePassword } from './validation';

describe('validateEmail', () => {
  it('空欄 → エラー', () => {
    expect(validateEmail('')).toBe('メールアドレスを入力してください');
  });

  it('@ なし → エラー', () => {
    expect(validateEmail('userexample.com')).toBe('有効なメールアドレスを入力してください');
  });

  it('ドメインにドットなし → エラー', () => {
    expect(validateEmail('user@domain')).toBe('有効なメールアドレスを入力してください');
  });

  it('@ の前が空 → エラー', () => {
    expect(validateEmail('@example.com')).toBe('有効なメールアドレスを入力してください');
  });

  it('有効なメールアドレス → null', () => {
    expect(validateEmail('user@example.com')).toBeNull();
  });

  it('サブドメイン付き → null', () => {
    expect(validateEmail('user@mail.example.co.jp')).toBeNull();
  });

  it('ローカルパートにドット・プラス → null', () => {
    expect(validateEmail('user.name+tag@example.com')).toBeNull();
  });
});

describe('validatePassword', () => {
  it('空欄 → エラー', () => {
    expect(validatePassword('')).toBe('パスワードを入力してください');
  });

  it('スペース含む（内部）→ エラー', () => {
    // 先頭/末尾スペースは呼び出し元で trim されるため、ここでは内部スペースのみを検証する
    expect(validatePassword('Pass word1!')).toBe('パスワードにスペースは使用できません');
  });

  it('7文字（最小境界値 -1、他条件すべて満たす）→ エラー', () => {
    // P(大) a(小) s(小) s(小) 1(数) !(記号) a(小) = 7文字
    expect(validatePassword('Pass1!a')).toBe('パスワードは8文字以上にしてください');
  });

  it('8文字（最小境界値、他条件すべて満たす）→ null', () => {
    expect(validatePassword('Passw0r!')).toBeNull();
  });

  it('英大文字なし → エラー', () => {
    expect(validatePassword('password1!')).toBe('パスワードには英大文字を1文字以上含めてください');
  });

  it('英小文字なし → エラー', () => {
    expect(validatePassword('PASSWORD1!')).toBe('パスワードには英小文字を1文字以上含めてください');
  });

  it('数字なし → エラー', () => {
    expect(validatePassword('Password!!')).toBe('パスワードには数字を1文字以上含めてください');
  });

  it('記号なし → エラー', () => {
    expect(validatePassword('Password1a')).toBe('パスワードには記号を1文字以上含めてください');
  });

  it('各種記号（!@#$%^&*）→ null', () => {
    expect(validatePassword('Password1!')).toBeNull();
    expect(validatePassword('Password1@')).toBeNull();
    expect(validatePassword('Password1#')).toBeNull();
    expect(validatePassword('Password1$')).toBeNull();
  });

  it('記号（_+-=[]{}）→ null', () => {
    expect(validatePassword('Password1_')).toBeNull();
    expect(validatePassword('Password1+')).toBeNull();
    expect(validatePassword('Password1-')).toBeNull();
  });

  it('全条件満たす長いパスワード → null', () => {
    expect(validatePassword('MyStr0ngP@ssword!')).toBeNull();
  });
});
