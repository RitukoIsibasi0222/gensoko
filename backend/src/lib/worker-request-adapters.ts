import { createFetchMailSender } from "./fetch-mail-sender.js";
import type { MailSender } from "./mail-sender.js";
import {
  createPrismaClient as createDefaultPrismaClient,
  type AppPrismaClient,
} from "./prisma-client.js";
import type { WorkerRuntimeConfig } from "./worker-config.js";
import type { CreateWorkerRequestAdapters } from "../worker-handler.js";
import type { RateLimitCounter } from "../cloudflare/rate-limit-counter.js";
import { createDurableObjectRateLimitStore } from "../middleware/rateLimit/durable-object-store.js";
import { resolveClientIp } from "../middleware/rateLimit/key.js";
import type { RateLimitStore } from "../middleware/rateLimit/store.js";

export type WorkerRequestAdapterFactories = Readonly<{
  createPrismaClient(connectionString: string): AppPrismaClient;
  createMailSender(config: Pick<WorkerRuntimeConfig, "target" | "mail">): MailSender;
  createRateLimitStore(namespace: DurableObjectNamespace<RateLimitCounter>): RateLimitStore;
}>;

/**
 * production相当Workerのruntime adapterをrequest単位で構築する。
 */
export function createWorkerRequestAdapters({
  createPrismaClient = createDefaultPrismaClient,
  createMailSender = createFetchMailSender,
  createRateLimitStore = createDurableObjectRateLimitStore,
}: Partial<WorkerRequestAdapterFactories> = {}): CreateWorkerRequestAdapters {
  return ({ request, config }) => {
    const prisma = createPrismaClient(config.hyperdrive.connectionString);
    const mailSender = createMailSender(config);
    const rateLimitStore = createRateLimitStore(
      config.rateLimit.namespace as unknown as DurableObjectNamespace<RateLimitCounter>,
    );

    return {
      prisma,
      mailSender,
      rateLimit: {
        getStore: () => rateLimitStore,
        keySecret: config.rateLimit.keySecret,
        resolveIp: () =>
          resolveClientIp({
            runtime: "cloudflare-workers",
            cfConnectingIp: request.headers.get("CF-Connecting-IP"),
          }),
      },
    };
  };
}
