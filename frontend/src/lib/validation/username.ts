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
