import { z } from "zod";

import type { AppPrismaClient } from "../lib/prisma-client.js";
import { validateSupabaseDatabaseTarget } from "../lib/supabase-database-target.js";

import {
  createUnknownProductionInitialStateEvidence,
  type M1CheckStatus,
  type ProductionInitialStateEvidence,
} from "./productionInitialStateEvidence.js";

const LEGACY_USER_WHERE = { deletedAt: { not: null } } as const;
const EXTERNAL_REQUEST_TIMEOUT_MS = 10_000;
const MAX_EXTERNAL_PAGES = 10_000;
const VERCEL_DEPLOYMENTS_ENDPOINT = "https://api.vercel.com/v6/deployments";
const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com";
const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const BACKUP_ARTIFACT_PREFIX = "production-db-backup-";
const PRODUCTION_DATABASE_WORKFLOW_NAME = "Production Database Operations";
const BACKUP_STEP_NAME = "Create and verify encrypted logical backup";
const INVALID_M1_CONFIG_MESSAGE = "production初回状態確認の設定が不正です";

const vercelDeploymentsPageSchema = z.object({
  deployments: z.array(
    z.object({
      target: z.string(),
      meta: z.object({
        githubCommitRepo: z.string().min(1),
      }),
    }),
  ),
  pagination: z.object({
    count: z.number().int().nonnegative(),
    next: z.number().int().nonnegative().nullable().optional(),
  }),
});

const cloudflareScriptsSchema = z.object({
  success: z.literal(true),
  result: z.array(z.object({ id: z.string().min(1) })),
});

const cloudflareDeploymentsSchema = z.object({
  success: z.literal(true),
  result: z.object({
    deployments: z.array(z.object({ id: z.string().uuid() })),
  }),
});

const githubDeploymentsPageSchema = z.array(
  z.object({
    environment: z.string(),
  }),
);

const githubArtifactsPageSchema = z.object({
  total_count: z.number().int().nonnegative(),
  artifacts: z.array(
    z.object({
      name: z.string(),
      expired: z.boolean(),
    }),
  ),
});

const githubRunsPageSchema = z.object({
  total_count: z.number().int().nonnegative(),
  workflow_runs: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
    }),
  ),
});

const githubJobsPageSchema = z.object({
  total_count: z.number().int().nonnegative(),
  jobs: z.array(
    z.object({
      steps: z.array(
        z.object({
          name: z.string(),
          conclusion: z.string().nullable(),
        }),
      ),
    }),
  ),
});

const productionInitialStateConfigSchema = z.object({
  batchEnvironment: z.literal("production"),
  databaseUrl: z.string().min(1),
  productionSupabaseProjectRef: z.string().regex(/^[a-z0-9]+$/),
  githubRepository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  githubToken: z.string().min(1),
  vercelAccessToken: z.string().min(1),
  vercelScopeId: z.string().min(1),
  vercelRepository: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  cloudflareApiToken: z.string().min(1),
  cloudflareAccountId: z.string().min(1),
  cloudflareWorkerName: z.string().min(1),
  reviewedSha: z.string().regex(/^[0-9a-f]{40}$/),
  historyAttestation: z.literal("NO_DELETED_DEPLOYMENT_OR_EXTERNAL_BACKUP_COPY"),
  changeFreezeAttestation: z.literal("NO_CONCURRENT_PRODUCTION_CHANGE"),
});

export type ProductionInitialStateConfig = z.infer<typeof productionInitialStateConfigSchema>;

export type ProductionInitialStateDependencies = Readonly<{
  prisma: AppPrismaClient;
  fetch: typeof globalThis.fetch;
}>;

export type VercelProductionDeploymentConfig = Readonly<{
  accessToken: string;
  scopeId: string;
  repository: string;
}>;

export type CloudflareProductionDeploymentConfig = Readonly<{
  apiToken: string;
  accountId: string;
  workerName: string;
}>;

export type GitHubProductionHistoryConfig = Readonly<{
  repository: string;
  token: string;
}>;

export type GitHubProductionHistoryEvidence = Readonly<{
  githubProductionDeployments: M1CheckStatus;
  productionBackupHistory: M1CheckStatus;
}>;

export function parseProductionInitialStateConfig(input: unknown): ProductionInitialStateConfig {
  const parsed = productionInitialStateConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(INVALID_M1_CONFIG_MESSAGE);
  }
  return parsed.data;
}

export type ProductionDatabaseInitialStateEvidence = Readonly<{
  allUsers: M1CheckStatus;
  legacyUsers: M1CheckStatus;
  userRelatedRows: M1CheckStatus;
  auditLogs: M1CheckStatus;
}>;

