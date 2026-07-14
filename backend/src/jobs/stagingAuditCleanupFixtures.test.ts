import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  STAGING_EXPIRED_AUDIT_ACTION,
  STAGING_RETAINED_AUDIT_ACTION,
  prepareStagingAuditCleanupFixtures,
  removeStagingAuditCleanupFixtures,
  validateStagingAuditCleanupFixtureEnvironment,
  verifyStagingAuditCleanupFixturesWereCleaned,
} from "./stagingAuditCleanupFixtures.js";

const NOW = new Date("2026-07-14T08:00:00.000Z");
const RETENTION_DAYS = 365;
const MILLISECONDS_PER_DAY = 86_400_000;
const PROJECT_REF = "exampleprojectref";
const INVALID_ENVIRONMENT_MESSAGE = "staging監査ログfixture設定が不正です";
const VERIFICATION_FAILED_MESSAGE = "staging監査ログcleanup結果が正しくありません";

const deleteMany = vi.fn();
const createMany = vi.fn();
const count = vi.fn();
const client = { auditLog: { deleteMany, createMany, count } };

function createEnvironment() {
  return {
    BATCH_ENVIRONMENT: "staging",
    AUDIT_LOG_STAGING_FIXTURES_ENABLED: "true",
    STAGING_SUPABASE_PROJECT_REF: PROJECT_REF,
    DATABASE_URL: `postgresql://postgres.${PROJECT_REF}:password@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`,
  };
}

describe("validateStagingAuditCleanupFixtureEnvironment", () => {
  it("accepts an explicitly enabled staging session-pooler target", () => {
    expect(() => validateStagingAuditCleanupFixtureEnvironment(createEnvironment())).not.toThrow();
  });

  it.each([
    ["wrong environment", { BATCH_ENVIRONMENT: "production" }],
    ["disabled fixtures", { AUDIT_LOG_STAGING_FIXTURES_ENABLED: "false" }],
    ["wrong project", { STAGING_SUPABASE_PROJECT_REF: "otherproject" }],
    [
      "transaction pooler",
      {
        DATABASE_URL: `postgresql://postgres.${PROJECT_REF}:password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`,
      },
    ],
    [
      "non-Supabase host",
      {
        DATABASE_URL: `postgresql://postgres.${PROJECT_REF}:password@example.com:5432/postgres`,
      },
    ],
  ])("rejects %s without exposing the URL", (_caseName, override) => {
    expect(() =>
      validateStagingAuditCleanupFixtureEnvironment({
        ...createEnvironment(),
        ...override,
      }),
    ).toThrow(INVALID_ENVIRONMENT_MESSAGE);
  });
});

describe("staging audit cleanup fixtures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replaces only fixture actions and creates one expired and one retained row", async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    createMany.mockResolvedValue({ count: 2 });

    const result = await prepareStagingAuditCleanupFixtures({
      client,
      now: NOW,
      retentionDays: RETENTION_DAYS,
    });

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        action: {
          in: [STAGING_EXPIRED_AUDIT_ACTION, STAGING_RETAINED_AUDIT_ACTION],
        },
      },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          action: STAGING_EXPIRED_AUDIT_ACTION,
          result: "SUCCESS",
          occurredAt: new Date(NOW.getTime() - 366 * MILLISECONDS_PER_DAY),
        }),
        expect.objectContaining({
          action: STAGING_RETAINED_AUDIT_ACTION,
          result: "SUCCESS",
          occurredAt: new Date(NOW.getTime() - 364 * MILLISECONDS_PER_DAY),
        }),
      ],
    });
    expect(result).toEqual({ expiredCount: 1, retainedCount: 1 });
  });

  it("rejects an invalid clock before accessing the database", async () => {
    await expect(
      prepareStagingAuditCleanupFixtures({
        client,
        now: new Date(Number.NaN),
        retentionDays: RETENTION_DAYS,
      }),
    ).rejects.toThrow("staging監査ログfixtureの基準時刻が不正です");
    expect(deleteMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it("rejects an invalid retention period before accessing the database", async () => {
    await expect(
      prepareStagingAuditCleanupFixtures({
        client,
        now: NOW,
        retentionDays: 1,
      }),
    ).rejects.toThrow("staging監査ログfixtureの保持日数が不正です");
    expect(deleteMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it("fails preparation when both fixture rows were not created", async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    createMany.mockResolvedValue({ count: 1 });

    await expect(
      prepareStagingAuditCleanupFixtures({
        client,
        now: NOW,
        retentionDays: RETENTION_DAYS,
      }),
    ).rejects.toThrow("staging監査ログfixtureの作成に失敗しました");
  });

  it("verifies that only the expired fixture was deleted", async () => {
    count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    await expect(verifyStagingAuditCleanupFixturesWereCleaned({ client })).resolves.toEqual({
      expiredCount: 0,
      retainedCount: 1,
    });
  });

  it("fails verification when an expired fixture remains", async () => {
    count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    await expect(verifyStagingAuditCleanupFixturesWereCleaned({ client })).rejects.toThrow(
      VERIFICATION_FAILED_MESSAGE,
    );
  });

  it("fails verification when the retained fixture is missing", async () => {
    count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    await expect(verifyStagingAuditCleanupFixturesWereCleaned({ client })).rejects.toThrow(
      VERIFICATION_FAILED_MESSAGE,
    );
  });

  it("removes only staging fixture actions", async () => {
    deleteMany.mockResolvedValue({ count: 1 });

    await expect(removeStagingAuditCleanupFixtures({ client })).resolves.toEqual({
      deletedCount: 1,
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        action: {
          in: [STAGING_EXPIRED_AUDIT_ACTION, STAGING_RETAINED_AUDIT_ACTION],
        },
      },
    });
  });
});
