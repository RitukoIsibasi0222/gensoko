import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { AuditResult } from "@prisma/client";
import prismaClientModule from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../lib/password.js";

const { PrismaClient } = prismaClientModule;
const connectionString = process.env.ACCOUNT_DELETION_INTEGRATION_DATABASE_URL;
const originalDatabaseUrl = process.env.DATABASE_URL;
const runIntegrationTest = typeof connectionString === "string" && connectionString.length > 0;
const allowedDatabaseHosts = new Set(["localhost", "127.0.0.1", "postgres"]);
const REQUIRED_DATABASE_NAME = "gensoko_account_deletion_test";
const PASSWORD = "IntegrationPass1!";
const ELEMENT_ID = 999_913;

type PrismaClientInstance = InstanceType<typeof PrismaClient>;

describe.skipIf(!runIntegrationTest)("account deletionの実DB cascade・監査・rollback", () => {
  let verificationPrisma: PrismaClientInstance | undefined;
  let servicePrisma: (typeof import("../lib/prisma.js"))["prisma"] | undefined;
  let deleteCurrentUser:
    | (typeof import("../services/user.service.js"))["deleteCurrentUser"]
    | undefined;
  let forceDeleteAdminUser:
    | (typeof import("../services/admin.service.js"))["forceDeleteAdminUser"]
    | undefined;

  beforeAll(async () => {
    const databaseUrl = new URL(connectionString!);
    const databaseName = databaseUrl.pathname.replace(/^\//, "");
    if (
      !allowedDatabaseHosts.has(databaseUrl.hostname) ||
      databaseName !== REQUIRED_DATABASE_NAME
    ) {
      throw new Error(
        `account deletion integration testはローカルDockerの${REQUIRED_DATABASE_NAME}でのみ実行できます`,
      );
    }

    process.env.DATABASE_URL = connectionString;
    verificationPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString! }),
    });

    const [userServiceModule, adminServiceModule, prismaModule] = await Promise.all([
      import("../services/user.service.js"),
      import("../services/admin.service.js"),
      import("../lib/prisma.js"),
    ]);
    deleteCurrentUser = userServiceModule.deleteCurrentUser;
    forceDeleteAdminUser = adminServiceModule.forceDeleteAdminUser;
    servicePrisma = prismaModule.prisma;

    await verificationPrisma.auditLog.deleteMany();
    await verificationPrisma.user.deleteMany();
    await verificationPrisma.element.upsert({
      where: { id: ELEMENT_ID },
      update: {},
      create: {
        id: ELEMENT_ID,
        symbol: "T13",
        nameJa: "削除統合試験元素",
        nameEn: "Account Deletion Integration Element",
        category: "integration-test",
        period: 1,
      },
    });
  });

  afterEach(async () => {
    await verificationPrisma?.auditLog.deleteMany();
    await verificationPrisma?.user.deleteMany();
  });

  afterAll(async () => {
    try {
      await verificationPrisma?.auditLog.deleteMany();
      await verificationPrisma?.user.deleteMany();
      await verificationPrisma?.element.deleteMany({ where: { id: ELEMENT_ID } });
    } finally {
      await Promise.allSettled([verificationPrisma?.$disconnect(), servicePrisma?.$disconnect()]);
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    }
  });

  async function createOwnedUserFixture(input: {
    userId: string;
    role?: "USER" | "ADMIN";
  }): Promise<{ email: string; username: string }> {
    const client = verificationPrisma!;
    const role = input.role ?? "USER";
    const uniquePart = randomUUID().replaceAll("-", "");
    const username = `delete_${uniquePart.slice(0, 16)}`;
    const email = `${uniquePart}@example.com`;
    const passwordHash = await hashPassword(PASSWORD);
    const sessionId = `${input.userId}-session`;

    await client.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: input.userId,
          username,
          email,
          passwordHash,
          role,
          emailVerified: true,
        },
      });
      await tx.refreshToken.create({
        data: {
          tokenHash: `${input.userId}-refresh`,
          userId: input.userId,
          expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        },
      });
      await tx.emailVerification.create({
        data: {
          userId: input.userId,
          tokenHash: `${input.userId}-verification`,
          expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        },
      });
      await tx.passwordResetToken.create({
        data: {
          userId: input.userId,
          tokenHash: `${input.userId}-password-reset`,
          expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        },
      });
      await tx.weakElement.create({
        data: { userId: input.userId, elementId: ELEMENT_ID },
      });
      await tx.gameSession.create({
        data: {
          id: sessionId,
          userId: input.userId,
          mode: "SYMBOL_TO_NAME_LV1",
          totalScore: 100,
          correctCount: 1,
          totalCount: 1,
          durationSec: 10,
        },
      });
      await tx.gameAnswer.create({
        data: {
          id: `${input.userId}-answer`,
          sessionId,
          elementId: ELEMENT_ID,
          isCorrect: true,
          answerTimeSec: 1,
        },
      });
      await tx.gameQuestionSet.create({
        data: {
          id: `${input.userId}-question-set`,
          userId: input.userId,
          mode: "SYMBOL_TO_NAME_LV1",
          questions: [{ elementId: ELEMENT_ID, correctElementId: ELEMENT_ID }],
          expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        },
      });
      await tx.userStats.create({ data: { userId: input.userId } });
    });

    return { email, username };
  }

  async function getOwnedRowCounts(userId: string) {
    const client = verificationPrisma!;
    return await Promise.all([
      client.user.count({ where: { id: userId } }),
      client.refreshToken.count({ where: { userId } }),
      client.emailVerification.count({ where: { userId } }),
      client.passwordResetToken.count({ where: { userId } }),
      client.weakElement.count({ where: { userId } }),
      client.gameSession.count({ where: { userId } }),
      client.gameAnswer.count({ where: { sessionId: `${userId}-session` } }),
      client.gameQuestionSet.count({ where: { userId } }),
      client.userStats.count({ where: { userId } }),
    ]);
  }

  it("本人退会は全所有rowをcascade削除し、共有ElementとPIIなし成功監査を残す", async () => {
    const userId = `self-${randomUUID()}`;
    const identity = await createOwnedUserFixture({ userId });

    await deleteCurrentUser!({ userId, currentPassword: PASSWORD });

    expect(await getOwnedRowCounts(userId)).toEqual(Array(9).fill(0));
    expect(await verificationPrisma!.element.count({ where: { id: ELEMENT_ID } })).toBe(1);
    const audits = await verificationPrisma!.auditLog.findMany({
      where: { action: "USER_ACCOUNT_DELETE", targetId: userId },
      select: {
        action: true,
        result: true,
        actorId: true,
        actorRole: true,
        targetType: true,
        targetId: true,
        failureReason: true,
      },
    });
    expect(audits).toEqual([
      {
        action: "USER_ACCOUNT_DELETE",
        result: AuditResult.SUCCESS,
        actorId: userId,
        actorRole: "USER",
        targetType: "USER",
        targetId: userId,
        failureReason: null,
      },
    ]);
    expect(JSON.stringify(audits)).not.toContain(identity.email);
    expect(JSON.stringify(audits)).not.toContain(identity.username);
  });

  it("管理者強制退会はtarget所有rowをcascade削除し、actorとtargetの成功監査を残す", async () => {
    const actorId = `actor-${randomUUID()}`;
    const targetId = `target-${randomUUID()}`;
    await createOwnedUserFixture({ userId: actorId, role: "ADMIN" });
    await createOwnedUserFixture({ userId: targetId });

    await forceDeleteAdminUser!({ adminUserId: actorId, targetUserId: targetId });

    expect(await getOwnedRowCounts(targetId)).toEqual(Array(9).fill(0));
    expect(await verificationPrisma!.user.count({ where: { id: actorId } })).toBe(1);
    expect(
      await verificationPrisma!.auditLog.findMany({
        where: { action: "ADMIN_USER_FORCE_DELETE", targetId },
        select: {
          result: true,
          actorId: true,
          actorRole: true,
          targetType: true,
          targetId: true,
          failureReason: true,
        },
      }),
    ).toEqual([
      {
        result: AuditResult.SUCCESS,
        actorId,
        actorRole: "ADMIN",
        targetType: "USER",
        targetId,
        failureReason: null,
      },
    ]);
  });

  it("監査insertが失敗した場合はUser削除と全cascadeをrollbackする", async () => {
    const userId = `rollback-${randomUUID()}`;
    const collisionAuditId = `collision-${randomUUID()}`;
    await createOwnedUserFixture({ userId });
    await verificationPrisma!.auditLog.create({
      data: {
        id: collisionAuditId,
        action: "LOGIN",
        result: AuditResult.FAILURE,
        failureReason: "AUTHENTICATION_FAILED",
      },
    });

    let transactionError: unknown;
    try {
      await verificationPrisma!.$transaction(async (tx) => {
        await tx.user.delete({ where: { id: userId } });
        await tx.auditLog.create({
          data: {
            id: collisionAuditId,
            action: "USER_ACCOUNT_DELETE",
            result: AuditResult.SUCCESS,
            actorId: userId,
            actorRole: "USER",
            targetType: "USER",
            targetId: userId,
          },
        });
      });
    } catch (error) {
      transactionError = error;
    }

    expect(transactionError).toMatchObject({ code: "P2002" });
    expect(await getOwnedRowCounts(userId)).toEqual(Array(9).fill(1));
    expect(await verificationPrisma!.auditLog.count({ where: { id: collisionAuditId } })).toBe(1);
  });

  it("同一Userへの並行本人退会は1件だけcommitし、成功監査も1件だけ残す", async () => {
    const userId = `concurrent-self-${randomUUID()}`;
    await createOwnedUserFixture({ userId });

    const results = await Promise.allSettled([
      deleteCurrentUser!({ userId, currentPassword: PASSWORD }),
      deleteCurrentUser!({ userId, currentPassword: PASSWORD }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { status: 409 },
    });
    expect(await verificationPrisma!.user.count({ where: { id: userId } })).toBe(0);
    expect(
      await verificationPrisma!.auditLog.count({
        where: { action: "USER_ACCOUNT_DELETE", targetId: userId },
      }),
    ).toBe(1);
  });

  it("2人のADMINが並行して本人退会しても利用可能なADMINを1人残す", async () => {
    const firstAdminId = `concurrent-admin-a-${randomUUID()}`;
    const secondAdminId = `concurrent-admin-b-${randomUUID()}`;
    await createOwnedUserFixture({ userId: firstAdminId, role: "ADMIN" });
    await createOwnedUserFixture({ userId: secondAdminId, role: "ADMIN" });

    const results = await Promise.allSettled([
      deleteCurrentUser!({ userId: firstAdminId, currentPassword: PASSWORD }),
      deleteCurrentUser!({ userId: secondAdminId, currentPassword: PASSWORD }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { status: 409 },
    });
    expect(
      await verificationPrisma!.user.count({
        where: { role: "ADMIN", isActive: true, emailVerified: true, deletedAt: null },
      }),
    ).toBe(1);
    expect(
      await verificationPrisma!.auditLog.count({ where: { action: "USER_ACCOUNT_DELETE" } }),
    ).toBe(1);
  });
});
