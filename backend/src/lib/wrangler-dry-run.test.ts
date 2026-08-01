import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawnSync: runtimeMocks.spawnSync,
}));

import { runWranglerDryRun, WRANGLER_LOCAL_BUILD_ERROR_MESSAGE } from "./wrangler-dry-run.js";

describe("runWranglerDryRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMocks.spawnSync.mockReturnValue({
      status: 0,
      error: undefined,
    });
  });

  it("Node executableでWranglerのJS CLIをshellなしで起動する", () => {
    runWranglerDryRun({
      configPath: "wrangler.jsonc",
      environment: "staging",
      outputDirectory: ".wrangler/staging-build",
    });

    expect(runtimeMocks.spawnSync).toHaveBeenCalledWith(
      process.execPath,
      [
        expect.stringMatching(/[\\/]wrangler[\\/]bin[\\/]wrangler\.js$/),
        "deploy",
        "--dry-run",
        "--config",
        "wrangler.jsonc",
        "--outdir",
        ".wrangler/staging-build",
        "--metafile",
        "--env",
        "staging",
      ],
      expect.objectContaining({
        encoding: "utf8",
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  });

  it("Wranglerが失敗した場合は固定エラーだけを返す", () => {
    runtimeMocks.spawnSync.mockReturnValue({
      status: 1,
      error: new Error("sensitive binding"),
    });

    expect(() =>
      runWranglerDryRun({
        configPath: "wrangler.jsonc",
        outputDirectory: ".wrangler/staging-build",
      }),
    ).toThrow(WRANGLER_LOCAL_BUILD_ERROR_MESSAGE);
  });
});
