import bcrypt from "bcryptjs";

const PASSWORD_HASH_COST = 12;

/** DB保存用のパスワードhashを共通のcostで生成する */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PASSWORD_HASH_COST);
}
