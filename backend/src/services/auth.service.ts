import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { mailer } from "../lib/mail.js";

export class AuthError extends Error {
  constructor(
    public readonly status: 400 | 409 | 500,
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
  await prisma.$transaction(async (tx) => {
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

    // tx 内でメール送信（失敗時はロールバック）
    const verifyUrl = `${process.env.FRONTEND_URL ?? "http://localhost:5174"}/verify-email?token=${token}`;

    await mailer.sendMail({
      from: process.env.MAIL_FROM ?? "noreply@gensoko.app",
      to: email,
      subject: "【元素庫】メールアドレスの確認",
      text: `以下のURLをクリックしてメールアドレスを確認してください（有効期限: 24時間）\n\n${verifyUrl}`,
      html: `<p>以下のURLをクリックしてメールアドレスを確認してください（有効期限: 24時間）</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
    });
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
