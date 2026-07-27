import { describe, expect, it, vi } from "vitest";

import { runM2EvidenceCli } from "./stagingReleaseCandidateEvidence.cli.js";

const SHA = "1234567890abcdef1234567890abcdef12345678";

function clearEvidenceJson(): string {
  return JSON.stringify({
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
    decision: "unknown",
  });
}

describe("M2 evidence CLI", () => {
  it("inputをexact schemaで再構成して安全なJSONだけを書く", async () => {
    const writeFile = vi.fn();
    const info = vi.fn();
    const exitCode = await runM2EvidenceCli({
      argv: ["--input", "input.json", "--output", "evidence.json"],
      readFile: vi.fn().mockResolvedValue(clearEvidenceJson()),
      writeFile,
      info,
      error: vi.fn(),
    });

    expect(exitCode).toBe(0);
    const written = JSON.parse(writeFile.mock.calls[0]![1] as string) as { decision: string };
    expect(written.decision).toBe("clear");
    expect(info).toHaveBeenCalledWith({ event: "m2_evidence.completed", decision: "clear" });
  });

  it("余分なfield・JSON不正・欠落を固定errorへ縮約する", async () => {
    const error = vi.fn();
    const exitCode = await runM2EvidenceCli({
      argv: ["--input", "input.json", "--output", "evidence.json"],
      readFile: vi.fn().mockResolvedValue('{"raw":"secret-token"}'),
      writeFile: vi.fn(),
      info: vi.fn(),
      error,
    });

    expect(exitCode).toBe(1);
    expect(JSON.stringify(error.mock.calls)).toBe(
      '[[{"event":"m2_evidence.failed","message":"M2 evidence CLIの実行に失敗しました"}]]',
    );
  });
});
