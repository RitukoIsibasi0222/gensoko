import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  createBcryptPasswordVerifier: vi.fn(),
  createWorkerHandler: vi.fn(),
  createWorkerRequestAdapters: vi.fn(),
  workerFetch: vi.fn(),
}));

class TestRateLimitCounter {}
class TestPasswordVerifierDurableObject {}

const VALID_JWT_SECRET = "j".repeat(64);
const VALID_RATE_LIMIT_SECRET = Buffer.from("r".repeat(32)).toString("base64");

function createValidEnvironment() {
  return {
    DEPLOYMENT_ENVIRONMENT: "staging",
    DATABASE_TARGET: "staging",
    NODE_ENV: "production",
    FRONTEND_URL: "https://staging.gensoko.example",
    JWT_SECRET: VALID_JWT_SECRET,
    RATE_LIMIT_STORE: "durable-object",
    RATE_LIMIT_KEY_SECRET: VALID_RATE_LIMIT_SECRET,
    MAIL_API_URL: "https://mail.example.test/send",
    MAIL_API_KEY: "mail-api-key",
    MAIL_FROM: "noreply@staging.gensoko.example",
    MAIL_ALLOWED_RECIPIENTS: "tester@example.test",
    HYPERDRIVE: { connectionString: "postgresql://worker-request" },
    RATE_LIMIT_COUNTER: { idFromName: vi.fn(), get: vi.fn() },
    PASSWORD_VERIFIER: { idFromName: vi.fn(), get: vi.fn() },
  };
}

vi.mock("./cloudflare/rate-limit-counter.js", () => ({
  RateLimitCounter: TestRateLimitCounter,
}));

vi.mock("./cloudflare/password-verifier.js", () => ({
  PasswordVerifierDurableObject: TestPasswordVerifierDurableObject,
}));

vi.mock("./lib/bcrypt-password-verifier.js", () => ({
  createBcryptPasswordVerifier: runtimeMocks.createBcryptPasswordVerifier,
}));

vi.mock("./lib/worker-request-adapters.js", () => ({
  createWorkerRequestAdapters: runtimeMocks.createWorkerRequestAdapters,
}));

vi.mock("./worker-handler.js", () => ({
  createWorkerHandler: runtimeMocks.createWorkerHandler,
}));

describe("staging rollback baseline Worker", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    runtimeMocks.createWorkerRequestAdapters.mockReturnValue(vi.fn());
    runtimeMocks.createWorkerHandler.mockReturnValue({ fetch: runtimeMocks.workerFetch });
    runtimeMocks.workerFetch.mockResolvedValue(new Response(null, { status: 204 }));
  });

  it("baseline entrypointだけが既存local bcrypt adapterを明示DIする", async () => {
    const localVerifier = { verify: vi.fn() };
    const namespace = { idFromName: vi.fn(), get: vi.fn() };
    runtimeMocks.createBcryptPasswordVerifier.mockReturnValue(localVerifier);

    await import("./worker-staging-rollback-baseline.js");

    expect(runtimeMocks.createWorkerRequestAdapters).toHaveBeenCalledOnce();
    const factories = runtimeMocks.createWorkerRequestAdapters.mock.calls[0]?.[0];
    expect(factories).toEqual({
      createPasswordVerifier: expect.any(Function),
    });
    expect(factories.createPasswordVerifier(namespace)).toBe(localVerifier);
    expect(runtimeMocks.createBcryptPasswordVerifier).toHaveBeenCalledOnce();
    expect(runtimeMocks.createWorkerHandler).toHaveBeenCalledWith({
      expectedTarget: "staging",
      createRequestAdapters: runtimeMocks.createWorkerRequestAdapters.mock.results[0]?.value,
    });
  });

  it("通常版と同じ2 classをexportし、environmentを変更せずhandlerへ渡す", async () => {
    const module = await import("./worker-staging-rollback-baseline.js");
    const request = new Request("https://staging.example.test/api/v1/health");
    const environment = { PASSWORD_VERIFIER: { idFromName: vi.fn(), get: vi.fn() } };
    const executionContext = { waitUntil: vi.fn() };

    await expect(
      module.default.fetch(request, environment as never, executionContext),
    ).resolves.toMatchObject({ status: 204 });

    expect(module.RateLimitCounter).toBe(TestRateLimitCounter);
    expect(module.PasswordVerifierDurableObject).toBe(TestPasswordVerifierDurableObject);
    expect(runtimeMocks.workerFetch).toHaveBeenCalledWith(request, environment, executionContext);
  });

  it("PASSWORD_VERIFIER binding欠損をlocal adapterで迂回せず固定503にする", async () => {
    await import("./worker-staging-rollback-baseline.js");
    const handlerOptions = runtimeMocks.createWorkerHandler.mock.calls[0]?.[0];
    expect(handlerOptions).toBeDefined();
    const actualWorkerHandler =
      await vi.importActual<typeof import("./worker-handler.js")>("./worker-handler.js");
    const worker = actualWorkerHandler.createWorkerHandler(handlerOptions!);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await worker.fetch(
        new Request("https://staging.example.test/api/v1/auth/login"),
        { ...createValidEnvironment(), PASSWORD_VERIFIER: undefined } as never,
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("60");
      await expect(response.json()).resolves.toEqual({
        error: "一時的に利用できません。しばらく待ってから再試行してください",
      });
      expect(handlerOptions!.createRequestAdapters).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith("password_verification_unavailable");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("bcrypt照合を複製せず、mode切替・自動fallbackを持たない", () => {
    const source = readFileSync("src/worker-staging-rollback-baseline.ts", "utf8");

    expect(source).toContain('from "./lib/bcrypt-password-verifier.js"');
    expect(source).toContain("createBcryptPasswordVerifier()");
    expect(source).toContain("Required<");
    expect(source).not.toContain("bcrypt.compare");
    expect(source).not.toContain("process.env");
    expect(source.toLowerCase()).not.toContain("fallback");
  });
});
