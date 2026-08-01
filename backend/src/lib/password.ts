import bcrypt from "bcryptjs";

const PASSWORD_HASH_COST = 12;

export const BCRYPT_MAX_PASSWORD_BYTES = 72;
export const PASSWORD_TOO_LONG_MESSAGE = "パスワードはUTF-8で72バイト以内にしてください";

/** bcryptが入力を切り捨てずに処理できる範囲か判定する */
export function isPasswordWithinBcryptLimit(password: string): boolean {
  return !bcrypt.truncates(password);
}

/** DB保存用のパスワードhashを共通のcostで生成する */
export async function hashPassword(password: string): Promise<string> {
  if (!isPasswordWithinBcryptLimit(password)) {
    throw new Error(PASSWORD_TOO_LONG_MESSAGE);
  }

  return bcrypt.hash(password, PASSWORD_HASH_COST);
}
