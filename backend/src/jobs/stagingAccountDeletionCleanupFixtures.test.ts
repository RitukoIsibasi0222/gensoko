import { describe, expect, it, vi } from "vitest";

import {
  STAGING_ACCOUNT_DELETION_ACTIVE_FIXTURE,
  STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE,
  STAGING_ACCOUNT_DELETION_SUSPENDED_FIXTURE,
  prepareStagingAccountDeletionCleanupFixtures,
  removeStagingAccountDeletionCleanupFixtures,
  validateStagingAccountDeletionCleanupFixtureEnvironment,
  verifyStagingAccountDeletionCleanupFixtureIsolation,
  verifyStagingAccountDeletionCleanupFixturesWereCleaned,
  type StagingAccountDeletionCleanupFixtureClient,
  type StagingAccountDeletionCleanupFixtureUser,
} from "./stagingAccountDeletionCleanupFixtures.js";

const STAGING_ENVIRONMENT = {
  BATCH_ENVIRONMENT: "staging",
  ACCOUNT_DATA_DELETION_STAGING_FIXTURES_ENABLED: "true",
  STAGING_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
  DATABASE_URL:
    "postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
} as const;

function toRow(
  fixture: typeof STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE,
): StagingAccountDeletionCleanupFixtureUser {
  return {
    id: fixture.id,
    username: fixture.username,
    email: fixture.email,
    role: "USER",
    emailVerified: true,
    isActive: fixture.isActive,
    deletedAt: fixture.deletedAt,
  };
}

function createClient(options?: {
  identifierRows?: StagingAccountDeletionCleanupFixtureUser[];
  legacyRows?: StagingAccountDeletionCleanupFixtureUser[];
  elementCount?: number;
  ownedCounts?: number[];
  createdCount?: number;
  deletedCount?: number;
}): StagingAccountDeletionCleanupFixtureClient {
  const identifierRows = options?.identifierRows ?? [];
  const legacyRows = options?.legacyRows ?? [];
  const ownedCounts = options?.ownedCounts ?? [0, 0];

  const transactionClient = {
    user: {
      findMany: vi.fn().mockResolvedValueOnce(identifierRows).mockResolvedValueOnce(legacyRows),
      deleteMany: vi
        .fn()
        .mockResolvedValue({ count: options?.deletedCount ?? identifierRows.length }),
      createMany: vi.fn().mockResolvedValue({ count: options?.createdCount ?? 3 }),
    },
    userStats: {
      create: vi.fn().mockResolvedValue({ userId: STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE.id }),
      count: vi.fn().mockResolvedValue(ownedCounts[0] ?? 0),
    },
    refreshToken: {
      create: vi.fn().mockResolvedValue({
        tokenHash: "staging-account-deletion-cleanup-fixture-token",
      }),
      count: vi.fn().mockResolvedValue(ownedCounts[1] ?? 0),
    },
    element: {
      count: vi.fn().mockResolvedValue(options?.elementCount ?? 1),
    },
  };

  return {
    ...transactionClient,
    $transaction: vi.fn(async (callback) => await callback(transactionClient)),
  };
}

describe("staging account deletion cleanup fixture environment", () => {
  it("staging接続先と専用flagが完全に一致する場合だけ受理する", () => {
    expect(() =>
      validateStagingAccountDeletionCleanupFixtureEnvironment(STAGING_ENVIRONMENT),
    ).not.toThrow();
  });

  it.each([
    { ...STAGING_ENVIRONMENT, ACCOUNT_DATA_DELETION_STAGING_FIXTURES_ENABLED: "false" },
    { ...STAGING_ENVIRONMENT, BATCH_ENVIRONMENT: "production" },
    { ...STAGING_ENVIRONMENT, STAGING_SUPABASE_PROJECT_REF: "differentprojectref123" },
  ])("staging fixture設定が不正なら拒否する", (environment) => {
    expect(() => validateStagingAccountDeletionCleanupFixtureEnvironment(environment)).toThrow(
      "staging account deletion fixture設定が不正です",
    );
  });
});

