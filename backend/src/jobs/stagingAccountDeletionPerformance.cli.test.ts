import { beforeEach, describe, expect, it, vi } from "vitest";

import { runStagingAccountDeletionPerformanceCli } from "./stagingAccountDeletionPerformance.cli.js";

function createEnvironment(
  overrides: Partial<Record<string, string | undefined>> = {},
): Record<string, string | undefined> {
  return {
    BATCH_ENVIRONMENT: "staging",
    STAGING_SUPABASE_PROJECT_REF: "exampleproject",
    DATABASE_URL:
      "postgresql://postgres.exampleproject:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
    STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED: "false",
    ...overrides,
  };
}

function createDependencies() {
  const runtime = {
    preview: vi.fn().mockResolvedValue({ maxGameSessions: 12, maxGameAnswers: 120 }),
    execute: vi.fn().mockResolvedValue({
      maxGameSessions: 12,
      maxGameAnswers: 120,
      fixtureGameSessions: 12,
      fixtureGameAnswers: 120,
      durationMs: 400,
      thresholdMs: 5_000,
      passed: true,
    }),
    probeMigrationWrites: vi.fn().mockResolvedValue({
      probeCount: 3,
      writeProbeMaxDurationMs: 25,
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };

  return {
    validateEnvironment: vi.fn(),
    getPerformanceConfig: vi.fn((environment) => ({
      executeEnabled: environment.STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED?.trim() === "true",
    })),
    loadRuntime: vi.fn().mockResolvedValue(runtime),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    runtime,
  };
}

describe("staging account deletion performance CLI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("引数なしはread-only previewで、execute flagがtrueでも削除しない", async () => {
    const dependencies = createDependencies();

    await expect(
      runStagingAccountDeletionPerformanceCli({
        argv: [],
        environment: createEnvironment({
          STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED: "true",
        }),
        dependencies,
      }),
    ).resolves.toBe(0);
    expect(dependencies.runtime.preview).toHaveBeenCalledOnce();
    expect(dependencies.runtime.execute).not.toHaveBeenCalled();
  });

  it("executeはflag・明示件数・timeout・確認文字列が揃った場合だけ実行する", async () => {
    const dependencies = createDependencies();

    await expect(
      runStagingAccountDeletionPerformanceCli({
        argv: [
          "--execute",
          "--session-count=12",
          "--answer-count=120",
          "--platform-request-timeout-ms=10000",
          "--confirm=MEASURE_STAGING_ACCOUNT_DELETION",
        ],
        environment: createEnvironment({
          STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED: "true",
        }),
        dependencies,
      }),
    ).resolves.toBe(0);
    expect(dependencies.runtime.execute).toHaveBeenCalledWith({
      sessionCount: 12,
      answerCount: 120,
      platformRequestTimeoutMs: 10_000,
    });
  });

  it.each([
    [
      "flag false",
      { STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED: "false" },
      [
        "--execute",
        "--session-count=12",
        "--answer-count=120",
        "--platform-request-timeout-ms=10000",
        "--confirm=MEASURE_STAGING_ACCOUNT_DELETION",
      ],
    ],
    [
      "confirm mismatch",
      { STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED: "true" },
      [
        "--execute",
        "--session-count=12",
        "--answer-count=120",
        "--platform-request-timeout-ms=10000",
        "--confirm=WRONG",
      ],
    ],
    [
      "missing count",
      { STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED: "true" },
      [
        "--execute",
        "--session-count=12",
        "--platform-request-timeout-ms=10000",
        "--confirm=MEASURE_STAGING_ACCOUNT_DELETION",
      ],
    ],
  ])("%sはDB load前に終了code 2で拒否する", async (_label, environment, argv) => {
    const dependencies = createDependencies();

    await expect(
      runStagingAccountDeletionPerformanceCli({
        argv,
        environment: createEnvironment(environment),
        dependencies,
      }),
    ).resolves.toBe(2);
    expect(dependencies.loadRuntime).not.toHaveBeenCalled();
  });

  it("unknown引数はDB load前に拒否する", async () => {
    const dependencies = createDependencies();

    await expect(
      runStagingAccountDeletionPerformanceCli({
        argv: ["--unknown"],
        environment: createEnvironment(),
        dependencies,
      }),
    ).resolves.toBe(2);
    expect(dependencies.loadRuntime).not.toHaveBeenCalled();
  });

  it("migration write probeも専用flag・duration・別確認文字列を必須にする", async () => {
    const dependencies = createDependencies();

    await expect(
      runStagingAccountDeletionPerformanceCli({
        argv: [
          "--migration-write-probe",
          "--probe-duration-ms=30000",
          "--confirm=MEASURE_STAGING_ACCOUNT_DELETION_MIGRATION",
        ],
        environment: createEnvironment({
          STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED: "true",
        }),
        dependencies,
      }),
    ).resolves.toBe(0);
    expect(dependencies.runtime.probeMigrationWrites).toHaveBeenCalledWith(30_000);
    expect(dependencies.runtime.execute).not.toHaveBeenCalled();
  });

  it("接続先検証失敗はDB load前に拒否する", async () => {
    const dependencies = createDependencies();
    dependencies.validateEnvironment.mockImplementation(() => {
      throw new Error("staging DB接続先が不正です");
    });

    await expect(
      runStagingAccountDeletionPerformanceCli({
        argv: [],
        environment: createEnvironment(),
        dependencies,
      }),
    ).resolves.toBe(2);
    expect(dependencies.loadRuntime).not.toHaveBeenCalled();
    expect(dependencies.error).toHaveBeenCalledWith({
      event: "account_deletion.performance.failed",
      message: "staging account deletion性能測定の接続先が不正です",
    });
  });

  it("性能測定flagの設定不備を引数不備と区別してDB load前に拒否する", async () => {
    const dependencies = createDependencies();
    dependencies.getPerformanceConfig.mockImplementation(() => {
      throw new Error("raw configuration error");
    });

    await expect(
      runStagingAccountDeletionPerformanceCli({
        argv: [],
        environment: createEnvironment({
          STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED: "invalid",
        }),
        dependencies,
      }),
    ).resolves.toBe(2);
    expect(dependencies.validateEnvironment).not.toHaveBeenCalled();
    expect(dependencies.loadRuntime).not.toHaveBeenCalled();
    expect(dependencies.error).toHaveBeenCalledWith({
      event: "account_deletion.performance.failed",
      message: "staging account deletion性能測定の環境設定が不正です",
    });
  });

  it("fixture上限外はDB load前に拒否する", async () => {
    const dependencies = createDependencies();

    await expect(
      runStagingAccountDeletionPerformanceCli({
        argv: [
          "--execute",
          "--session-count=5001",
          "--answer-count=120",
          "--platform-request-timeout-ms=10000",
          "--confirm=MEASURE_STAGING_ACCOUNT_DELETION",
        ],
        environment: createEnvironment({
          STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED: "true",
        }),
        dependencies,
      }),
    ).resolves.toBe(2);
    expect(dependencies.loadRuntime).not.toHaveBeenCalled();
  });

  it("実行errorの生情報・DATABASE_URL・内部IDをlogへ出さない", async () => {
    const dependencies = createDependencies();
    dependencies.runtime.preview.mockRejectedValue(
      new Error("postgresql://secret@example.com/private user-id@example.com internal-user-id"),
    );

    await expect(
      runStagingAccountDeletionPerformanceCli({
        argv: [],
        environment: createEnvironment(),
        dependencies,
      }),
    ).resolves.toBe(1);
    expect(JSON.stringify(dependencies.error.mock.calls)).toBe(
      '[[{"event":"account_deletion.performance.failed","message":"staging account deletion性能測定に失敗しました"}]]',
    );
  });

  it("disconnect失敗は確定済み結果を変えずgeneric warningだけを出す", async () => {
    const dependencies = createDependencies();
    dependencies.runtime.disconnect.mockRejectedValue(new Error("raw disconnect error"));

    await expect(
      runStagingAccountDeletionPerformanceCli({
        argv: [],
        environment: createEnvironment(),
        dependencies,
      }),
    ).resolves.toBe(0);
    expect(JSON.stringify(dependencies.warn.mock.calls)).not.toContain("raw disconnect");
  });
});
