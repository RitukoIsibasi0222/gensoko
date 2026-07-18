import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  deleteLegacySoftDeletedUsers: vi.fn(),
  disconnect: vi.fn(),
  cleanupModuleLoaded: vi.fn(),
  prismaModuleLoaded: vi.fn(),
  validateStagingFixtureEnvironment: vi.fn(),
}));

vi.mock("./deleteLegacySoftDeletedUsers.js", () => {
  runtimeMocks.cleanupModuleLoaded();
  return {
    deleteLegacySoftDeletedUsers: runtimeMocks.deleteLegacySoftDeletedUsers,
  };
});

vi.mock("./stagingAccountDeletionCleanupFixtures.js", () => ({
  STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE: {
    id: "staging-account-deletion-legacy-fixture",
  },
  validateStagingAccountDeletionCleanupFixtureEnvironment:
    runtimeMocks.validateStagingFixtureEnvironment,
}));

const CONFIRMATION = "DELETE_LEGACY_SOFT_DELETED_USERS";
const ORIGINAL_ARGV = [...process.argv];
const ENVIRONMENT_KEYS = [
  "ACCOUNT_DATA_DELETION_EXECUTE_ENABLED",
  "ACCOUNT_DATA_DELETION_BATCH_SIZE",
  "ACCOUNT_DATA_DELETION_STAGING_FIXTURES_ENABLED",
  "BATCH_ENVIRONMENT",
  "STAGING_SUPABASE_PROJECT_REF",
  "DATABASE_URL",
] as const;
const ORIGINAL_ENVIRONMENT = Object.fromEntries(
  ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENVIRONMENT_KEYS)[number], string | undefined>;
const DRY_RUN_RESULT = {
  mode: "dry-run",
  matchedUsers: 2,
  deletedUsers: 0,
  processedBatches: 0,
  remainingUsers: 2,
} as const;
const EMPTY_DRY_RUN_RESULT = {
  ...DRY_RUN_RESULT,
  matchedUsers: 0,
  remainingUsers: 0,
} as const;
const EXECUTE_RESULT = {
  mode: "execute",
  matchedUsers: 2,
  deletedUsers: 2,
  processedBatches: 1,
  remainingUsers: 0,
} as const;

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

function setDefaultEnvironment(): void {
  process.env.ACCOUNT_DATA_DELETION_EXECUTE_ENABLED = "false";
  process.env.ACCOUNT_DATA_DELETION_BATCH_SIZE = "25";
}