const UNKNOWN_DATABASE_EVIDENCE: ProductionDatabaseInitialStateEvidence = {
  allUsers: "unknown",
  legacyUsers: "unknown",
  userRelatedRows: "unknown",
  auditLogs: "unknown",
};

function isDatabaseEvidenceComplete(evidence: ProductionDatabaseInitialStateEvidence): boolean {
  return Object.values(evidence).every((status) => status !== "unknown");
}

function assertValidCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("DB集計結果が不正です");
  }
}

function toPresenceStatus(count: number): M1CheckStatus {
  assertValidCount(count);
  return count === 0 ? "clear" : "present";
}

async function fetchJson(
  fetchImplementation: typeof globalThis.fetch,
  url: URL,
  headers: Readonly<Record<string, string>>,
): Promise<unknown> {
  return (await fetchJsonPage(fetchImplementation, url, headers)).body;
}

async function fetchJsonPage(
  fetchImplementation: typeof globalThis.fetch,
  url: URL,
  headers: Readonly<Record<string, string>>,
): Promise<Readonly<{ body: unknown; hasNextPage: boolean }>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTERNAL_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImplementation(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error("外部read-only APIの確認に失敗しました");
    }
    try {
      const body: unknown = await response.json();
      return {
        body,
        hasNextPage: response.headers.get("link")?.includes('rel="next"') ?? false,
      };
    } catch {
      throw new Error("外部read-only APIの応答形式が不正です");
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAllGitHubPages<T>(
  fetchImplementation: typeof globalThis.fetch,
  createUrl: (page: number) => URL,
  headers: Readonly<Record<string, string>>,
  parsePage: (body: unknown) => Readonly<{ items: T[]; totalCount?: number }>,
): Promise<T[]> {
  const items: T[] = [];
  let expectedTotalCount: number | undefined;

  for (let pageNumber = 1; pageNumber <= MAX_EXTERNAL_PAGES; pageNumber += 1) {
    const page = await fetchJsonPage(fetchImplementation, createUrl(pageNumber), headers);
    const parsedPage = parsePage(page.body);

    if (parsedPage.totalCount !== undefined) {
      if (expectedTotalCount !== undefined && expectedTotalCount !== parsedPage.totalCount) {
        throw new Error("GitHub APIのpagination整合性を確認できませんでした");
      }
      expectedTotalCount = parsedPage.totalCount;
    }
    items.push(...parsedPage.items);

    if (!page.hasNextPage) {
      if (expectedTotalCount !== undefined && items.length !== expectedTotalCount) {
        throw new Error("GitHub APIの全pageを確認できませんでした");
      }
      return items;
    }
  }

  throw new Error("GitHub APIのpagination上限を超えました");
}

export async function inspectProductionDatabaseInitialState(
  prisma: AppPrismaClient,
): Promise<ProductionDatabaseInitialStateEvidence> {
  try {
    return await prisma.$transaction(
      async (transaction) => {
        const [
          allUsers,
          legacyUsers,
          refreshTokens,
          emailVerifications,
          passwordResetTokens,
          weakElements,
          gameSessions,
          gameAnswers,
          gameQuestionSets,
          userStats,
          auditLogs,
        ] = await Promise.all([
          transaction.user.count(),
          transaction.user.count({ where: LEGACY_USER_WHERE }),
          transaction.refreshToken.count(),
          transaction.emailVerification.count(),
          transaction.passwordResetToken.count(),
          transaction.weakElement.count(),
          transaction.gameSession.count(),
          transaction.gameAnswer.count(),
          transaction.gameQuestionSet.count(),
          transaction.userStats.count(),
          transaction.auditLog.count(),
        ]);

        const relatedCounts = [
          refreshTokens,
          emailVerifications,
          passwordResetTokens,
          weakElements,
          gameSessions,
          gameAnswers,
          gameQuestionSets,
          userStats,
        ];
        relatedCounts.forEach(assertValidCount);

        return {
          allUsers: toPresenceStatus(allUsers),
          legacyUsers: toPresenceStatus(legacyUsers),
          userRelatedRows: relatedCounts.some((count) => count > 0) ? "present" : "clear",
          auditLogs: toPresenceStatus(auditLogs),
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  } catch {
    return UNKNOWN_DATABASE_EVIDENCE;
  }
}

export async function inspectVercelProductionDeployments(
  fetchImplementation: typeof globalThis.fetch,
  config: VercelProductionDeploymentConfig,
): Promise<M1CheckStatus> {
  const visitedCursors = new Set<number>();
  let cursor: number | undefined;

  try {
    for (let pageNumber = 1; pageNumber <= MAX_EXTERNAL_PAGES; pageNumber += 1) {
      const url = new URL(VERCEL_DEPLOYMENTS_ENDPOINT);
      url.searchParams.set("teamId", config.scopeId);
      url.searchParams.set("target", "production");
      url.searchParams.set("limit", "100");
      if (cursor !== undefined) {
        url.searchParams.set("until", String(cursor));
      }

      const body = await fetchJson(fetchImplementation, url, {
        accept: "application/json",
        authorization: `Bearer ${config.accessToken}`,
      });
      const page = vercelDeploymentsPageSchema.parse(body);
      if (page.pagination.count !== page.deployments.length) {
        return "unknown";
      }

      for (const deployment of page.deployments) {
        if (
          deployment.target === "production" &&
          deployment.meta.githubCommitRepo === config.repository
        ) {
          return "present";
        }
      }

      const nextCursor = page.pagination.next;
      if (nextCursor === undefined || nextCursor === null) {
        return "clear";
      }
      if (visitedCursors.has(nextCursor)) {
        return "unknown";
      }
      visitedCursors.add(nextCursor);
      cursor = nextCursor;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function inspectCloudflareProductionDeployments(
  fetchImplementation: typeof globalThis.fetch,
  config: CloudflareProductionDeploymentConfig,
): Promise<M1CheckStatus> {
  const accountPath = `/client/v4/accounts/${encodeURIComponent(config.accountId)}`;
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${config.apiToken}`,
  };

  try {
    const scriptsUrl = new URL(`${accountPath}/workers/scripts`, CLOUDFLARE_API_ORIGIN);
    const scriptsBody = await fetchJson(fetchImplementation, scriptsUrl, headers);
    const scripts = cloudflareScriptsSchema.parse(scriptsBody);
    if (!scripts.result.some((script) => script.id === config.workerName)) {
      return "clear";
    }

    const deploymentUrl = new URL(
      `${accountPath}/workers/scripts/${encodeURIComponent(config.workerName)}/deployments`,
      CLOUDFLARE_API_ORIGIN,
    );
    const deploymentsBody = await fetchJson(fetchImplementation, deploymentUrl, headers);
    const deployments = cloudflareDeploymentsSchema.parse(deploymentsBody);
    return deployments.result.deployments.length === 0 ? "clear" : "present";
  } catch {
    return "unknown";
  }
}

function createGitHubRequestContext(config: GitHubProductionHistoryConfig): Readonly<{
  repositoryPath: string;
  headers: Readonly<Record<string, string>>;
}> {
  const repositoryParts = config.repository.split("/");
  if (repositoryParts.length !== 2 || repositoryParts.some((part) => part.length === 0)) {
    throw new Error("GitHub repository設定が不正です");
  }
  const [owner, repository] = repositoryParts;
  return {
    repositoryPath: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${config.token}`,
      "x-github-api-version": GITHUB_API_VERSION,
    },
  };
}

async function inspectGitHubProductionDeployments(
  fetchImplementation: typeof globalThis.fetch,
  repositoryPath: string,
  headers: Readonly<Record<string, string>>,
): Promise<M1CheckStatus> {
  const deployments = await fetchAllGitHubPages(
    fetchImplementation,
    (page) => {
      const url = new URL(`${repositoryPath}/deployments`, GITHUB_API_ORIGIN);
      url.searchParams.set("environment", "production");
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));
      return url;
    },
    headers,
    (body) => ({ items: githubDeploymentsPageSchema.parse(body) }),
  );
  return deployments.some((deployment) => deployment.environment === "production")
    ? "present"
    : "clear";
}

async function inspectGitHubBackupHistory(
  fetchImplementation: typeof globalThis.fetch,
  repositoryPath: string,
  headers: Readonly<Record<string, string>>,
): Promise<M1CheckStatus> {
  const artifacts = await fetchAllGitHubPages(
    fetchImplementation,
    (page) => {
      const url = new URL(`${repositoryPath}/actions/artifacts`, GITHUB_API_ORIGIN);
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));
      return url;
    },
    headers,
    (body) => {
      const parsed = githubArtifactsPageSchema.parse(body);
      return { items: parsed.artifacts, totalCount: parsed.total_count };
    },
  );
  if (artifacts.some((artifact) => artifact.name.startsWith(BACKUP_ARTIFACT_PREFIX))) {
    return "present";
  }

  const workflowRuns = await fetchAllGitHubPages(
    fetchImplementation,
    (page) => {
      const url = new URL(`${repositoryPath}/actions/runs`, GITHUB_API_ORIGIN);
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));
      return url;
    },
    headers,
    (body) => {
      const parsed = githubRunsPageSchema.parse(body);
      return { items: parsed.workflow_runs, totalCount: parsed.total_count };
    },
  );

  for (const workflowRun of workflowRuns) {
    if (workflowRun.name !== PRODUCTION_DATABASE_WORKFLOW_NAME) {
      continue;
    }
    const jobs = await fetchAllGitHubPages(
      fetchImplementation,
      (page) => {
        const url = new URL(
          `${repositoryPath}/actions/runs/${workflowRun.id}/jobs`,
          GITHUB_API_ORIGIN,
        );
        url.searchParams.set("filter", "all");
        url.searchParams.set("per_page", "100");
        url.searchParams.set("page", String(page));
        return url;
      },
      headers,
      (body) => {
        const parsed = githubJobsPageSchema.parse(body);
        return { items: parsed.jobs, totalCount: parsed.total_count };
      },
    );
    if (
      jobs.some((job) =>
        job.steps.some((step) => step.name === BACKUP_STEP_NAME && step.conclusion === "success"),
      )
    ) {
      return "present";
    }
  }

  return "clear";
}

