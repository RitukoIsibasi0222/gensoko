import { describe, expect, it } from "vitest";

import { validateStagingDatabaseTarget } from "./staging-database-target.js";

const PROJECT_REF = "abcdefghijklmnopqrst";

function createEnvironment(
  overrides: Partial<Record<string, string | undefined>> = {},
): Record<string, string | undefined> {
  return {
    BATCH_ENVIRONMENT: "staging",
    STAGING_SUPABASE_PROJECT_REF: PROJECT_REF,
    DATABASE_URL:
      "postgresql://postgres." +
      PROJECT_REF +
      ":secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
    ...overrides,
  };
}

describe("validateStagingDatabaseTarget", () => {
  it("stagingのSession pooler接続だけを受理する", () => {
    expect(() => validateStagingDatabaseTarget(createEnvironment())).not.toThrow();
  });

  it.each([
    ["environment", { BATCH_ENVIRONMENT: "production" }],
    ["project ref", { STAGING_SUPABASE_PROJECT_REF: "otherproject" }],
    [
      "username",
      {
        DATABASE_URL:
          "postgresql://postgres.otherproject:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
      },
    ],
    [
      "host",
      {
        DATABASE_URL: "postgresql://postgres." + PROJECT_REF + ":secret@localhost:5432/postgres",
      },
    ],
    [
      "port",
      {
        DATABASE_URL:
          "postgresql://postgres." +
          PROJECT_REF +
          ":secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
      },
    ],
    [
      "path",
      {
        DATABASE_URL:
          "postgresql://postgres." +
          PROJECT_REF +
          ":secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/other",
      },
    ],
  ])("%s不一致をgeneric errorで拒否する", (_label, overrides) => {
    expect(() => validateStagingDatabaseTarget(createEnvironment(overrides))).toThrow(
      "staging DB接続先が不正です",
    );
  });

  it("URLやproject refをerrorへ含めない", () => {
    let message = "";
    try {
      validateStagingDatabaseTarget(
        createEnvironment({
          DATABASE_URL: "postgresql://sensitive-user:sensitive-password@example.com/private",
        }),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe("staging DB接続先が不正です");
    expect(message).not.toContain("sensitive");
    expect(message).not.toContain(PROJECT_REF);
  });
});
