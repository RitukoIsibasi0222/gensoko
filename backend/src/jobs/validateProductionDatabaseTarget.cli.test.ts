import { describe, expect, it, vi } from "vitest";

import { runValidateProductionDatabaseTargetCli } from "./validateProductionDatabaseTarget.cli.js";

const validEnvironment = {
  BATCH_ENVIRONMENT: "production",
  PRODUCTION_SUPABASE_PROJECT_REF: "exampleproject",
  DATABASE_URL:
    "postgresql://postgres.exampleproject:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
};

describe("validateProductionDatabaseTarget CLI", () => {
  it("正しいproduction接続先は秘密情報なしで成功する", () => {
    const logger = { info: vi.fn(), error: vi.fn() };

    expect(runValidateProductionDatabaseTargetCli(validEnvironment, logger)).toBe(0);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("exampleproject");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("不正接続先はURLを出さず終了code 2にする", () => {
    const logger = { info: vi.fn(), error: vi.fn() };

    expect(
      runValidateProductionDatabaseTargetCli(
        {
          ...validEnvironment,
          DATABASE_URL: "postgresql://secret:password@staging.example.com/private",
        },
        logger,
      ),
    ).toBe(2);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("staging.example.com");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("password");
  });
});