function restoreEnvironment(): void {
  for (const key of ENVIRONMENT_KEYS) {
    const originalValue = ORIGINAL_ENVIRONMENT[key];
    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
}

function getConsoleOutput(spy: ReturnType<typeof vi.spyOn>): string {
  return JSON.stringify(spy.mock.calls);
}

async function importCli(): Promise<void> {
  await import("./deleteLegacySoftDeletedUsers.cli.js");
}

describe("deleteLegacySoftDeletedUsers CLI", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock("../lib/prisma.js", () => {
      runtimeMocks.prismaModuleLoaded();
      return {
        prisma: {
          $disconnect: runtimeMocks.disconnect,
        },
      };
    });
    runtimeMocks.deleteLegacySoftDeletedUsers.mockReset().mockResolvedValue(DRY_RUN_RESULT);
    runtimeMocks.disconnect.mockReset().mockResolvedValue(undefined);
    runtimeMocks.validateStagingFixtureEnvironment.mockReset().mockImplementation(() => undefined);
    process.argv = [process.execPath, "/app/src/jobs/deleteLegacySoftDeletedUsers.cli.ts"];
    process.exitCode = undefined;
    setDefaultEnvironment();
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
    ["引数・execute flagなし", false],
    ["execute flagだけtrue", true],
  ])("%sでは必ずdry-runを実行する", async (_caseName, executeEnabled) => {
    process.env.ACCOUNT_DATA_DELETION_EXECUTE_ENABLED = String(executeEnabled);

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(runtimeMocks.deleteLegacySoftDeletedUsers).toHaveBeenCalledWith({
      mode: "dry-run",
      batchSize: 25,
    });
    expect(runtimeMocks.deleteLegacySoftDeletedUsers).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.disconnect).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("三重gateが揃った場合だけexecute後にdry-runで残件0を確認する", async () => {
    process.env.ACCOUNT_DATA_DELETION_EXECUTE_ENABLED = "true";
    process.argv.push("--execute", `--confirm=${CONFIRMATION}`);
    runtimeMocks.deleteLegacySoftDeletedUsers
      .mockResolvedValueOnce(EXECUTE_RESULT)
      .mockResolvedValueOnce(EMPTY_DRY_RUN_RESULT);

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(runtimeMocks.deleteLegacySoftDeletedUsers).toHaveBeenNthCalledWith(1, {
      mode: "execute",
      batchSize: 25,
    });
    expect(runtimeMocks.deleteLegacySoftDeletedUsers).toHaveBeenNthCalledWith(2, {
      mode: "dry-run",
      batchSize: 25,
    });
    expect(runtimeMocks.disconnect).toHaveBeenCalledTimes(1);
  });

  it("staging synthetic限定executeは接続先を検証し、削除対象IDをfixtureへ固定する", async () => {
    process.env.ACCOUNT_DATA_DELETION_EXECUTE_ENABLED = "true";
    process.env.ACCOUNT_DATA_DELETION_STAGING_FIXTURES_ENABLED = "true";
    process.env.BATCH_ENVIRONMENT = "staging";
    process.env.STAGING_SUPABASE_PROJECT_REF = "abcdefghijklmnopqrst";
    process.env.DATABASE_URL =
      "postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres";
    process.argv.push("--execute", `--confirm=${CONFIRMATION}`, "--staging-synthetic-only");
    runtimeMocks.deleteLegacySoftDeletedUsers
      .mockResolvedValueOnce({ ...EXECUTE_RESULT, matchedUsers: 1, deletedUsers: 1 })
      .mockResolvedValueOnce(EMPTY_DRY_RUN_RESULT);

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(runtimeMocks.validateStagingFixtureEnvironment).toHaveBeenCalledWith(process.env);
    expect(runtimeMocks.deleteLegacySoftDeletedUsers).toHaveBeenNthCalledWith(1, {
      mode: "execute",
      batchSize: 25,
      deleteOnlyUserIds: ["staging-account-deletion-legacy-fixture"],
    });
    expect(runtimeMocks.deleteLegacySoftDeletedUsers).toHaveBeenNthCalledWith(2, {
      mode: "dry-run",
      batchSize: 25,
    });
  });

  it.each([
    ["未知引数", ["--unknown=private-id"]],
    ["位置引数", ["private-user-id"]],
    ["execute重複", ["--execute", "--execute"]],
    ["confirm重複", [`--confirm=${CONFIRMATION}`, `--confirm=${CONFIRMATION}`]],
  ])("%sはDB dependency読込前に終了code 2で拒否する", async (_caseName, argv) => {
    process.argv.push(...argv);

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(2));
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "account_data_deletion.legacy_cleanup.cli.failed",
      message: "既存退会済みユーザーcleanup CLIの引数が正しくありません",
    });
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("private-id");
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("private-user-id");
    expect(runtimeMocks.cleanupModuleLoaded).not.toHaveBeenCalled();
    expect(runtimeMocks.prismaModuleLoaded).not.toHaveBeenCalled();
    expect(runtimeMocks.disconnect).not.toHaveBeenCalled();
  });

  it.each([
    ["--executeだけ", true, ["--execute"]],
    ["環境flagなし", false, ["--execute", `--confirm=${CONFIRMATION}`]],
    ["確認文字列不一致", true, ["--execute", "--confirm=private-confirmation"]],
    ["confirmだけ", true, [`--confirm=${CONFIRMATION}`]],
  ])(
    "%sはDB dependency読込前にexecute gate不足として拒否する",
    async (_caseName, executeEnabled, argv) => {
      process.env.ACCOUNT_DATA_DELETION_EXECUTE_ENABLED = String(executeEnabled);
      process.argv.push(...argv);

      await importCli();

      await vi.waitFor(() => expect(process.exitCode).toBe(2));
      expect(consoleErrorSpy).toHaveBeenCalledWith({
        event: "account_data_deletion.legacy_cleanup.cli.failed",
        message: "既存退会済みユーザーcleanupの実行条件が満たされていません",
      });
      expect(getConsoleOutput(consoleErrorSpy)).not.toContain("private-confirmation");
      expect(runtimeMocks.cleanupModuleLoaded).not.toHaveBeenCalled();
      expect(runtimeMocks.prismaModuleLoaded).not.toHaveBeenCalled();
    },
  );

  it.each(["", "0", "101", "-1", "1.5", "25件"])(
    "不正なbatch size=%sはDB dependency読込前に拒否する",
    async (batchSize) => {
      process.env.ACCOUNT_DATA_DELETION_BATCH_SIZE = batchSize;

      await importCli();

      await vi.waitFor(() => expect(process.exitCode).toBe(2));
      expect(consoleErrorSpy).toHaveBeenCalledWith({
        event: "account_data_deletion.legacy_cleanup.cli.failed",
        message: "ACCOUNT_DATA_DELETION_BATCH_SIZEは1から100までの10進整数で設定してください",
      });
      expect(runtimeMocks.cleanupModuleLoaded).not.toHaveBeenCalled();
      expect(runtimeMocks.prismaModuleLoaded).not.toHaveBeenCalled();
    },
  );

  it.each(["", "TRUE", "1", "yes"])(
    "不正なexecute flag=%sはDB dependency読込前に拒否する",
    async (executeEnabled) => {
      process.env.ACCOUNT_DATA_DELETION_EXECUTE_ENABLED = executeEnabled;

      await importCli();

      await vi.waitFor(() => expect(process.exitCode).toBe(2));
      expect(consoleErrorSpy).toHaveBeenCalledWith({
        event: "account_data_deletion.legacy_cleanup.cli.failed",
        message: "ACCOUNT_DATA_DELETION_EXECUTE_ENABLEDはtrueまたはfalseで設定してください",
      });
      expect(runtimeMocks.cleanupModuleLoaded).not.toHaveBeenCalled();
      expect(runtimeMocks.prismaModuleLoaded).not.toHaveBeenCalled();
    },
  );

  it("dry-run対象0件は終了code 0にする", async () => {
    runtimeMocks.deleteLegacySoftDeletedUsers.mockResolvedValue(EMPTY_DRY_RUN_RESULT);

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(runtimeMocks.disconnect).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("execute対象0件と検証dry-run 0件は終了code 0にする", async () => {
    process.env.ACCOUNT_DATA_DELETION_EXECUTE_ENABLED = "true";
    process.argv.push("--execute", `--confirm=${CONFIRMATION}`);
    runtimeMocks.deleteLegacySoftDeletedUsers
      .mockResolvedValueOnce({
        ...EXECUTE_RESULT,
        matchedUsers: 0,
        deletedUsers: 0,
        processedBatches: 0,
      })
      .mockResolvedValueOnce(EMPTY_DRY_RUN_RESULT);

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(runtimeMocks.deleteLegacySoftDeletedUsers).toHaveBeenCalledTimes(2);
  });

  it("execute後の残件をdry-runでも確認した場合は終了code 1にする", async () => {
    process.env.ACCOUNT_DATA_DELETION_EXECUTE_ENABLED = "true";
    process.argv.push("--execute", `--confirm=${CONFIRMATION}`);
    runtimeMocks.deleteLegacySoftDeletedUsers
      .mockResolvedValueOnce({
        ...EXECUTE_RESULT,
        deletedUsers: 1,
        remainingUsers: 1,
      })
      .mockResolvedValueOnce({
        ...DRY_RUN_RESULT,
        matchedUsers: 1,
        remainingUsers: 1,
      });

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(runtimeMocks.deleteLegacySoftDeletedUsers).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "account_data_deletion.legacy_cleanup.cli.remaining_users",
      message: "既存退会済みユーザーが残っています",
    });
    expect(runtimeMocks.disconnect).toHaveBeenCalledTimes(1);
  });

  it("service失敗は固定stderr・終了code 1とし、秘密情報を出力しない", async () => {
    runtimeMocks.deleteLegacySoftDeletedUsers.mockRejectedValue(
      new Error(
        "DATABASE_URL=postgresql://private-user:private-password@production.internal private-user-id",
      ),
    );

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "account_data_deletion.legacy_cleanup.cli.failed",
      message: "既存退会済みユーザーcleanup CLIの実行に失敗しました",
    });
    const stderr = getConsoleOutput(consoleErrorSpy);
    for (const secret of [
      "DATABASE_URL",
      "private-user",
      "private-password",
      "production.internal",
      "private-user-id",
    ]) {
      expect(stderr).not.toContain(secret);
    }
    expect(runtimeMocks.disconnect).toHaveBeenCalledTimes(1);
  });

  it("DB dependency読込失敗は固定stderr・終了code 1とし、生Errorを出力しない", async () => {
    vi.doMock("../lib/prisma.js", () => {
      runtimeMocks.prismaModuleLoaded();
      throw new Error("postgresql://private-user:private-password@production.internal/gensoko");
    });

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "account_data_deletion.legacy_cleanup.cli.failed",
      message: "既存退会済みユーザーcleanup CLIの実行に失敗しました",
    });
    const stderr = getConsoleOutput(consoleErrorSpy);
    expect(stderr).not.toContain("private-user");
    expect(stderr).not.toContain("private-password");
    expect(stderr).not.toContain("production.internal");
    expect(runtimeMocks.disconnect).not.toHaveBeenCalled();
  });

  it("成功後のdisconnect失敗は終了code 0を維持し、再実行防止警告を出す", async () => {
    runtimeMocks.disconnect.mockRejectedValue(new Error("disconnect DATABASE_URL=private"));

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(consoleWarnSpy).toHaveBeenCalledWith({
      event: "account_data_deletion.legacy_cleanup.cli.disconnect_failed",
      message:
        "cleanup結果は確定済みですが、DB接続の終了処理に失敗しました。再実行せず接続状態を確認してください",
    });
    expect(getConsoleOutput(consoleWarnSpy)).not.toContain("DATABASE_URL");
    expect(getConsoleOutput(consoleWarnSpy)).not.toContain("private");
  });

  it("実行失敗後のdisconnect失敗は終了code 1を維持する", async () => {
    runtimeMocks.deleteLegacySoftDeletedUsers.mockRejectedValue(new Error("cleanup failed"));
    runtimeMocks.disconnect.mockRejectedValue(new Error("disconnect failed"));

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "account_data_deletion.legacy_cleanup.cli.failed",
      message: "既存退会済みユーザーcleanup CLIの実行に失敗しました",
    });
    expect(consoleWarnSpy).toHaveBeenCalledWith({
      event: "account_data_deletion.legacy_cleanup.cli.disconnect_failed",
      message: "DB接続の終了処理に失敗しました",
    });
  });
});
