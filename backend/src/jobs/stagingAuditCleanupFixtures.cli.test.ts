import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  verifyCleaned: vi.fn(),
  remove: vi.fn(),
  validateEnvironment: vi.fn(),
  prismaModuleLoaded: vi.fn(),
  disconnect: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  count: vi.fn(),
}));

vi.mock("./stagingAuditCleanupFixtures.js", () => ({
  prepareStagingAuditCleanupFixtures: runtimeMocks.prepare,
  verifyStagingAuditCleanupFixturesWereCleaned: runtimeMocks.verifyCleaned,
  removeStagingAuditCleanupFixtures: runtimeMocks.remove,
  validateStagingAuditCleanupFixtureEnvironment: runtimeMocks.validateEnvironment,
}));

vi.mock("../lib/prisma.js", () => {
  runtimeMocks.prismaModuleLoaded();
  return {
    prisma: {
      auditLog: {
        deleteMany: runtimeMocks.deleteMany,
        createMany: runtimeMocks.createMany,
        count: runtimeMocks.count,
      },
      $disconnect: runtimeMocks.disconnect,
    },
  };
});

const ORIGINAL_ARGV = [...process.argv];

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

function setValidEnvironment(): void {
  vi.stubEnv("BATCH_ENVIRONMENT", "staging");
  vi.stubEnv("AUDIT_LOG_STAGING_FIXTURES_ENABLED", "true");
  vi.stubEnv("STAGING_SUPABASE_PROJECT_REF", "example-project-ref");
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://postgres.example-project-ref:password@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
  );
  vi.stubEnv("AUDIT_LOG_RETENTION_DAYS", "365");
  vi.stubEnv("AUDIT_LOG_CLEANUP_ENABLED", "false");
}

function getConsoleOutput(spy: ReturnType<typeof vi.spyOn>): string {
  return JSON.stringify(spy.mock.calls);
}

async function importCli(): Promise<void> {
  await import("./stagingAuditCleanupFixtures.cli.js");
}

describe("stagingAuditCleanupFixtures CLI", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setValidEnvironment();
    runtimeMocks.validateEnvironment.mockImplementation(() => undefined);
    runtimeMocks.prepare.mockResolvedValue({
      expiredCount: 1,
      retainedCount: 1,
    });
    runtimeMocks.verifyCleaned.mockResolvedValue({
      expiredCount: 0,
      retainedCount: 1,
    });
    runtimeMocks.remove.mockResolvedValue({
      deletedCount: 1,
    });
    runtimeMocks.disconnect.mockResolvedValue(undefined);
    process.argv = [process.execPath, "/app/src/jobs/stagingAuditCleanupFixtures.cli.ts"];
    process.exitCode = undefined;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    process.argv = [...ORIGINAL_ARGV];
    process.exitCode = undefined;
    vi.unstubAllEnvs();
  });

  it.each([
    ["prepare", runtimeMocks.prepare],
    ["verify-cleaned", runtimeMocks.verifyCleaned],
    ["remove", runtimeMocks.remove],
  ])("%sを実行し、成功時は終了code 0にする", async (operation, operationMock) => {
    process.argv.push("--operation", operation);

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(runtimeMocks.validateEnvironment).toHaveBeenCalledWith(process.env);
    expect(operationMock).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.disconnect).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "audit_logs.cleanup.staging_fixtures.completed",
        operation,
      }),
    );
  });

  it.each([
    ["引数なし", []],
    ["未知の操作", ["--operation", "unknown", "private-id"]],
    ["未知引数", ["--unknown", "DATABASE_URL=secret"]],
  ])("%sは固定エラー・終了code 2とし、DBをloadしない", async (_caseName, argv) => {
    process.argv.push(...argv);

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(2));
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "audit_logs.cleanup.staging_fixtures.failed",
      message: "staging監査ログfixture CLIの引数が正しくありません",
    });
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("private-id");
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("DATABASE_URL");
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("secret");
    expect(runtimeMocks.validateEnvironment).not.toHaveBeenCalled();
    expect(runtimeMocks.prismaModuleLoaded).not.toHaveBeenCalled();
    expect(runtimeMocks.disconnect).not.toHaveBeenCalled();
  });

  it("staging safety guard不一致は終了code 2とし、DBをloadしない", async () => {
    process.argv.push("--operation", "prepare");
    runtimeMocks.validateEnvironment.mockImplementation(() => {
      throw new Error("DATABASE_URL=secret project-ref=private-id");
    });

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(2));
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "audit_logs.cleanup.staging_fixtures.failed",
      message: "staging監査ログfixture設定が不正です",
    });
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("DATABASE_URL");
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("secret");
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("private-id");
    expect(runtimeMocks.prismaModuleLoaded).not.toHaveBeenCalled();
  });

  it("保持期間の設定不備は終了code 2とし、DBをloadしない", async () => {
    process.argv.push("--operation", "prepare");
    vi.stubEnv("AUDIT_LOG_RETENTION_DAYS", "29");

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(2));
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "audit_logs.cleanup.staging_fixtures.failed",
      message: "staging監査ログfixture CLIの実行に失敗しました",
    });
    expect(runtimeMocks.prismaModuleLoaded).not.toHaveBeenCalled();
  });

  it("DB処理エラーは終了code 1とし、raw errorや内部値を出力しない", async () => {
    process.argv.push("--operation", "prepare");
    runtimeMocks.prepare.mockRejectedValue(
      new Error("DATABASE_URL=secret audit-log-id=private-id"),
    );

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(runtimeMocks.disconnect).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "audit_logs.cleanup.staging_fixtures.failed",
      message: "staging監査ログfixture CLIの実行に失敗しました",
    });
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("DATABASE_URL");
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("secret");
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("private-id");
  });

  it("成功後のdisconnect失敗は終了code 0を維持し、固定警告を出す", async () => {
    process.argv.push("--operation", "remove");
    runtimeMocks.disconnect.mockRejectedValue(new Error("DATABASE_URL=secret"));

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(consoleWarnSpy).toHaveBeenCalledWith({
      event: "audit_logs.cleanup.staging_fixtures.disconnect_failed",
      message: "staging監査ログfixtureのDB接続終了に失敗しました",
    });
    expect(getConsoleOutput(consoleWarnSpy)).not.toContain("DATABASE_URL");
    expect(getConsoleOutput(consoleWarnSpy)).not.toContain("secret");
  });
});
