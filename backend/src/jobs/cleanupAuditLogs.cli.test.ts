import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  cleanupExpiredAuditLogs: vi.fn(),
  disconnect: vi.fn(),
  cleanupModuleLoaded: vi.fn(),
  prismaModuleLoaded: vi.fn(),
}));

vi.mock("./cleanupAuditLogs.js", () => {
  runtimeMocks.cleanupModuleLoaded();
  return { cleanupExpiredAuditLogs: runtimeMocks.cleanupExpiredAuditLogs };
});

vi.mock("../lib/prisma.js", () => {
  runtimeMocks.prismaModuleLoaded();
  return {
    prisma: {
      $disconnect: runtimeMocks.disconnect,
    },
  };
});

const NOW = new Date("2026-07-13T09:00:00.000Z");
const CUTOFF = new Date("2025-07-13T09:00:00.000Z");
const ORIGINAL_ARGV = [...process.argv];
const ORIGINAL_RETENTION_DAYS = process.env.AUDIT_LOG_RETENTION_DAYS;
const ORIGINAL_CLEANUP_ENABLED = process.env.AUDIT_LOG_CLEANUP_ENABLED;
const CONFIG = { retentionDays: 365, cleanupEnabled: true } as const;

const SUCCESS_RESULT = {
  cutoff: CUTOFF,
  retentionDays: 365,
  dryRun: false,
  skipped: false,
  deletedCount: 2,
  durationMs: 10,
  limitReached: false,
  healthBefore: {
    createdLast24HoursCount: 4,
    hasExpiredRows: true,
    oldestOccurredAt: NOW,
    latestOccurredAt: NOW,
  },
} as const;

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

function setValidEnvironment(): void {
  process.env.AUDIT_LOG_RETENTION_DAYS = "365";
  process.env.AUDIT_LOG_CLEANUP_ENABLED = "true";
}

function restoreEnvironment(): void {
  if (ORIGINAL_RETENTION_DAYS === undefined) {
    delete process.env.AUDIT_LOG_RETENTION_DAYS;
  } else {
    process.env.AUDIT_LOG_RETENTION_DAYS = ORIGINAL_RETENTION_DAYS;
  }

  if (ORIGINAL_CLEANUP_ENABLED === undefined) {
    delete process.env.AUDIT_LOG_CLEANUP_ENABLED;
  } else {
    process.env.AUDIT_LOG_CLEANUP_ENABLED = ORIGINAL_CLEANUP_ENABLED;
  }
}

function getConsoleOutput(spy: ReturnType<typeof vi.spyOn>): string {
  return JSON.stringify(spy.mock.calls);
}

async function importCli(): Promise<void> {
  await import("./cleanupAuditLogs.cli.js");
}

