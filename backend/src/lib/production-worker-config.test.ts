import { describe, expect, it } from "vitest";
import {
  buildProductionWorkerConfig,
  PRODUCTION_WORKER_CONFIG_ERROR_MESSAGE,
} from "./production-worker-config.js";

const INPUT = {
  workerName: "gensoko-api-production",
  apiHostname: "api.example.com",
  frontendOrigin: "https://app.example.com",
  registrableDomain: "example.com",
  hyperdriveId: "a".repeat(32),
  stagingHyperdriveId: "b".repeat(32),
} as const;

describe("production Worker config", () => {
  it("production専用entrypoint・custom domain・binding・targetを生成する", () => {
    const config = buildProductionWorkerConfig(INPUT, { allowReservedDomains: true });

    expect(config).toMatchObject({
      main: "src/worker-production.ts",
      name: "gensoko-api-production",
      workers_dev: false,
      routes: [{ pattern: "api.example.com", custom_domain: true }],
      vars: {
        DEPLOYMENT_ENVIRONMENT: "production",
        DATABASE_TARGET: "production",
        NODE_ENV: "production",
        RATE_LIMIT_STORE: "durable-object",
        FRONTEND_URL: "https://app.example.com",
      },
      hyperdrive: [{ binding: "HYPERDRIVE", id: "a".repeat(32) }],
    });
  });

  it("staging Hyperdrive共有・staging名・provider domainをfail-fastで拒否する", () => {
    for (const invalidInput of [
      { ...INPUT, hyperdriveId: INPUT.stagingHyperdriveId },
      { ...INPUT, workerName: "gensoko-api-staging" },
      { ...INPUT, apiHostname: "gensoko.workers.dev" },
      { ...INPUT, frontendOrigin: "https://gensoko.vercel.app" },
    ]) {
      expect(() =>
        buildProductionWorkerConfig(invalidInput, { allowReservedDomains: true }),
      ).toThrow(PRODUCTION_WORKER_CONFIG_ERROR_MESSAGE);
    }
  });

  it("HTTPS・同一site・origin形式・必須resourceを値非表示で検証する", () => {
    for (const invalidInput of [
      { ...INPUT, frontendOrigin: "http://app.example.com" },
      { ...INPUT, frontendOrigin: "https://app.example.net" },
      { ...INPUT, frontendOrigin: "https://user:pass@app.example.com" },
      { ...INPUT, frontendOrigin: "https://app.example.com/path" },
      { ...INPUT, hyperdriveId: "" },
      { ...INPUT, apiHostname: "" },
    ]) {
      expect(() =>
        buildProductionWorkerConfig(invalidInput, { allowReservedDomains: true }),
      ).toThrow(PRODUCTION_WORKER_CONFIG_ERROR_MESSAGE);
    }
  });

  it("通常実行では予約済みplaceholder domainを拒否する", () => {
    expect(() => buildProductionWorkerConfig(INPUT)).toThrow(
      PRODUCTION_WORKER_CONFIG_ERROR_MESSAGE,
    );
  });

  it("生成設定へsecret名・DB URL・staging resourceを混入しない", () => {
    const serialized = JSON.stringify(
      buildProductionWorkerConfig(INPUT, { allowReservedDomains: true }),
    );

    for (const forbidden of [
      "JWT_SECRET",
      "RATE_LIMIT_KEY_SECRET",
      "MAIL_API_KEY",
      "postgresql://",
      INPUT.stagingHyperdriveId,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
