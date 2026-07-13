import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { AuditResult } from "@prisma/client";
import prismaClientModule from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { PrismaClient } = prismaClientModule;
const connectionString = process.env.AUDIT_CLEANUP_INTEGRATION_DATABASE_URL;
const runIntegrationTest = typeof connectionString === "string" && connectionString.length > 0;
const allowedDatabaseHosts = new Set(["localhost", "127.0.0.1", "postgres"]);
const REQUIRED_DATABASE_NAME = "gensoko_audit_cleanup_test";
const FIXTURE_EXPIRED_COUNT = 501;
const NOW = new Date("2026-07-13T00:00:00.000Z");
const EXPECTED_CUTOFF = new Date("2025-07-13T00:00:00.000Z");

describe.skipIf(!runIntegrationTest)("監査ログcleanupの実DB動作", () => {
  const fixturePrefix = `audit-cleanup-${randomUUID()}`;
  const boundaryId = `${fixturePrefix}-boundary`;
  const retainedId = `${fixturePrefix}-retained`;
  const retiredUserId = `${fixturePrefix}-retired-user`;
  let prisma: InstanceType<typeof PrismaClient> | undefined;
  let cleanupPrisma: InstanceType<typeof PrismaClient> | undefined;
  let cleanupExpiredAuditLogs:
    | (typeof import("./cleanupAuditLogs.js"))["cleanupExpiredAuditLogs"]
    | undefined;

  beforeAll(async () => {
    const databaseUrl = new URL(connectionString!);
    const databaseName = databaseUrl.pathname.replace(/^\//, "");

    if (
      !allowedDatabaseHosts.has(databaseUrl.hostname) ||
      databaseName !== REQUIRED_DATABASE_NAME
    ) {
      throw new Error(
        `監査ログcleanup integration testはローカルDockerの${REQUIRED_DATABASE_NAME}でのみ実行できます`,
      );
    }

    process.env.DATABASE_URL = connectionString;
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString! }),
    });

    const cleanupModule = await import("./cleanupAuditLogs.js");
    const prismaModule = await import("../lib/prisma.js");
    cleanupExpiredAuditLogs = cleanupModule.cleanupExpiredAuditLogs;
    cleanupPrisma = prismaModule.prisma;

    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany({ where: { id: retiredUserId } });
    await prisma.user.create({
      data: {
        id: retiredUserId,
        username: `audit_cleanup_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
        email: `${retiredUserId}@example.com`,
        passwordHash: "integration-test-only",
        emailVerified: true,
      },
    });
    await prisma.auditLog.createMany({
      data: [
        ...Array.from({ length: FIXTURE_EXPIRED_COUNT }, (_, index) => ({
          id: `${fixturePrefix}-expired-${index.toString().padStart(3, "0")}`,
          action: "INTEGRATION_TEST",
          result: AuditResult.SUCCESS,
          actorId: `deleted-user-${index}`,
          actorRole: null,
          targetType: "USER",
          targetId: `deleted-user-${index}`,
          failureReason: null,
          occurredAt: new Date(EXPECTED_CUTOFF.getTime() - 1),
        })),
        {
          id: boundaryId,
          action: "INTEGRATION_TEST",
          result: AuditResult.SUCCESS,
          actorId: "boundary-user",
          actorRole: null,
          targetType: "USER",
          targetId: "boundary-user",
          failureReason: null,
          occurredAt: EXPECTED_CUTOFF,
        },
        {
          id: retainedId,
          action: "INTEGRATION_TEST",
          result: AuditResult.SUCCESS,
          actorId: retiredUserId,
          actorRole: null,
          targetType: "USER",
          targetId: retiredUserId,
          failureReason: null,
          occurredAt: new Date(EXPECTED_CUTOFF.getTime() + 1),
        },
      ],
    });
    await prisma.user.delete({ where: { id: retiredUserId } });
  });

  afterAll(async () => {
    await prisma?.auditLog.deleteMany();
    await prisma?.user.deleteMany({ where: { id: retiredUserId } });
    await Promise.allSettled([prisma?.$disconnect(), cleanupPrisma?.$disconnect()]);
  });

  it("500件を超える期限切れ行だけを分割削除し、境界を保持して再実行可能", async () => {
    const cleanup = cleanupExpiredAuditLogs!;
    const config = { retentionDays: 365, cleanupEnabled: true } as const;
    const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

    await expect(prisma!.user.findUnique({ where: { id: retiredUserId } })).resolves.toBeNull();

    const firstResult = await cleanup({ now: NOW, config, logger });

    expect(firstResult).toMatchObject({
      cutoff: EXPECTED_CUTOFF,
      deletedCount: FIXTURE_EXPIRED_COUNT,
      skipped: false,
      limitReached: false,
    });
    expect(
      await prisma!.auditLog.findMany({
        orderBy: { occurredAt: "asc" },
        select: { id: true, actorId: true, targetId: true, occurredAt: true },
      }),
    ).toEqual([
      {
        id: boundaryId,
        actorId: "boundary-user",
        targetId: "boundary-user",
        occurredAt: EXPECTED_CUTOFF,
      },
      {
        id: retainedId,
        actorId: retiredUserId,
        targetId: retiredUserId,
        occurredAt: new Date(EXPECTED_CUTOFF.getTime() + 1),
      },
    ]);

    const secondResult = await cleanup({ now: NOW, config, logger });

    expect(secondResult).toMatchObject({
      cutoff: EXPECTED_CUTOFF,
      deletedCount: 0,
      skipped: false,
      limitReached: false,
    });
    expect(await prisma!.auditLog.count()).toBe(2);
  });
});
