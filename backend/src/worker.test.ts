import { describe, expect, it, vi } from "vitest";
import type { AppPrismaClient } from "./lib/prisma-client.js";
import type { WorkerRuntimeEnvironment } from "./lib/worker-config.js";
import {
  createWorkerHandler,
  type CreateWorkerRequestAdapters,
  type WorkerRequestAdapters,
} from "./worker-handler.js";

const VALID_JWT_SECRET = "j".repeat(64);
const VALID_RATE_LIMIT_SECRET = Buffer.from("r".repeat(32)).toString("base64");
const ALLOWED_ORIGIN = "https://staging.gensoko.example";

function createRateLimitDependencies() {
  return {
    getStore: () => ({
      consume: async () => ({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAtMs: Date.now() + 60_000,
        retryAfterSec: 0,
      }),
    }),
    keySecret: VALID_RATE_LIMIT_SECRET,
    resolveIp: () => "127.0.0.1",
  };
}

function createTestAdapters(prisma: AppPrismaClient): WorkerRequestAdapters {
  return {
    prisma,
    mailSender: { send: async () => undefined },
    rateLimit: createRateLimitDependencies(),
  };
}

function createWorkerRequest(path: string, origin = ALLOWED_ORIGIN): Request {
  return new Request(`https://api.example.test${path}`, {
    headers: { Origin: origin },
  });
}

function createValidEnvironment(): WorkerRuntimeEnvironment {
  return {
    DEPLOYMENT_ENVIRONMENT: "staging",
    DATABASE_TARGET: "staging",
    NODE_ENV: "production",
    FRONTEND_URL: ALLOWED_ORIGIN,
    JWT_SECRET: VALID_JWT_SECRET,
    RATE_LIMIT_STORE: "durable-object",
    RATE_LIMIT_KEY_SECRET: VALID_RATE_LIMIT_SECRET,
    MAIL_API_URL: "https://mail.example.test/send",
    MAIL_API_KEY: "mail-api-key",
    MAIL_FROM: "noreply@staging.gensoko.example",
    MAIL_ALLOWED_RECIPIENTS: "tester@example.test",
    HYPERDRIVE: { connectionString: "postgresql://worker-request" },
    RATE_LIMIT_COUNTER: {
      idFromName: vi.fn(),
      get: vi.fn(),
    },
  };
}

