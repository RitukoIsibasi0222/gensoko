import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("RefreshToken cleanup schema", () => {
  it("expiresAt/tokenHashのexpand-only indexをschemaとmigrationで一致させる", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    expect(schema).toContain("@@index([expiresAt, tokenHash])");

    const migrationDirectory = readdirSync("prisma/migrations").find((name) =>
      name.endsWith("_add_refresh_token_expiry_index"),
    );
    expect(migrationDirectory).toBeDefined();
    const sql = readFileSync(
      join("prisma/migrations", migrationDirectory ?? "", "migration.sql"),
      "utf8",
    );
    expect(sql).toContain('ON "refresh_tokens"("expiresAt", "tokenHash")');
    expect(sql).toContain("CREATE INDEX CONCURRENTLY");
    expect(sql).not.toMatch(/DROP|DELETE|UPDATE|ALTER TABLE/i);
  });
});
