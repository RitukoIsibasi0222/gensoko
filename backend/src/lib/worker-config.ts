import { getFrontendUrl, getRateLimitConfig } from "./config.js";
import { normalizeMailAddress, parseSafeHttpsUrl } from "./mail-runtime-validation.js";
import { PasswordVerificationUnavailableError } from "./password-verifier.js";

const INVALID_WORKER_RUNTIME_CONFIG_MESSAGE = "Workers runtime設定が不正です";
const MIN_PRODUCTION_JWT_SECRET_LENGTH = 64;
const DEFAULT_MAIL_TIMEOUT_MS = 5_000;
const MAX_MAIL_TIMEOUT_MS = 30_000;

export type WorkerDeploymentTarget = "staging" | "production";

export type HyperdriveBinding = Readonly<{
  connectionString: string;
}>;

export type DurableObjectNamespaceBinding<TObjectId = unknown, TObjectStub = unknown> = Readonly<{
  idFromName(name: string): TObjectId;
  get(id: TObjectId): TObjectStub;
}>;

// concrete namespaceのID引数型をgenericへ保持したまま、callableであることだけを制約する。
// このconstraint経由ではgetを呼ばないため、never[]は任意引数を許可する意味ではない。
export type DurableObjectNamespaceBindingConstraint = Readonly<{
  idFromName(name: string): unknown;
  get: (...args: never[]) => unknown;
}>;

export type WorkerRuntimeEnvironment<
  TRateLimitNamespace extends DurableObjectNamespaceBindingConstraint =
    DurableObjectNamespaceBinding,
  TPasswordVerifierNamespace extends DurableObjectNamespaceBindingConstraint =
    DurableObjectNamespaceBinding,
> = Readonly<{
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
  MAIL_TIMEOUT_MS?: string;
  HYPERDRIVE?: HyperdriveBinding;
  RATE_LIMIT_COUNTER?: TRateLimitNamespace;
  PASSWORD_VERIFIER?: TPasswordVerifierNamespace;
}>;

export type WorkerRuntimeConfigOptions<
  TRateLimitNamespace extends DurableObjectNamespaceBindingConstraint =
    DurableObjectNamespaceBinding,
  TPasswordVerifierNamespace extends DurableObjectNamespaceBindingConstraint =
    DurableObjectNamespaceBinding,
> = Readonly<{
  expectedTarget: WorkerDeploymentTarget;
  environment: WorkerRuntimeEnvironment<TRateLimitNamespace, TPasswordVerifierNamespace>;
}>;

export type WorkerRuntimeConfig<
  TRateLimitNamespace extends DurableObjectNamespaceBindingConstraint =
    DurableObjectNamespaceBinding,
  TPasswordVerifierNamespace extends DurableObjectNamespaceBindingConstraint =
    DurableObjectNamespaceBinding,
> = Readonly<{
  target: WorkerDeploymentTarget;
  databaseTarget: WorkerDeploymentTarget;
  frontendUrl: string;
  jwtSecret: string;
  rateLimit: Readonly<{
    store: "durable-object";
    keySecret: string;
    namespace: TRateLimitNamespace;
  }>;
  passwordVerifier: Readonly<{
    namespace: TPasswordVerifierNamespace;
  }>;
  hyperdrive: HyperdriveBinding;
  mail: Readonly<{
    apiUrl: string;
    apiKey: string;
    from: string;
    allowedRecipients: readonly string[] | null;
    timeoutMs: number;
  }>;
}>;

function rejectInvalidWorkerRuntimeConfig(): never {
  throw new Error(INVALID_WORKER_RUNTIME_CONFIG_MESSAGE);
}

function requireString(value: string | undefined): string {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    rejectInvalidWorkerRuntimeConfig();
  }

  return normalizedValue;
}

function parseMailApiUrl(value: string | undefined): string {
  const apiUrl = parseSafeHttpsUrl(requireString(value));
  if (apiUrl === null) {
    rejectInvalidWorkerRuntimeConfig();
  }

  return apiUrl;
}

function parseMailAddress(value: string | undefined): string {
  const address = normalizeMailAddress(requireString(value));
  if (address === null) {
    rejectInvalidWorkerRuntimeConfig();
  }

  return address;
}

function parseAllowedRecipients(
  value: string | undefined,
  target: WorkerDeploymentTarget,
): readonly string[] | null {
  if (value === undefined && target === "production") {
    return null;
  }

  const recipients: string[] = [];
  for (const valuePart of requireString(value).split(",")) {
    const recipient = normalizeMailAddress(valuePart);
    if (recipient === null) {
      rejectInvalidWorkerRuntimeConfig();
    }
    recipients.push(recipient);
  }

  return recipients;
}

