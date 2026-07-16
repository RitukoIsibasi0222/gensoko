import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PRISMA_SCHEMA_PATH = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));
const PRISMA_MIGRATIONS_PATH = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const ACCOUNT_DELETION_INDEX_MIGRATION_SUFFIX = "_add_account_deletion_indexes";
const prismaSchema = readFileSync(PRISMA_SCHEMA_PATH, "utf8");
const modelPattern = /model\s+(\w+)\s+\{([\s\S]*?)\n\}/g;

const directUserOwnedModels = [
  "EmailVerification",
  "GameQuestionSet",
  "GameSession",
  "PasswordResetToken",
  "RefreshToken",
  "UserStats",
  "WeakElement",
] as const;

function getModelBlock(modelName: string): string {
  const modelMatch = new RegExp("model\\s+" + modelName + "\\s+\\{([\\s\\S]*?)\\n\\}").exec(
    prismaSchema,
  );

  expect(modelMatch, "Prisma model " + modelName + " が見つかりません").not.toBeNull();

  return modelMatch?.[1] ?? "";
}

function getModelsReferencingUser(): string[] {
  return [...prismaSchema.matchAll(modelPattern)]
    .filter((match) => /\buser\s+User\s+@relation\(/.test(match[2] ?? ""))
    .map((match) => match[1] ?? "")
    .sort();
}

function getAccountDeletionIndexMigrationSql(): string {
  const migrationDirectories = readdirSync(PRISMA_MIGRATIONS_PATH, {
    withFileTypes: true,
  })
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.endsWith(ACCOUNT_DELETION_INDEX_MIGRATION_SUFFIX),
    )
    .map((entry) => entry.name);

  expect(migrationDirectories).toHaveLength(1);

  return readFileSync(
    join(PRISMA_MIGRATIONS_PATH, migrationDirectories[0] ?? "", "migration.sql"),
    "utf8",
  );
}

describe("account deletion Prisma schema contract", () => {
  it("Userを直接参照する所有model inventoryを固定する", () => {
    expect(getModelsReferencingUser()).toEqual([...directUserOwnedModels].sort());
  });

  it.each(directUserOwnedModels)("%sはUser削除時にcascadeする", (modelName) => {
    expect(getModelBlock(modelName)).toMatch(
      /\buser\s+User\s+@relation\([^)]*onDelete:\s*Cascade[^)]*\)/,
    );
  });

  it("GameAnswerはGameSession削除時に間接cascadeする", () => {
    expect(getModelBlock("GameAnswer")).toMatch(
      /\bsession\s+GameSession\s+@relation\([^)]*onDelete:\s*Cascade[^)]*\)/,
    );
  });

  it("共有Elementと保持対象AuditLogをUser cascade inventoryへ含めない", () => {
    expect(getModelBlock("Element")).not.toMatch(/\buser\s+User\s+@relation\(/);
    expect(getModelBlock("AuditLog")).not.toContain("@relation");
  });

  it.each([
    { modelName: "RefreshToken", index: "@@index([userId])" },
    { modelName: "EmailVerification", index: "@@index([userId])" },
    { modelName: "GameQuestionSet", index: "@@index([userId])" },
    { modelName: "User", index: "@@index([deletedAt, id])" },
  ])("$modelNameは削除・移行に必要なindex $index を持つ", ({ modelName, index }) => {
    expect(getModelBlock(modelName)).toContain(index);
  });

  it("expand migrationは削除・移行に必要なindexだけを追加する", () => {
    const migrationSql = getAccountDeletionIndexMigrationSql();

    expect(migrationSql).toContain(
      'CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX "email_verifications_userId_idx" ON "email_verifications"("userId");',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX "game_question_sets_userId_idx" ON "game_question_sets"("userId");',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX "users_deletedAt_id_idx" ON "users"("deletedAt", "id");',
    );
    expect(migrationSql).not.toContain("DROP ");
  });
});
