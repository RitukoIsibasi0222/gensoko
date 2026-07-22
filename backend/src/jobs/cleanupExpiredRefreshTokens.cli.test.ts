import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  cleanupModuleLoaded: vi.fn(),
  prismaModuleLoaded: vi.fn(),
  cleanupExpiredRefreshTokens: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("./cleanupExpiredRefreshTokens.js", () => {
  runtimeMocks.cleanupModuleLoaded();
  return { cleanupExpiredRefreshTokens: runtimeMocks.cleanupExpiredRefreshTokens };
});

vi.mock("../lib/prisma.js", () => {
  runtimeMocks.prismaModuleLoaded();
  return { prisma: { $disconnect: runtimeMocks.disconnect } };
});

const ORIGINAL_ARGV = [...process.argv];
const ORIGINAL_CLEANUP_ENABLED = process.env.REFRESH_TOKEN_CLEANUP_ENABLED;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

async function importCli(): Promise<void> {
  await import("./cleanupExpiredRefreshTokens.cli.js");
}

describe("cleanupExpiredRefreshTokens CLI", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.argv = [process.execPath, "/app/src/jobs/cleanupExpiredRefreshTokens.cli.ts"];
    process.exitCode = undefined;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    process.argv = [...ORIGINAL_ARGV];
    process.exitCode = undefined;
    if (ORIGINAL_CLEANUP_ENABLED === undefined) {
      delete process.env.REFRESH_TOKEN_CLEANUP_ENABLED;
    } else {
      process.env.REFRESH_TOKEN_CLEANUP_ENABLED = ORIGINAL_CLEANUP_ENABLED;
    }
  });

  it("cleanup有効設定の不備は具体メッセージ・終了code 2とし、DB dependencyをloadしない", async () => {
    process.env.REFRESH_TOKEN_CLEANUP_ENABLED = "invalid";

    await importCli();

    await vi.waitFor(() => expect(process.exitCode).toBe(2));
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "refresh_tokens.cleanup.cli.failed",
      message: "REFRESH_TOKEN_CLEANUP_ENABLEDはtrueまたはfalseで設定してください",
    });
    expect(runtimeMocks.cleanupModuleLoaded).not.toHaveBeenCalled();
    expect(runtimeMocks.prismaModuleLoaded).not.toHaveBeenCalled();
    expect(runtimeMocks.cleanupExpiredRefreshTokens).not.toHaveBeenCalled();
    expect(runtimeMocks.disconnect).not.toHaveBeenCalled();
  });
});
