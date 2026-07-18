import { describe, expect, it, vi } from "vitest";
import type { createApp } from "./app.js";
import type { createAppDependencies } from "./lib/app-dependencies.js";
import type { WorkerRuntimeEnvironment } from "./lib/worker-config.js";
import { createWorkerHandler } from "./worker.js";

const VALID_JWT_SECRET = "j".repeat(64);
const VALID_RATE_LIMIT_SECRET = btoa("r".repeat(32));

function createValidEnvironment(): WorkerRuntimeEnvironment {
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
    RATE_LIMIT_COUNTER: {
      idFromName: vi.fn(),
      get: vi.fn(),
    },
  };
}

describe("createWorkerHandler", () => {
  it("requestごとにadapterを生成し、Prismaをdisconnectしない", async () => {
    const disconnect = vi.fn();
    const createRequestAdapters = vi.fn().mockImplementation(() => ({
      prisma: { requestId: crypto.randomUUID(), $disconnect: disconnect },
      mailSender: { send: vi.fn() },
      rateLimit: {
        getStore: vi.fn(),
        keySecret: VALID_RATE_LIMIT_SECRET,
        resolveIp: vi.fn(),
      },
    }));
    const seenPrisma: unknown[] = [];
    const createDependencies = vi.fn((options: { prisma: unknown }) => {
      seenPrisma.push(options.prisma);
      return { requestPrisma: options.prisma };
    }) as unknown as typeof createAppDependencies;
    const createApplication = vi.fn(() => ({
      fetch: async () => new Response("ok"),
    })) as unknown as typeof createApp;
    const worker = createWorkerHandler({
      expectedTarget: "staging",
      createRequestAdapters: createRequestAdapters as never,
      createDependencies,
      createApplication,
    });
    const environment = createValidEnvironment();

    await worker.fetch(new Request("https://api.example.test/first"), environment);
    await worker.fetch(new Request("https://api.example.test/second"), environment);

    expect(createRequestAdapters).toHaveBeenCalledTimes(2);
    expect(seenPrisma).toHaveLength(2);
    expect(seenPrisma[0]).not.toBe(seenPrisma[1]);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("adapter未実装時はmemory fallbackせず503で閉じる", async () => {
    const worker = createWorkerHandler({
      expectedTarget: "staging",
      createRequestAdapters: async () => null,
    });

    const response = await worker.fetch(
      new Request("https://api.example.test/api/v1/health"),
      createValidEnvironment(),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Workers adapterはまだ利用できません",
    });
  });

  it("設定不正の詳細やsecretを応答へ含めない", async () => {
    const worker = createWorkerHandler({
      expectedTarget: "staging",
      createRequestAdapters: vi.fn(),
    });
    const environment = {
      ...createValidEnvironment(),
      JWT_SECRET: "sensitive-but-invalid",
    };

    const response = await worker.fetch(new Request("https://api.example.test/"), environment);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("Workers runtime設定が不正です");
    expect(body).not.toContain("sensitive-but-invalid");
  });
});