describe("cleanupAuditLogs CLI", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setValidEnvironment();
    runtimeMocks.cleanupExpiredAuditLogs.mockResolvedValue(SUCCESS_RESULT);
    runtimeMocks.disconnect.mockResolvedValue(undefined);
    process.argv = [process.execPath, "/app/src/jobs/cleanupAuditLogs.cli.ts"];
    process.exitCode = undefined;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    process.argv = [...ORIGINAL_ARGV];
    process.exitCode = undefined;
    restoreEnvironment();
  });

  it.each([
    ["引数なし", []],
    ["--dry-run", ["--dry-run"]],
  ])("%sではdry-runを実行し、終了code 0にする", async (_caseName, argv) => {
    process.argv.push(...argv);
    runtimeMocks.cleanupExpiredAuditLogs.mockResolvedValue({
      ...SUCCESS_RESULT,
      dryRun: true,
      deletedCount: 0,
    });

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(runtimeMocks.cleanupExpiredAuditLogs).toHaveBeenCalledWith({
      dryRun: true,
      config: CONFIG,
    });
    expect(runtimeMocks.disconnect).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("--executeでは実削除を要求し、成功時は終了code 0にする", async () => {
    process.argv.push("--execute");

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(runtimeMocks.cleanupExpiredAuditLogs).toHaveBeenCalledWith({
      dryRun: false,
      config: CONFIG,
    });
    expect(runtimeMocks.disconnect).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["dry-runとexecuteの競合", ["--dry-run", "--execute"]],
    ["未知引数", ["--unknown", "private-id"]],
  ])("%sは固定エラー・終了code 2とし、DB dependencyをloadしない", async (_caseName, argv) => {
    process.argv.push(...argv);

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(2));
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "audit_logs.cleanup.cli.failed",
      message: "監査ログcleanup CLIの引数が正しくありません",
    });
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("private-id");
    expect(runtimeMocks.cleanupModuleLoaded).not.toHaveBeenCalled();
    expect(runtimeMocks.prismaModuleLoaded).not.toHaveBeenCalled();
    expect(runtimeMocks.cleanupExpiredAuditLogs).not.toHaveBeenCalled();
    expect(runtimeMocks.disconnect).not.toHaveBeenCalled();
  });

  it("保持期間の設定不備は終了code 2とし、DB dependencyをloadしない", async () => {
    process.env.AUDIT_LOG_RETENTION_DAYS = "29";

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(2));
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "audit_logs.cleanup.cli.failed",
      message: "AUDIT_LOG_RETENTION_DAYSは30から3650までの10進整数で設定してください",
    });
    expect(runtimeMocks.cleanupModuleLoaded).not.toHaveBeenCalled();
    expect(runtimeMocks.prismaModuleLoaded).not.toHaveBeenCalled();
  });

  it("cleanup無効によるskipは正常終了code 0を維持する", async () => {
    process.argv.push("--execute");
    process.env.AUDIT_LOG_CLEANUP_ENABLED = "false";
    runtimeMocks.cleanupExpiredAuditLogs.mockResolvedValue({
      ...SUCCESS_RESULT,
      skipped: true,
      deletedCount: 0,
    });

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(runtimeMocks.cleanupExpiredAuditLogs).toHaveBeenCalledWith({
      dryRun: false,
      config: { retentionDays: 365, cleanupEnabled: false },
    });
  });

  it("削除上限到達後も残件がある場合は終了code 1にする", async () => {
    process.argv.push("--execute");
    runtimeMocks.cleanupExpiredAuditLogs.mockResolvedValue({
      ...SUCCESS_RESULT,
      deletedCount: 10_000,
      limitReached: true,
    });

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(runtimeMocks.disconnect).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "audit_logs.cleanup.cli.limit_reached",
      message: "監査ログcleanupの安全上限到達後も期限超過ログが残っています",
    });
  });

  it("DBエラーは終了code 1とし、raw errorや内部IDを出力しない", async () => {
    process.argv.push("--execute");
    runtimeMocks.cleanupExpiredAuditLogs.mockRejectedValue(
      new Error("DATABASE_URL=secret audit-log-id=private-id"),
    );

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(runtimeMocks.disconnect).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "audit_logs.cleanup.cli.failed",
      message: "監査ログcleanup CLIの実行に失敗しました",
    });
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("DATABASE_URL");
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("secret");
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("private-id");
  });

  it("成功後のdisconnect失敗は終了code 0を維持し、再実行防止の警告を出す", async () => {
    runtimeMocks.disconnect.mockRejectedValue(new Error("disconnect DATABASE_URL=secret"));

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(consoleWarnSpy).toHaveBeenCalledWith({
      event: "audit_logs.cleanup.cli.disconnect_failed",
      message:
        "監査ログcleanupの結果は確定済みですが、DB接続の終了処理に失敗しました。再実行せず接続状態を確認してください",
    });
    expect(getConsoleOutput(consoleWarnSpy)).not.toContain("DATABASE_URL");
    expect(getConsoleOutput(consoleWarnSpy)).not.toContain("secret");
  });

  it("実行失敗後のdisconnect失敗は元の終了code 1を維持する", async () => {
    runtimeMocks.cleanupExpiredAuditLogs.mockRejectedValue(new Error("cleanup failed"));
    runtimeMocks.disconnect.mockRejectedValue(new Error("disconnect failed"));

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "audit_logs.cleanup.cli.failed",
      message: "監査ログcleanup CLIの実行に失敗しました",
    });
    expect(consoleWarnSpy).toHaveBeenCalledWith({
      event: "audit_logs.cleanup.cli.disconnect_failed",
      message: "DB接続の終了処理に失敗しました",
    });
  });
});
