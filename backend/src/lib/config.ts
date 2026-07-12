const DEVELOPMENT_FRONTEND_URL = "http://localhost:5174";
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
const MIN_RATE_LIMIT_KEY_BYTES = 32;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type FrontendUrlOptions = {
  isProduction?: boolean;
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
}: FrontendUrlOptions = {}): string {
  const frontendUrl = process.env.FRONTEND_URL?.trim();

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
