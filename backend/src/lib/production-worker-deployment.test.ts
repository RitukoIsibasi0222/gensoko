import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  PRODUCTION_WORKER_DEPLOYMENT_ERROR_MESSAGE,
  runProductionWorkerDeployment,
} from "./production-worker-deployment.js";

const SHA = "1234567890abcdef1234567890abcdef12345678";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "gensoko-production-worker-"));
  const stagingConfigPath = join(root, "wrangler.jsonc");
  writeFileSync(
    stagingConfigPath,
    JSON.stringify({ env: { staging: { hyperdrive: [{ id: "b".repeat(32) }] } } }),
  );
  return {
    root,
    stagingConfigPath,
    environment: {
      RUNNER_TEMP: root,
      PRODUCTION_WORKER_NAME: "gensoko-api-production",
      PRODUCTION_API_HOSTNAME: "api.gensoko.example.co",
      PRODUCTION_FRONTEND_ORIGIN: "https://www.gensoko.example.co",
      PRODUCTION_REGISTRABLE_DOMAIN: "gensoko.example.co",
      PRODUCTION_HYPERDRIVE_ID: "a".repeat(32),
    },
  };
}

describe("production Worker deployment", () => {
  it("mode 0600のproduction configでdeployしexact SHA metadataを確認後cleanupする", () => {
    const fixture = setup();
    let generatedConfigPath = "";
    const runner = vi.fn((command: string, args: readonly string[]) => {
      expect(command).toBe("npx");
      const configIndex = args.indexOf("--config");
      generatedConfigPath = String(args[configIndex + 1]);
      expect(statSync(generatedConfigPath).mode & 0o777).toBe(0o600);
      expect(readFileSync(generatedConfigPath, "utf8")).not.toContain("b".repeat(32));
      if (args.includes("deploy"))
        return { status: 0, stdout: "provider deploy output", stderr: "" };
      return {
        status: 0,
        stdout: JSON.stringify({ deployments: [{ message: `production-release:${SHA}` }] }),
        stderr: "",
      };
    });

    expect(
      runProductionWorkerDeployment({
        expectedSha: SHA,
        environment: fixture.environment,
        stagingConfigPath: fixture.stagingConfigPath,
        workingDirectory: fixture.root,
        runner,
      }),
    ).toEqual({ status: "deployed" });
    expect(runner).toHaveBeenCalledTimes(2);
    expect(existsSync(generatedConfigPath)).toBe(false);
    expect(existsSync(join(fixture.root, "production-worker-provider.log"))).toBe(false);
  });

  it("metadata不一致とprovider raw errorを固定errorへ縮約してtemp fileを削除する", () => {
    const fixture = setup();
    const runner = vi
      .fn()
      .mockReturnValueOnce({ status: 0, stdout: "raw deploy", stderr: "" })
      .mockReturnValueOnce({ status: 0, stdout: '{"raw":"wrong sha"}', stderr: "secret detail" });

    expect(() =>
      runProductionWorkerDeployment({
        expectedSha: SHA,
        environment: fixture.environment,
        stagingConfigPath: fixture.stagingConfigPath,
        workingDirectory: fixture.root,
        runner,
      }),
    ).toThrow(PRODUCTION_WORKER_DEPLOYMENT_ERROR_MESSAGE);
    expect(existsSync(join(fixture.root, "production-worker-provider.log"))).toBe(false);
    expect(existsSync(join(fixture.root, "production-worker-state.json"))).toBe(false);
  });
});
