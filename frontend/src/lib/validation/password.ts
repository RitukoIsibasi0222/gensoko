export const MAX_PASSWORD_UTF8_BYTES = 72;
export const PASSWORD_TOO_LONG_MESSAGE = 'パスワードはUTF-8で72バイト以内にしてください';
export const PASSWORD_BYTE_LIMIT_HINT =
  'UTF-8で72バイト以内（日本語や絵文字は1文字で複数バイトになります）';

export function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
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
 * - UTF-8で72バイト以内
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
  if (getUtf8ByteLength(value) > MAX_PASSWORD_UTF8_BYTES) {
    return PASSWORD_TOO_LONG_MESSAGE;
  }
  return null;
}
