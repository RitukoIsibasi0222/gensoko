const DEVELOPMENT_FRONTEND_URL = "http://localhost:5174";
const DATABASE_URL_REQUIRED_MESSAGE = "DATABASE_URLの設定が必要です";
const FRONTEND_URL_REQUIRED_MESSAGE = "production環境ではFRONTEND_URLの設定が必要です";
const FRONTEND_URL_INVALID_MESSAGE = "FRONTEND_URLはHTTP(S)のオリジン形式で設定してください";
const RATE_LIMIT_STORE_PRODUCTION_REQUIRED_MESSAGE =
  "production環境ではRATE_LIMIT_STORE=durable-objectの設定が必要です";
const RATE_LIMIT_STORE_INVALID_MESSAGE =
  "RATE_LIMIT_STOREはmemoryまたはdurable-objectを設定してください";
const RATE_LIMIT_KEY_SECRET_REQUIRED_MESSAGE = "RATE_LIMIT_KEY_SECRETの設定が必要です";
const RATE_LIMIT_KEY_SECRET_BASE64_MESSAGE = "RATE_LIMIT_KEY_SECRETはbase64形式で設定してください";
const RATE_LIMIT_KEY_SECRET_LENGTH_MESSAGE =
  "RATE_LIMIT_KEY_SECRETは復号後32バイト以上にしてください";
const AUDIT_LOG_RETENTION_DAYS_REQUIRED_MESSAGE = "AUDIT_LOG_RETENTION_DAYSの設定が必要です";
const AUDIT_LOG_RETENTION_DAYS_INVALID_MESSAGE =
  "AUDIT_LOG_RETENTION_DAYSは30から3650までの10進整数で設定してください";
const AUDIT_LOG_CLEANUP_ENABLED_INVALID_MESSAGE =
  "AUDIT_LOG_CLEANUP_ENABLEDはtrueまたはfalseで設定してください";
const ACCOUNT_DATA_DELETION_EXECUTE_ENABLED_INVALID_MESSAGE =
  "ACCOUNT_DATA_DELETION_EXECUTE_ENABLEDはtrueまたはfalseで設定してください";
const ACCOUNT_DATA_DELETION_BATCH_SIZE_INVALID_MESSAGE =
  "ACCOUNT_DATA_DELETION_BATCH_SIZEは1から100までの10進整数で設定してください";
const STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED_INVALID_MESSAGE =
  "STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLEDはtrueまたはfalseで設定してください";
const MIN_RATE_LIMIT_KEY_BYTES = 32;
const MIN_AUDIT_LOG_RETENTION_DAYS = 30;
const MAX_AUDIT_LOG_RETENTION_DAYS = 3650;
const DEFAULT_ACCOUNT_DATA_DELETION_BATCH_SIZE = 25;
const MIN_ACCOUNT_DATA_DELETION_BATCH_SIZE = 1;
const MAX_ACCOUNT_DATA_DELETION_BATCH_SIZE = 100;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const DECIMAL_INTEGER_PATTERN = /^\d+$/;

export type DatabaseUrlOptions = Readonly<{
  environment?: Readonly<{
    DATABASE_URL?: string;
  }>;
}>;

export type FrontendUrlOptions = {
  isProduction?: boolean;
  environment?: Readonly<{
    FRONTEND_URL?: string;
  }>;
};

export type RateLimitRuntime = "development" | "test" | "production";
export type RateLimitStoreName = "memory" | "durable-object";

export type RateLimitEnvironment = Readonly<{
  RATE_LIMIT_STORE?: string;
  RATE_LIMIT_KEY_SECRET?: string;
}>;

export type RateLimitConfigOptions = Readonly<{
  runtime?: RateLimitRuntime;
  environment?: RateLimitEnvironment;
}>;

export type RateLimitConfig = Readonly<{
  store: RateLimitStoreName;
  keySecret: string;
}>;

export type AuditLogRetentionEnvironment = Readonly<{
  AUDIT_LOG_RETENTION_DAYS?: string;
  AUDIT_LOG_CLEANUP_ENABLED?: string;
}>;

export type AuditLogRetentionConfigOptions = Readonly<{
  environment?: AuditLogRetentionEnvironment;
}>;

