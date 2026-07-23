import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  validateEnvironment: vi.fn(),
  runEvidence: vi.fn(),
}));

vi.mock("./stagingRateLimitEvidence.js", () => ({
  validateStagingRateLimitEvidenceEnvironment: runtimeMocks.validateEnvironment,
  runStagingRateLimitEvidence: runtimeMocks.runEvidence,
}));

const ORIGINAL_ENV = { ...process.env };
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

function getConsoleOutput(spy: ReturnType<typeof vi.spyOn>): string {
  return JSON.stringify(spy.mock.calls);
}

async function runCli(): Promise<void> {
  const module = await import("./stagingRateLimitEvidence.cli.js");
  await module.executionPromise;
}

describe("stagingRateLimitEvidence CLI", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      STAGING_SYNTHETIC_USER_PASSWORD: "UserSecret1!",
    };
    process.exitCode = undefined;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    runtimeMocks.validateEnvironment.mockReturnValue({
      apiBaseUrl: "https://staging.invalid/api/v1",
      frontendOrigin: "https://frontend.invalid",
      evidenceCase: "auth",
      requestTimeoutMs: 10_000,
      userPassword: "UserSecret1!",
    });
    runtimeMocks.runEvidence.mockResolvedValue({
      evidenceCase: "auth",
      policyId: "AUTH_IP",
      allowedRequests: 10,
      limitedRequestNumber: 11,
      limitedStatus: 429,
      retryAfterSec: 42,
      bodyContract: true,
      corsContract: true,
      securityHeadersContract: true,
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    process.env = { ...ORIGINAL_ENV };
    process.exitCode = undefined;
  });

  it("成功時は安全なsummaryだけを出力しcredentialや接続先を出さない", async () => {
    await runCli();

    expect(process.exitCode).toBe(0);
    expect(runtimeMocks.validateEnvironment).toHaveBeenCalledWith(process.env);
    expect(runtimeMocks.runEvidence).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "staging_rate_limit_evidence.completed",
        evidenceCase: "auth",
        policyId: "AUTH_IP",
        limitedStatus: 429,
      }),
    );
    const output = getConsoleOutput(consoleInfoSpy);
    expect(output).not.toContain("UserSecret1!");
    expect(output).not.toContain("staging.invalid");
    expect(output).not.toContain("frontend.invalid");
  });

  it("環境guard失敗はraw値を出さず終了code 2にする", async () => {
    runtimeMocks.validateEnvironment.mockImplementation(() => {
      throw new Error("password=guard-secret");
    });
    await runCli();

    expect(process.exitCode).toBe(2);
    expect(runtimeMocks.runEvidence).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "staging_rate_limit_evidence.failed",
      message: "staging rate limit evidence設定が不正です",
    });
    expect(getConsoleOutput(consoleErrorSpy)).not.toContain("guard-secret");
  });

  it("HTTP実行失敗はtoken・body・redirect先を出さず終了code 1にする", async () => {
    runtimeMocks.runEvidence.mockRejectedValue(
      new Error("token=secret response-body=private redirect=https://attacker.invalid"),
    );
    await runCli();

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "staging_rate_limit_evidence.failed",
      message: "staging rate limit evidenceの実行に失敗しました",
    });
    const output = getConsoleOutput(consoleErrorSpy);
    expect(output).not.toContain("secret");
    expect(output).not.toContain("private");
    expect(output).not.toContain("attacker.invalid");
  });
});
