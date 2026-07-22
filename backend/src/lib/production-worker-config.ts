export const PRODUCTION_WORKER_CONFIG_ERROR_MESSAGE = "production Worker設定が不正です";

export type ProductionWorkerConfigInput = Readonly<{
  workerName: string;
  apiHostname: string;
  frontendOrigin: string;
  registrableDomain: string;
  hyperdriveId: string;
  stagingHyperdriveId: string;
}>;

type ProductionWorkerConfigOptions = Readonly<{
  allowReservedDomains?: boolean;
}>;

function failInvalidProductionConfig(): never {
  throw new Error(PRODUCTION_WORKER_CONFIG_ERROR_MESSAGE);
}

function requireExactValue(value: string): string {
  if (!value || value !== value.trim()) {
    failInvalidProductionConfig();
  }
  return value;
}

function isSameSiteHostname(hostname: string, registrableDomain: string): boolean {
  return hostname === registrableDomain || hostname.endsWith(`.${registrableDomain}`);
}

function isValidDnsHostname(hostname: string): boolean {
  if (hostname.length > 253) return false;
  const labels = hostname.split(".");
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^(?:[a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])$/.test(label),
    )
  );
}

function isProviderHostname(hostname: string): boolean {
  return ["workers.dev", "vercel.app"].some(
    (provider) => hostname === provider || hostname.endsWith(`.${provider}`),
  );
}

function isReservedDomain(domain: string): boolean {
  return (
    domain === "localhost" ||
    domain.endsWith(".localhost") ||
    ["example.com", "example.net", "example.org", "invalid", "test"].some(
      (reserved) => domain === reserved || domain.endsWith(`.${reserved}`),
    )
  );
}

export function buildProductionWorkerConfig(
  input: ProductionWorkerConfigInput,
  options: ProductionWorkerConfigOptions = {},
) {
  const workerName = requireExactValue(input.workerName);
  const apiHostname = requireExactValue(input.apiHostname).toLowerCase();
  const frontendOrigin = requireExactValue(input.frontendOrigin);
  const registrableDomain = requireExactValue(input.registrableDomain).toLowerCase();
  const hyperdriveId = requireExactValue(input.hyperdriveId);
  const stagingHyperdriveId = requireExactValue(input.stagingHyperdriveId);

  if (
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(workerName) ||
    !workerName.includes("production") ||
    workerName.includes("staging") ||
    !isValidDnsHostname(apiHostname) ||
    !isValidDnsHostname(registrableDomain) ||
    isProviderHostname(apiHostname) ||
    !/^[0-9a-f]{32}$/.test(hyperdriveId) ||
    !/^[0-9a-f]{32}$/.test(stagingHyperdriveId) ||
    hyperdriveId === stagingHyperdriveId
  ) {
    failInvalidProductionConfig();
  }

  let frontendUrl: URL;
  try {
    frontendUrl = new URL(frontendOrigin);
  } catch {
    failInvalidProductionConfig();
  }

  if (
    frontendUrl.protocol !== "https:" ||
    frontendUrl.username ||
    frontendUrl.password ||
    frontendUrl.port ||
    frontendUrl.pathname !== "/" ||
    frontendUrl.search ||
    frontendUrl.hash ||
    frontendUrl.origin !== frontendOrigin ||
    !isValidDnsHostname(frontendUrl.hostname) ||
    isProviderHostname(frontendUrl.hostname) ||
    frontendUrl.hostname === apiHostname ||
    !isSameSiteHostname(apiHostname, registrableDomain) ||
    !isSameSiteHostname(frontendUrl.hostname, registrableDomain) ||
    (!options.allowReservedDomains && isReservedDomain(registrableDomain))
  ) {
    failInvalidProductionConfig();
  }

  return {
    $schema: "node_modules/wrangler/config-schema.json",
    main: "src/worker-production.ts",
    name: workerName,
    compatibility_date: "2026-07-18",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    routes: [{ pattern: apiHostname, custom_domain: true }],
    vars: {
      DEPLOYMENT_ENVIRONMENT: "production",
      DATABASE_TARGET: "production",
      NODE_ENV: "production",
      RATE_LIMIT_STORE: "durable-object",
      FRONTEND_URL: frontendOrigin,
    },
    durable_objects: {
      bindings: [{ name: "RATE_LIMIT_COUNTER", class_name: "RateLimitCounter" }],
    },
    hyperdrive: [{ binding: "HYPERDRIVE", id: hyperdriveId }],
    migrations: [{ tag: "v1", new_sqlite_classes: ["RateLimitCounter"] }],
  } as const;
}

export function buildProductionWorkerConfigFromEnvironment(
  environment: NodeJS.ProcessEnv,
  stagingHyperdriveId: string,
) {
  return buildProductionWorkerConfig({
    workerName: environment.PRODUCTION_WORKER_NAME ?? "",
    apiHostname: environment.PRODUCTION_API_HOSTNAME ?? "",
    frontendOrigin: environment.PRODUCTION_FRONTEND_ORIGIN ?? "",
    registrableDomain: environment.PRODUCTION_REGISTRABLE_DOMAIN ?? "",
    hyperdriveId: environment.PRODUCTION_HYPERDRIVE_ID ?? "",
    stagingHyperdriveId,
  });
}
