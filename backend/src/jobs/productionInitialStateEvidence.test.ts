import { describe, expect, it } from "vitest";

import {
  createUnknownProductionInitialStateEvidence,
  determineM1Path,
  toSafeProductionInitialStateMarker,
  type ProductionInitialStateEvidence,
} from "./productionInitialStateEvidence.js";

const REVIEWED_SHA = "1234567890abcdef1234567890abcdef12345678";

function createClearEvidence(): ProductionInitialStateEvidence {
  return {
    schemaVersion: 1,
    databaseTarget: "clear",
    allUsers: "clear",
    legacyUsers: "clear",
    userRelatedRows: "clear",
    auditLogs: "clear",
    vercelProductionDeployments: "clear",
    cloudflareProductionDeployments: "clear",
    githubProductionDeployments: "clear",
    productionBackupHistory: "clear",
    deletedHistoryAndExternalCopyAttestation: "clear",
    productionChangeFreezeAttestation: "clear",
  };
}

describe("production initial state evidence", () => {
  it("全checkがclearの場合だけpath-aを返す", () => {
    expect(determineM1Path(createClearEvidence())).toBe("path-a");
  });

  it.each(["present", "unknown"] as const)("%sが1件でもあればpath-bへ倒す", (status) => {
    expect(
      determineM1Path({
        ...createClearEvidence(),
        productionBackupHistory: status,
      }),
    ).toBe("path-b");
  });

  it("unknown evidenceは全checkをunknownで初期化する", () => {
    const evidence = createUnknownProductionInitialStateEvidence();

    expect(evidence.schemaVersion).toBe(1);
    expect(
      Object.entries(evidence)
        .filter(([key]) => key !== "schemaVersion")
        .every(([, status]) => status === "unknown"),
    ).toBe(true);
  });

  it("safe markerはallowlist済みstatus・SHA・timestamp・decisionだけを含む", () => {
    const evidence = createClearEvidence();
    const marker = toSafeProductionInitialStateMarker(
      evidence,
      REVIEWED_SHA,
      new Date("2026-07-27T00:00:00.000Z"),
    );

    expect(marker).toEqual({
      schemaVersion: 1,
      reviewedSha: REVIEWED_SHA,
      executedAt: "2026-07-27T00:00:00.000Z",
      evidence,
      decision: "path-a",
    });
    expect(JSON.stringify(marker)).not.toMatch(
      /count|email|username|userId|token|password|databaseUrl|resourceId|raw/i,
    );
  });

  it("不正なreviewed SHAをsafe markerへ含めない", () => {
    expect(() =>
      toSafeProductionInitialStateMarker(
        createClearEvidence(),
        "secret-or-resource-id",
        new Date(),
      ),
    ).toThrow("安全なM1証拠markerを作成できませんでした");
  });
});
