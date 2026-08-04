import { describe, expect, it } from "vitest";

import { validateProductionDatabaseTarget } from "./production-database-target.js";

const validEnvironment = {
  BATCH_ENVIRONMENT: "production",
  PRODUCTION_SUPABASE_PROJECT_REF: "exampleproject",
  DATABASE_URL:
    "postgresql://postgres.exampleproject:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
};

describe("validateProductionDatabaseTarget", () => {
  it("production Session poolerの完全一致接続先を受理する", () => {
    expect(() => validateProductionDatabaseTarget(validEnvironment)).not.toThrow();
  });

  it.each([
    ["環境marker不一致", { BATCH_ENVIRONMENT: "staging" }],
    ["project ref不一致", { PRODUCTION_SUPABASE_PROJECT_REF: "otherproject" }],
    [
      "transaction pooler",
      { DATABASE_URL: validEnvironment.DATABASE_URL.replace(":5432/", ":6543/") },
    ],
  ])("%sを値非表示で拒否する", (_name, override) => {
    expect(() => validateProductionDatabaseTarget({ ...validEnvironment, ...override })).toThrow(
      "production DB接続先が不正です",
    );
  });
});
