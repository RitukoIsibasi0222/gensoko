import { randomUUID } from "crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { AuditResult } from "@prisma/client";
import prismaClientModule from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../lib/password.js";

const { PrismaClient } = prismaClientModule;
const connectionString = process.env.AUDIT_INTEGRATION_DATABASE_URL;
const runIntegrationTest = typeof connectionString === "string" && connectionString.length > 0;
const allowedDatabaseHosts = new Set(["localhost", "127.0.0.1", "postgres"]);

describe.skipIf(!runIntegrationTest)("監査ログの実DB rollback", () => {
  const uniqueSuffix = randomUUID();
  const userId = `audit-rollback-${uniqueSuffix}`;
  const auditLogId = `audit-collision-${uniqueSuffix}`;
  let prisma: InstanceType<typeof PrismaClient> | undefined;

  beforeAll(async () => {
    const databaseUrl = new URL(connectionString!);
    if (!allowedDatabaseHosts.has(databaseUrl.hostname)) {
      throw new Error("監査integration testはローカルDocker PostgreSQLでのみ実行できます");
    }

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString! }),
    });

    const passwordHash = await hashPassword("IntegrationPass1!");
    await prisma.user.create({
      data: {
        id: userId,
        username: `audit_rb_${uniqueSuffix.replaceAll("-", "").slice(0, 16)}`,
        email: `audit-${uniqueSuffix}@example.com`,
        passwordHash,
        emailVerified: true,
      },
    });
    await prisma.auditLog.create({
      data: {
        id: auditLogId,
        action: "LOGIN",
        result: AuditResult.FAILURE,
        actorId: null,
        actorRole: null,
        targetType: null,
        targetId: null,
        failureReason: "AUTHENTICATION_FAILED",
      },
    });
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }

    await prisma.auditLog.deleteMany({ where: { id: auditLogId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("監査insertが主キー競合で失敗した場合は直前のユーザー更新もrollbackする", async () => {
    const client = prisma!;
    let transactionError: unknown;

    try {
      await client.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { isActive: false },
        });
        await tx.auditLog.create({
          data: {
            id: auditLogId,
            action: "PASSWORD_CHANGE",
            result: AuditResult.SUCCESS,
            actorId: userId,
            actorRole: "USER",
            targetType: "USER",
            targetId: userId,
            failureReason: null,
          },
        });
      });
    } catch (error) {
      transactionError = error;
    }

    expect(transactionError).toMatchObject({ code: "P2002" });

    const [user, auditLogCount] = await Promise.all([
      client.user.findUnique({ where: { id: userId }, select: { isActive: true } }),
      client.auditLog.count({ where: { id: auditLogId } }),
    ]);

    expect(user).toEqual({ isActive: true });
    expect(auditLogCount).toBe(1);
  });
});
