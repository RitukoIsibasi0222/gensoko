export type WorkerDeploymentTarget = "staging" | "production";

export type HyperdriveBinding = Readonly<{
  connectionString: string;
}>;

export type DurableObjectNamespaceBinding = Readonly<{
  idFromName(name: string): unknown;
  get(id: unknown): unknown;
}>;

export type WorkerRuntimeEnvironment = Readonly<{
  DEPLOYMENT_ENVIRONMENT?: string;
  DATABASE_TARGET?: string;
  NODE_ENV?: string;
  FRONTEND_URL?: string;
  JWT_SECRET?: string;
  RATE_LIMIT_STORE?: string;
  RATE_LIMIT_KEY_SECRET?: string;
  MAIL_API_URL?: string;
  MAIL_API_KEY?: string;
  MAIL_FROM?: string;
  MAIL_ALLOWED_RECIPIENTS?: string;
  HYPERDRIVE?: HyperdriveBinding;
  RATE_LIMIT_COUNTER?: DurableObjectNamespaceBinding;
}>;

export type WorkerRuntimeConfigOptions = Readonly<{
  expectedTarget: WorkerDeploymentTarget;
  environment: WorkerRuntimeEnvironment;
}>;

export type WorkerRuntimeConfig = Readonly<{
  target: WorkerDeploymentTarget;
  databaseTarget: WorkerDeploymentTarget;
  frontendUrl: string;
  jwtSecret: string;
  rateLimit: Readonly<{
    store: "durable-object";
    keySecret: string;
    namespace: DurableObjectNamespaceBinding;
  }>;
  hyperdrive: HyperdriveBinding;
  mail: Readonly<{
    apiUrl: string;
    apiKey: string;
    from: string;
    allowedRecipients: readonly string[];
  }>;
}>;

/**
 * Workersの文字列設定とresource bindingをrequest処理前に検証する。
 */
export function getWorkerRuntimeConfig(_options: WorkerRuntimeConfigOptions): WorkerRuntimeConfig {
  throw new Error("Workers runtime設定は未実装です");
}
