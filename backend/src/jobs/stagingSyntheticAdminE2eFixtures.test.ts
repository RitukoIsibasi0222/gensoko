import { describe, expect, it, vi } from "vitest";

import {
  STAGING_SYNTHETIC_E2E_ADMIN,
  STAGING_SYNTHETIC_E2E_USER,
  prepareStagingSyntheticAdminE2eFixtures,
  removeStagingSyntheticAdminE2eFixtures,
  validateStagingSyntheticAdminE2eFixtureEnvironment,
  type StagingSyntheticAdminE2eFixtureClient,
  type StagingSyntheticAdminE2eFixtureUser,
} from "./stagingSyntheticAdminE2eFixtures.js";

const ADMIN_PASSWORD = "SyntheticAdmin1!password";
const USER_PASSWORD = "SyntheticUser1!password";
const VALID_ENVIRONMENT = {
  BATCH_ENVIRONMENT: "staging",
  STAGING_SUPABASE_PROJECT_REF: "staging-ref",
  DATABASE_URL:
    "postgresql://postgres.staging-ref:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
  STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED: "true",
  STAGING_SYNTHETIC_ADMIN_PASSWORD: ADMIN_PASSWORD,
  STAGING_SYNTHETIC_USER_PASSWORD: USER_PASSWORD,
} as const;

function fixtureRow(
  fixture: typeof STAGING_SYNTHETIC_E2E_ADMIN | typeof STAGING_SYNTHETIC_E2E_USER,
): StagingSyntheticAdminE2eFixtureUser {
  return {
    id: fixture.id,
    username: fixture.username,
    email: fixture.email,
    role: fixture.role,
    emailVerified: true,
    isActive: true,
    deletedAt: null,
  };
}

