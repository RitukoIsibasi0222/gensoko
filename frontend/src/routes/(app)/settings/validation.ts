/**
 * 現在のパスワード入力を検証する。
 * 呼び出し元で trim 済みの値を渡す前提。
 */
export function validateCurrentPassword(value: string): string | null {
  if (!value) {
    return '現在のパスワードを入力してください';
  }
  return null;
}

/**
 * 新しいパスワードと確認用パスワードの一致を検証する。
 * 呼び出し元で trim 済みの値を渡す前提。
 */
export function validateConfirmPassword(
  normalizedNewPassword: string,
  normalizedConfirmPassword: string
): string | null {
  if (!normalizedConfirmPassword) {
    return '確認用パスワードを入力してください';
  }

  if (normalizedNewPassword !== normalizedConfirmPassword) {
    return '確認用パスワードが一致しません';
  }

  return null;
}

/**
 * アカウント削除の確認チェックを検証する。
 */
export function validateDeleteAcknowledgement(checked: boolean): string | null {
  if (!checked) {
    return 'アカウント削除の確認チェックを入れてください';
  }
  return null;
}
