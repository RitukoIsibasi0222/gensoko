import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  createAdmin: vi.fn(),
  disconnect: vi.fn(),
  adminServiceModuleLoaded: vi.fn(),
  prismaModuleLoaded: vi.fn(),
}));

vi.mock("../services/admin-create.service.js", () => {
  runtimeMocks.adminServiceModuleLoaded();
  return { createAdmin: runtimeMocks.createAdmin };
});

vi.mock("../lib/prisma.js", () => {
  runtimeMocks.prismaModuleLoaded();
  return {
    prisma: {
      $disconnect: runtimeMocks.disconnect,
    },
  };
});

const DATABASE_URL = "postgresql://gensoko:private-db-password@postgres:5432/gensoko";
const ADMIN_USERNAME = "env_admin";
const ADMIN_EMAIL = "EnvAdmin@Example.com";
const ADMIN_PASSWORD = "EnvironmentPass1!";
const ORIGINAL_ARGV = [...process.argv];
const ENVIRONMENT_KEYS = [
  "DATABASE_URL",
  "ADMIN_USERNAME",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
] as const;
const ORIGINAL_ENVIRONMENT = Object.fromEntries(
  ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENVIRONMENT_KEYS)[number], string | undefined>;

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

function clearAdminEnvironment(): void {
  for (const key of ENVIRONMENT_KEYS) {
    delete process.env[key];
  }
}

function setValidAdminEnvironment(): void {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.ADMIN_USERNAME = ADMIN_USERNAME;
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
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
  return spy.mock.calls.flat().map(String).join("\n");
}

async function importCli(): Promise<void> {
  await import("./createAdmin.cli.js");
}

