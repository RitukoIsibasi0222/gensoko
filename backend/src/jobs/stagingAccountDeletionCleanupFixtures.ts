import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";

import { validateStagingDatabaseTarget } from "../lib/staging-database-target.js";
import { hashPassword } from "../lib/password.js";

const INVALID_ENVIRONMENT_MESSAGE = "staging account deletion fixture設定が不正です";
const INVALID_FIXTURE_IDENTITY_MESSAGE = "staging account deletion fixtureの識別に失敗しました";
const ISOLATION_FAILED_MESSAGE = "staging cleanup対象をsynthetic fixtureへ分離できません";
const PREPARATION_FAILED_MESSAGE = "staging account deletion fixtureの作成に失敗しました";
const CLEANUP_VERIFICATION_FAILED_MESSAGE =
  "staging account deletion fixtureのcleanup結果が不正です";

type StagingAccountDeletionCleanupFixture = Readonly<{
  id: string;
  username: string;
  email: string;
  isActive: boolean;
  deletedAt: Date | null;
}>;

export const STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE: StagingAccountDeletionCleanupFixture = {
  id: "staging-account-deletion-legacy-fixture",
  username: "staging_deletion_legacy_fixture",
  email: "staging-deletion-legacy-fixture@example.test",
  isActive: false,
  deletedAt: new Date("2000-01-01T00:00:00.000Z"),
};

export const STAGING_ACCOUNT_DELETION_ACTIVE_FIXTURE: StagingAccountDeletionCleanupFixture = {
  id: "staging-account-deletion-active-sentinel",
  username: "staging_deletion_active_sentinel",
  email: "staging-deletion-active-sentinel@example.test",
  isActive: true,
  deletedAt: null,
};

export const STAGING_ACCOUNT_DELETION_SUSPENDED_FIXTURE: StagingAccountDeletionCleanupFixture = {
  id: "staging-account-deletion-suspended-sentinel",
  username: "staging_deletion_suspended_sentinel",
  email: "staging-deletion-suspended-sentinel@example.test",
  isActive: false,
  deletedAt: null,
};

const FIXTURES = [
  STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE,
  STAGING_ACCOUNT_DELETION_ACTIVE_FIXTURE,
  STAGING_ACCOUNT_DELETION_SUSPENDED_FIXTURE,
];

export type StagingAccountDeletionCleanupFixtureEnvironment = Readonly<{
  BATCH_ENVIRONMENT?: string;
  ACCOUNT_DATA_DELETION_STAGING_FIXTURES_ENABLED?: string;
  STAGING_SUPABASE_PROJECT_REF?: string;
  DATABASE_URL?: string;
}>;

export type StagingAccountDeletionCleanupFixtureUser = Readonly<{
  id: string;
  username: string;
  email: string;
  role: "USER";
  emailVerified: boolean;
  isActive: boolean;
  deletedAt: Date | null;
}>;

type FixtureTransactionClient = Readonly<{
  user: {
    findMany: (
      options: Prisma.UserFindManyArgs,
    ) => Promise<StagingAccountDeletionCleanupFixtureUser[]>;
    deleteMany: (options: Prisma.UserDeleteManyArgs) => Promise<{ count: number }>;
    createMany: (options: Prisma.UserCreateManyArgs) => Promise<{ count: number }>;
  };
  userStats: {
    create: (options: Prisma.UserStatsCreateArgs) => Promise<unknown>;
    count: (options: Prisma.UserStatsCountArgs) => Promise<number>;
  };
  refreshToken: {
    create: (options: Prisma.RefreshTokenCreateArgs) => Promise<unknown>;
    count: (options: Prisma.RefreshTokenCountArgs) => Promise<number>;
  };
  element: {
    count: (options?: Prisma.ElementCountArgs) => Promise<number>;
  };
}>;

export type StagingAccountDeletionCleanupFixtureClient = FixtureTransactionClient &
  Readonly<{
    $transaction: <T>(callback: (client: FixtureTransactionClient) => Promise<T>) => Promise<T>;
  }>;

