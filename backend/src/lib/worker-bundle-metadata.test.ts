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

  it.each([
    ["inputs欠落", {}],
    ["inputsが配列", { inputs: [] }],
    ["inputsが空", { inputs: {} }],
    ["production entrypoint欠落", { inputs: { "src/index.ts": {} } }],
  ])("%sを拒否する", (_caseName, metadata) => {
    expect(() => parseWorkerBundleInputPaths(metadata)).toThrow(INVALID_METADATA_MESSAGE);
  });
});
