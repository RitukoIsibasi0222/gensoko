import { describe, expect, it } from "vitest";
import {
  buildStagingRollbackBaselineConfig,
  STAGING_ROLLBACK_WORKER_CONFIG_ERROR_MESSAGE,
} from "./staging-rollback-worker-config.js";

const STAGING_CONFIG = {
  $schema: "node_modules/wrangler/config-schema.json",
  main: "src/worker.ts",
  compatibility_date: "2026-07-18",
  compatibility_flags: ["nodejs_compat"],
  env: {
    staging: {
      name: "gensoko-api-staging",
      vars: {
        DEPLOYMENT_ENVIRONMENT: "staging",
        DATABASE_TARGET: "staging",
        NODE_ENV: "production",
        RATE_LIMIT_STORE: "durable-object",
      },
      durable_objects: {
        bindings: [
          { name: "RATE_LIMIT_COUNTER", class_name: "RateLimitCounter" },
          { name: "PASSWORD_VERIFIER", class_name: "PasswordVerifierDurableObject" },
        ],
      },
      hyperdrive: [{ binding: "HYPERDRIVE", id: "a".repeat(32) }],
      migrations: [
        { tag: "v1", new_sqlite_classes: ["RateLimitCounter"] },
        { tag: "v2", new_sqlite_classes: ["PasswordVerifierDurableObject"] },
      ],
    },
  },
} as const;

function cloneStagingConfig(): Record<string, unknown> {
  return structuredClone(STAGING_CONFIG) as unknown as Record<string, unknown>;
}

describe("staging rollback baseline Worker config", () => {
  it("通常stagingとentrypoint以外のWorker・binding・v1/v2 migration契約を一致させる", () => {
    const config = buildStagingRollbackBaselineConfig(STAGING_CONFIG);

    expect(config).toEqual({
      $schema: STAGING_CONFIG.$schema,
      main: "src/worker-staging-rollback-baseline.ts",
      compatibility_date: STAGING_CONFIG.compatibility_date,
      compatibility_flags: STAGING_CONFIG.compatibility_flags,
      ...STAGING_CONFIG.env.staging,
    });
    expect(config.migrations).toEqual([
      { tag: "v1", new_sqlite_classes: ["RateLimitCounter"] },
      { tag: "v2", new_sqlite_classes: ["PasswordVerifierDurableObject"] },
    ]);
    expect(JSON.stringify(config)).not.toContain('"v3"');
  });

  it.each([
    [
      "production target",
      () => {
        const input = cloneStagingConfig();
        const staging = (input.env as { staging: { vars: Record<string, string> } }).staging;
        staging.vars.DEPLOYMENT_ENVIRONMENT = "production";
        return input;
      },
    ],
    [
      "password verifier binding欠損",
      () => {
        const input = cloneStagingConfig();
        const staging = (input.env as { staging: { durable_objects: { bindings: unknown[] } } })
          .staging;
        staging.durable_objects.bindings.pop();
        return input;
      },
    ],
    [
      "migration順序変更",
      () => {
        const input = cloneStagingConfig();
        const staging = (input.env as { staging: { migrations: unknown[] } }).staging;
        staging.migrations.reverse();
        return input;
      },
    ],
    [
      "v3 migration追加",
      () => {
        const input = cloneStagingConfig();
        const staging = (input.env as { staging: { migrations: unknown[] } }).staging;
        staging.migrations.push({ tag: "v3", new_sqlite_classes: ["UnexpectedClass"] });
        return input;
      },
    ],
    [
      "secret変数追加",
      () => {
        const input = cloneStagingConfig();
        const staging = (input.env as { staging: { vars: Record<string, string> } }).staging;
        staging.vars.JWT_SECRET = "sensitive-value";
        return input;
      },
    ],
    ["未知key追加", () => ({ ...cloneStagingConfig(), rollback_mode: "local" })],
  ] as const)("%sを固定errorで拒否する", (_caseName, createInput) => {
    expect(() => buildStagingRollbackBaselineConfig(createInput())).toThrow(
      STAGING_ROLLBACK_WORKER_CONFIG_ERROR_MESSAGE,
    );
  });

  it("不正なresource値やraw入力をerrorへ含めない", () => {
    const input = cloneStagingConfig();
    const sensitiveValue = "sensitive-resource-value";
    const staging = (input.env as { staging: { hyperdrive: Array<{ id: string }> } }).staging;
    staging.hyperdrive[0]!.id = sensitiveValue;

    const error = (() => {
      try {
        buildStagingRollbackBaselineConfig(input);
      } catch (caught) {
        return caught;
      }
      return null;
    })();

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(STAGING_ROLLBACK_WORKER_CONFIG_ERROR_MESSAGE);
    expect(String(error)).not.toContain(sensitiveValue);
  });
});
