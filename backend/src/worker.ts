import { createApp } from "./app.js";
import {
  createAppDependencies,
  type CreateAppDependenciesOptions,
} from "./lib/app-dependencies.js";
import type { MailSender } from "./lib/mail-sender.js";
import type { AppPrismaClient } from "./lib/prisma-client.js";
import {
  getWorkerRuntimeConfig,
  type WorkerDeploymentTarget,
  type WorkerRuntimeConfig,
  type WorkerRuntimeEnvironment,
} from "./lib/worker-config.js";
import type { RateLimitDependencies } from "./middleware/rateLimit/store.js";

const INVALID_RUNTIME_CONFIG_MESSAGE = "Workers runtime設定が不正です";
const ADAPTER_UNAVAILABLE_MESSAGE = "Workers adapterはまだ利用できません";

export type WorkerExecutionContext = Readonly<{
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}>;

export type WorkerRequestAdapters = Readonly<{
  prisma: AppPrismaClient;
  mailSender: MailSender;
  rateLimit: RateLimitDependencies;
}>;

export type CreateWorkerRequestAdapters = (
  input: Readonly<{
    request: Request;
    environment: WorkerRuntimeEnvironment;
    executionContext?: WorkerExecutionContext;
    config: WorkerRuntimeConfig;
  }>,
) => WorkerRequestAdapters | null | Promise<WorkerRequestAdapters | null>;

export type CreateWorkerHandlerOptions = Readonly<{
  expectedTarget: WorkerDeploymentTarget;
  createRequestAdapters: CreateWorkerRequestAdapters;
  createDependencies?: typeof createAppDependencies;
  createApplication?: typeof createApp;
}>;

function jsonError(message: string, status: 500 | 503): Response {
  return Response.json({ error: message }, { status });
}

export function createWorkerHandler({
  expectedTarget,
  createRequestAdapters,
  createDependencies = createAppDependencies,
  createApplication = createApp,
}: CreateWorkerHandlerOptions) {
  return {
    async fetch(
      request: Request,
      environment: WorkerRuntimeEnvironment,
      executionContext?: WorkerExecutionContext,
    ): Promise<Response> {
      let config: WorkerRuntimeConfig;
      try {
        config = getWorkerRuntimeConfig({ expectedTarget, environment });
      } catch {
        return jsonError(INVALID_RUNTIME_CONFIG_MESSAGE, 500);
      }

      let adapters: WorkerRequestAdapters | null;
      try {
        adapters = await createRequestAdapters({
          request,
          environment,
          executionContext,
          config,
        });
      } catch {
        return jsonError(ADAPTER_UNAVAILABLE_MESSAGE, 503);
      }

      if (!adapters) {
        return jsonError(ADAPTER_UNAVAILABLE_MESSAGE, 503);
      }

      const dependencyOptions: CreateAppDependenciesOptions = {
        prisma: adapters.prisma,
        mailSender: adapters.mailSender,
        jwtSecret: config.jwtSecret,
        frontendUrl: config.frontendUrl,
        mailFrom: config.mail.from,
      };
      const dependencies = createDependencies(dependencyOptions);
      const app = createApplication({
        isProduction: true,
        frontendUrl: config.frontendUrl,
        rateLimit: adapters.rateLimit,
        dependencies,
      });

      return app.fetch(request);
    },
  };
}

// SD7（Durable Object）とSD8（fetch mail）が揃うまでは誤配備を503で閉じる。
export default createWorkerHandler({
  expectedTarget: "staging",
  createRequestAdapters: async () => null,
});
