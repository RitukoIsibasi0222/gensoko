import { describe, expect, it, vi } from "vitest";

import type { ProductionInitialStateEvidence } from "./productionInitialStateEvidence.js";
import { runInspectProductionInitialStateCli } from "./inspectProductionInitialState.cli.js";

const SENSITIVE_VALUES = [
  "database-secret",
  "vercel-secret-token",
  "approved-scope-id",
  "github-secret-token",
  "cloudflare-secret-token",
  "approved-account-id",
  "gensoko-production",
];

const VALID_ENVIRONMENT = {
  BATCH_ENVIRONMENT: "production",
  DATABASE_URL:
    "postgresql://postgres.abcdefghijklmnopqrst:database-secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
  PRODUCTION_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
  GITHUB_REPOSITORY: "owner/Gensoko",
  GITHUB_TOKEN: "github-secret-token",
  M1_VERCEL_ACCESS_TOKEN: "vercel-secret-token",
  M1_VERCEL_SCOPE_ID: "approved-scope-id",
  M1_VERCEL_REPOSITORY: "Gensoko",
  M1_CLOUDFLARE_API_TOKEN: "cloudflare-secret-token",
  M1_CLOUDFLARE_ACCOUNT_ID: "approved-account-id",
  M1_CLOUDFLARE_WORKER_NAME: "gensoko-production",
  M1_REVIEWED_SHA: "1234567890abcdef1234567890abcdef12345678",
  M1_HISTORY_ATTESTATION: "NO_DELETED_DEPLOYMENT_OR_EXTERNAL_BACKUP_COPY",
  M1_CHANGE_FREEZE_ATTESTATION: "NO_CONCURRENT_PRODUCTION_CHANGE",
  M1_EVIDENCE_MARKER_PATH: "/runner-temp/production-initial-state-evidence.json",
};

function createEvidence(status: "clear" | "present" | "unknown"): ProductionInitialStateEvidence {
  return {
    schemaVersion: 1,
    databaseTarget: status,
    allUsers: status,
    legacyUsers: status,
    userRelatedRows: status,
    auditLogs: status,
    vercelProductionDeployments: status,
    cloudflareProductionDeployments: status,
    githubProductionDeployments: status,
    productionBackupHistory: status,
    deletedHistoryAndExternalCopyAttestation: status,
    productionChangeFreezeAttestation: status,
  };
}

function createCliFixture(evidence: ProductionInitialStateEvidence) {
  return {
    dependencies: {
      inspect: vi.fn().mockResolvedValue(evidence),
      writeMarker: vi.fn().mockResolvedValue(undefined),
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    },
    logger: { info: vi.fn(), error: vi.fn() },
  };
}

describe("inspectProductionInitialState CLI", () => {
  it("全clearならsafe markerを保存して終了code 0にする", async () => {
    const { dependencies, logger } = createCliFixture(createEvidence("clear"));

    const exitCode = await runInspectProductionInitialStateCli(
      VALID_ENVIRONMENT,
      dependencies,
      logger,
    );

    expect(exitCode).toBe(0);
    expect(dependencies.inspect).toHaveBeenCalledOnce();
    expect(dependencies.writeMarker).toHaveBeenCalledOnce();
    const [markerPath, markerJson] = dependencies.writeMarker.mock.calls[0];
    expect(markerPath).toBe(VALID_ENVIRONMENT.M1_EVIDENCE_MARKER_PATH);
    expect(JSON.parse(markerJson).decision).toBe("path-a");
    expect(logger.error).not.toHaveBeenCalled();
    const serializedOutput = JSON.stringify(logger.info.mock.calls);
    for (const sensitiveValue of SENSITIVE_VALUES) {
      expect(serializedOutput).not.toContain(sensitiveValue);
    }
  });

  it.each(["present", "unknown"] as const)(
    "%sならsafe markerを保存後に終了code 1へ倒す",
    async (status) => {
      const { dependencies, logger } = createCliFixture(createEvidence(status));

      const exitCode = await runInspectProductionInitialStateCli(
        VALID_ENVIRONMENT,
        dependencies,
        logger,
      );

      expect(exitCode).toBe(1);
      expect(dependencies.writeMarker).toHaveBeenCalledOnce();
      expect(JSON.parse(dependencies.writeMarker.mock.calls[0][1]).decision).toBe("path-b");
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  it("attestation・SHA・marker path不正はinspection前にcode 2で停止する", async () => {
    const { dependencies, logger } = createCliFixture(createEvidence("clear"));

    const exitCode = await runInspectProductionInitialStateCli(
      {
        ...VALID_ENVIRONMENT,
        M1_HISTORY_ATTESTATION: "UNCONFIRMED",
        M1_REVIEWED_SHA: "resource-id",
        M1_EVIDENCE_MARKER_PATH: "relative-marker.json",
      },
      dependencies,
      logger,
    );

    expect(exitCode).toBe(2);
    expect(dependencies.inspect).not.toHaveBeenCalled();
    expect(dependencies.writeMarker).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith({
      event: "production_initial_state.inspection.failed",
      message: "production初回状態read-only確認に失敗しました",
    });
  });

  it("raw error・Secret・resource IDをstdout/stderrへ出さない", async () => {
    const { dependencies, logger } = createCliFixture(createEvidence("clear"));
    dependencies.inspect.mockRejectedValueOnce(
      new Error("database-secret github-secret-token resource-id raw response"),
    );

    const exitCode = await runInspectProductionInitialStateCli(
      VALID_ENVIRONMENT,
      dependencies,
      logger,
    );

    expect(exitCode).toBe(2);
    const serializedOutput = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(serializedOutput).not.toContain("database-secret");
    expect(serializedOutput).not.toContain("github-secret-token");
    expect(serializedOutput).not.toContain("resource-id");
    expect(serializedOutput).not.toContain("raw response");
  });
});