export async function inspectGitHubProductionHistory(
  fetchImplementation: typeof globalThis.fetch,
  config: GitHubProductionHistoryConfig,
): Promise<GitHubProductionHistoryEvidence> {
  let githubProductionDeployments: M1CheckStatus = "unknown";
  let productionBackupHistory: M1CheckStatus = "unknown";

  try {
    const context = createGitHubRequestContext(config);
    try {
      githubProductionDeployments = await inspectGitHubProductionDeployments(
        fetchImplementation,
        context.repositoryPath,
        context.headers,
      );
    } catch {
      githubProductionDeployments = "unknown";
    }
    try {
      productionBackupHistory = await inspectGitHubBackupHistory(
        fetchImplementation,
        context.repositoryPath,
        context.headers,
      );
    } catch {
      productionBackupHistory = "unknown";
    }
  } catch {
    // Invalid repository configuration leaves both checks unknown.
  }

  return {
    githubProductionDeployments,
    productionBackupHistory,
  };
}

export async function inspectProductionInitialState(
  dependencies: ProductionInitialStateDependencies,
  configInput: ProductionInitialStateConfig,
): Promise<ProductionInitialStateEvidence> {
  const parsedConfig = productionInitialStateConfigSchema.safeParse(configInput);
  if (!parsedConfig.success) {
    return createUnknownProductionInitialStateEvidence();
  }
  const config = parsedConfig.data;
  const evidence = createUnknownProductionInitialStateEvidence();

  const vercelProductionDeployments = await inspectVercelProductionDeployments(dependencies.fetch, {
    accessToken: config.vercelAccessToken,
    scopeId: config.vercelScopeId,
    repository: config.vercelRepository,
  });
  const cloudflareProductionDeployments = await inspectCloudflareProductionDeployments(
    dependencies.fetch,
    {
      apiToken: config.cloudflareApiToken,
      accountId: config.cloudflareAccountId,
      workerName: config.cloudflareWorkerName,
    },
  );
  const githubHistory = await inspectGitHubProductionHistory(dependencies.fetch, {
    repository: config.githubRepository,
    token: config.githubToken,
  });

  let databaseTarget: M1CheckStatus;
  let databaseEvidence: ProductionDatabaseInitialStateEvidence = UNKNOWN_DATABASE_EVIDENCE;
  try {
    validateSupabaseDatabaseTarget({
      environmentName: "production",
      batchEnvironment: config.batchEnvironment,
      projectRef: config.productionSupabaseProjectRef,
      databaseUrl: config.databaseUrl,
    });
    databaseEvidence = await inspectProductionDatabaseInitialState(dependencies.prisma);
    databaseTarget = isDatabaseEvidenceComplete(databaseEvidence) ? "clear" : "unknown";
  } catch {
    databaseTarget = "unknown";
  }

  return {
    ...evidence,
    databaseTarget,
    ...databaseEvidence,
    vercelProductionDeployments,
    cloudflareProductionDeployments,
    ...githubHistory,
    deletedHistoryAndExternalCopyAttestation: "clear",
    productionChangeFreezeAttestation: "clear",
  };
}
