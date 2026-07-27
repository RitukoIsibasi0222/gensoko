import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  M2_STAGING_FIXTURE,
  M2StagingFixtureError,
  armM2EmailVerification,
  preflightM2StagingFixture,
  removeM2StagingFixture,
  validateM2StagingFixtureEnvironment,
  type M2StagingFixtureClient,
} from "./stagingReleaseCandidateFixtures.js";

type TestFixtureUser = Readonly<{
  id: string;
  username: string;
  email: string;
  role: "USER" | "ADMIN";
  emailVerified: boolean;
  isActive: boolean;
  deletedAt: Date | null;
  passwordResetToken: Readonly<{ id: string }> | null;
  _count: Readonly<Record<string, number>>;
}>;

function exactUser(): TestFixtureUser {
  return {
    id: "fixture-user-id",
    username: M2_STAGING_FIXTURE.username,
    email: M2_STAGING_FIXTURE.email,
    role: "USER" as const,
    emailVerified: false,
    isActive: true,
    deletedAt: null,
    passwordResetToken: null,
    _count: {
      refreshTokens: 0,
      weakElements: 0,
      gameSessions: 0,
      gameQuestionSets: 0,
      emailVerifications: 1,
    },
  };
}

function createClient(rows: TestFixtureUser[] = []): M2StagingFixtureClient {
  const transactionClient = {
    user: {
      findMany: vi.fn().mockResolvedValue(rows),
      deleteMany: vi.fn().mockResolvedValue({ count: rows.length }),
    },
    emailVerification: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: "verification-id" }),
    },
    refreshToken: { count: vi.fn().mockResolvedValue(0) },
    passwordResetToken: { count: vi.fn().mockResolvedValue(0) },
    weakElement: { count: vi.fn().mockResolvedValue(0) },
    gameSession: { count: vi.fn().mockResolvedValue(0) },
    gameQuestionSet: { count: vi.fn().mockResolvedValue(0) },
    userStats: { count: vi.fn().mockResolvedValue(0) },
  };
  return {
    ...transactionClient,
    $transaction: vi.fn(async (callback, options) => {
      expect(options).toEqual({ isolationLevel: "Serializable" });
      return await callback(transactionClient);
    }),
  } as unknown as M2StagingFixtureClient;
}

describe("M2 staging fixture", () => {
  it("staging完全一致environmentだけをDB接続前に受理する", () => {
    expect(() =>
      validateM2StagingFixtureEnvironment({
        BATCH_ENVIRONMENT: "production",
        STAGING_SUPABASE_PROJECT_REF: "staging-ref",
        DATABASE_URL: "postgresql://user:secret@db.staging-ref.supabase.co/postgres",
        M2_STAGING_FIXTURE_ENABLED: "true",
      }),
    ).toThrow("M2 staging fixture設定が不正です");
  });

  it("予約identityが0件の場合だけpreflightをclearにする", async () => {
    await expect(preflightM2StagingFixture({ client: createClient() })).resolves.toEqual({
      status: "clear",
    });
  });

  it("emailまたはusername衝突は削除せずpresentにする", async () => {
    const client = createClient([{ ...exactUser(), username: "partial-collision" }]);
    await expect(preflightM2StagingFixture({ client })).rejects.toMatchObject({
      status: "present",
    });
    expect(client.user.deleteMany).not.toHaveBeenCalled();
  });

  it("完全一致Userだけへephemeral token hashをSerializableで設定する", async () => {
    const client = createClient([exactUser()]);
    const token = "ab".repeat(32);
    await expect(
      armM2EmailVerification({
        client,
        token,
        expiresAt: new Date("2026-07-28T01:00:00.000Z"),
      }),
    ).resolves.toEqual({ status: "clear" });
    expect(client.emailVerification.create).toHaveBeenCalledWith({
      data: {
        userId: "fixture-user-id",
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date("2026-07-28T01:00:00.000Z"),
      },
      select: { id: true },
    });
  });

  it.each([
    { emailVerified: true },
    { role: "ADMIN" as const },
    { isActive: false },
    { deletedAt: new Date() },
  ])("User状態不一致は上書きせずpresentにする", async (change) => {
    const client = createClient([{ ...exactUser(), ...change }]);
    await expect(
      armM2EmailVerification({ client, token: "ab".repeat(32), expiresAt: new Date() }),
    ).rejects.toMatchObject({ status: "present" });
    expect(client.emailVerification.deleteMany).not.toHaveBeenCalled();
  });

  it("transaction競合はraw errorを保持せずunknownにする", async () => {
    const client = createClient([exactUser()]);
    vi.mocked(client.$transaction).mockRejectedValueOnce(new Error("secret database detail"));
    const error = await armM2EmailVerification({
      client,
      token: "ab".repeat(32),
      expiresAt: new Date(),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(M2StagingFixtureError);
    expect(error).toMatchObject({ status: "unknown" });
    expect(String(error)).not.toContain("secret database detail");
  });

  it("cleanupは0件をclear、完全一致1件を削除後residue 0でclearにする", async () => {
    await expect(removeM2StagingFixture({ client: createClient() })).resolves.toEqual({
      status: "clear",
      deletedUsers: 0,
    });
    await expect(removeM2StagingFixture({ client: createClient([exactUser()]) })).resolves.toEqual({
      status: "clear",
      deletedUsers: 1,
    });
  });
});
