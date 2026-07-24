import { describe, expect, it, vi } from "vitest";
import type { RateLimitCounter } from "../cloudflare/rate-limit-counter.js";
import type { PasswordVerifierDurableObject } from "../cloudflare/password-verifier.js";
import type { AppPrismaClient } from "./prisma-client.js";
import type { WorkerRuntimeConfig, WorkerRuntimeEnvironment } from "./worker-config.js";
import { createWorkerRequestAdapters } from "./worker-request-adapters.js";
import type { MailSender } from "./mail-sender.js";
import type { RateLimitStore } from "../middleware/rateLimit/store.js";
import type { PasswordVerifier } from "./password-verifier.js";

const RATE_LIMIT_SECRET = "test-rate-limit-secret";
type WorkerRateLimitNamespace = DurableObjectNamespace<RateLimitCounter>;
type WorkerPasswordVerifierNamespace = DurableObjectNamespace<PasswordVerifierDurableObject>;

function createConfig(): WorkerRuntimeConfig<
  WorkerRateLimitNamespace,
  WorkerPasswordVerifierNamespace
> {
  return {
    target: "staging",
    databaseTarget: "staging",
    frontendUrl: "https://staging.example.invalid",
    jwtSecret: "j".repeat(64),
    hyperdrive: { connectionString: "postgresql://request-scoped-worker" },
    rateLimit: {
      store: "durable-object",
      keySecret: RATE_LIMIT_SECRET,
      namespace: {
        idFromName: vi.fn(),
        get: vi.fn(),
      } as unknown as WorkerRateLimitNamespace,
    },
    passwordVerifier: {
      namespace: {
        idFromName: vi.fn(),
        get: vi.fn(),
      } as unknown as WorkerPasswordVerifierNamespace,
    },
    mail: {
      apiUrl: "https://mail.example.invalid/send",
      apiKey: "test-mail-key",
      from: "noreply@staging.example.invalid",
      allowedRecipients: ["synthetic@example.invalid"],
      timeoutMs: 5_000,
    },
  };
}

describe("createWorkerRequestAdapters", () => {
  it("requestごとにPrisma・DO store・fetch mail senderを新しく組み立てる", async () => {
    const prismaClients: AppPrismaClient[] = [];
    const stores: RateLimitStore[] = [];
    const mailSenders: MailSender[] = [];
    const passwordVerifiers: PasswordVerifier[] = [];
    const createPrismaClient = vi.fn(() => {
      const prisma = { requestNumber: prismaClients.length + 1 } as unknown as AppPrismaClient;
      prismaClients.push(prisma);
      return prisma;
    });
    const createRateLimitStore = vi.fn(() => {
      const store = { consume: vi.fn() } as unknown as RateLimitStore;
      stores.push(store);
      return store;
    });
    const createMailSender = vi.fn(() => {
      const mailSender = { send: vi.fn() };
      mailSenders.push(mailSender);
      return mailSender;
    });
    const createPasswordVerifier = vi.fn(() => {
      const passwordVerifier = { verify: vi.fn() } as unknown as PasswordVerifier;
      passwordVerifiers.push(passwordVerifier);
      return passwordVerifier;
    });
    const createAdapters = createWorkerRequestAdapters({
      createPrismaClient,
      createRateLimitStore,
      createMailSender,
      createPasswordVerifier,
    });
    const config = createConfig();
    const environment: WorkerRuntimeEnvironment<
      WorkerRateLimitNamespace,
      WorkerPasswordVerifierNamespace
    > = {};

    const first = await createAdapters({
      request: new Request("https://api.example.invalid/", {
        headers: { "CF-Connecting-IP": "203.0.113.10" },
      }),
      environment,
      config,
    });
    const second = await createAdapters({
      request: new Request("https://api.example.invalid/", {
        headers: { "CF-Connecting-IP": "203.0.113.11" },
      }),
      environment,
      config,
    });

    expect(first?.prisma).toBe(prismaClients[0]);
    expect(second?.prisma).toBe(prismaClients[1]);
    expect(first?.prisma).not.toBe(second?.prisma);
    expect(first?.mailSender).toBe(mailSenders[0]);
    expect(second?.mailSender).toBe(mailSenders[1]);
    expect(first?.passwordVerifier).toBe(passwordVerifiers[0]);
    expect(second?.passwordVerifier).toBe(passwordVerifiers[1]);
    expect(first?.rateLimit.getStore({} as never)).toBe(stores[0]);
    expect(second?.rateLimit.getStore({} as never)).toBe(stores[1]);
    expect(await first?.rateLimit.resolveIp({} as never)).toBe("203.0.113.10");
    expect(await second?.rateLimit.resolveIp({} as never)).toBe("203.0.113.11");
    expect(createPrismaClient).toHaveBeenNthCalledWith(1, config.hyperdrive.connectionString);
    expect(createPrismaClient).toHaveBeenNthCalledWith(2, config.hyperdrive.connectionString);
    expect(createRateLimitStore).toHaveBeenCalledTimes(2);
    expect(createMailSender).toHaveBeenCalledTimes(2);
    expect(createPasswordVerifier).toHaveBeenCalledTimes(2);
  });

  it("CF-Connecting-IPだけを信頼しforwarded headerへfallbackしない", async () => {
    const createAdapters = createWorkerRequestAdapters({
      createPrismaClient: () => ({}) as AppPrismaClient,
      createRateLimitStore: () => ({ consume: vi.fn() }),
      createMailSender: () => ({ send: vi.fn() }),
    });
    const adapters = await createAdapters({
      request: new Request("https://api.example.invalid/", {
        headers: {
          "X-Forwarded-For": "203.0.113.20",
          "X-Real-IP": "203.0.113.21",
        },
      }),
      environment: {},
      config: createConfig(),
    });

    expect(await adapters?.rateLimit.resolveIp({} as never)).toBeNull();
  });

  it("factory初期化失敗をfallbackせず呼び出し元へ伝播する", async () => {
    const createAdapters = createWorkerRequestAdapters({
      createPrismaClient: () => {
        throw new Error("sensitive connection failure");
      },
      createRateLimitStore: () => ({ consume: vi.fn() }),
      createMailSender: () => ({ send: vi.fn() }),
    });

    await expect(
      Promise.resolve().then(() =>
        createAdapters({
          request: new Request("https://api.example.invalid/"),
          environment: {},
          config: createConfig(),
        }),
      ),
    ).rejects.toThrow();
  });
});
