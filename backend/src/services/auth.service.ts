import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { sign } from "hono/jwt";
import { prisma } from "../lib/prisma.js";
import { mailer } from "../lib/mail.js";
import type { Role } from "@prisma/client";

/** フロントエンドのベース URL を返す。環境変数が未設定の場合は開発用デフォルトを使用する */
function getFrontendBaseUrl(): string {
  return process.env.FRONTEND_URL ?? "http://localhost:5174";
}

export class AuthError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 500,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export async function register(input: {
  username: string;
  email: string;
  password: string;
}): Promise<void> {
  const { username, email, password } = input;

  // 1. DB にメールまたはユーザー名の重複チェック + ユーザー作成をトランザクションで実行
  const { token } = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findFirst({
      where: { OR: [{ email }, { username }] },
      select: { id: true },
    });
    if (existing) {
      throw new AuthError(409, "メールアドレスまたはユーザー名が既に使用されています");
    }

    // 2. パスワードをハッシュ化（コスト=12）
    const passwordHash = await bcrypt.hash(password, 12);

    // 3. ユーザー作成
    const user = await tx.user.create({
      data: { username, email, passwordHash },
      select: { id: true },
    });

    // 4. メール認証トークン生成（平文をメール送信用に保持、ハッシュをDB保存）
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24時間

    await tx.emailVerification.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    return { token };
  });

  // 5. メール送信（DB 確定後に実行。DB トランザクション内で外部 I/O を待たないよう分離）
  // 送信失敗時はユーザーが emailVerified: false のまま残る（再送信フローで対応可能）
  const verifyUrl = `${getFrontendBaseUrl()}/verify-email?token=${token}`;

  await mailer.sendMail({
    from: process.env.MAIL_FROM ?? "noreply@gensoko.app",
    to: email,
    subject: "【元素庫】メールアドレスの確認",
    text: `以下のURLをクリックしてメールアドレスを確認してください（有効期限: 24時間）\n\n${verifyUrl}`,
    html: `<p>以下のURLをクリックしてメールアドレスを確認してください（有効期限: 24時間）</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
  });
}

const MAX_LOGIN_FAIL = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15分
const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15分
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日

export async function issueRefreshToken(userId: string): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt },
  });

  return rawToken;
}

export async function logout(rawToken: string): Promise<void> {
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  // deleteMany で P2025 を回避（存在しないトークンでも正常終了）
  await prisma.refreshToken.deleteMany({ where: { tokenHash } });
}

export async function refreshAccessToken(rawToken: string): Promise<{
  accessToken: string;
  newRefreshToken: string;
  user: { id: string; role: Role };
}> {
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, role: true, isActive: true } } },
  });

  if (!record) {
    throw new AuthError(401, "無効なリフレッシュトークンです");
  }

  if (record.expiresAt < new Date()) {
    // deleteMany で P2025 を回避（並行リクエストで既に削除済みの場合も安全）
    await prisma.refreshToken.deleteMany({ where: { tokenHash } });
    throw new AuthError(401, "リフレッシュトークンの有効期限が切れています");
  }

  if (!record.user.isActive) {
    await prisma.refreshToken.deleteMany({ where: { tokenHash } });
    throw new AuthError(403, "アカウントが停止されています");
  }

  // トークンローテーション: トランザクションで旧トークン削除と新トークン作成を原子的に実行
  const newRawToken = randomBytes(32).toString("hex");
  const newTokenHash = createHash("sha256").update(newRawToken).digest("hex");
  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await prisma.$transaction(async (tx) => {
    // count=0 の場合は並行リクエストで既に使用済み → 旧トークンの単回使用を担保
    const { count } = await tx.refreshToken.deleteMany({ where: { tokenHash } });
    if (count === 0) {
      throw new AuthError(401, "無効なリフレッシュトークンです");
    }
    await tx.refreshToken.create({
      data: { userId: record.user.id, tokenHash: newTokenHash, expiresAt: newExpiresAt },
    });
  });

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");

  const now = Math.floor(Date.now() / 1000);
  const accessToken = await sign(
    { sub: record.user.id, role: record.user.role, iat: now, exp: now + ACCESS_TOKEN_TTL_SEC },
    secret,
    "HS256",
  );

  return {
    accessToken,
    newRefreshToken: newRawToken,
    user: { id: record.user.id, role: record.user.role },
  };
}

export async function login(input: { email: string; password: string }): Promise<{
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string; role: Role };
}> {
  const { email, password } = input;

  // 1. ユーザー取得
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      username: true,
      role: true,
      passwordHash: true,
      emailVerified: true,
      isActive: true,
      loginFailCount: true,
      lockedUntil: true,
    },
  });

  if (!user) {
    throw new AuthError(401, "メールアドレスまたはパスワードが正しくありません");
  }

  // 2. アカウント停止チェック
  if (!user.isActive) {
    throw new AuthError(403, "アカウントが停止されています");
  }

  // 3. メール確認チェック
  if (!user.emailVerified) {
    throw new AuthError(403, "メールアドレスが確認されていません");
  }

  // 4. ブルートフォースロックチェック
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AuthError(401, "しばらく後に再試行してください");
  }

  // ロック期限切れの場合は failCount をリセットしてから検証（再ロックを防ぐ）
  let currentFailCount = user.loginFailCount;
  if (user.lockedUntil && user.lockedUntil <= new Date()) {
    await prisma.user.update({
      where: { id: user.id },
      data: { loginFailCount: 0, lockedUntil: null },
    });
    currentFailCount = 0;
  }

  // 5. パスワード検証
  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    const newFailCount = Math.min(currentFailCount + 1, MAX_LOGIN_FAIL);
    const updateData: { loginFailCount: number; lockedUntil?: Date } = {
      loginFailCount: newFailCount,
    };
    if (newFailCount >= MAX_LOGIN_FAIL) {
      updateData.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
    }
    await prisma.user.update({ where: { id: user.id }, data: updateData });
    throw new AuthError(401, "メールアドレスまたはパスワードが正しくありません");
  }

  // 6. ログイン成功: failCount リセット・lastLoginAt 更新
  await prisma.user.update({
    where: { id: user.id },
    data: { loginFailCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  // 7. JWT 発行
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");

  const now = Math.floor(Date.now() / 1000);
  const accessToken = await sign(
    { sub: user.id, role: user.role, iat: now, exp: now + ACCESS_TOKEN_TTL_SEC },
    secret,
    "HS256",
  );

  // 8. streak 更新
  await updateLoginStreak(user.id);

  // 9. リフレッシュトークン発行
  const refreshToken = await issueRefreshToken(user.id);

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, username: user.username, role: user.role },
  };
}

async function updateLoginStreak(userId: string): Promise<void> {
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);

  const stats = await prisma.userStats.findUnique({
    where: { userId },
    select: { currentStreak: true, lastActiveDate: true },
  });

  // 今日すでにログイン済みの場合はスキップ
  if (stats?.lastActiveDate) {
    const lastUTC = new Date(stats.lastActiveDate);
    lastUTC.setUTCHours(0, 0, 0, 0);
    if (lastUTC.getTime() === todayUTC.getTime()) {
      return;
    }
  }

  let newStreak: number;
  if (!stats?.lastActiveDate) {
    newStreak = 1;
  } else {
    const lastUTC = new Date(stats.lastActiveDate);
    lastUTC.setUTCHours(0, 0, 0, 0);
    const diffDays = Math.round((todayUTC.getTime() - lastUTC.getTime()) / (24 * 60 * 60 * 1000));
    newStreak = diffDays === 1 ? stats.currentStreak + 1 : 1;
  }

  await prisma.userStats.upsert({
    where: { userId },
    create: { userId, currentStreak: newStreak, lastActiveDate: new Date() },
    update: { currentStreak: newStreak, lastActiveDate: new Date() },
  });
}

export async function verifyEmail(input: { token: string }): Promise<void> {
  const { token } = input;

  // 1. tokenをsha256ハッシュ化してDBと照合
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const record = await prisma.emailVerification.findUnique({
    where: { tokenHash },
  });

  // 2. レコードなし
  if (!record) {
    throw new AuthError(404, "無効なトークンです");
  }

  // 3. 有効期限切れ → トークン削除して400
  if (record.expiresAt < new Date()) {
    await prisma.emailVerification.delete({ where: { tokenHash } });
    throw new AuthError(400, "トークンの有効期限が切れています");
  }

  // 4. ユーザーの認証状態を確認
  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { emailVerified: true },
  });

  if (user?.emailVerified) {
    throw new AuthError(400, "既にメールアドレスは確認済みです");
  }

  // 5. トランザクションでトークン削除 + emailVerified を true に更新
  await prisma.$transaction(async (tx) => {
    await tx.emailVerification.delete({ where: { tokenHash } });
    await tx.user.update({
      where: { id: record.userId },
      data: { emailVerified: true },
    });
  });
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1時間

export async function forgotPassword(input: { email: string }): Promise<void> {
  const { email } = input;

  // 1. ユーザー検索
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  // 2. ユーザーが存在しない場合は何もしない（列挙攻撃対策: エラーを返さない）
  // タイミング攻撃対策: ダミーのハッシュ計算で存在するユーザーとの処理時間差を縮める
  // cost=4 にして CPU 負荷を抑える（cost=12 は DoS の踏み台になり得る）
  if (!user) {
    await bcrypt.hash("timing-safe-dummy", 4);
    return;
  }

  // 3. トークン生成（平文はメール送信用に保持、ハッシュはDB保存）
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  const resetUrl = `${getFrontendBaseUrl()}/reset-password?token=${token}`;

  // 4. トークンをDBに確定（upsert で原子的に置き換え）
  await prisma.passwordResetToken.upsert({
    where: { userId: user.id },
    create: { userId: user.id, tokenHash, expiresAt },
    update: { tokenHash, expiresAt },
  });

  // 5. メール送信（失敗時はトークンを削除して無効化する）
  // ※ DB トランザクション内で外部 I/O（SMTP）を待たないよう分離する
  try {
    await mailer.sendMail({
      from: process.env.MAIL_FROM ?? "noreply@gensoko.app",
      to: email,
      subject: "【元素庫】パスワードリセット",
      text: `以下のURLをクリックしてパスワードをリセットしてください（有効期限: 1時間）\n\n${resetUrl}`,
      html: `<p>以下のURLをクリックしてパスワードをリセットしてください（有効期限: 1時間）</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
    });
  } catch (err) {
    // メール送信失敗: DB確定済みトークンを削除して無効化する（次回リクエストで再試行できる）
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    throw err;
  }
}

export async function resetPassword(input: { token: string; password: string }): Promise<void> {
  const { token, password } = input;

  // 1. tokenをsha256ハッシュ化してDBと照合
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });

  // 2. レコードなし
  if (!record) {
    throw new AuthError(404, "無効なトークンです");
  }

  // 3. 有効期限切れ → トークン削除して400
  if (record.expiresAt < new Date()) {
    await prisma.passwordResetToken.deleteMany({ where: { tokenHash } });
    throw new AuthError(400, "トークンの有効期限が切れています");
  }

  // 4. トランザクション: パスワード更新・全RT削除・リセットトークン削除
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.$transaction(async (tx) => {
    // 1. リセットトークン削除（単回使用保証: count=0なら並行リクエストで使用済み）
    const { count } = await tx.passwordResetToken.deleteMany({ where: { tokenHash } });
    if (count === 0) {
      throw new AuthError(404, "無効なトークンです");
    }
    // 2. パスワード更新
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    });
    // 3. 全リフレッシュトークン削除（全デバイスからログアウト）
    await tx.refreshToken.deleteMany({ where: { userId: record.userId } });
  });
}
