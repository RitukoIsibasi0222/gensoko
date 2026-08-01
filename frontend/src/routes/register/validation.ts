import { isValidEmailFormat } from '$lib/validation/email';
export { validatePassword } from '$lib/validation/password';
export { validateUsername } from '$lib/validation/username';

/**
 * ユーザー登録フォームのバリデーション関数
 *
 * すべての関数は trim 済みの値を受け取る前提（関数内で trim しない）。
 * validatePassword も trim 済みの値を受け取る（先頭/末尾スペースは呼び出し元で除去済み。内部スペースのみ検知して弾く）。
 * ユーザー名・パスワードの制約はバックエンドの registerSchema / strongPasswordSchema に準拠させること。
 * ※「準拠」であり「完全一致」ではない: 空欄時のエラーメッセージ等、フロント独自の文言を持つ場合がある。
 *   バックエンドと異なる部分は各関数の JSDoc に「フロント独自」として明記すること。
 * メールアドレスは $lib/validation/email.ts の簡易チェックを使用する（バックエンドは z.string().email() でより厳密に検証）。
 * （backend/src/routes/auth/index.ts 参照）
 */

/**
 * メールアドレスのバリデーション
 *
 * - 必須
 * - 簡易形式チェック（`$lib/validation/email.ts` の `isValidEmailFormat` を使用）
 *   - バックエンドは `z.string().email()` でより厳密に検証するため、こちらは「明らかな入力ミスの早期検知」が目的
 *
 * フロント独自（バックエンドとの差分）:
 * - 空欄時: 「メールアドレスを入力してください」
 *   （バックエンド Zod は email() のエラー「有効なメールアドレスを入力してください」）
 * - 形式チェック: 簡易正規表現による早期検知（バックエンドは RFC 準拠の z.string().email() でより厳密に検証）
 *
 * @param value - trim 済みのメールアドレス
 * @returns エラーメッセージ（エラーがない場合は null）
 */
export function validateEmail(value: string): string | null {
  if (!value) {
    return 'メールアドレスを入力してください';
  }
  if (!isValidEmailFormat(value)) {
    return '有効なメールアドレスを入力してください';
  }
  return null;
}
