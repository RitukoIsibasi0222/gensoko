import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { validateStagingDatabaseTarget } from "../lib/staging-database-target.js";
import type { M2EvidenceStatus } from "./stagingReleaseCandidateEvidence.js";

const INVALID_ENVIRONMENT_MESSAGE = "M2 staging fixture設定が不正です";
const PRESENT_MESSAGE = "M2 staging fixtureの予約領域が使用されています";
const UNKNOWN_MESSAGE = "M2 staging fixtureの状態を確認できませんでした";
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export const M2_STAGING_FIXTURE = {
  username: "m2_release_candidate_user",
  email: "m2-release-candidate-user@example.test",
} as const;

export type M2StagingFixtureEnvironment = Readonly<{
  BATCH_ENVIRONMENT?: string;
  STAGING_SUPABASE_PROJECT_REF?: string;
  DATABASE_URL?: string;
  M2_STAGING_FIXTURE_ENABLED?: string;
}>;

type M2FixtureUser = Readonly<{
  id: string;
  username: string;
  email: string;
  role: "USER" | "ADMIN";
  emailVerified: boolean;
  isActive: boolean;
  deletedAt: Date | null;
  passwordResetToken: Readonly<{ id: string }> | null;
  _count: Readonly<{
    refreshTokens: number;
    weakElements: number;
    gameSessions: number;
    gameQuestionSets: number;
    emailVerifications: number;
  }>;
}>;

type CountModel = Readonly<{ count: (args: { where: { userId: string } }) => Promise<number> }>;

type M2StagingFixtureTransactionClient = Readonly<{
  user: {
    findMany: (args: Prisma.UserFindManyArgs) => Promise<M2FixtureUser[]>;
    deleteMany: (args: Prisma.UserDeleteManyArgs) => Promise<{ count: number }>;
  };
  emailVerification: {
    deleteMany: (args: Prisma.EmailVerificationDeleteManyArgs) => Promise<{ count: number }>;
    create: (args: Prisma.EmailVerificationCreateArgs) => Promise<{ id: string }>;
  };
  refreshToken: CountModel;
  passwordResetToken: CountModel;
  weakElement: CountModel;
  gameSession: CountModel;
  gameQuestionSet: CountModel;
  userStats: CountModel;
}>;

export type M2StagingFixtureClient = M2StagingFixtureTransactionClient &
  Readonly<{
    $transaction: <T>(
      callback: (client: M2StagingFixtureTransactionClient) => Promise<T>,
      options: { isolationLevel: "Serializable" },
    ) => Promise<T>;
  }>;

export class M2StagingFixtureError extends Error {
  readonly status: Exclude<M2EvidenceStatus, "clear">;

  constructor(status: Exclude<M2EvidenceStatus, "clear">) {
    super(status === "present" ? PRESENT_MESSAGE : UNKNOWN_MESSAGE);
    this.name = "M2StagingFixtureError";
    this.status = status;
  }
}

function identifierWhere(): Prisma.UserWhereInput {
  return {
    OR: [{ username: M2_STAGING_FIXTURE.username }, { email: M2_STAGING_FIXTURE.email }],
  };
}

async function findIdentifierRows(
  client: M2StagingFixtureTransactionClient,
): Promise<M2FixtureUser[]> {
  return await client.user.findMany({
    where: identifierWhere(),
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      emailVerified: true,
      isActive: true,
      deletedAt: true,
      passwordResetToken: { select: { id: true } },
      _count: {
        select: {
          refreshTokens: true,
          weakElements: true,
          gameSessions: true,
          gameQuestionSets: true,
          emailVerifications: true,
        },
      },
    },
  });
}

function isExactIdentity(user: M2FixtureUser): boolean {
  return (
    user.username === M2_STAGING_FIXTURE.username &&
    user.email === M2_STAGING_FIXTURE.email &&
    user.role === "USER" &&
    user.isActive &&
    user.deletedAt === null
  );
}

