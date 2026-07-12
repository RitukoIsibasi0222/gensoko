import { z } from "zod";
import { isPasswordWithinBcryptLimit, PASSWORD_TOO_LONG_MESSAGE } from "../password.js";

export const usernameSchema = z
  .string()
  .min(3, "ユーザー名は3文字以上にしてください")
  .max(20, "ユーザー名は20文字以内にしてください")
  .regex(/^[a-zA-Z0-9_]+$/, "ユーザー名は英数字とアンダースコアのみ使用できます");

export const emailSchema = z.string().email("有効なメールアドレスを入力してください");

// 認証関連で共通利用するパスワード強度チェック
export const strongPasswordSchema = z
  .string()
  .min(8, "パスワードは8文字以上にしてください")
  .regex(/[A-Z]/, "パスワードには英大文字を1文字以上含めてください")
  .regex(/[a-z]/, "パスワードには英小文字を1文字以上含めてください")
  .regex(/[0-9]/, "パスワードには数字を1文字以上含めてください")
  .regex(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/, "パスワードには記号を1文字以上含めてください")
  .refine((value) => !/ /.test(value), "パスワードにスペースは使用できません")
  .refine(isPasswordWithinBcryptLimit, PASSWORD_TOO_LONG_MESSAGE);