export type StagingAccountDeletionCleanupFixtureState = Readonly<{
  legacyFixtureUsers: number;
  targetOwnedRows: number;
  activeSentinelUsers: number;
  suspendedSentinelUsers: number;
  fixtureSourceElementsAvailable: boolean;
}>;

function createIdentifierWhere(): Prisma.UserWhereInput {
  return {
    OR: FIXTURES.flatMap(({ id, username, email }) => [{ id }, { username }, { email }]),
  };
}

function createExactFixtureWhere(): Prisma.UserWhereInput {
  return {
    OR: FIXTURES.map((fixture) => ({
      id: fixture.id,
      username: fixture.username,
      email: fixture.email,
      role: "USER",
      emailVerified: true,
      isActive: fixture.isActive,
      deletedAt: fixture.deletedAt,
    })),
  };
}

function datesEqual(left: Date | null, right: Date | null): boolean {
  return left === null ? right === null : right !== null && left.getTime() === right.getTime();
}

function rowMatchesFixture(
  row: StagingAccountDeletionCleanupFixtureUser,
  fixture: StagingAccountDeletionCleanupFixture,
): boolean {
  return (
    row.id === fixture.id &&
    row.username === fixture.username &&
    row.email === fixture.email &&
    row.role === "USER" &&
    row.emailVerified === true &&
    row.isActive === fixture.isActive &&
    datesEqual(row.deletedAt, fixture.deletedAt)
  );
}

function assertRowsAreExactFixtures(rows: StagingAccountDeletionCleanupFixtureUser[]): void {
  const matchedFixtureIds = new Set<string>();

  for (const row of rows) {
    const fixture = FIXTURES.find((candidate) => rowMatchesFixture(row, candidate));
    if (!fixture || matchedFixtureIds.has(fixture.id)) {
      throw new Error(INVALID_FIXTURE_IDENTITY_MESSAGE);
    }
    matchedFixtureIds.add(fixture.id);
  }
}

async function findIdentifierRows(
  client: FixtureTransactionClient,
): Promise<StagingAccountDeletionCleanupFixtureUser[]> {
  return await client.user.findMany({
    where: createIdentifierWhere(),
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      emailVerified: true,
      isActive: true,
      deletedAt: true,
    },
  });
}

export function validateStagingAccountDeletionCleanupFixtureEnvironment(
  environment: StagingAccountDeletionCleanupFixtureEnvironment,
): void {
  try {
    validateStagingDatabaseTarget(environment);
    if (environment.ACCOUNT_DATA_DELETION_STAGING_FIXTURES_ENABLED !== "true") {
      throw new Error(INVALID_ENVIRONMENT_MESSAGE);
    }
  } catch {
    throw new Error(INVALID_ENVIRONMENT_MESSAGE);
  }
}

export async function prepareStagingAccountDeletionCleanupFixtures({
  client,
  createPasswordHash = async () => await hashPassword(randomBytes(24).toString("base64url")),
}: {
  client: StagingAccountDeletionCleanupFixtureClient;
  createPasswordHash?: () => Promise<string>;
}): Promise<{ createdUsers: number; targetOwnedRows: number }> {
  const passwordHash = await createPasswordHash();

  return await client.$transaction(async (transactionClient) => {
    const [identifierRows, elementCount] = await Promise.all([
      findIdentifierRows(transactionClient),
      transactionClient.element.count(),
    ]);
    assertRowsAreExactFixtures(identifierRows);

    if (elementCount < 1) {
      throw new Error(PREPARATION_FAILED_MESSAGE);
    }

    const deleted = await transactionClient.user.deleteMany({ where: createExactFixtureWhere() });
    if (deleted.count !== identifierRows.length) {
      throw new Error(INVALID_FIXTURE_IDENTITY_MESSAGE);
    }
    const created = await transactionClient.user.createMany({
      data: FIXTURES.map((fixture) => ({
        ...fixture,
        passwordHash,
        role: "USER",
        emailVerified: true,
      })),
    });

    if (created.count !== FIXTURES.length) {
      throw new Error(PREPARATION_FAILED_MESSAGE);
    }

    await transactionClient.userStats.create({
      data: {
        userId: STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE.id,
        totalGames: 1,
        totalCorrect: 1,
        totalAnswered: 1,
      },
    });
    await transactionClient.refreshToken.create({
      data: {
        tokenHash: `staging-account-deletion-cleanup-${randomBytes(16).toString("hex")}`,
        userId: STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE.id,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      },
    });

    return { createdUsers: created.count, targetOwnedRows: 2 };
  });
}

