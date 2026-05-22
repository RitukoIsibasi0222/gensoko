import { isValidEmailFormat } from '$lib/validation/email';

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
 * ユーザー名のバリデーション
 *
 * 制約（バックエンドの registerSchema に準拠）:
 * - 必須
 * - 3〜20文字
 * - 英数字とアンダースコアのみ（/^[a-zA-Z0-9_]+$/）
 *
 * フロント独自（バックエンドとの差分）:
 * - 空欄時: 「ユーザー名を入力してください」
 *   （バックエンド Zod は min(3) のエラー「ユーザー名は3文字以上にしてください」）
 *
 * @param value - trim 済みのユーザー名
 * @returns エラーメッセージ（エラーがない場合は null）
 */
export function validateUsername(value: string): string | null {
  if (!value) {
    return 'ユーザー名を入力してください';
  }
  if (value.length < 3) {
    return 'ユーザー名は3文字以上にしてください';
  }
  if (value.length > 20) {
    return 'ユーザー名は20文字以内にしてください';
  }
  if (!/^[a-zA-Z0-9_]+$/.test(value)) {
    return 'ユーザー名は英数字とアンダースコアのみ使用できます';
  }
  return null;
}

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

/**
 * パスワードのバリデーション
 *
 * 制約（バックエンドの strongPasswordSchema に準拠）:
 * - 必須
 * - スペース禁止
 * - 8文字以上
 * - 英大文字を1文字以上含む
 * - 英小文字を1文字以上含む
 * - 数字を1文字以上含む
 * - 記号（!@#$%^&*()_+-=[]{}など）を1文字以上含む
 *
 * フロント独自（バックエンドとの差分）:
 * - 空欄時: 「パスワードを入力してください」
 *   （バックエンド Zod は min(8) のエラー「パスワードは8文字以上にしてください」）
 *
 * @param value - trim 済みのパスワード（先頭/末尾スペースは呼び出し元で除去済み。内部スペースのみ検知対象）
 * @returns エラーメッセージ（エラーがない場合は null）
 */
export function validatePassword(value: string): string | null {
  if (!value) {
    return 'パスワードを入力してください';
  }
  if (/ /.test(value)) {
    return 'パスワードにスペースは使用できません';
  }
  if (value.length < 8) {
    return 'パスワードは8文字以上にしてください';
  }
  if (!/[A-Z]/.test(value)) {
    return 'パスワードには英大文字を1文字以上含めてください';
  }
  if (!/[a-z]/.test(value)) {
    return 'パスワードには英小文字を1文字以上含めてください';
  }
  if (!/[0-9]/.test(value)) {
    return 'パスワードには数字を1文字以上含めてください';
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(value)) {
    return 'パスワードには記号を1文字以上含めてください';
  }
  return null;
}
