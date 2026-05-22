/**
 * ユーザー登録フォームのバリデーション関数
 *
 * すべての関数は trim 済みの値を受け取る前提（関数内で trim しない）。
 * バックエンドの registerSchema / strongPasswordSchema と一致させること。
 * （backend/src/routes/auth/index.ts 参照）
 */

/**
 * ユーザー名のバリデーション
 *
 * 制約:
 * - 必須
 * - 3〜20文字
 * - 英数字とアンダースコアのみ（/^[a-zA-Z0-9_]+$/）
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
 * 制約:
 * - 必須
 * - メール形式（/^[^\s@]+@[^\s@]+\.[^\s@]+$/）
 *
 * @param value - trim 済みのメールアドレス
 * @returns エラーメッセージ（エラーがない場合は null）
 */
export function validateEmail(value: string): string | null {
  if (!value) {
    return 'メールアドレスを入力してください';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return '有効なメールアドレスを入力してください';
  }
  return null;
}

/**
 * パスワードのバリデーション
 *
 * 制約（バックエンドの strongPasswordSchema と一致）:
 * - 必須
 * - スペース禁止
 * - 8文字以上
 * - 英大文字を1文字以上含む
 * - 英小文字を1文字以上含む
 * - 数字を1文字以上含む
 * - 記号（!@#$%^&*()_+-=[]{}など）を1文字以上含む
 *
 * @param value - trim 済みのパスワード
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
