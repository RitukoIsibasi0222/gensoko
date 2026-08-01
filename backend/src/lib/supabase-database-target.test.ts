import { describe, expect, it } from "vitest";

import { validateSupabaseDatabaseTarget } from "./supabase-database-target.js";

const PROJECT_REF = "abcdefghijklmnopqrst";
const DATABASE_URL =
  "postgresql://postgres." +
  PROJECT_REF +
  ":secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres";

describe("validateSupabaseDatabaseTarget", () => {
  it.each(["staging", "production"] as const)(
    "%sのSession pooler接続とenvironment markerだけを受理する",
    (environmentName) => {
      expect(() =>
        validateSupabaseDatabaseTarget({
          environmentName,
          batchEnvironment: environmentName,
          projectRef: PROJECT_REF,
          databaseUrl: DATABASE_URL,
        }),
      ).not.toThrow();
    },
  );

  it.each([
    ["marker不一致", { batchEnvironment: "staging" }],
    ["project ref欠落", { projectRef: undefined }],
    ["project ref不一致", { projectRef: "otherproject" }],
    ["protocol不一致", { databaseUrl: DATABASE_URL.replace("postgresql:", "postgres:") }],
    [
      "username不一致",
      {
        databaseUrl:
          "postgresql://other:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
      },
    ],
    [
      "host不一致",
      { databaseUrl: "postgresql://postgres." + PROJECT_REF + ":secret@localhost:5432/postgres" },
    ],
    ["port不一致", { databaseUrl: DATABASE_URL.replace(":5432/", ":6543/") }],
    ["database不一致", { databaseUrl: DATABASE_URL.replace("/postgres", "/other") }],
    ["query付き", { databaseUrl: DATABASE_URL + "?sslmode=require" }],
    ["fragment付き", { databaseUrl: DATABASE_URL + "#private" }],
  ])("%sはproduction用generic errorで拒否する", (_label, overrides) => {
    expect(() =>
      validateSupabaseDatabaseTarget({
        environmentName: "production",
        batchEnvironment: "production",
        projectRef: PROJECT_REF,
        databaseUrl: DATABASE_URL,
        ...overrides,
      }),
    ).toThrow("production DB接続先が不正です");
  });

  it("URL・credential・project refをerrorへ含めない", () => {
    let message = "";

    try {
      validateSupabaseDatabaseTarget({
        environmentName: "production",
        batchEnvironment: "production",
        projectRef: PROJECT_REF,
        databaseUrl: "postgresql://sensitive-user:sensitive-password@example.com/private",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe("production DB接続先が不正です");
    expect(message).not.toContain("sensitive");
    expect(message).not.toContain(PROJECT_REF);
  });
});
