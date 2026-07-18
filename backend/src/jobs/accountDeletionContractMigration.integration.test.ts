import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("drops the column and temporary index when no legacy row exists", async () => {
    await pool.query('DELETE FROM "users"');
    await pool.query(migrationSql);

    const state = await pool.query<{ column_exists: boolean; index_exists: boolean }>(
      `SELECT
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'deletedAt') AS column_exists,
         to_regclass('public."users_deletedAt_id_idx"') IS NOT NULL AS index_exists`,
    );
    expect(state.rows[0]).toEqual({ column_exists: false, index_exists: false });
  });
});
