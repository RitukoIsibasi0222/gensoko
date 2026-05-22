import type { MiddlewareHandler } from "hono";
import { verify } from "hono/jwt";
import { prisma } from "../../lib/prisma.js";
import type { AppVariables, JwtPayload } from "../../types/index.js";

/** JWT_SECRET を取得（未設定は起動時にエラー） */
const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
};

/**
 * authMiddleware（必須認証）
 *
 * 使い方:
 *   app.get("/users/me", authMiddleware, (c) => {
 *     const user = c.get("user"); // { id, role }
 *   });
 */
export const authMiddleware: MiddlewareHandler<{
  Variables: AppVariables;
}> = async (c, next) => {
  // 1. Authorization ヘッダーを取得
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "認証が必要です" }, 401);
  }

  // 2. "Bearer " の後ろのトークン部分を取り出す
  const token = authHeader.slice(7);

  // 3. JWT の署名を検証（期限切れ・改ざんを検知）
  let payload: JwtPayload;
  try {
    payload = (await verify(token, getJwtSecret(), "HS256")) as JwtPayload;
  } catch {
    return c.json({ error: "トークンが無効です" }, 401);
  }

  // 4. DB からユーザーを取得（必要な項目のみ select）
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      role: true,
      isActive: true,
      emailVerified: true,
      lockedUntil: true,
    },
  });

  if (!user) {
    return c.json({ error: "ユーザーが見つかりません" }, 401);
  }

  // 5. アカウント状態チェック
  if (!user.isActive) {
    return c.json({ error: "アカウントが停止されています" }, 403);
  }

  if (!user.emailVerified) {
    return c.json({ error: "メールアドレスが確認されていません" }, 403);
  }

  // JWT 発行後にアカウントがロックされたケースも弾く
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return c.json({ error: "アカウントがロックされています" }, 403);
  }

  // 6. 後続のハンドラで使えるようにユーザー情報をセット
  c.set("user", { id: user.id, role: user.role });
  await next();
};

/**
 * optionalAuthMiddleware（任意認証）
 *
 * ログインしていなくても通過するが、
 * トークンがある場合は検証して user をセットする。
 * トークンがあって不正な場合は 401 を返す。
 *
 * 使い方:
 *   app.get("/elements", optionalAuthMiddleware, (c) => {
 *     const user = c.get("user"); // ログイン時: { id, role } / 未ログイン: undefined
 *   });
 */
export const optionalAuthMiddleware: MiddlewareHandler<{
  Variables: AppVariables;
}> = async (c, next) => {
  const authHeader = c.req.header("Authorization");

  // トークンなし → そのまま通す（user は未セット）
  if (!authHeader) {
    await next();
    return;
  }

  if (!authHeader.startsWith("Bearer ")) {
    return c.json({ error: "認証形式が正しくありません" }, 401);
  }

  const token = authHeader.slice(7);

  let payload: JwtPayload;
  try {
    payload = (await verify(token, getJwtSecret(), "HS256")) as JwtPayload;
  } catch {
    return c.json({ error: "トークンが無効です" }, 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      role: true,
      isActive: true,
      emailVerified: true,
      lockedUntil: true,
    },
  });

  // ユーザーが有効な場合のみセット（無効なら未セットのまま通す）
  if (user?.isActive && user.emailVerified) {
    c.set("user", { id: user.id, role: user.role });
  }

  await next();
};
