import { describe, expect, it } from "vitest";

import {
  createM2Evidence,
  createUnknownM2Evidence,
  validateM1PathAEvidence,
  type M2StagingReleaseCandidateEvidence,
} from "./stagingReleaseCandidateEvidence.js";

const SHA = "1234567890abcdef1234567890abcdef12345678";

function createClearEvidence(): M2StagingReleaseCandidateEvidence {
  return {
    schemaVersion: 1,
    workflowName: "staging-release-candidate-campaign",
    evidenceVersion: "m2-v1",
    releaseCandidateSha: SHA,
    startedAt: "2026-07-28T00:00:00.000Z",
    completedAt: "2026-07-28T00:20:00.000Z",
    m1Gate: "clear",
    deployment: {
      databaseTarget: "clear",
      apiCandidate: "clear",
      frontendCandidate: "clear",
      passwordVerifierBinding: "clear",
    },
    campaign: {
      registration: "clear",
      emailVerification: "clear",
      validLogin: "clear",
      refreshProtocol: "clear",
      mainWorkerCpu: "clear",
      authAllowedTen: "clear",
      authEleventh429: "clear",
      authRetryAfter: "clear",
      authReset: "clear",
      game: "clear",
      keyboard: "clear",
      viewport320: "clear",
      selfDeletion: "clear",
      oldCredentialRejection: "clear",
      headersCorsSafeErrors: "clear",
    },
    cleanup: { main: "clear", recovery: "not-required", residue: "clear" },
    authAllowedRequests: 10,
    authLimitedRequest: 11,
    decision: "clear",
  };
}

describe("M2 safe evidence", () => {
  it("exact allowlistを受理しdecisionを再計算する", () => {
    expect(createM2Evidence({ ...createClearEvidence(), decision: "unknown" }).decision).toBe(
      "clear",
    );
  });

  it.each(["present", "unknown"] as const)("required statusが%sならfail-closedにする", (status) => {
    const evidence = createM2Evidence({
      ...createClearEvidence(),
      campaign: { ...createClearEvidence().campaign, validLogin: status },
    });
    expect(evidence.decision).toBe(status);
  });

  it("cleanup成功で元のunknownをclearへ戻さない", () => {
    const evidence = createM2Evidence({
      ...createClearEvidence(),
      campaign: { ...createClearEvidence().campaign, game: "unknown" },
      cleanup: { main: "clear", recovery: "clear", residue: "clear" },
    });
    expect(evidence.decision).toBe("unknown");
  });

  it("余分なkey・不正SHA・Artifact欠落相当を拒否する", () => {
    expect(() => createM2Evidence({ ...createClearEvidence(), raw: "secret" })).toThrow(
      "安全なM2証拠を作成できませんでした",
    );
    expect(() =>
      createM2Evidence({ ...createClearEvidence(), releaseCandidateSha: "not-a-sha" }),
    ).toThrow("安全なM2証拠を作成できませんでした");
    expect(() => createM2Evidence(undefined)).toThrow("安全なM2証拠を作成できませんでした");
  });

  it("unknown evidenceは許可fieldだけをunknownで初期化する", () => {
    const evidence = createUnknownM2Evidence({
      releaseCandidateSha: SHA,
      startedAt: new Date("2026-07-28T00:00:00.000Z"),
      completedAt: new Date("2026-07-28T00:01:00.000Z"),
    });
    expect(evidence.decision).toBe("unknown");
    for (const forbiddenKey of [
      "email",
      "username",
      "password",
      "token",
      "cookie",
      "authorization",
      "databaseUrl",
      "resourceId",
      "raw",
    ]) {
      expect(evidence).not.toHaveProperty(forbiddenKey);
    }
  });

  it("M1 markerは同一SHA・path-a・全clearだけを受理する", () => {
    const marker = {
      schemaVersion: 1,
      reviewedSha: SHA,
      executedAt: "2026-07-28T00:00:00.000Z",
      evidence: {
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
      },
      decision: "path-a",
    };
    expect(validateM1PathAEvidence(marker, SHA)).toEqual({ status: "clear" });
    expect(validateM1PathAEvidence({ ...marker, decision: "path-b" }, SHA)).toEqual({
      status: "present",
    });
    expect(validateM1PathAEvidence(marker, "abcdef1234567890abcdef1234567890abcdef12")).toEqual({
      status: "unknown",
    });
  });
});
