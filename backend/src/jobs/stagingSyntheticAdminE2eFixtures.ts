import type { Prisma } from "@prisma/client";

import { normalizePassword } from "../lib/normalize.js";
import { hashPassword } from "../lib/password.js";
import { validateStagingDatabaseTarget } from "../lib/staging-database-target.js";
import { strongPasswordSchema } from "../lib/validation/auth.js";

const INVALID_ENVIRONMENT_MESSAGE = "staging synthetic E2E fixture設定が不正です";
const INVALID_FIXTURE_IDENTITY_MESSAGE = "staging synthetic E2E fixtureの識別に失敗しました";
const PREPARATION_FAILED_MESSAGE = "staging synthetic E2E fixtureの作成に失敗しました";

type StagingSyntheticAdminE2eFixture = Readonly<{
  id: string;
  username: string;
  email: string;
  role: "USER" | "ADMIN";
}>;

export const STAGING_SYNTHETIC_E2E_ADMIN = {
  id: "staging-synthetic-e2e-admin",
  username: "staging_synthetic_e2e_admin",
  email: "staging-synthetic-e2e-admin@example.test",
  role: "ADMIN",
} as const satisfies StagingSyntheticAdminE2eFixture;

export const STAGING_SYNTHETIC_E2E_USER = {
  id: "staging-synthetic-e2e-user",
  username: "staging_synthetic_e2e_user",
  email: "staging-synthetic-e2e-user@example.test",
  role: "USER",
} as const satisfies StagingSyntheticAdminE2eFixture;

const FIXTURES = [STAGING_SYNTHETIC_E2E_ADMIN, STAGING_SYNTHETIC_E2E_USER] as const;

export type StagingSyntheticAdminE2eFixtureEnvironment = Readonly<{
  BATCH_ENVIRONMENT?: string;
  STAGING_SUPABASE_PROJECT_REF?: string;
  DATABASE_URL?: string;
  STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED?: string;
  STAGING_SYNTHETIC_ADMIN_PASSWORD?: string;
  STAGING_SYNTHETIC_USER_PASSWORD?: string;
}>;

export type StagingSyntheticAdminE2eFixtureUser = Readonly<{
  id: string;
  username: string;
  email: string;
  role: "USER" | "ADMIN";
  emailVerified: boolean;
  isActive: boolean;
  deletedAt: Date | null;
}>;

type FixtureTransactionClient = Readonly<{
  user: {
    findMany: (options: Prisma.UserFindManyArgs) => Promise<StagingSyntheticAdminE2eFixtureUser[]>;
    deleteMany: (options: Prisma.UserDeleteManyArgs) => Promise<{ count: number }>;
    createMany: (options: Prisma.UserCreateManyArgs) => Promise<{ count: number }>;
  };
}>;

export type StagingSyntheticAdminE2eFixtureClient = FixtureTransactionClient &
  Readonly<{
    $transaction: <T>(callback: (client: FixtureTransactionClient) => Promise<T>) => Promise<T>;
  }>;

function createIdentifierWhere(): Prisma.UserWhereInput {
  return {
    OR: FIXTURES.flatMap(({ id, username, email }) => [{ id }, { username }, { email }]),
  };
}

function createExactFixtureWhere(): Prisma.UserWhereInput {
  return {
    OR: FIXTURES.map((fixture) => ({
      ...fixture,
      emailVerified: true,
      isActive: true,
      deletedAt: null,
    })),
  };
}

function rowMatchesFixture(
  row: StagingSyntheticAdminE2eFixtureUser,
  fixture: StagingSyntheticAdminE2eFixture,
): boolean {
  return (
    row.id === fixture.id &&
    row.username === fixture.username &&
    row.email === fixture.email &&
    row.role === fixture.role &&
    row.emailVerified === true &&
    row.isActive === true &&
    row.deletedAt === null
  );
}

