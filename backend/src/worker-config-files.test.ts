import { readFileSync } from "node:fs";
import { parseConfigFileTextToJson } from "typescript";
import { describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;

function parseJsonObject(relativePath: string, jsonc: string): JsonObject {
  const { config, error } = parseConfigFileTextToJson(relativePath, jsonc);
  const parsedConfig: unknown = config;
  if (
    error ||
    typeof parsedConfig !== "object" ||
    parsedConfig === null ||
    Array.isArray(parsedConfig)
  ) {
    throw new Error(`${relativePath}のJSONC設定が不正です`);
  }

  return parsedConfig as JsonObject;
}

function readJson(relativePath: string): JsonObject {
  const jsonc = readFileSync(relativePath, "utf8");
  return parseJsonObject(relativePath, jsonc);
}

function getObject(value: unknown): JsonObject {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  return value as JsonObject;
}

describe("Workers staging build設定", () => {
  it("comment・trailing comma・文字列内のcommaを含むJSONCを安全に解釈する", () => {
    expect(
      parseJsonObject(
        "inline.jsonc",
        `{
          // JSONC comment
          "pattern": ",}",
          "items": [1,],
        }`,
      ),
    ).toEqual({
      pattern: ",}",
      items: [1],
    });
  });

  it("compatibility date・nodejs_compat・staging専用bindingを固定する", () => {
    const config = readJson("wrangler.jsonc");
    const staging = getObject(getObject(config.env).staging);
    const variables = getObject(staging.vars);
    const durableObjects = getObject(staging.durable_objects);
    const durableObjectBindings = durableObjects.bindings as JsonObject[];
    const hyperdriveBindings = staging.hyperdrive as JsonObject[];

    expect(config.main).toBe("src/worker.ts");
    expect(config.compatibility_date).toBe("2026-07-18");
    expect(config.compatibility_flags).toEqual(["nodejs_compat"]);
    expect(staging.name).toBe("gensoko-api-staging");
    expect(variables).toEqual({
      DEPLOYMENT_ENVIRONMENT: "staging",
      DATABASE_TARGET: "staging",
      NODE_ENV: "production",
      RATE_LIMIT_STORE: "durable-object",
    });
    expect(durableObjectBindings).toContainEqual({
      name: "RATE_LIMIT_COUNTER",
      class_name: "RateLimitCounter",
    });
    expect(hyperdriveBindings).toContainEqual({
      binding: "HYPERDRIVE",
      id: "00000000000000000000000000000000",
    });
  });

  it("Wrangler設定へsecret値や外部接続情報を保存しない", () => {
    const configText = readFileSync("wrangler.jsonc", "utf8");

    for (const forbiddenName of [
      "JWT_SECRET",
      "RATE_LIMIT_KEY_SECRET",
      "MAIL_API_KEY",
      "MAIL_ALLOWED_RECIPIENTS",
      "FRONTEND_URL",
      "localConnectionString",
    ]) {
      expect(configText).not.toContain(forbiddenName);
    }
    expect(configText).not.toContain("postgresql://");
  });

  it("生成型check・Workers型check・dry-run bundle gateをscript化する", () => {
    const packageJson = readJson("package.json");
    const scripts = getObject(packageJson.scripts);
    const nodeTypeScriptConfig = readJson("tsconfig.json");
    const workersTypeScriptConfig = readJson("tsconfig.workers.json");

    expect(scripts["workers:types"]).toContain("wrangler types");
    expect(scripts["workers:types"]).toContain("--env staging");
    expect(scripts["workers:types"]).toContain("--env-interface CloudflareBindings");
    expect(scripts["workers:types:check"]).toContain("--check");
    expect(scripts["workers:typecheck"]).toBe("tsc --project tsconfig.workers.json");
    expect(scripts["workers:dry-run"]).toContain("runWranglerDryRun.cli.ts");
    expect(scripts["workers:dry-run"]).toContain("wrangler.jsonc staging");
    expect(scripts["workers:dry-run"]).toContain("checkWorkerBundle.cli.ts");
    expect(scripts["workers:build"]).toContain("workers:types:check");
    expect(scripts["workers:build"]).toContain("workers:typecheck");
    expect(scripts["workers:build"]).toContain("workers:dry-run");
    expect(readFileSync("src/lib/wrangler-dry-run.ts", "utf8")).toContain('"--dry-run"');
    expect(nodeTypeScriptConfig.exclude).toEqual(
      expect.arrayContaining(["src/worker.ts", "src/lib/worker-request-adapters.ts"]),
    );
    expect(workersTypeScriptConfig.include).toEqual(
      expect.arrayContaining(["src/worker.ts", "src/lib/worker-request-adapters.ts"]),
    );
    expect(readFileSync("src/worker.ts", "utf8")).toMatch(/Required<\s*WorkerRuntimeEnvironment/);
    expect(readFileSync("src/lib/worker-request-adapters.ts", "utf8")).not.toContain(
      "as unknown as DurableObjectNamespace",
    );
  });

  it("生成型へstagingの文字列設定・resource binding・secret名を含める", () => {
    const generatedTypes = readFileSync("worker-configuration.d.ts", "utf8");

    expect(generatedTypes).toContain("interface CloudflareBindings");
    for (const bindingName of [
      "DEPLOYMENT_ENVIRONMENT",
      "DATABASE_TARGET",
      "NODE_ENV",
      "RATE_LIMIT_STORE",
      "FRONTEND_URL",
      "JWT_SECRET",
      "RATE_LIMIT_KEY_SECRET",
      "MAIL_API_URL",
      "MAIL_API_KEY",
      "MAIL_FROM",
      "MAIL_ALLOWED_RECIPIENTS",
      "HYPERDRIVE",
      "RATE_LIMIT_COUNTER",
    ]) {
      expect(generatedTypes).toContain(bindingName);
    }
  });
});
