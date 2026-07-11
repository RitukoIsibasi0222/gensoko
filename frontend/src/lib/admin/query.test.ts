import { describe, expect, it } from 'vitest';

const { normalizeAdminSearchInput, parseAdminListLocation, serializeAdminListLocation } =
  await import('./query');

describe('parseAdminListLocation', () => {
  it('初期状態: query、検索下書き、page stateが空になる', () => {
    const result = parseAdminListLocation(new URLSearchParams(), undefined);

    expect(result.query).toEqual({});
    expect(result.searchDraft).toBe('');
    expect(result.canonicalSearchParams.toString()).toBe('');
    expect(result.canonicalPageState).toEqual({});
    expect(result.needsCanonicalization).toBe(false);
  });

  it('有効なrole/statusをURLから復元する', () => {
    const result = parseAdminListLocation(
      new URLSearchParams('role=ADMIN&status=suspended'),
      undefined
    );

    expect(result.query).toEqual({ role: 'ADMIN', status: 'suspended' });
    expect(result.canonicalSearchParams.toString()).toBe('role=ADMIN&status=suspended');
    expect(result.needsCanonicalization).toBe(false);
  });

  it('不正なrole/statusをURLから除去してcanonicalizationを要求する', () => {
    const result = parseAdminListLocation(
      new URLSearchParams('role=OWNER&status=unknown'),
      undefined
    );

    expect(result.query).toEqual({});
    expect(result.canonicalSearchParams.toString()).toBe('');
    expect(result.needsCanonicalization).toBe(true);
  });

  it('URLのq/cursorを利用せず除去し、page stateの値だけを復元する', () => {
    const result = parseAdminListLocation(
      new URLSearchParams('q=leaked%40example.com&cursor=url-cursor&role=USER'),
      {
        q: 'state@example.com',
        cursor: 'state-cursor'
      }
    );

    expect(result.query).toEqual({
      q: 'state@example.com',
      cursor: 'state-cursor',
      role: 'USER'
    });
    expect(result.searchDraft).toBe('state@example.com');
    expect(result.canonicalSearchParams.toString()).toBe('role=USER');
    expect(result.needsCanonicalization).toBe(true);
  });

  it('正規化済みpage stateのq/cursorを復元する', () => {
    const result = parseAdminListLocation(new URLSearchParams(), {
      q: 'taro@example.com',
      cursor: 'cursor-1'
    });

    expect(result.query).toEqual({
      q: 'taro@example.com',
      cursor: 'cursor-1'
    });
    expect(result.searchDraft).toBe('taro@example.com');
    expect(result.canonicalPageState).toEqual({
      q: 'taro@example.com',
      cursor: 'cursor-1'
    });
    expect(result.needsCanonicalization).toBe(false);
  });

  it('型が不正なpage stateを破棄してcanonicalizationを要求する', () => {
    const result = parseAdminListLocation(new URLSearchParams(), {
      q: 123,
      cursor: false
    });

    expect(result.query).toEqual({});
    expect(result.canonicalPageState).toEqual({});
    expect(result.needsCanonicalization).toBe(true);
  });

  it('未正規化または101文字のpage stateを復元しない', () => {
    const result = parseAdminListLocation(new URLSearchParams(), {
      q: ' x ',
      cursor: ' cursor ',
      extra: 'ignored'
    });
    const tooLong = parseAdminListLocation(new URLSearchParams(), {
      q: 'a'.repeat(101)
    });

    expect(result.query).toEqual({});
    expect(result.canonicalPageState).toEqual({});
    expect(result.needsCanonicalization).toBe(true);
    expect(tooLong.query).toEqual({});
    expect(tooLong.needsCanonicalization).toBe(true);
  });

  it('管理外のURL queryを保持しつつq/cursorだけを除去する', () => {
    const result = parseAdminListLocation(
      new URLSearchParams('source=internal&q=secret&cursor=secret-cursor'),
      undefined
    );

    expect(result.canonicalSearchParams.toString()).toBe('source=internal');
    expect(result.needsCanonicalization).toBe(true);
  });
});

describe('normalizeAdminSearchInput', () => {
  it('前後空白を一度だけ除去した検索語を返す', () => {
    expect(normalizeAdminSearchInput('  taro@example.com  ')).toEqual({
      success: true,
      value: 'taro@example.com'
    });
  });

  it('空白だけなら未指定へ正規化する', () => {
    expect(normalizeAdminSearchInput('   ')).toEqual({
      success: true,
      value: undefined
    });
  });

  it('100文字は許可する', () => {
    const value = 'a'.repeat(100);

    expect(normalizeAdminSearchInput(value)).toEqual({
      success: true,
      value
    });
  });

  it('101文字は画面表示用の日本語エラーを返す', () => {
    expect(normalizeAdminSearchInput('a'.repeat(101))).toEqual({
      success: false,
      message: '検索キーワードは100文字以内で入力してください'
    });
  });
});

describe('serializeAdminListLocation', () => {
  it('role/statusをURL、q/cursorをpage stateへ分離する', () => {
    const result = serializeAdminListLocation({
      role: 'ADMIN',
      status: 'active',
      q: 'taro@example.com',
      cursor: 'cursor-1'
    });

    expect(result.searchParams.toString()).toBe('role=ADMIN&status=active');
    expect(result.pageState).toEqual({
      q: 'taro@example.com',
      cursor: 'cursor-1'
    });
  });

  it('未指定値を文字列undefinedとして保存しない', () => {
    const result = serializeAdminListLocation({
      role: undefined,
      status: undefined,
      q: undefined,
      cursor: undefined
    });

    expect(result.searchParams.toString()).toBe('');
    expect(result.pageState).toEqual({});
  });

  it('検索・filter変更時にcursorを渡さなければpage stateから確実に消える', () => {
    const searchChanged = serializeAdminListLocation({
      q: 'new-search'
    });
    const filterChanged = serializeAdminListLocation({
      role: 'USER',
      status: 'suspended'
    });

    expect(searchChanged.pageState).toEqual({ q: 'new-search' });
    expect(filterChanged.searchParams.toString()).toBe('role=USER&status=suspended');
    expect(filterChanged.pageState).toEqual({});
  });
});
