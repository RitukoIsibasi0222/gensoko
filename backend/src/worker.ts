import { Hono } from "hono";
import { createApp } from "./app.js";
import {
  createAppDependencies,
  type CreateAppDependenciesOptions,
} from "./lib/app-dependencies.js";
import { getFrontendUrl } from "./lib/config.js";
import type { MailSender } from "./lib/mail-sender.js";
import type { AppPrismaClient } from "./lib/prisma-client.js";
import {
  getWorkerRuntimeConfig,
  type WorkerDeploymentTarget,
  type WorkerRuntimeConfig,
  type WorkerRuntimeEnvironment,
} from "./lib/worker-config.js";
import { createCorsMiddleware } from "./middleware/cors/index.js";
import type { RateLimitDependencies } from "./middleware/rateLimit/store.js";
import { createSecurityHeadersMiddleware } from "./middleware/security/index.js";

const INVALID_RUNTIME_CONFIG_MESSAGE = "Workers runtime設定が不正です";
const ADAPTER_UNAVAILABLE_MESSAGE = "Workers adapterはまだ利用できません";
const INTERNAL_SERVER_ERROR_MESSAGE = "サーバーエラーが発生しました";
const INVALID_RUNTIME_CONFIG_LOG_MESSAGE = "Workers runtime設定の検証に失敗しました";
const ADAPTER_INITIALIZATION_LOG_MESSAGE = "Workers adapterの初期化に失敗しました";
const APPLICATION_INITIALIZATION_LOG_MESSAGE = "Workers applicationの構築に失敗しました";

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
  createErrorApplication?: CreateWorkerErrorApplication;
}>;

export type WorkerErrorApplicationOptions = Readonly<{
  message: string;
  status: 500 | 503;
  frontendUrl?: string;
}>;

export type WorkerErrorApplication = Readonly<{
  fetch(request: Request): Response | Promise<Response>;
}>;

export type CreateWorkerErrorApplication = (
  options: WorkerErrorApplicationOptions,
) => WorkerErrorApplication;

function createWorkerErrorApplication({
  message,
  status,
  frontendUrl,
}: WorkerErrorApplicationOptions): WorkerErrorApplication {
  const errorApp = new Hono();

  errorApp.use("*", createSecurityHeadersMiddleware({ isProduction: true }));
  errorApp.use("*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
  });

  if (frontendUrl) {
    errorApp.use("*", createCorsMiddleware(frontendUrl));
  }

  errorApp.all("*", (context) => context.json({ error: message }, status));
  return errorApp;
}

function getSafeWorkerErrorFrontendUrl(environment: WorkerRuntimeEnvironment): string | undefined {
  try {
    const frontendUrl = getFrontendUrl({
      isProduction: true,
      environment,
    });

    // 通常のWorkers設定と同様、error pathでも検証済みHTTPS originだけをCORSへ渡す。
    return frontendUrl.startsWith("https://") ? frontendUrl : undefined;
  } catch {
    return undefined;
  }
}

export function createWorkerHandler({
  expectedTarget,
  createRequestAdapters,
  createDependencies = createAppDependencies,
  createApplication = createApp,
  createErrorApplication = createWorkerErrorApplication,
}: CreateWorkerHandlerOptions) {
  // 既定WorkerはSD7/SD8まで全requestを503で閉じるため、error appの再構築を避ける。
  // 固定status/messageと検証済みoriginだけをcacheし、request・env・adapterは保持しない。
  const errorApplications = new Map<string, WorkerErrorApplication>();

  const jsonError = async ({
    request,
    message,
    status,
    frontendUrl,
  }: WorkerErrorApplicationOptions & Readonly<{ request: Request }>): Promise<Response> => {
    const cacheKey = JSON.stringify([status, message, frontendUrl ?? null]);
    let errorApplication = errorApplications.get(cacheKey);

    if (!errorApplication) {
      errorApplication = createErrorApplication({ message, status, frontendUrl });
      errorApplications.set(cacheKey, errorApplication);
    }

    return errorApplication.fetch(request);
  };

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
        const frontendUrl = getSafeWorkerErrorFrontendUrl(environment);
        console.error(INVALID_RUNTIME_CONFIG_LOG_MESSAGE);
        return jsonError({
          request,
          message: INVALID_RUNTIME_CONFIG_MESSAGE,
          status: 500,
          frontendUrl,
        });
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
        console.error(ADAPTER_INITIALIZATION_LOG_MESSAGE);
        return jsonError({
          request,
          message: ADAPTER_UNAVAILABLE_MESSAGE,
          status: 503,
          frontendUrl: config.frontendUrl,
        });
      }

      if (!adapters) {
        return jsonError({
          request,
          message: ADAPTER_UNAVAILABLE_MESSAGE,
          status: 503,
          frontendUrl: config.frontendUrl,
        });
      }

      try {
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
      } catch {
        console.error(APPLICATION_INITIALIZATION_LOG_MESSAGE);
        return jsonError({
          request,
          message: INTERNAL_SERVER_ERROR_MESSAGE,
          status: 500,
          frontendUrl: config.frontendUrl,
        });
      }
    },
  };
}

// SD9でWranglerのproduction graphと実bindingを接続するまでは誤配備を503で閉じる。
export default createWorkerHandler({
  expectedTarget: "staging",
  createRequestAdapters: async () => null,
});
