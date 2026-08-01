/** 認証関連で使う文字列正規化（先頭/末尾の空白除去） */
export function normalizePassword(rawPassword: string): string {
  return rawPassword.trim();
}
