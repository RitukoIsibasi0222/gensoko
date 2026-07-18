import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getWorkerRuntimeConfig,
  type DurableObjectNamespaceBinding,
  type HyperdriveBinding,
  type WorkerRuntimeEnvironment,
} from "./worker-config.js";

const INVALID_WORKER_RUNTIME_CONFIG_MESSAGE = "Workers runtime設定が不正です";
const VALID_JWT_SECRET = "j".repeat(64);
const VALID_RATE_LIMIT_KEY_SECRET = Buffer.from("0123456789abcdef0123456789abcdef").toString(
  "base64",
);
const REQUIRED_STRING_BINDING_NAMES = [
  "DEPLOYMENT_ENVIRONMENT",
  "DATABASE_TARGET",
  "NODE_ENV",
  "FRONTEND_URL",
  "JWT_SECRET",
  "RATE_LIMIT_STORE",
  "RATE_LIMIT_KEY_SECRET",
  "MAIL_API_URL",
  "MAIL_API_KEY",
  "MAIL_FROM",
  "MAIL_ALLOWED_RECIPIENTS",
] as const;

const HYPERDRIVE_BINDING: HyperdriveBinding = {
  connectionString:
    "postgresql://worker-user:worker-password@hyperdrive.local:5432/worker-database",
};
const RATE_LIMIT_COUNTER_BINDING: DurableObjectNamespaceBinding = {
  idFromName: (name) => ({ name }),
  get: (id) => ({ id }),
};

function createEnvironment(
  overrides: Partial<WorkerRuntimeEnvironment> = {},
): WorkerRuntimeEnvironment {
  return {
    DEPLOYMENT_ENVIRONMENT: "staging",
    DATABASE_TARGET: "staging",
    NODE_ENV: "production",
    FRONTEND_URL: "https://develop.gensoko.example",
    JWT_SECRET: VALID_JWT_SECRET,
    RATE_LIMIT_STORE: "durable-object",
    RATE_LIMIT_KEY_SECRET: VALID_RATE_LIMIT_KEY_SECRET,
    MAIL_API_URL: "https://mail-api.example.invalid/send",
    MAIL_API_KEY: "staging-mail-api-key",
    MAIL_FROM: "noreply@staging.gensoko.example",
    MAIL_ALLOWED_RECIPIENTS: "synthetic-user@example.invalid",
    HYPERDRIVE: HYPERDRIVE_BINDING,
    RATE_LIMIT_COUNTER: RATE_LIMIT_COUNTER_BINDING,
    ...overrides,
  };
}

function getThrownMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  return "";
}

