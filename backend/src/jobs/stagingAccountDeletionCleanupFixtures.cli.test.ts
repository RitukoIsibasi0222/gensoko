import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  verifyIsolation: vi.fn(),
  verifyCleaned: vi.fn(),
  remove: vi.fn(),
  validateEnvironment: vi.fn(),
  prismaModuleLoaded: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("./stagingAccountDeletionCleanupFixtures.js", () => ({
  prepareStagingAccountDeletionCleanupFixtures: runtimeMocks.prepare,
  verifyStagingAccountDeletionCleanupFixtureIsolation: runtimeMocks.verifyIsolation,
  verifyStagingAccountDeletionCleanupFixturesWereCleaned: runtimeMocks.verifyCleaned,
  removeStagingAccountDeletionCleanupFixtures: runtimeMocks.remove,
  validateStagingAccountDeletionCleanupFixtureEnvironment: runtimeMocks.validateEnvironment,
}));

vi.mock("../lib/prisma.js", () => {
  runtimeMocks.prismaModuleLoaded();
  return { prisma: { $disconnect: runtimeMocks.disconnect } };
});

const ORIGINAL_ARGV = [...process.argv];
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

function getConsoleOutput(spy: ReturnType<typeof vi.spyOn>): string {
  return JSON.stringify(spy.mock.calls);
}

async function importCli(): Promise<void> {
  await import("./stagingAccountDeletionCleanupFixtures.cli.js");
}

describe("stagingAccountDeletionCleanupFixtures CLI", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    runtimeMocks.validateEnvironment.mockImplementation(() => undefined);
    runtimeMocks.remove.mockResolvedValue({ deletedUsers: 2 });
    runtimeMocks.disconnect.mockResolvedValue(undefined);
    process.argv = [process.execPath, "/app/src/jobs/stagingAccountDeletionCleanupFixtures.cli.ts"];
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
  });

  it("引数不備は日本語の固定エラー・終了code 2とし、DBをloadしない", async () => {
    process.argv.push("--unknown", "DATABASE_URL=secret");
    await importCli();
    await vi.waitFor(() => expect(process.exitCode).toBe(2));
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "account_data_deletion.staging_fixtures.failed",
      message: "staging account deletion fixture CLIの引数が正しくありません",
    });
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("DATABASE_URL");
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("secret");
    expect(runtimeMocks.prismaModuleLoaded).not.toHaveBeenCalled();
  });

  it("staging safety guard不一致は日本語の固定エラー・終了code 2とする", async () => {
    process.argv.push("--operation", "prepare");
    runtimeMocks.validateEnvironment.mockImplementation(() => {
      throw new Error("DATABASE_URL=secret project-ref=private-id");
    });
    await importCli();
    await vi.waitFor(() => expect(process.exitCode).toBe(2));
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "account_data_deletion.staging_fixtures.failed",
      message: "staging account deletion fixture設定が不正です",
    });
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("secret");
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("private-id");
    expect(runtimeMocks.prismaModuleLoaded).not.toHaveBeenCalled();
  });

  it("DB処理エラーは日本語の固定エラー・終了code 1とし、raw errorを出力しない", async () => {
    process.argv.push("--operation", "remove");
    runtimeMocks.remove.mockRejectedValue(new Error("DATABASE_URL=secret user-id=private-id"));
    await importCli();
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(runtimeMocks.disconnect).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "account_data_deletion.staging_fixtures.failed",
      message: "staging account deletion fixture CLIの実行に失敗しました",
    });
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("secret");
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("private-id");
  });

  it("成功後のdisconnect失敗は終了code 0を維持し、固定警告を出す", async () => {
    process.argv.push("--operation", "remove");
    runtimeMocks.disconnect.mockRejectedValue(new Error("DATABASE_URL=secret"));
    await importCli();
    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "account_data_deletion.staging_fixtures.completed",
        operation: "remove",
      }),
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith({
      event: "account_data_deletion.staging_fixtures.disconnect_failed",
      message: "staging account deletion fixtureのDB接続終了に失敗しました",
    });
    expect(getConsoleOutput(consoleWarnSpy)).not.toContain("DATABASE_URL");
    expect(getConsoleOutput(consoleWarnSpy)).not.toContain("secret");
  });
});