async function inspectFixtureState({
  client,
  expectCleaned,
}: {
  client: StagingAccountDeletionCleanupFixtureClient;
  expectCleaned: boolean;
}): Promise<StagingAccountDeletionCleanupFixtureState> {
  const identifierRows = await findIdentifierRows(client);
  assertRowsAreExactFixtures(identifierRows);

  const legacyRows = await client.user.findMany({
    where: { deletedAt: { not: null } },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      emailVerified: true,
      isActive: true,
      deletedAt: true,
    },
  });

  const legacyRowsAreExact = expectCleaned
    ? legacyRows.length === 0
    : legacyRows.length === 0 ||
      (legacyRows.length === 1 &&
        rowMatchesFixture(legacyRows[0]!, STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE));
  if (!legacyRowsAreExact) {
    throw new Error(ISOLATION_FAILED_MESSAGE);
  }

  const activeSentinelUsers = identifierRows.filter((row) =>
    rowMatchesFixture(row, STAGING_ACCOUNT_DELETION_ACTIVE_FIXTURE),
  ).length;
  const suspendedSentinelUsers = identifierRows.filter((row) =>
    rowMatchesFixture(row, STAGING_ACCOUNT_DELETION_SUSPENDED_FIXTURE),
  ).length;
  const legacyFixtureUsers = identifierRows.filter((row) =>
    rowMatchesFixture(row, STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE),
  ).length;

  const [statsCount, refreshTokenCount, elementCount] = await Promise.all([
    client.userStats.count({ where: { userId: STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE.id } }),
    client.refreshToken.count({ where: { userId: STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE.id } }),
    client.element.count(),
  ]);
  const targetOwnedRows = statsCount + refreshTokenCount;

  const validState =
    activeSentinelUsers === 1 &&
    suspendedSentinelUsers === 1 &&
    elementCount > 0 &&
    (expectCleaned
      ? legacyFixtureUsers === 0 && targetOwnedRows === 0
      : (legacyFixtureUsers === 1 && statsCount === 1 && refreshTokenCount === 1) ||
        (legacyFixtureUsers === 0 && targetOwnedRows === 0));
  if (!validState) {
    throw new Error(expectCleaned ? CLEANUP_VERIFICATION_FAILED_MESSAGE : ISOLATION_FAILED_MESSAGE);
  }

  return {
    legacyFixtureUsers,
    targetOwnedRows,
    activeSentinelUsers,
    suspendedSentinelUsers,
    fixtureSourceElementsAvailable: true,
  };
}

export async function verifyStagingAccountDeletionCleanupFixtureIsolation({
  client,
}: {
  client: StagingAccountDeletionCleanupFixtureClient;
}): Promise<StagingAccountDeletionCleanupFixtureState> {
  return await inspectFixtureState({ client, expectCleaned: false });
}

export async function verifyStagingAccountDeletionCleanupFixturesWereCleaned({
  client,
}: {
  client: StagingAccountDeletionCleanupFixtureClient;
}): Promise<StagingAccountDeletionCleanupFixtureState> {
  return await inspectFixtureState({ client, expectCleaned: true });
}

export async function removeStagingAccountDeletionCleanupFixtures({
  client,
}: {
  client: StagingAccountDeletionCleanupFixtureClient;
}): Promise<{ deletedUsers: number }> {
  return await client.$transaction(async (transactionClient) => {
    const identifierRows = await findIdentifierRows(transactionClient);
    assertRowsAreExactFixtures(identifierRows);
    const result = await transactionClient.user.deleteMany({ where: createExactFixtureWhere() });
    if (result.count !== identifierRows.length) {
      throw new Error(INVALID_FIXTURE_IDENTITY_MESSAGE);
    }
    return { deletedUsers: result.count };
  });
}