function assertArmableUser(rows: M2FixtureUser[]): M2FixtureUser {
  const user = rows[0];
  if (
    rows.length !== 1 ||
    !user ||
    !isExactIdentity(user) ||
    user.emailVerified ||
    user._count.refreshTokens !== 0 ||
    user._count.weakElements !== 0 ||
    user._count.gameSessions !== 0 ||
    user._count.gameQuestionSets !== 0 ||
    user.passwordResetToken !== null ||
    user._count.emailVerifications !== 1
  ) {
    throw new M2StagingFixtureError("present");
  }
  return user;
}

function toSafeFixtureError(error: unknown): M2StagingFixtureError {
  return error instanceof M2StagingFixtureError ? error : new M2StagingFixtureError("unknown");
}

export function validateM2StagingFixtureEnvironment(
  environment: M2StagingFixtureEnvironment,
): void {
  try {
    validateStagingDatabaseTarget(environment);
    if (environment.M2_STAGING_FIXTURE_ENABLED !== "true") {
      throw new Error(INVALID_ENVIRONMENT_MESSAGE);
    }
  } catch {
    throw new Error(INVALID_ENVIRONMENT_MESSAGE);
  }
}

export async function preflightM2StagingFixture({
  client,
}: {
  client: M2StagingFixtureClient;
}): Promise<Readonly<{ status: "clear" }>> {
  try {
    const rows = await findIdentifierRows(client);
    if (rows.length !== 0) {
      throw new M2StagingFixtureError("present");
    }
    return { status: "clear" };
  } catch (error) {
    throw toSafeFixtureError(error);
  }
}

export async function armM2EmailVerification({
  client,
  token,
  expiresAt,
}: {
  client: M2StagingFixtureClient;
  token: string;
  expiresAt: Date;
}): Promise<Readonly<{ status: "clear" }>> {
  if (!TOKEN_PATTERN.test(token) || Number.isNaN(expiresAt.getTime())) {
    throw new M2StagingFixtureError("unknown");
  }
  try {
    return await client.$transaction(
      async (transactionClient) => {
        const user = assertArmableUser(await findIdentifierRows(transactionClient));
        const deleted = await transactionClient.emailVerification.deleteMany({
          where: { userId: user.id },
        });
        if (deleted.count !== 1) {
          throw new M2StagingFixtureError("unknown");
        }
        await transactionClient.emailVerification.create({
          data: {
            userId: user.id,
            tokenHash: createHash("sha256").update(token).digest("hex"),
            expiresAt,
          },
          select: { id: true },
        });
        return { status: "clear" };
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    throw toSafeFixtureError(error);
  }
}

async function countResidue(
  client: M2StagingFixtureTransactionClient,
  userId: string,
): Promise<number> {
  const counts = await Promise.all([
    client.refreshToken.count({ where: { userId } }),
    client.passwordResetToken.count({ where: { userId } }),
    client.weakElement.count({ where: { userId } }),
    client.gameSession.count({ where: { userId } }),
    client.gameQuestionSet.count({ where: { userId } }),
    client.userStats.count({ where: { userId } }),
  ]);
  return counts.reduce((total, count) => total + count, 0);
}

export async function removeM2StagingFixture({
  client,
}: {
  client: M2StagingFixtureClient;
}): Promise<Readonly<{ status: "clear"; deletedUsers: 0 | 1 }>> {
  try {
    return await client.$transaction(
      async (transactionClient) => {
        const rows = await findIdentifierRows(transactionClient);
        if (rows.length === 0) {
          return { status: "clear", deletedUsers: 0 };
        }
        const user = rows[0];
        if (rows.length !== 1 || !user || !isExactIdentity(user)) {
          throw new M2StagingFixtureError("present");
        }
        const deleted = await transactionClient.user.deleteMany({
          where: { id: user.id, ...M2_STAGING_FIXTURE, role: "USER", deletedAt: null },
        });
        if (deleted.count !== 1 || (await countResidue(transactionClient, user.id)) !== 0) {
          throw new M2StagingFixtureError("unknown");
        }
        return { status: "clear", deletedUsers: 1 };
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    throw toSafeFixtureError(error);
  }
}
