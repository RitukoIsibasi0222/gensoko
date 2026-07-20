import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  remove: vi.fn(),
  validateEnvironment: vi.fn(),
  prismaModuleLoaded: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("./stagingSyntheticAdminE2eFixtures.js", () => ({
  prepareStagingSyntheticAdminE2eFixtures: runtimeMocks.prepare,
  removeStagingSyntheticAdminE2eFixtures: runtimeMocks.remove,
  validateStagingSyntheticAdminE2eFixtureEnvironment: runtimeMocks.validateEnvironment,
}));

vi.mock("../lib/prisma.js", () => {
  runtimeMocks.prismaModuleLoaded();
  return { prisma: { $disconnect: runtimeMocks.disconnect } };
});

const ORIGINAL_ARGV = [...process.argv];
const ORIGINAL_ENV = { ...process.env };
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

function getConsoleOutput(spy: ReturnType<typeof vi.spyOn>): string {
  return JSON.stringify(spy.mock.calls);
}

async function runCli(): Promise<void> {
  const module = await import("./stagingSyntheticAdminE2eFixtures.cli.js");
  await module.executionPromise;
}

describe("stagingSyntheticAdminE2eFixtures CLI", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    runtimeMocks.validateEnvironment.mockImplementation(() => undefined);
    runtimeMocks.prepare.mockResolvedValue({ createdUsers: 2, replacedUsers: 0 });
    runtimeMocks.remove.mockResolvedValue({ deletedUsers: 1 });
    runtimeMocks.disconnect.mockResolvedValue(undefined);
    process.argv = [process.execPath, "/app/src/jobs/stagingSyntheticAdminE2eFixtures.cli.ts"];
    process.env = {
      ...ORIGINAL_ENV,
      STAGING_SYNTHETIC_ADMIN_PASSWORD: "AdminSecret1!",
      STAGING_SYNTHETIC_USER_PASSWORD: "UserSecret1!",
    };
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
    process.env = { ...ORIGINAL_ENV };
    process.exitCode = undefined;
  });

  it("引数不備はDBをloadせず固定errorと終了code 2にする", async () => {
    process.argv.push("--unknown", "secret");
    await runCli();

    expect(process.exitCode).toBe(2);
    expect(runtimeMocks.prismaModuleLoaded).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "staging_synthetic_e2e.fixtures.failed",
      message: "staging synthetic E2E fixture CLIの引数が正しくありません",
    });
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("secret");
  });

  it("prepareはcredentialを引数やlogへ出さず環境変数からfixtureへ渡す", async () => {
    process.argv.push("--operation", "prepare");
    await runCli();

    expect(process.exitCode).toBe(0);
    expect(runtimeMocks.validateEnvironment).toHaveBeenCalledWith(process.env, {
      requireCredentials: true,
    });
    expect(runtimeMocks.prepare).toHaveBeenCalledWith({
      client: expect.anything(),
      adminPassword: "AdminSecret1!",
      userPassword: "UserSecret1!",
    });
    expect(consoleInfoSpy).toHaveBeenCalledWith({
      event: "staging_synthetic_e2e.fixtures.completed",
      operation: "prepare",
      createdUsers: 2,
      replacedUsers: 0,
    });
    expect(getConsoleOutput(consoleInfoSpy)).not.toContain("AdminSecret1!");
    expect(getConsoleOutput(consoleInfoSpy)).not.toContain("UserSecret1!");
  });

  it("removeはcredential欠落時もstaging guardを通してcleanupする", async () => {
    delete process.env.STAGING_SYNTHETIC_ADMIN_PASSWORD;
    delete process.env.STAGING_SYNTHETIC_USER_PASSWORD;
    process.argv.push("--operation", "remove");
    await runCli();

    expect(runtimeMocks.validateEnvironment).toHaveBeenCalledWith(process.env, {
      requireCredentials: false,
    });
    expect(runtimeMocks.remove).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(0);
  });

  it("DB errorとdisconnect errorはraw値を出力せず固定messageにする", async () => {
    process.argv.push("--operation", "remove");
    runtimeMocks.remove.mockRejectedValue(new Error("DATABASE_URL=secret user-id=private"));
    runtimeMocks.disconnect.mockRejectedValue(new Error("password=secret"));
    await runCli();

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "staging_synthetic_e2e.fixtures.failed",
      message: "staging synthetic E2E fixture CLIの実行に失敗しました",
    });
    expect(consoleWarnSpy).toHaveBeenCalledWith({
      event: "staging_synthetic_e2e.fixtures.disconnect_failed",
      message: "staging synthetic E2E fixtureのDB接続終了に失敗しました",
    });
    expect(getConsoleOutput(consoleErrorSpy) + getConsoleOutput(consoleWarnSpy)).not.toContain(
      "secret",
    );
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("private");
  });
});
