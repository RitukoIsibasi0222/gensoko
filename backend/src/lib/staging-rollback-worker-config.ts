import { z } from "zod";

export const STAGING_ROLLBACK_WORKER_CONFIG_ERROR_MESSAGE =
  "staging rollback baseline Worker設定が不正です";

const durableObjectBindingSchema = z
  .object({
    name: z.string(),
    class_name: z.string(),
  })
  .strict();

const stagingConfigSchema = z
  .object({
    $schema: z.literal("node_modules/wrangler/config-schema.json"),
    main: z.literal("src/worker.ts"),
    compatibility_date: z.literal("2026-07-18"),
    compatibility_flags: z.tuple([z.literal("nodejs_compat")]),
    env: z
      .object({
        staging: z
          .object({
            name: z.literal("gensoko-api-staging"),
            vars: z
              .object({
                DEPLOYMENT_ENVIRONMENT: z.literal("staging"),
                DATABASE_TARGET: z.literal("staging"),
                NODE_ENV: z.literal("production"),
                RATE_LIMIT_STORE: z.literal("durable-object"),
              })
              .strict(),
            durable_objects: z
              .object({
                bindings: z.tuple([
                  durableObjectBindingSchema.extend({
                    name: z.literal("RATE_LIMIT_COUNTER"),
                    class_name: z.literal("RateLimitCounter"),
                  }),
                  durableObjectBindingSchema.extend({
                    name: z.literal("PASSWORD_VERIFIER"),
                    class_name: z.literal("PasswordVerifierDurableObject"),
                  }),
                ]),
              })
              .strict(),
            hyperdrive: z.tuple([
              z
                .object({
                  binding: z.literal("HYPERDRIVE"),
                  id: z.string().regex(/^[0-9a-f]{32}$/),
                })
                .strict(),
            ]),
            migrations: z.tuple([
              z
                .object({
                  tag: z.literal("v1"),
                  new_sqlite_classes: z.tuple([z.literal("RateLimitCounter")]),
                })
                .strict(),
              z
                .object({
                  tag: z.literal("v2"),
                  new_sqlite_classes: z.tuple([z.literal("PasswordVerifierDurableObject")]),
                })
                .strict(),
            ]),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

/**
 * checked-in staging設定を検証し、entrypointだけをrollback baselineへ置換する。
 */
export function buildStagingRollbackBaselineConfig(checkedInStagingConfig: unknown) {
  const parsed = stagingConfigSchema.safeParse(checkedInStagingConfig);
  if (!parsed.success) {
    throw new Error(STAGING_ROLLBACK_WORKER_CONFIG_ERROR_MESSAGE);
  }

  const { env, ...sharedConfig } = parsed.data;
  return {
    ...sharedConfig,
    main: "src/worker-staging-rollback-baseline.ts",
    ...env.staging,
  } as const;
}