export type AuditLogRetentionConfig = Readonly<{
  retentionDays: number;
  cleanupEnabled: boolean;
}>;

export type AccountDataDeletionConfigOptions = Readonly<{
  environment?: Readonly<Record<string, string | undefined>>;
}>;

export type AccountDataDeletionConfig = Readonly<{
  executeEnabled: boolean;
  batchSize: number;
}>;

export type StagingAccountDeletionPerformanceConfigOptions = Readonly<{
  environment?: Readonly<Record<string, string | undefined>>;
}>;

export type StagingAccountDeletionPerformanceConfig = Readonly<{
  executeEnabled: boolean;
}>;

/**
 * Node.js用Prisma singletonへ渡す接続URLを検証して返す。
 * Workersはrequest bindingから別途接続URLを注入する。
 */
export function getDatabaseUrl({ environment = process.env }: DatabaseUrlOptions = {}): string {
  const databaseUrl = environment.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(DATABASE_URL_REQUIRED_MESSAGE);
  }

  return databaseUrl;
}

function parseFrontendOrigin(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(FRONTEND_URL_INVALID_MESSAGE);
  }

  const isHttpOrigin = url.protocol === "http:" || url.protocol === "https:";
  const hasOnlyOrigin =
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "";

  if (!isHttpOrigin || !hasOnlyOrigin) {
    throw new Error(FRONTEND_URL_INVALID_MESSAGE);
  }

  return url.origin;
}

/**
 * CORSとメールURLで共有するfrontend URLを返す。
 * productionではlocalhostへの暗黙fallbackを禁止し、設定漏れを起動時に検出する。
 */
export function getFrontendUrl({
  isProduction = process.env.NODE_ENV === "production",
  environment = process.env,
}: FrontendUrlOptions = {}): string {
  const frontendUrl = environment.FRONTEND_URL?.trim();

  if (frontendUrl) {
    return parseFrontendOrigin(frontendUrl);
  }

  if (isProduction) {
    throw new Error(FRONTEND_URL_REQUIRED_MESSAGE);
  }

  return DEVELOPMENT_FRONTEND_URL;
}

function getDefaultRateLimitRuntime(): RateLimitRuntime {
  if (process.env.NODE_ENV === "production") {
    return "production";
  }

  if (process.env.NODE_ENV === "test") {
    return "test";
  }

  return "development";
}

function parseRateLimitStore(
  value: string | undefined,
  runtime: RateLimitRuntime,
): RateLimitStoreName {
  const store = value?.trim();

  if (runtime === "production" && store !== "durable-object") {
    throw new Error(RATE_LIMIT_STORE_PRODUCTION_REQUIRED_MESSAGE);
  }

  if (store !== "memory" && store !== "durable-object") {
    throw new Error(RATE_LIMIT_STORE_INVALID_MESSAGE);
  }

  return store;
}

function parseRateLimitKeySecret(value: string | undefined): string {
  const keySecret = value?.trim();

  if (!keySecret) {
    throw new Error(RATE_LIMIT_KEY_SECRET_REQUIRED_MESSAGE);
  }

  if (!BASE64_PATTERN.test(keySecret)) {
    throw new Error(RATE_LIMIT_KEY_SECRET_BASE64_MESSAGE);
  }

  let decodedSecret: string;

  try {
    decodedSecret = atob(keySecret);
  } catch {
    throw new Error(RATE_LIMIT_KEY_SECRET_BASE64_MESSAGE);
  }

  if (decodedSecret.length < MIN_RATE_LIMIT_KEY_BYTES) {
    throw new Error(RATE_LIMIT_KEY_SECRET_LENGTH_MESSAGE);
  }

  return keySecret;
}

/**
 * rate limit storeとHMAC専用secretを検証して返す。
 * productionではDurable Objectを必須とし、memory storeへのfallbackを許可しない。
 */
export function getRateLimitConfig({
  runtime = getDefaultRateLimitRuntime(),
  environment = process.env,
}: RateLimitConfigOptions = {}): RateLimitConfig {
  const store = parseRateLimitStore(environment.RATE_LIMIT_STORE, runtime);
  const keySecret = parseRateLimitKeySecret(environment.RATE_LIMIT_KEY_SECRET);

  return { store, keySecret };
}

