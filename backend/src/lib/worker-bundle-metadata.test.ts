import { describe, expect, it } from "vitest";
import { parseWorkerBundleInputPaths } from "./worker-bundle-metadata.js";

const INVALID_METADATA_MESSAGE = "Workers bundleの検証情報が不正です";

describe("parseWorkerBundleInputPaths", () => {
  it("production entrypointを含むmetafile input pathを返す", () => {
    expect(
      parseWorkerBundleInputPaths({
        inputs: {
          "src/worker.ts": { bytes: 100 },
          "src/lib/prisma-client.ts": { bytes: 200 },
        },
      }),
    ).toEqual(["src/worker.ts", "src/lib/prisma-client.ts"]);
  });

  it("production profileでworker-production entrypoint metadataを受理する", () => {
    expect(
      parseWorkerBundleInputPaths(
        {
          inputs: {
            "src/worker-production.ts": { bytes: 100 },
            "src/lib/worker-handler.ts": { bytes: 200 },
          },
        },
        "production",
      ),
    ).toEqual(["src/worker-production.ts", "src/lib/worker-handler.ts"]);
  });

  it("baseline profileで専用entrypoint metadataを受理する", () => {
    expect(
      parseWorkerBundleInputPaths(
        {
          inputs: {
            "src/worker-staging-rollback-baseline.ts": { bytes: 100 },
            "src/lib/bcrypt-password-verifier.ts": { bytes: 200 },
          },
        },
        "staging-rollback-baseline",
      ),
    ).toEqual(["src/worker-staging-rollback-baseline.ts", "src/lib/bcrypt-password-verifier.ts"]);
  });

  it.each([
    ["standard", "src/worker-production.ts"],
    ["production", "src/worker.ts"],
    ["staging-rollback-baseline", "src/worker.ts"],
    ["staging-rollback-baseline", "src/worker-production.ts"],
  ] as const)("%s profileと%sの不一致を拒否する", (profile, entrypoint) => {
    expect(() => parseWorkerBundleInputPaths({ inputs: { [entrypoint]: {} } }, profile)).toThrow(
      INVALID_METADATA_MESSAGE,
    );
  });

  it("複数profileのentrypointを含むmetadataを拒否する", () => {
    expect(() =>
      parseWorkerBundleInputPaths(
        {
          inputs: {
            "src/worker-staging-rollback-baseline.ts": {},
            "src/worker.ts": {},
          },
        },
        "staging-rollback-baseline",
      ),
    ).toThrow(INVALID_METADATA_MESSAGE);
  });

  it.each([
    ["inputs欠落", {}],
    ["inputsが配列", { inputs: [] }],
    ["inputsが空", { inputs: {} }],
    ["production entrypoint欠落", { inputs: { "src/index.ts": {} } }],
  ])("%sを拒否する", (_caseName, metadata) => {
    expect(() => parseWorkerBundleInputPaths(metadata)).toThrow(INVALID_METADATA_MESSAGE);
  });
});
