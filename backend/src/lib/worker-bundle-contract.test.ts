import { describe, expect, it } from "vitest";
import {
  assertWorkerBundleInputs,
  findForbiddenWorkerBundleDependencies,
} from "./worker-bundle-contract.js";

describe("Workers bundle contract", () => {
  it.each([
    ["standard", "src/worker.ts"],
    ["production", "src/worker-production.ts"],
  ] as const)(
    "%s profileでPrisma・pg・fetch mail・Durable Object graphを許可する",
    (profile, entrypoint) => {
      const inputs = [
        entrypoint,
        "src/lib/worker-request-adapters.ts",
        "src/lib/prisma-client.ts",
        "node_modules/@prisma/client/index.js",
        "node_modules/@prisma/adapter-pg/dist/index.mjs",
        "node_modules/pg/lib/index.js",
        "src/lib/fetch-mail-sender.ts",
        "src/middleware/rateLimit/durable-object-store.ts",
        "src/lib/durable-object-password-verifier.ts",
        "src/cloudflare/password-verifier.ts",
      ];

      expect(findForbiddenWorkerBundleDependencies(inputs, profile)).toEqual([]);
      expect(() => assertWorkerBundleInputs(inputs, profile)).not.toThrow();
    },
  );

  it("Node entrypoint・Nodemailer・SMTP・memory fallback・Node Prisma・bcrypt adapterを拒否する", () => {
    const inputs = [
      "src/index.ts",
      "node_modules/@hono/node-server/dist/index.mjs",
      "node_modules/nodemailer/lib/nodemailer.js",
      "src/lib/mail.ts",
      "src/lib/prisma.ts",
      "src/middleware/rateLimit/in-memory-store.ts",
      "src/lib/bcrypt-password-verifier.ts",
    ];

    expect(findForbiddenWorkerBundleDependencies(inputs)).toEqual([
      "node-entrypoint",
      "node-server",
      "nodemailer",
      "node-mail-adapter",
      "node-prisma-singleton",
      "memory-rate-limit-store",
      "node-bcrypt-password-verifier",
    ]);
    expect(() => assertWorkerBundleInputs(inputs)).toThrow(
      "Workers bundleに許可されない依存が含まれています",
    );
  });

  it("Windows形式のmetafile pathでも同じ禁止契約を適用する", () => {
    expect(
      findForbiddenWorkerBundleDependencies([
        "src\\lib\\mail.ts",
        "node_modules\\nodemailer\\lib\\smtp-transport\\index.js",
      ]),
    ).toEqual(["node-mail-adapter", "nodemailer"]);
  });

  it.each(["standard", "production"] as const)(
    "%s profileへbaseline entrypoint・local bcrypt adapterが混入すると拒否する",
    (profile) => {
      const inputs = [
        "src/worker-staging-rollback-baseline.ts",
        "src/lib/bcrypt-password-verifier.ts",
      ];

      expect(findForbiddenWorkerBundleDependencies(inputs, profile)).toEqual([
        "staging-rollback-baseline-entrypoint",
        "node-bcrypt-password-verifier",
      ]);
      expect(() => assertWorkerBundleInputs(inputs, profile)).toThrow(
        "Workers bundleに許可されない依存が含まれています",
      );
    },
  );

  it("baseline profileだけが専用entrypointと既存local bcrypt adapterを許可する", () => {
    const inputs = [
      "src/worker-staging-rollback-baseline.ts",
      "src/lib/bcrypt-password-verifier.ts",
      "src/lib/worker-request-adapters.ts",
      "src/cloudflare/password-verifier.ts",
    ];

    expect(findForbiddenWorkerBundleDependencies(inputs, "staging-rollback-baseline")).toEqual([]);
    expect(() => assertWorkerBundleInputs(inputs, "staging-rollback-baseline")).not.toThrow();
  });

  it("baseline profileでもNode server・mail・Prisma singleton・memory storeを拒否する", () => {
    const inputs = [
      "src/index.ts",
      "node_modules/@hono/node-server/dist/index.mjs",
      "node_modules/nodemailer/lib/nodemailer.js",
      "src/lib/mail.ts",
      "src/lib/prisma.ts",
      "src/middleware/rateLimit/in-memory-store.ts",
    ];

    expect(findForbiddenWorkerBundleDependencies(inputs, "staging-rollback-baseline")).toEqual([
      "node-entrypoint",
      "node-server",
      "nodemailer",
      "node-mail-adapter",
      "node-prisma-singleton",
      "memory-rate-limit-store",
    ]);
    expect(() => assertWorkerBundleInputs(inputs, "staging-rollback-baseline")).toThrow(
      "Workers bundleに許可されない依存が含まれています",
    );
  });
});
