import { describe, expect, it, vi } from "vitest";

import { runValidateStagingDatabaseTargetCli } from "./validateStagingDatabaseTarget.cli.js";

const validEnvironment = {
  BATCH_ENVIRONMENT: "staging",
  STAGING_SUPABASE_PROJECT_REF: "exampleproject",
  DATABASE_URL:
    "postgresql://postgres.exampleproject:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
};

describe("validateStagingDatabaseTarget CLI", () => {
  it("正しいstaging接続先は秘密情報なしで成功する", () => {
    const logger = { info: vi.fn(), error: vi.fn() };

    expect(runValidateStagingDatabaseTargetCli(validEnvironment, logger)).toBe(0);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("exampleproject");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("不正接続先はURLを出さず終了code 2にする", () => {
    const logger = { info: vi.fn(), error: vi.fn() };

    expect(
      runValidateStagingDatabaseTargetCli(
        {
          ...validEnvironment,
          DATABASE_URL: "postgresql://secret:password@production.example.com/private",
        },
        logger,
      ),
    ).toBe(2);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("production.example.com");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("password");
  });
});
