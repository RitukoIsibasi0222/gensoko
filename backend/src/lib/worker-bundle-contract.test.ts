import { describe, expect, it } from "vitest";
import {
  assertWorkerBundleInputs,
  findForbiddenWorkerBundleDependencies,
} from "./worker-bundle-contract.js";

describe("Workers bundle contract", () => {
  it("Prisma・pg・fetch mail・Durable Objectのproduction graphを許可する", () => {
    const inputs = [
      "src/worker.ts",
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

    expect(findForbiddenWorkerBundleDependencies(inputs)).toEqual([]);
    expect(() => assertWorkerBundleInputs(inputs)).not.toThrow();
  });

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
      "Workers bundleにNode専用依存が含まれています",
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
});