describe("createWorkerHandler", () => {
  it("requestごとのPrismaを実app graphへ渡し、disconnectしない", async () => {
    const requestClients: Array<{
      prisma: AppPrismaClient;
      findMany: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    const createRequestAdapters: CreateWorkerRequestAdapters = () => {
      const requestNumber = requestClients.length + 1;
      const findMany = vi.fn().mockResolvedValue([
        {
          id: requestNumber,
          symbol: `R${requestNumber}`,
        },
      ]);
      const disconnect = vi.fn();
      const prisma = {
        element: { findMany },
        $disconnect: disconnect,
      } as unknown as AppPrismaClient;
      requestClients.push({ prisma, findMany, disconnect });

      return createTestAdapters(prisma);
    };
    const worker = createWorkerHandler({
      expectedTarget: "staging",
      createRequestAdapters,
    });
    const environment = createValidEnvironment();

    const firstResponse = await worker.fetch(createWorkerRequest("/api/v1/elements"), environment);
    const secondResponse = await worker.fetch(createWorkerRequest("/api/v1/elements"), environment);

    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toEqual({
      elements: [{ id: 1, symbol: "R1" }],
    });
    expect(secondResponse.status).toBe(200);
    await expect(secondResponse.json()).resolves.toEqual({
      elements: [{ id: 2, symbol: "R2" }],
    });
    expect(requestClients).toHaveLength(2);
    expect(requestClients[0]?.prisma).not.toBe(requestClients[1]?.prisma);
    expect(requestClients[0]?.findMany).toHaveBeenCalledTimes(1);
    expect(requestClients[1]?.findMany).toHaveBeenCalledTimes(1);
    expect(requestClients[0]?.disconnect).not.toHaveBeenCalled();
    expect(requestClients[1]?.disconnect).not.toHaveBeenCalled();
  });

  it("adapter未実装時はmemory fallbackせず503で閉じる", async () => {
    const worker = createWorkerHandler({
      expectedTarget: "staging",
      createRequestAdapters: async () => null,
    });

    const response = await worker.fetch(
      createWorkerRequest("/api/v1/health"),
      createValidEnvironment(),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Workers adapterはまだ利用できません",
    });
  });

  it("同じfail-closed応答ではerror appを再構築しない", async () => {
    const createErrorApplication = vi.fn(
      ({ message, status }: { message: string; status: 500 | 503 }) => ({
        fetch: async () => Response.json({ error: message }, { status }),
      }),
    );
    const worker = createWorkerHandler({
      expectedTarget: "staging",
      createRequestAdapters: async () => null,
      createErrorApplication,
    });
    const environment = createValidEnvironment();

    const firstResponse = await worker.fetch(createWorkerRequest("/first"), environment);
    const secondResponse = await worker.fetch(createWorkerRequest("/second"), environment);

    expect(firstResponse.status).toBe(503);
    expect(secondResponse.status).toBe(503);
    expect(createErrorApplication).toHaveBeenCalledOnce();
  });

  it("設定不正の詳細やsecretを応答・ログへ含めない", async () => {
    const worker = createWorkerHandler({
      expectedTarget: "staging",
      createRequestAdapters: vi.fn(),
    });
    const environment = {
      ...createValidEnvironment(),
      JWT_SECRET: "sensitive-but-invalid",
    };
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await worker.fetch(createWorkerRequest("/"), environment);
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(body).toContain("Workers runtime設定が不正です");
      expect(body).not.toContain("sensitive-but-invalid");
      expect(consoleErrorSpy).toHaveBeenCalledWith("Workers runtime設定の検証に失敗しました");
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain("sensitive-but-invalid");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("他の設定が不正でも検証済みoriginのpreflightを処理する", async () => {
    const worker = createWorkerHandler({
      expectedTarget: "staging",
      createRequestAdapters: vi.fn(),
    });
    const environment = {
      ...createValidEnvironment(),
      JWT_SECRET: "invalid",
    };
    const request = new Request("https://api.example.test/api/v1/auth/login", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type,Authorization",
      },
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await worker.fetch(request, environment);

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("本設定で不正なFRONTEND_URLは設定エラーresponseへCORS originを付けない", async () => {
    const worker = createWorkerHandler({
      expectedTarget: "staging",
      createRequestAdapters: vi.fn(),
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      for (const frontendUrl of ["https://evil.example/path", "http://staging.gensoko.example"]) {
        const response = await worker.fetch(createWorkerRequest("/", new URL(frontendUrl).origin), {
          ...createValidEnvironment(),
          FRONTEND_URL: frontendUrl,
        });

        expect(response.status).toBe(500);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
        expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
      }
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("adapter例外をsafe logへ記録し、単一origin CORS付き503を返す", async () => {
    const sensitiveError = "postgresql://user:secret@internal.example/gensoko";
    const worker = createWorkerHandler({
      expectedTarget: "staging",
      createRequestAdapters: async () => {
        throw new Error(sensitiveError);
      },
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await worker.fetch(
        createWorkerRequest("/api/v1/elements"),
        createValidEnvironment(),
      );
      const body = await response.text();

      expect(response.status).toBe(503);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(body).toContain("Workers adapterはまだ利用できません");
      expect(body).not.toContain(sensitiveError);
      expect(consoleErrorSpy).toHaveBeenCalledWith("Workers adapterの初期化に失敗しました");
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain(sensitiveError);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("未許可originをadapter失敗responseへ反映しない", async () => {
    const worker = createWorkerHandler({
      expectedTarget: "staging",
      createRequestAdapters: async () => {
        throw new Error("adapter error");
      },
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await worker.fetch(
        createWorkerRequest("/api/v1/elements", "https://evil.example"),
        createValidEnvironment(),
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("https://evil.example");
      expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("adapter失敗中も許可originのpreflightを処理する", async () => {
    const worker = createWorkerHandler({
      expectedTarget: "staging",
      createRequestAdapters: async () => {
        throw new Error("adapter error");
      },
    });
    const request = new Request("https://api.example.test/api/v1/auth/login", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type,Authorization",
      },
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await worker.fetch(request, createValidEnvironment());

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("dependency構築例外を内部情報なしの日本語500へ変換する", async () => {
    const sensitiveError = "dependency failed with secret-value";
    const worker = createWorkerHandler({
      expectedTarget: "staging",
      createRequestAdapters: async () => createTestAdapters({} as unknown as AppPrismaClient),
      createDependencies: () => {
        throw new Error(sensitiveError);
      },
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await worker.fetch(createWorkerRequest("/"), createValidEnvironment());
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
      expect(body).toContain("サーバーエラーが発生しました");
      expect(body).not.toContain(sensitiveError);
      expect(consoleErrorSpy).toHaveBeenCalledWith("Workers applicationの構築に失敗しました");
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain(sensitiveError);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("app構築例外を内部情報なしの日本語500へ変換する", async () => {
    const sensitiveError = "application failed with secret-value";
    const worker = createWorkerHandler({
      expectedTarget: "staging",
      createRequestAdapters: async () => createTestAdapters({} as unknown as AppPrismaClient),
      createApplication: () => {
        throw new Error(sensitiveError);
      },
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await worker.fetch(createWorkerRequest("/"), createValidEnvironment());
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
      expect(body).toContain("サーバーエラーが発生しました");
      expect(body).not.toContain(sensitiveError);
      expect(consoleErrorSpy).toHaveBeenCalledWith("Workers applicationの構築に失敗しました");
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain(sensitiveError);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
