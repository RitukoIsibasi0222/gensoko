import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const BACKEND_ROOT = resolve(import.meta.dirname, "../..");
const CONTRACT_MIGRATION_PATH = resolve(
  BACKEND_ROOT,
  "prisma/contract-migrations/20260718090000_drop_users_deleted_at/migration.sql",
);
const STANDARD_MIGRATIONS_PATH = resolve(BACKEND_ROOT, "prisma/migrations");

describe("account deletion contract migration", () => {
  it("is isolated from the standard prisma migrate deploy directory", () => {
    expect(CONTRACT_MIGRATION_PATH.startsWith(STANDARD_MIGRATIONS_PATH)).toBe(false);
  });

  it("checks for legacy rows before dropping the index and column", () => {
    const sql = readFileSync(CONTRACT_MIGRATION_PATH, "utf8");
    const beginPosition = sql.indexOf("BEGIN;");
    const lockPosition = sql.indexOf('LOCK TABLE "users" IN ACCESS EXCLUSIVE MODE');
    const guardPosition = sql.indexOf('"deletedAt" IS NOT NULL');
    const raisePosition = sql.indexOf("RAISE EXCEPTION");
    const dropIndexPosition = sql.indexOf('DROP INDEX "users_deletedAt_id_idx"');
    const dropColumnPosition = sql.indexOf('DROP COLUMN "deletedAt"');

    expect(beginPosition).toBeGreaterThanOrEqual(0);
    expect(lockPosition).toBeGreaterThan(beginPosition);
    expect(guardPosition).toBeGreaterThan(lockPosition);
    expect(raisePosition).toBeGreaterThan(guardPosition);
    expect(dropIndexPosition).toBeGreaterThan(raisePosition);
    expect(dropColumnPosition).toBeGreaterThan(dropIndexPosition);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(sql).not.toContain("SELECT *");
  });
});
