import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  runWranglerDryRun: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: runtimeMocks.readFileSync,
  rmSync: runtimeMocks.rmSync,
  writeFileSync: runtimeMocks.writeFileSync,
}));

vi.mock("../lib/wrangler-dry-run.js", () => ({
  runWranglerDryRun: runtimeMocks.runWranglerDryRun,
}));

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
};

const ORIGINAL_ARGV = [...process.argv];
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

async function importCli(): Promise<void> {
  await import("./runStagingRollbackBaselineDryRun.cli.js");
}

describe("runStagingRollbackBaselineDryRun.cli", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.argv = [
      process.execPath,
      "/app/src/scripts/runStagingRollbackBaselineDryRun.cli.ts",
      ".wrangler/rollback-baseline-build",
    ];
    process.exitCode = undefined;
    runtimeMocks.readFileSync.mockReturnValue(JSON.stringify(STAGING_CONFIG));
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.argv = [...ORIGINAL_ARGV];
    process.exitCode = undefined;
    consoleErrorSpy.mockRestore();
  });

  it("権限0600の一時configでdry-runし、成功時に削除する", async () => {
    await importCli();

    const expectedConfigPath = `${process.cwd()}/.wrangler.staging-rollback-baseline.generated.${process.pid}.json`;
    expect(runtimeMocks.readFileSync).toHaveBeenCalledWith("wrangler.jsonc", "utf8");
    expect(runtimeMocks.writeFileSync).toHaveBeenCalledWith(
      expectedConfigPath,
      expect.any(String),
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    const generatedConfig = JSON.parse(runtimeMocks.writeFileSync.mock.calls[0]?.[1]);
    expect(generatedConfig.main).toBe("src/worker-staging-rollback-baseline.ts");
    expect(runtimeMocks.runWranglerDryRun).toHaveBeenCalledWith({
      configPath: expectedConfigPath,
      outputDirectory: ".wrangler/rollback-baseline-build",
    });
    expect(runtimeMocks.rmSync).toHaveBeenCalledWith(expectedConfigPath, { force: true });
    expect(process.exitCode).toBeUndefined();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("dry-run失敗時も一時configを削除し、raw errorを出力しない", async () => {
    const sensitiveError = "postgresql://private-database-url";
    runtimeMocks.runWranglerDryRun.mockImplementation(() => {
      throw new Error(sensitiveError);
    });

    await importCli();

    expect(runtimeMocks.rmSync).toHaveBeenCalledWith(expect.any(String), { force: true });
    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith("rollback baseline dry-runに失敗しました");
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain(sensitiveError);
  });

  it("一時config削除失敗もraw errorなしの固定errorへ縮約する", async () => {
    const sensitiveError = "sensitive-generated-config-path";
    runtimeMocks.rmSync.mockImplementation(() => {
      throw new Error(sensitiveError);
    });

    await importCli();

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith("rollback baseline dry-runに失敗しました");
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain(sensitiveError);
  });

  it("出力先欠損を固定errorで拒否し、一時fileを作らない", async () => {
    process.argv.pop();

    await importCli();

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith("rollback baseline dry-runに失敗しました");
    expect(runtimeMocks.readFileSync).not.toHaveBeenCalled();
    expect(runtimeMocks.writeFileSync).not.toHaveBeenCalled();
    expect(runtimeMocks.runWranglerDryRun).not.toHaveBeenCalled();
    expect(runtimeMocks.rmSync).not.toHaveBeenCalled();
  });
});
