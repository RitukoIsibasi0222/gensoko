import { describe, expect, it } from "vitest";

import {
  PRODUCTION_RELEASE_STATUSES,
  toProductionReleaseEvidence,
} from "./productionReleaseEvidence.js";

const SHA = "1234567890abcdef1234567890abcdef12345678";

describe("production release evidence", () => {
  it("exact schema・canonical status順・UTC timestampだけを生成する", () => {
    const evidence = toProductionReleaseEvidence({
      sha: SHA,
      event: "push",
      runId: "123456789",
      runAttempt: 1,
      statuses: PRODUCTION_RELEASE_STATUSES,
      createdAt: new Date("2026-08-06T00:00:00.000Z"),
    });

    expect(evidence).toEqual({
      schemaVersion: 1,
      sha: SHA,
      event: "push",
      runId: "123456789",
      runAttempt: 1,
      statuses: PRODUCTION_RELEASE_STATUSES,
      createdAt: "2026-08-06T00:00:00.000Z",
    });
    expect(JSON.stringify(evidence)).not.toMatch(
      /https?:|token|secret|database|resource|deploymentId|projectId|raw/i,
    );
  });

  it("失敗runは達成済みstatusのcanonical prefixだけを保存できる", () => {
    expect(
      toProductionReleaseEvidence({
        sha: SHA,
        event: "push",
        runId: "123456789",
        runAttempt: 1,
        statuses: PRODUCTION_RELEASE_STATUSES.slice(0, 5),
        createdAt: new Date("2026-08-06T00:00:00.000Z"),
      }).statuses,
    ).toEqual(PRODUCTION_RELEASE_STATUSES.slice(0, 5));
  });

  it.each([
    { sha: "not-a-sha" },
    { event: "pull_request" },
    { runId: "https://provider.example/run/1" },
    { runAttempt: 0 },
    { statuses: ["SMOKE_CLEAR", "API_DEPLOYED"] },
    { statuses: [] },
    { createdAt: new Date("invalid") },
  ])("不正値・禁止値・status順序を拒否する", (override) => {
    expect(() =>
      toProductionReleaseEvidence({
        sha: SHA,
        event: "workflow_dispatch",
        runId: "123456789",
        runAttempt: 2,
        statuses: PRODUCTION_RELEASE_STATUSES,
        createdAt: new Date("2026-08-06T00:00:00.000Z"),
        ...override,
      } as Parameters<typeof toProductionReleaseEvidence>[0]),
    ).toThrow("production release evidenceを作成できませんでした");
  });
});