function parseMailTimeoutMs(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAIL_TIMEOUT_MS;
  }

  const timeoutMs = Number(requireString(value));
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_MAIL_TIMEOUT_MS) {
    rejectInvalidWorkerRuntimeConfig();
  }

  return timeoutMs;
}

function validateHyperdriveBinding(binding: HyperdriveBinding | undefined): HyperdriveBinding {
  if (
    !binding ||
    typeof binding.connectionString !== "string" ||
    !binding.connectionString.trim() ||
    binding.connectionString !== binding.connectionString.trim()
  ) {
    rejectInvalidWorkerRuntimeConfig();
  }

  return binding;
}

function validateDurableObjectNamespaceBinding<
  TNamespace extends DurableObjectNamespaceBindingConstraint,
>(binding: TNamespace | undefined): TNamespace {
  if (!binding || typeof binding.idFromName !== "function" || typeof binding.get !== "function") {
    rejectInvalidWorkerRuntimeConfig();
  }

  return binding;
}

function validatePasswordVerifierNamespaceBinding<
  TNamespace extends DurableObjectNamespaceBindingConstraint,
>(binding: TNamespace | undefined): TNamespace {
  if (!binding || typeof binding.idFromName !== "function" || typeof binding.get !== "function") {
    throw new PasswordVerificationUnavailableError();
  }

  return binding;
}

/**
 * Workersの文字列設定とresource bindingをrequest処理前に検証する。
 */
export function getWorkerRuntimeConfig<
  TRateLimitNamespace extends DurableObjectNamespaceBindingConstraint =
    DurableObjectNamespaceBinding,
  TPasswordVerifierNamespace extends DurableObjectNamespaceBindingConstraint =
    DurableObjectNamespaceBinding,
>({
  expectedTarget,
  environment,
}: WorkerRuntimeConfigOptions<
  TRateLimitNamespace,
  TPasswordVerifierNamespace
>): WorkerRuntimeConfig<TRateLimitNamespace, TPasswordVerifierNamespace> {
  try {
    const target = requireString(environment.DEPLOYMENT_ENVIRONMENT);
    const databaseTarget = requireString(environment.DATABASE_TARGET);
    const nodeEnvironment = requireString(environment.NODE_ENV);
    const rateLimitConfig = getRateLimitConfig({
      runtime: "production",
      environment,
    });

    if (
      target !== expectedTarget ||
      databaseTarget !== expectedTarget ||
      nodeEnvironment !== "production" ||
      rateLimitConfig.store !== "durable-object"
    ) {
      rejectInvalidWorkerRuntimeConfig();
    }

    const frontendUrl = getFrontendUrl({
      isProduction: true,
      environment,
    });

    if (!frontendUrl.startsWith("https://")) {
      rejectInvalidWorkerRuntimeConfig();
    }

    const jwtSecret = requireString(environment.JWT_SECRET);

    if (jwtSecret.length < MIN_PRODUCTION_JWT_SECRET_LENGTH) {
      rejectInvalidWorkerRuntimeConfig();
    }

    const hyperdrive = validateHyperdriveBinding(environment.HYPERDRIVE);
    const rateLimitCounter = validateDurableObjectNamespaceBinding(environment.RATE_LIMIT_COUNTER);
    const passwordVerifier = validatePasswordVerifierNamespaceBinding(
      environment.PASSWORD_VERIFIER,
    );

    return {
      target: expectedTarget,
      databaseTarget: expectedTarget,
      frontendUrl,
      jwtSecret,
      rateLimit: {
        store: "durable-object",
        keySecret: rateLimitConfig.keySecret,
        namespace: rateLimitCounter,
      },
      passwordVerifier: {
        namespace: passwordVerifier,
      },
      hyperdrive,
      mail: {
        apiUrl: parseMailApiUrl(environment.MAIL_API_URL),
        apiKey: requireString(environment.MAIL_API_KEY),
        from: parseMailAddress(environment.MAIL_FROM),
        allowedRecipients: parseAllowedRecipients(
          environment.MAIL_ALLOWED_RECIPIENTS,
          expectedTarget,
        ),
        timeoutMs: parseMailTimeoutMs(environment.MAIL_TIMEOUT_MS),
      },
    };
  } catch (error) {
    if (error instanceof PasswordVerificationUnavailableError) {
      throw error;
    }
    rejectInvalidWorkerRuntimeConfig();
  }
}
