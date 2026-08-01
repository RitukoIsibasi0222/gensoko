/**
 * メールアドレスの簡易形式チェック（フロントエンド共通）
 *
 * フロントエンドでの入力補助として「明らかな入力ミスを早期に検知する」ことが目的。
 * バックエンドは z.string().email()（RFC 準拠）で検証しており、
 * こちらの正規表現よりも厳密な検証が行われる。
 *
 * login・register の両ページから参照する。
 * 正規表現を変更する場合はこのファイルのみ修正すればよい。
 */

/** メールアドレス簡易チェック用正規表現（`@` と ドットを含む形式） */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * メールアドレスが簡易形式チェックを通過するか判定する。
 * @param value - チェックする文字列（trim 済みを想定）
 * @returns 形式が有効なら true
 */
export function isValidEmailFormat(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}
