import { describe, expect, it, vi } from "vitest";

import { runM2StagingFixtureCli } from "./stagingReleaseCandidateFixtures.cli.js";

const VALID_ENVIRONMENT = {
  BATCH_ENVIRONMENT: "staging",
  STAGING_SUPABASE_PROJECT_REF: "stagingref",
  DATABASE_URL:
    "postgresql://postgres.stagingref:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
  M2_STAGING_FIXTURE_ENABLED: "true",
  M2_VERIFICATION_TOKEN: "ab".repeat(32),
};

describe("M2 staging fixture CLI", () => {
  it("不正引数を固定messageとexit 2へ縮約する", async () => {
    const info = vi.fn();
    const error = vi.fn();
    const exitCode = await runM2StagingFixtureCli({
      argv: ["--operation", "invalid"],
      environment: VALID_ENVIRONMENT,
      info,
      error,
      loadDependencies: vi.fn(),
    });

    expect(exitCode).toBe(2);
    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith({
      event: "m2_staging_fixture.failed",
      message: "M2 staging fixture CLIの引数が正しくありません",
    });
  });

  it("preflight成功時は固定statusだけを出す", async () => {
    const info = vi.fn();
    const client = { user: { findMany: vi.fn().mockResolvedValue([]) } };
    const exitCode = await runM2StagingFixtureCli({
      argv: ["--operation", "preflight"],
      environment: VALID_ENVIRONMENT,
      info,
      error: vi.fn(),
      loadDependencies: vi.fn().mockResolvedValue({ client, disconnect: vi.fn() }),
    });

    expect(exitCode).toBe(0);
    expect(info).toHaveBeenCalledWith({
      event: "m2_staging_fixture.completed",
      operation: "preflight",
      status: "clear",
    });
  });

  it("実行失敗時はraw error・token・DB URLを出さない", async () => {
    const error = vi.fn();
    const exitCode = await runM2StagingFixtureCli({
      argv: ["--operation", "arm-verification"],
      environment: VALID_ENVIRONMENT,
      info: vi.fn(),
      error,
      loadDependencies: vi.fn().mockRejectedValue(new Error("raw database secret ababab")),
    });

    expect(exitCode).toBe(1);
    const serialized = JSON.stringify(error.mock.calls);
    expect(serialized).toContain("M2 staging fixture CLIの実行に失敗しました");
    expect(serialized).not.toContain(VALID_ENVIRONMENT.M2_VERIFICATION_TOKEN);
    expect(serialized).not.toContain(VALID_ENVIRONMENT.DATABASE_URL);
    expect(serialized).not.toContain("raw database secret");
  });
});
