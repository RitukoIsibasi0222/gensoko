import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    userStats: {
      create: vi.fn(),
    },
    emailVerification: {
      create: vi.fn(),
    },
    passwordResetToken: {
      create: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../lib/password.js", () => ({
  hashPassword: vi.fn(),
}));

import { hashPassword } from "../lib/password.js";
import { prisma } from "../lib/prisma.js";
import { AdminCreateError, createAdmin } from "./admin-create.service.js";

const INPUT = {
  username: "admin_user",
  email: "Admin@Example.com",
  password: "SecurePass1!",
};

const PASSWORD_HASH = "$2b$12$generated-password-hash";

describe("createAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("平文passwordをhash化し、利用可能な新規ADMINを単一createで保存する", async () => {
    vi.mocked(hashPassword).mockResolvedValue(PASSWORD_HASH);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: "admin-1" } as never);

    await expect(createAdmin(INPUT)).resolves.toBeUndefined();

    expect(hashPassword).toHaveBeenCalledTimes(1);
    expect(hashPassword).toHaveBeenCalledWith(INPUT.password);
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        username: INPUT.username,
        email: INPUT.email,
        passwordHash: PASSWORD_HASH,
        role: "ADMIN",
        emailVerified: true,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });

    const prismaArguments = JSON.stringify(vi.mocked(prisma.user.create).mock.calls);
    expect(prismaArguments).not.toContain(INPUT.password);
  });

  it("作成後にpasswordHashを含む全User列を取得せず、IDだけを返却対象にする", async () => {
    vi.mocked(hashPassword).mockResolvedValue(PASSWORD_HASH);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: "admin-1" } as never);

    await createAdmin(INPUT);

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ select: { id: true } }),
    );
  });

  it("既存ユーザー検索・更新・upsert・transaction・関連model作成を行わない", async () => {
    vi.mocked(hashPassword).mockResolvedValue(PASSWORD_HASH);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: "admin-1" } as never);

    await createAdmin(INPUT);

    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.upsert).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.userStats.create).not.toHaveBeenCalled();
    expect(prisma.emailVerification.create).not.toHaveBeenCalled();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it.each(["username", "email"])(
    "%sのP2002を安全なDUPLICATE_USERエラーへ変換し、既存ユーザーを変更しない",
    async (target) => {
      vi.mocked(hashPassword).mockResolvedValue(PASSWORD_HASH);
      vi.mocked(prisma.user.create).mockRejectedValue({
        code: "P2002",
        message: `duplicate ${target}: ${INPUT.username} / ${INPUT.email}`,
        meta: { target: [target] },
      } as never);

      const error = await createAdmin(INPUT).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AdminCreateError);
      expect(error).toMatchObject({
        code: "DUPLICATE_USER",
        message: "ユーザー名またはメールアドレスは既に使用されています",
      });
      expect(error).not.toMatchObject({
        message: expect.stringContaining(INPUT.username),
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.upsert).not.toHaveBeenCalled();
    },
  );

  it("想定外のPrismaエラーを同じerror objectのまま呼び出し元へ渡す", async () => {
    const prismaError = new Error("database connection failed");
    vi.mocked(hashPassword).mockResolvedValue(PASSWORD_HASH);
    vi.mocked(prisma.user.create).mockRejectedValue(prismaError);

    await expect(createAdmin(INPUT)).rejects.toBe(prismaError);
  });

  it("hash化に失敗した場合はDBへアクセスせず同じerrorを呼び出し元へ渡す", async () => {
    const hashError = new Error("bcrypt failed");
    vi.mocked(hashPassword).mockRejectedValue(hashError);

    await expect(createAdmin(INPUT)).rejects.toBe(hashError);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