function createClient(identifierRows: StagingSyntheticAdminE2eFixtureUser[] = []) {
  const transactionClient = {
    user: {
      findMany: vi.fn().mockResolvedValue(identifierRows),
      deleteMany: vi.fn().mockResolvedValue({ count: identifierRows.length }),
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
  };
  const client = {
    ...transactionClient,
    $transaction: vi.fn(
      async (callback: (client: typeof transactionClient) => Promise<unknown>) =>
        await callback(transactionClient),
    ),
  } as unknown as StagingSyntheticAdminE2eFixtureClient;

  return { client, transactionClient };
}

describe("staging synthetic Admin E2E fixtures", () => {
  it("staging Environment・専用flag・Supabase Session Pooler・credentialをすべて要求する", () => {
    expect(() =>
      validateStagingSyntheticAdminE2eFixtureEnvironment(VALID_ENVIRONMENT, {
        requireCredentials: true,
      }),
    ).not.toThrow();

    for (const invalidEnvironment of [
      { ...VALID_ENVIRONMENT, BATCH_ENVIRONMENT: "production" },
      { ...VALID_ENVIRONMENT, STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED: "false" },
      { ...VALID_ENVIRONMENT, DATABASE_URL: "postgresql://production.invalid/postgres" },
      { ...VALID_ENVIRONMENT, STAGING_SYNTHETIC_ADMIN_PASSWORD: "" },
      { ...VALID_ENVIRONMENT, STAGING_SYNTHETIC_USER_PASSWORD: "" },
    ]) {
      expect(() =>
        validateStagingSyntheticAdminE2eFixtureEnvironment(invalidEnvironment, {
          requireCredentials: true,
        }),
      ).toThrow("staging synthetic E2E fixture設定が不正です");
    }
  });

  it("cleanupはcredentialがなくてもstaging接続guardを満たせば実行できる", () => {
    const cleanupEnvironment = {
      BATCH_ENVIRONMENT: VALID_ENVIRONMENT.BATCH_ENVIRONMENT,
      STAGING_SUPABASE_PROJECT_REF: VALID_ENVIRONMENT.STAGING_SUPABASE_PROJECT_REF,
      DATABASE_URL: VALID_ENVIRONMENT.DATABASE_URL,
      STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED:
        VALID_ENVIRONMENT.STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED,
    };

    expect(() =>
      validateStagingSyntheticAdminE2eFixtureEnvironment(cleanupEnvironment, {
        requireCredentials: false,
      }),
    ).not.toThrow();
  });

  it("完全一致fixtureだけを置換し、ADMINと対象USERを別password hashで作成する", async () => {
    const { client, transactionClient } = createClient([
      fixtureRow(STAGING_SYNTHETIC_E2E_ADMIN),
      fixtureRow(STAGING_SYNTHETIC_E2E_USER),
    ]);
    const createPasswordHash = vi.fn(async (password: string) => "hash:" + password);

    await expect(
      prepareStagingSyntheticAdminE2eFixtures({
        client,
        adminPassword: "  " + ADMIN_PASSWORD + "  ",
        userPassword: "  " + USER_PASSWORD + "  ",
        createPasswordHash,
      }),
    ).resolves.toEqual({ createdUsers: 2, replacedUsers: 2 });

    expect(createPasswordHash.mock.calls).toEqual([[ADMIN_PASSWORD], [USER_PASSWORD]]);
    expect(transactionClient.user.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          ...STAGING_SYNTHETIC_E2E_ADMIN,
          passwordHash: "hash:" + ADMIN_PASSWORD,
          emailVerified: true,
          isActive: true,
          deletedAt: null,
        }),
        expect.objectContaining({
          ...STAGING_SYNTHETIC_E2E_USER,
          passwordHash: "hash:" + USER_PASSWORD,
          emailVerified: true,
          isActive: true,
          deletedAt: null,
        }),
      ],
    });
  });

  it("fixture関数を直接呼んでもADMINと対象USERの同一passwordをDB操作前に拒否する", async () => {
    const { client } = createClient();

    await expect(
      prepareStagingSyntheticAdminE2eFixtures({
        client,
        adminPassword: ADMIN_PASSWORD,
        userPassword: ADMIN_PASSWORD,
        createPasswordHash: async () => "hash",
      }),
    ).rejects.toThrow("staging synthetic E2E fixture設定が不正です");
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("ID・username・emailの一部だけが衝突する既存Userには触れず停止する", async () => {
    const collision = {
      ...fixtureRow(STAGING_SYNTHETIC_E2E_USER),
      id: "existing-user-id",
    };
    const { client, transactionClient } = createClient([collision]);

    await expect(
      prepareStagingSyntheticAdminE2eFixtures({
        client,
        adminPassword: ADMIN_PASSWORD,
        userPassword: USER_PASSWORD,
        createPasswordHash: async () => "hash",
      }),
    ).rejects.toThrow("staging synthetic E2E fixtureの識別に失敗しました");
    expect(transactionClient.user.deleteMany).not.toHaveBeenCalled();
    expect(transactionClient.user.createMany).not.toHaveBeenCalled();
  });

  it("対象USERが強制退会済みでも、残る完全一致ADMINだけをcleanupできる", async () => {
    const { client, transactionClient } = createClient([fixtureRow(STAGING_SYNTHETIC_E2E_ADMIN)]);

    await expect(removeStagingSyntheticAdminE2eFixtures({ client })).resolves.toEqual({
      deletedUsers: 1,
    });
    expect(transactionClient.user.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("cleanupも識別fieldが完全一致しないUserを削除しない", async () => {
    const collision = {
      ...fixtureRow(STAGING_SYNTHETIC_E2E_ADMIN),
      role: "USER" as const,
    };
    const { client, transactionClient } = createClient([collision]);

    await expect(removeStagingSyntheticAdminE2eFixtures({ client })).rejects.toThrow(
      "staging synthetic E2E fixtureの識別に失敗しました",
    );
    expect(transactionClient.user.deleteMany).not.toHaveBeenCalled();
  });
});