describe("createAdmin.cli", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    runtimeMocks.createAdmin.mockResolvedValue(undefined);
    runtimeMocks.disconnect.mockResolvedValue(undefined);
    process.argv = [process.execPath, "/app/src/scripts/createAdmin.cli.ts"];
    process.exitCode = undefined;
    clearAdminEnvironment();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    process.argv = [...ORIGINAL_ARGV];
    process.exitCode = undefined;
    restoreEnvironment();
  });

  it("helpをstdoutへ表示し、serviceとPrismaをloadせず終了code 0にする", async () => {
    const secretArgument = "ArgumentPass1!";
    process.argv.push("--help", "--password", secretArgument);

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    const stdout = getConsoleOutput(consoleLogSpy);
    expect(stdout).toContain("--username");
    expect(stdout).toContain("ADMIN_PASSWORD");
    expect(stdout).not.toContain(secretArgument);
    expect(stdout).not.toContain("DATABASE_URL");
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(runtimeMocks.adminServiceModuleLoaded).not.toHaveBeenCalled();
    expect(runtimeMocks.prismaModuleLoaded).not.toHaveBeenCalled();
    expect(runtimeMocks.createAdmin).not.toHaveBeenCalled();
    expect(runtimeMocks.disconnect).not.toHaveBeenCalled();
  });

  it("引数解析エラーを固定stderrへ表示し、DB dependencyをloadせず終了code 2にする", async () => {
    const secretPosition = "secret-admin@example.com";
    process.argv.push(secretPosition);

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(2));
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith("コマンド引数が正しくありません");
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain(secretPosition);
    expect(runtimeMocks.adminServiceModuleLoaded).not.toHaveBeenCalled();
    expect(runtimeMocks.prismaModuleLoaded).not.toHaveBeenCalled();
  });

  it("validationエラーを日本語stderrへ表示し、DB dependencyをloadせず終了code 2にする", async () => {
    setValidAdminEnvironment();
    process.env.ADMIN_USERNAME = "invalid-admin-name";

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(2));
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "ユーザー名は英数字とアンダースコアのみ使用できます",
    );
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("invalid-admin-name");
    expect(runtimeMocks.adminServiceModuleLoaded).not.toHaveBeenCalled();
    expect(runtimeMocks.prismaModuleLoaded).not.toHaveBeenCalled();
  });

  it("DB設定不足を固定stderrへ表示し、DB dependencyをloadせず終了code 1にする", async () => {
    setValidAdminEnvironment();
    delete process.env.DATABASE_URL;

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith("データベース接続設定がありません");
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("DATABASE_URL");
    expect(runtimeMocks.adminServiceModuleLoaded).not.toHaveBeenCalled();
    expect(runtimeMocks.prismaModuleLoaded).not.toHaveBeenCalled();
  });

  it("環境変数方式で管理者を作成し、成功出力・終了code 0・disconnectを反映する", async () => {
    setValidAdminEnvironment();

    await importCli();

    await vi.waitFor(() => expect(runtimeMocks.disconnect).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(runtimeMocks.adminServiceModuleLoaded).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.prismaModuleLoaded).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.createAdmin).toHaveBeenCalledWith({
      username: ADMIN_USERNAME,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith("管理者アカウントを作成しました");
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    const allOutput = `${getConsoleOutput(consoleLogSpy)}\n${getConsoleOutput(consoleErrorSpy)}`;
    expect(allOutput).not.toContain(ADMIN_USERNAME);
    expect(allOutput).not.toContain(ADMIN_EMAIL);
    expect(allOutput).not.toContain(ADMIN_PASSWORD);
    expect(allOutput).not.toContain(DATABASE_URL);
  });

  it("password引数方式では環境変数推奨警告を出すが、入力値は出力しない", async () => {
    const argumentUsername = "cli_admin";
    const argumentEmail = "CliAdmin@Example.com";
    const argumentPassword = "ArgumentPass1!";
    process.env.DATABASE_URL = DATABASE_URL;
    process.argv.push(
      "--username",
      argumentUsername,
      "--email",
      argumentEmail,
      "--password",
      argumentPassword,
    );

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(consoleLogSpy).toHaveBeenCalledWith("管理者アカウントを作成しました");
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(getConsoleOutput(consoleErrorSpy)).toContain("環境変数");

    const allOutput = `${getConsoleOutput(consoleLogSpy)}\n${getConsoleOutput(consoleErrorSpy)}`;
    expect(allOutput).not.toContain(argumentUsername);
    expect(allOutput).not.toContain(argumentEmail);
    expect(allOutput).not.toContain(argumentPassword);
    expect(allOutput).not.toContain(DATABASE_URL);
  });

  it("重複エラーを固定stderrへ表示し、終了code 1でdisconnectする", async () => {
    setValidAdminEnvironment();
    runtimeMocks.createAdmin.mockRejectedValue(
      Object.assign(new Error(`${ADMIN_USERNAME} / ${ADMIN_EMAIL}`), {
        code: "DUPLICATE_USER",
      }),
    );

    await importCli();

    await vi.waitFor(() => expect(runtimeMocks.disconnect).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "ユーザー名またはメールアドレスは既に使用されています",
    );
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain(ADMIN_USERNAME);
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain(ADMIN_EMAIL);
  });

  it("想定外エラーの詳細を出力せず、固定stderr・終了code 1・disconnectを反映する", async () => {
    setValidAdminEnvironment();
    const sensitiveValues = [
      ADMIN_USERNAME,
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      "$2b$12$private-password-hash",
      "private-user-id",
      DATABASE_URL,
      "P2002 private meta",
    ];
    runtimeMocks.createAdmin.mockRejectedValue(
      Object.assign(new Error(sensitiveValues.join(" ")), {
        code: "P2002",
        meta: sensitiveValues[6],
      }),
    );

    await importCli();

    await vi.waitFor(() => expect(runtimeMocks.disconnect).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith("管理者アカウントの作成に失敗しました");

    const allOutput = `${getConsoleOutput(consoleLogSpy)}\n${getConsoleOutput(consoleErrorSpy)}`;
    for (const sensitiveValue of sensitiveValues) {
      expect(allOutput).not.toContain(sensitiveValue);
    }
  });

  it("作成成功後のdisconnect失敗では成功codeを維持し、安全な警告を出す", async () => {
    setValidAdminEnvironment();
    runtimeMocks.disconnect.mockRejectedValue(new Error(`disconnect failed: ${DATABASE_URL}`));

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(consoleLogSpy).toHaveBeenCalledWith("管理者アカウントを作成しました");
    expect(consoleErrorSpy).toHaveBeenCalledWith("データベース接続の終了処理に失敗しました");
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain(DATABASE_URL);
  });

  it("作成失敗後のdisconnect失敗では元の終了code 1を維持する", async () => {
    setValidAdminEnvironment();
    runtimeMocks.createAdmin.mockRejectedValue(new Error("create failed"));
    runtimeMocks.disconnect.mockRejectedValue(new Error("disconnect failed"));

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenNthCalledWith(1, "管理者アカウントの作成に失敗しました");
    expect(consoleErrorSpy).toHaveBeenNthCalledWith(2, "データベース接続の終了処理に失敗しました");
  });
});