describe("getWorkerRuntimeConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("staging専用の文字列設定とresource bindingを返す", () => {
    expect(
      getWorkerRuntimeConfig({
        expectedTarget: "staging",
        environment: createEnvironment(),
      }),
    ).toEqual({
      target: "staging",
      databaseTarget: "staging",
      frontendUrl: "https://develop.gensoko.example",
      jwtSecret: VALID_JWT_SECRET,
      rateLimit: {
        store: "durable-object",
        keySecret: VALID_RATE_LIMIT_KEY_SECRET,
        namespace: RATE_LIMIT_COUNTER_BINDING,
      },
      hyperdrive: HYPERDRIVE_BINDING,
      mail: {
        apiUrl: "https://mail-api.example.invalid/send",
        apiKey: "staging-mail-api-key",
        from: "noreply@staging.gensoko.example",
        allowedRecipients: ["synthetic-user@example.invalid"],
      },
    });
  });

  it("process.envではなく明示environmentだけを使う", () => {
    vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "production");
    vi.stubEnv("DATABASE_TARGET", "production");
    vi.stubEnv("JWT_SECRET", "production-secret-must-not-be-read");

    expect(
      getWorkerRuntimeConfig({
        expectedTarget: "staging",
        environment: createEnvironment(),
      }).target,
    ).toBe("staging");
  });

  it("productionはproduction専用targetを受理しmail allowlist未設定を区別する", () => {
    const config = getWorkerRuntimeConfig({
      expectedTarget: "production",
      environment: createEnvironment({
        DEPLOYMENT_ENVIRONMENT: "production",
        DATABASE_TARGET: "production",
        FRONTEND_URL: "https://gensoko.example",
        MAIL_ALLOWED_RECIPIENTS: undefined,
      }),
    });

    expect(config.target).toBe("production");
    expect(config.databaseTarget).toBe("production");
    expect(config.mail.allowedRecipients).toBeNull();
  });

  it.each(REQUIRED_STRING_BINDING_NAMES)("%sの欠落をgeneric errorで拒否する", (name) => {
    expect(() =>
      getWorkerRuntimeConfig({
        expectedTarget: "staging",
        environment: createEnvironment({ [name]: undefined }),
      }),
    ).toThrow(INVALID_WORKER_RUNTIME_CONFIG_MESSAGE);
  });

  it.each(REQUIRED_STRING_BINDING_NAMES)("%sの空白値をgeneric errorで拒否する", (name) => {
    expect(() =>
      getWorkerRuntimeConfig({
        expectedTarget: "staging",
        environment: createEnvironment({ [name]: " " }),
      }),
    ).toThrow(INVALID_WORKER_RUNTIME_CONFIG_MESSAGE);
  });

  it.each([
    ["Worker環境", { DEPLOYMENT_ENVIRONMENT: "production" }],
    ["DB target", { DATABASE_TARGET: "production" }],
    ["development runtime", { NODE_ENV: "development" }],
    ["memory fallback", { RATE_LIMIT_STORE: "memory" }],
  ])("%sのstaging契約混同を拒否する", (_caseName, overrides) => {
    expect(() =>
      getWorkerRuntimeConfig({
        expectedTarget: "staging",
        environment: createEnvironment(overrides),
      }),
    ).toThrow(INVALID_WORKER_RUNTIME_CONFIG_MESSAGE);
  });

  it.each([
    ["HTTP frontend", { FRONTEND_URL: "http://develop.gensoko.example" }],
    ["wildcard frontend", { FRONTEND_URL: "*" }],
    ["path付きfrontend", { FRONTEND_URL: "https://develop.gensoko.example/app" }],
    ["HTTP mail API", { MAIL_API_URL: "http://mail-api.example.invalid/send" }],
  ])("%sを拒否する", (_caseName, overrides) => {
    expect(() =>
      getWorkerRuntimeConfig({
        expectedTarget: "staging",
        environment: createEnvironment(overrides),
      }),
    ).toThrow(INVALID_WORKER_RUNTIME_CONFIG_MESSAGE);
  });

  it.each([
    ["64文字未満のJWT secret", { JWT_SECRET: "short-secret" }],
    ["不正なrate limit secret", { RATE_LIMIT_KEY_SECRET: "not-base64!" }],
    [
      "空要素を含むmail allowlist",
      {
        MAIL_ALLOWED_RECIPIENTS: "synthetic-user@example.invalid, ,another-user@example.invalid",
      },
    ],
  ])("%sをgeneric errorで拒否する", (_caseName, overrides) => {
    expect(() =>
      getWorkerRuntimeConfig({
        expectedTarget: "staging",
        environment: createEnvironment(overrides),
      }),
    ).toThrow(INVALID_WORKER_RUNTIME_CONFIG_MESSAGE);
  });

  it("connectionStringを持たないHyperdrive bindingを拒否する", () => {
    expect(() =>
      getWorkerRuntimeConfig({
        expectedTarget: "staging",
        environment: createEnvironment({
          HYPERDRIVE: {} as HyperdriveBinding,
        }),
      }),
    ).toThrow(INVALID_WORKER_RUNTIME_CONFIG_MESSAGE);
  });

  it("前後空白付きのHyperdrive connectionStringを拒否する", () => {
    expect(() =>
      getWorkerRuntimeConfig({
        expectedTarget: "staging",
        environment: createEnvironment({
          HYPERDRIVE: {
            connectionString: " postgresql://worker.example.invalid/database ",
          },
        }),
      }),
    ).toThrow(INVALID_WORKER_RUNTIME_CONFIG_MESSAGE);
  });

  it("Durable Object APIを持たないrate limit bindingを拒否する", () => {
    expect(() =>
      getWorkerRuntimeConfig({
        expectedTarget: "staging",
        environment: createEnvironment({
          RATE_LIMIT_COUNTER: {} as DurableObjectNamespaceBinding,
        }),
      }),
    ).toThrow(INVALID_WORKER_RUNTIME_CONFIG_MESSAGE);
  });

  it("設定値・接続先・binding内部値をerrorへ含めない", () => {
    const message = getThrownMessage(() =>
      getWorkerRuntimeConfig({
        expectedTarget: "staging",
        environment: createEnvironment({
          DEPLOYMENT_ENVIRONMENT: "sensitive-production-target",
          JWT_SECRET: "sensitive-jwt-secret",
          MAIL_API_KEY: "sensitive-mail-api-key",
          HYPERDRIVE: {
            connectionString:
              "postgresql://sensitive-user:sensitive-password@sensitive-host/private",
          },
        }),
      }),
    );

    expect(message).toBe(INVALID_WORKER_RUNTIME_CONFIG_MESSAGE);
    expect(message).not.toContain("sensitive");
    expect(message).not.toContain("postgresql");
  });
});
