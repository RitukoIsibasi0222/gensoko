import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import prismaClientModule from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.ACCOUNT_DELETION_CONTRACT_DATABASE_URL;
const runIntegrationTest = typeof connectionString === "string" && connectionString.length > 0;
const ALLOWED_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "postgres"]);
const REQUIRED_DATABASE_NAME = "gensoko_account_deletion_contract_test";
const migrationSql = readFileSync(
  resolve(
    import.meta.dirname,
    "../../prisma/contract-migrations/20260718090000_drop_users_deleted_at/migration.sql",
  ),
  "utf8",
);
const { PrismaClient } = prismaClientModule;

async function waitForContractLock(pool: Pool): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_locks locks
         JOIN pg_class relations ON relations.oid = locks.relation
         WHERE relations.relname = 'users'
           AND locks.mode = 'AccessExclusiveLock'
           AND NOT locks.granted
       ) AS waiting`,
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("contract migration lock wait was not observed");
}

describe.skipIf(!runIntegrationTest)("account deletion contract migration dedicated DB", () => {
  let pool: Pool;

  beforeAll(async () => {
    const databaseUrl = new URL(connectionString!);
    const databaseName = databaseUrl.pathname.replace(/^\//, "");
    if (
      !ALLOWED_DATABASE_HOSTS.has(databaseUrl.hostname) ||
      databaseName !== REQUIRED_DATABASE_NAME
    ) {
      throw new Error(`contract migration test requires ${REQUIRED_DATABASE_NAME}`);
    }

    pool = new Pool({ connectionString });
    await pool.query('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3)');
    await pool.query(
      'CREATE INDEX IF NOT EXISTS "users_deletedAt_id_idx" ON "users"("deletedAt", "id")',
    );
    await pool.query('DELETE FROM "users"');
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3)');
    await pool.query(
      'CREATE INDEX IF NOT EXISTS "users_deletedAt_id_idx" ON "users"("deletedAt", "id")',
    );
    await pool.query('DELETE FROM "users"');
    await pool.end();
  });

  it("keeps the column and index when a legacy row exists", async () => {
    await pool.query(
      `INSERT INTO "users" ("id", "username", "email", "passwordHash", "role", "emailVerified", "isActive", "deletedAt", "updatedAt")
       VALUES ('contract-guard-fixture', 'contract_guard_fixture', 'contract-guard-fixture@example.test', 'hash', 'USER', true, false, NOW(), NOW())`,
    );

    await expect(pool.query(migrationSql)).rejects.toBeDefined();
    const state = await pool.query<{ column_exists: boolean; index_exists: boolean }>(
      `SELECT
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'deletedAt') AS column_exists,
         to_regclass('public."users_deletedAt_id_idx"') IS NOT NULL AS index_exists`,
    );
    expect(state.rows[0]).toEqual({ column_exists: true, index_exists: true });
    await pool.query('DELETE FROM "users" WHERE "id" = \'contract-guard-fixture\'');
  });

  it("rechecks the guard after a concurrent legacy insert commits", async () => {
    await pool.query('DELETE FROM "users"');
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        `INSERT INTO "users" ("id", "username", "email", "passwordHash", "role", "emailVerified", "isActive", "deletedAt", "updatedAt")
         VALUES ('contract-race-fixture', 'contract_race_fixture', 'contract-race-fixture@example.test', 'hash', 'USER', true, false, NOW(), NOW())`,
      );
      const migrationResult = pool.query(migrationSql).then(
        () => ({ succeeded: true }),
        () => ({ succeeded: false }),
      );

      await waitForContractLock(pool);
      await blocker.query("COMMIT");

      await expect(migrationResult).resolves.toEqual({ succeeded: false });
      const state = await pool.query<{ column_exists: boolean; index_exists: boolean }>(
        `SELECT
           EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'deletedAt') AS column_exists,
           to_regclass('public."users_deletedAt_id_idx"') IS NOT NULL AS index_exists`,
      );
      expect(state.rows[0]).toEqual({ column_exists: true, index_exists: true });
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await pool.query('DELETE FROM "users" WHERE "id" = \'contract-race-fixture\'');
    }
  });

  it("drops the column and temporary index when no legacy row exists", async () => {
    await pool.query('DELETE FROM "users"');
    await pool.query(migrationSql);

    const state = await pool.query<{ column_exists: boolean; index_exists: boolean }>(
      `SELECT
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'deletedAt') AS column_exists,
         to_regclass('public."users_deletedAt_id_idx"') IS NOT NULL AS index_exists`,
    );
    expect(state.rows[0]).toEqual({ column_exists: false, index_exists: false });

    await pool.query(
      `INSERT INTO "users" ("id", "username", "email", "passwordHash", "role", "emailVerified", "isActive", "updatedAt")
       VALUES ('contract-runtime-fixture', 'contract_runtime_fixture', 'contract-runtime-fixture@example.test', 'hash', 'USER', true, false, NOW())`,
    );
    const contractPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString! }),
    });
    try {
      await expect(
        contractPrisma.user.update({
          where: { id: "contract-runtime-fixture" },
          data: { isActive: true },
          select: { id: true },
        }),
      ).resolves.toEqual({ id: "contract-runtime-fixture" });
      await expect(
        contractPrisma.user.delete({
          where: { id: "contract-runtime-fixture" },
          select: { id: true },
        }),
      ).resolves.toEqual({ id: "contract-runtime-fixture" });
    } finally {
      await contractPrisma.$disconnect();
      await pool.query('DELETE FROM "users" WHERE "id" = \'contract-runtime-fixture\'');
    }
  });
});