describe("staging account deletion cleanup fixtures", () => {
  it("既存fixtureだけを置換し、legacy targetとactive/suspended sentinelを作成する", async () => {
    const existingRows = [
      toRow(STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE),
      toRow(STAGING_ACCOUNT_DELETION_ACTIVE_FIXTURE),
      toRow(STAGING_ACCOUNT_DELETION_SUSPENDED_FIXTURE),
    ];
    const client = createClient({ identifierRows: existingRows, elementCount: 118 });

    await expect(
      prepareStagingAccountDeletionCleanupFixtures({
        client,
        createPasswordHash: vi.fn().mockResolvedValue("bcrypt-hash"),
      }),
    ).resolves.toEqual({ createdUsers: 3, targetOwnedRows: 2 });

    expect(client.user.deleteMany).toHaveBeenCalledTimes(1);
    expect(client.user.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          id: STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE.id,
          deletedAt: STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE.deletedAt,
        }),
        expect.objectContaining({
          id: STAGING_ACCOUNT_DELETION_ACTIVE_FIXTURE.id,
          deletedAt: null,
          isActive: true,
        }),
        expect.objectContaining({
          id: STAGING_ACCOUNT_DELETION_SUSPENDED_FIXTURE.id,
          deletedAt: null,
          isActive: false,
        }),
      ]),
    });
  });

  it("fixture識別子に一致しても属性が違うUserは変更せず停止する", async () => {
    const mismatched = {
      ...toRow(STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE),
      email: "unknown@example.test",
    };
    const client = createClient({ identifierRows: [mismatched] });

    await expect(
      prepareStagingAccountDeletionCleanupFixtures({
        client,
        createPasswordHash: vi.fn().mockResolvedValue("bcrypt-hash"),
      }),
    ).rejects.toThrow("staging account deletion fixtureの識別に失敗しました");
    expect(client.user.deleteMany).not.toHaveBeenCalled();
  });

  it("Elementがなければfixture作成前に停止する", async () => {
    const client = createClient({ elementCount: 0 });

    await expect(
      prepareStagingAccountDeletionCleanupFixtures({
        client,
        createPasswordHash: vi.fn().mockResolvedValue("bcrypt-hash"),
      }),
    ).rejects.toThrow("staging account deletion fixtureの作成に失敗しました");
    expect(client.user.deleteMany).not.toHaveBeenCalled();
    expect(client.user.createMany).not.toHaveBeenCalled();
  });

  it("fixture作成件数が不足すればtransactionを失敗させる", async () => {
    const client = createClient({ elementCount: 118, createdCount: 2 });

    await expect(
      prepareStagingAccountDeletionCleanupFixtures({
        client,
        createPasswordHash: vi.fn().mockResolvedValue("bcrypt-hash"),
      }),
    ).rejects.toThrow("staging account deletion fixtureの作成に失敗しました");
  });

  it("legacy対象がsynthetic target 1件だけならexecute可能と判定する", async () => {
    const rows = [
      toRow(STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE),
      toRow(STAGING_ACCOUNT_DELETION_ACTIVE_FIXTURE),
      toRow(STAGING_ACCOUNT_DELETION_SUSPENDED_FIXTURE),
    ];
    const client = createClient({
      identifierRows: rows,
      legacyRows: [toRow(STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE)],
      elementCount: 118,
      ownedCounts: [1, 1],
    });

    await expect(verifyStagingAccountDeletionCleanupFixtureIsolation({ client })).resolves.toEqual({
      legacyFixtureUsers: 1,
      targetOwnedRows: 2,
      activeSentinelUsers: 1,
      suspendedSentinelUsers: 1,
      fixtureSourceElementsAvailable: true,
    });
  });

  it("cleanup済みでlegacy対象と所有rowが0件なら冪等再実行を許可する", async () => {
    const rows = [
      toRow(STAGING_ACCOUNT_DELETION_ACTIVE_FIXTURE),
      toRow(STAGING_ACCOUNT_DELETION_SUSPENDED_FIXTURE),
    ];
    const client = createClient({
      identifierRows: rows,
      legacyRows: [],
      elementCount: 118,
      ownedCounts: [0, 0],
    });

    await expect(verifyStagingAccountDeletionCleanupFixtureIsolation({ client })).resolves.toEqual({
      legacyFixtureUsers: 0,
      targetOwnedRows: 0,
      activeSentinelUsers: 1,
      suspendedSentinelUsers: 1,
      fixtureSourceElementsAvailable: true,
    });
  });

  it("由来不明のlegacy Userが1件でもあればexecute前に停止する", async () => {
    const rows = [
      toRow(STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE),
      toRow(STAGING_ACCOUNT_DELETION_ACTIVE_FIXTURE),
      toRow(STAGING_ACCOUNT_DELETION_SUSPENDED_FIXTURE),
    ];
    const unknownLegacy = {
      ...toRow(STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE),
      id: "unknown-legacy-user",
      username: "unknown_legacy_user",
      email: "unknown-legacy@example.test",
    };
    const client = createClient({
      identifierRows: rows,
      legacyRows: [toRow(STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE), unknownLegacy],
    });

    await expect(verifyStagingAccountDeletionCleanupFixtureIsolation({ client })).rejects.toThrow(
      "staging cleanup対象をsynthetic fixtureへ分離できません",
    );
  });

  it("cleanup後はtargetと所有rowが0でsentinelとElementが残る", async () => {
    const rows = [
      toRow(STAGING_ACCOUNT_DELETION_ACTIVE_FIXTURE),
      toRow(STAGING_ACCOUNT_DELETION_SUSPENDED_FIXTURE),
    ];
    const client = createClient({
      identifierRows: rows,
      legacyRows: [],
      elementCount: 118,
      ownedCounts: [0, 0],
    });

    await expect(
      verifyStagingAccountDeletionCleanupFixturesWereCleaned({ client }),
    ).resolves.toEqual({
      legacyFixtureUsers: 0,
      targetOwnedRows: 0,
      activeSentinelUsers: 1,
      suspendedSentinelUsers: 1,
      fixtureSourceElementsAvailable: true,
    });
  });

  it("cleanup後に所有rowが残れば失敗する", async () => {
    const rows = [
      toRow(STAGING_ACCOUNT_DELETION_ACTIVE_FIXTURE),
      toRow(STAGING_ACCOUNT_DELETION_SUSPENDED_FIXTURE),
    ];
    const client = createClient({
      identifierRows: rows,
      legacyRows: [],
      elementCount: 118,
      ownedCounts: [1, 0],
    });

    await expect(
      verifyStagingAccountDeletionCleanupFixturesWereCleaned({ client }),
    ).rejects.toThrow("staging account deletion fixtureのcleanup結果が不正です");
  });

  it("removeは完全一致fixtureだけを削除する", async () => {
    const rows = [
      toRow(STAGING_ACCOUNT_DELETION_ACTIVE_FIXTURE),
      toRow(STAGING_ACCOUNT_DELETION_SUSPENDED_FIXTURE),
    ];
    const client = createClient({ identifierRows: rows });

    await expect(removeStagingAccountDeletionCleanupFixtures({ client })).resolves.toEqual({
      deletedUsers: 2,
    });
  });

  it("remove直前に完全一致しなくなったfixtureがあれば失敗する", async () => {
    const rows = [
      toRow(STAGING_ACCOUNT_DELETION_ACTIVE_FIXTURE),
      toRow(STAGING_ACCOUNT_DELETION_SUSPENDED_FIXTURE),
    ];
    const client = createClient({ identifierRows: rows, deletedCount: 1 });

    await expect(removeStagingAccountDeletionCleanupFixtures({ client })).rejects.toThrow(
      "staging account deletion fixtureの識別に失敗しました",
    );
  });
});
