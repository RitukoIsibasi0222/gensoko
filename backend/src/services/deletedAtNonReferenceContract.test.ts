import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = resolve(import.meta.dirname, "..");

const NON_REFERENCE_FILES = [
  "lib/usable-admin.ts",
  "services/admin.service.ts",
  "services/auth.service.ts",
  "services/ranking.service.ts",
  "services/admin-create.service.ts",
  "services/user.service.ts",
] as const;

describe("deletedAt non-reference contract", () => {
  it.each(NON_REFERENCE_FILES)("%s does not depend on the legacy database column", (file) => {
    const source = readFileSync(resolve(SOURCE_ROOT, file), "utf8");
    expect(source).not.toContain("deletedAt");
  });

  it("keeps the deprecated v1 response field synthesized at the route boundary", () => {
    const source = readFileSync(resolve(SOURCE_ROOT, "routes/admin/index.ts"), "utf8");
    expect(source).toContain("deletedAt: null");
  });
});