function assertRowsAreExactFixtures(rows: StagingSyntheticAdminE2eFixtureUser[]): void {
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
): Promise<StagingSyntheticAdminE2eFixtureUser[]> {
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

function validateCredential(value: string | undefined): string {
  const normalizedValue = normalizePassword(value ?? "");
  const result = strongPasswordSchema.safeParse(normalizedValue);
  if (!result.success) {
    throw new Error(INVALID_ENVIRONMENT_MESSAGE);
  }
  return result.data;
}

export function validateStagingSyntheticAdminE2eFixtureEnvironment(
  environment: StagingSyntheticAdminE2eFixtureEnvironment,
  options: { requireCredentials: boolean },
): void {
  try {
    validateStagingDatabaseTarget(environment);
    if (environment.STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED !== "true") {
      throw new Error(INVALID_ENVIRONMENT_MESSAGE);
    }
    if (options.requireCredentials) {
      const adminPassword = validateCredential(environment.STAGING_SYNTHETIC_ADMIN_PASSWORD);
      const userPassword = validateCredential(environment.STAGING_SYNTHETIC_USER_PASSWORD);
      if (adminPassword === userPassword) {
        throw new Error(INVALID_ENVIRONMENT_MESSAGE);
      }
    }
  } catch {
    throw new Error(INVALID_ENVIRONMENT_MESSAGE);
  }
}

export async function prepareStagingSyntheticAdminE2eFixtures({
  client,
  adminPassword,
  userPassword,
  createPasswordHash = hashPassword,
}: {
  client: StagingSyntheticAdminE2eFixtureClient;
  adminPassword: string;
  userPassword: string;
  createPasswordHash?: (password: string) => Promise<string>;
}): Promise<{ createdUsers: number; replacedUsers: number }> {
  const normalizedAdminPassword = validateCredential(adminPassword);
  const normalizedUserPassword = validateCredential(userPassword);
  if (normalizedAdminPassword === normalizedUserPassword) {
    throw new Error(INVALID_ENVIRONMENT_MESSAGE);
  }
  const [adminPasswordHash, userPasswordHash] = await Promise.all([
    createPasswordHash(normalizedAdminPassword),
    createPasswordHash(normalizedUserPassword),
  ]);

  return await client.$transaction(async (transactionClient) => {
    const identifierRows = await findIdentifierRows(transactionClient);
    assertRowsAreExactFixtures(identifierRows);

    const deleted = await transactionClient.user.deleteMany({ where: createExactFixtureWhere() });
    if (deleted.count !== identifierRows.length) {
      throw new Error(INVALID_FIXTURE_IDENTITY_MESSAGE);
    }

    const created = await transactionClient.user.createMany({
      data: [
        {
          ...STAGING_SYNTHETIC_E2E_ADMIN,
          passwordHash: adminPasswordHash,
          emailVerified: true,
          isActive: true,
          deletedAt: null,
        },
        {
          ...STAGING_SYNTHETIC_E2E_USER,
          passwordHash: userPasswordHash,
          emailVerified: true,
          isActive: true,
          deletedAt: null,
        },
      ],
    });
    if (created.count !== FIXTURES.length) {
      throw new Error(PREPARATION_FAILED_MESSAGE);
    }

    return { createdUsers: created.count, replacedUsers: deleted.count };
  });
}

export async function removeStagingSyntheticAdminE2eFixtures({
  client,
}: {
  client: StagingSyntheticAdminE2eFixtureClient;
}): Promise<{ deletedUsers: number }> {
  return await client.$transaction(async (transactionClient) => {
    const identifierRows = await findIdentifierRows(transactionClient);
    assertRowsAreExactFixtures(identifierRows);

    const deleted = await transactionClient.user.deleteMany({ where: createExactFixtureWhere() });
    if (deleted.count !== identifierRows.length) {
      throw new Error(INVALID_FIXTURE_IDENTITY_MESSAGE);
    }
    return { deletedUsers: deleted.count };
  });
}