function parseAuditLogRetentionDays(value: string | undefined): number {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    throw new Error(AUDIT_LOG_RETENTION_DAYS_REQUIRED_MESSAGE);
  }

  if (!DECIMAL_INTEGER_PATTERN.test(normalizedValue)) {
    throw new Error(AUDIT_LOG_RETENTION_DAYS_INVALID_MESSAGE);
  }

  const retentionDays = Number(normalizedValue);

  if (
    !Number.isSafeInteger(retentionDays) ||
    retentionDays < MIN_AUDIT_LOG_RETENTION_DAYS ||
    retentionDays > MAX_AUDIT_LOG_RETENTION_DAYS
  ) {
    throw new Error(AUDIT_LOG_RETENTION_DAYS_INVALID_MESSAGE);
  }

  return retentionDays;
}

function parseAuditLogCleanupEnabled(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const normalizedValue = value.trim();

  if (normalizedValue === "true") {
    return true;
  }

  if (normalizedValue === "false") {
    return false;
  }

  throw new Error(AUDIT_LOG_CLEANUP_ENABLED_INVALID_MESSAGE);
}

/**
 * 監査ログの保持期間とcleanup有効化設定を検証して返す。
 * 保持期間が不明な状態で削除を始めず、cleanup未設定時は安全側で無効化する。
 */
export function getAuditLogRetentionConfig({
  environment = process.env,
}: AuditLogRetentionConfigOptions = {}): AuditLogRetentionConfig {
  return {
    retentionDays: parseAuditLogRetentionDays(environment.AUDIT_LOG_RETENTION_DAYS),
    cleanupEnabled: parseAuditLogCleanupEnabled(environment.AUDIT_LOG_CLEANUP_ENABLED),
  };
}

function parseDisabledByDefaultBoolean(value: string | undefined, invalidMessage: string): boolean {
  if (value === undefined) {
    return false;
  }

  const normalizedValue = value.trim();

  if (normalizedValue === "true") {
    return true;
  }

  if (normalizedValue === "false") {
    return false;
  }

  throw new Error(invalidMessage);
}

function parseAccountDataDeletionBatchSize(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_ACCOUNT_DATA_DELETION_BATCH_SIZE;
  }

  const normalizedValue = value.trim();

  if (!DECIMAL_INTEGER_PATTERN.test(normalizedValue)) {
    throw new Error(ACCOUNT_DATA_DELETION_BATCH_SIZE_INVALID_MESSAGE);
  }

  const batchSize = Number(normalizedValue);

  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < MIN_ACCOUNT_DATA_DELETION_BATCH_SIZE ||
    batchSize > MAX_ACCOUNT_DATA_DELETION_BATCH_SIZE
  ) {
    throw new Error(ACCOUNT_DATA_DELETION_BATCH_SIZE_INVALID_MESSAGE);
  }

  return batchSize;
}

/**
 * 既存soft-deleted user cleanupの実行許可と1 transactionあたりの件数を検証して返す。
 * 未設定時は削除を無効化し、batch sizeを25件に制限する。
 */
export function getAccountDataDeletionConfig({
  environment = process.env,
}: AccountDataDeletionConfigOptions = {}): AccountDataDeletionConfig {
  return {
    executeEnabled: parseDisabledByDefaultBoolean(
      environment.ACCOUNT_DATA_DELETION_EXECUTE_ENABLED,
      ACCOUNT_DATA_DELETION_EXECUTE_ENABLED_INVALID_MESSAGE,
    ),
    batchSize: parseAccountDataDeletionBatchSize(environment.ACCOUNT_DATA_DELETION_BATCH_SIZE),
  };
}

export function getStagingAccountDeletionPerformanceConfig({
  environment = process.env,
}: StagingAccountDeletionPerformanceConfigOptions = {}): StagingAccountDeletionPerformanceConfig {
  return {
    executeEnabled: parseDisabledByDefaultBoolean(
      environment.STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED,
      STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED_INVALID_MESSAGE,
    ),
  };
}
