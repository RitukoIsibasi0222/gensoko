import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { AppPrismaClient } from "../lib/prisma-client.js";

import { describe, expect, it, vi } from "vitest";

import {
  inspectCloudflareProductionDeployments,
  inspectGitHubProductionHistory,
  inspectProductionInitialState,
  inspectProductionDatabaseInitialState,
  inspectVercelProductionDeployments,
  type ProductionInitialStateConfig,
} from "./inspectProductionInitialState.js";

const INSPECTOR_SOURCE_PATH = fileURLToPath(
  new URL("./inspectProductionInitialState.ts", import.meta.url),
);
const PRISMA_SCHEMA_PATH = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));

type CountKey =
  | "allUsers"
  | "legacyUsers"
  | "refreshTokens"
  | "emailVerifications"
  | "passwordResetTokens"
  | "weakElements"
  | "gameSessions"
  | "gameAnswers"
  | "gameQuestionSets"
  | "userStats"
  | "auditLogs";

function createPrismaMock(overrides: Partial<Record<CountKey, number | Error>> = {}): {
  prisma: AppPrismaClient;
  transaction: Record<string, { count: ReturnType<typeof vi.fn> }>;
  transactionCall: ReturnType<typeof vi.fn>;
} {
  const count = (key: CountKey) =>
    vi.fn(async () => {
      const result = overrides[key] ?? 0;
      if (result instanceof Error) {
        throw result;
      }
      return result;
    });
  const transaction = {
    user: {
      count: vi
        .fn()
        .mockImplementationOnce(count("allUsers"))
        .mockImplementationOnce(count("legacyUsers")),
    },
    refreshToken: { count: count("refreshTokens") },
    emailVerification: { count: count("emailVerifications") },
    passwordResetToken: { count: count("passwordResetTokens") },
    weakElement: { count: count("weakElements") },
    gameSession: { count: count("gameSessions") },
    gameAnswer: { count: count("gameAnswers") },
    gameQuestionSet: { count: count("gameQuestionSets") },
    userStats: { count: count("userStats") },
    auditLog: { count: count("auditLogs") },
  };
  const transactionCall = vi.fn(
    async (
      callback: (tx: typeof transaction) => Promise<unknown>,
      _options: { isolationLevel: string },
    ) => await callback(transaction),
  );

  return {
    prisma: { $transaction: transactionCall } as unknown as AppPrismaClient,
    transaction,
    transactionCall,
  };
}

describe("inspectProductionDatabaseInitialState", () => {
  it("全User・legacy・全関連model・AuditLogを同一snapshotで個別countする", async () => {
    const { prisma, transaction, transactionCall } = createPrismaMock();

    const result = await inspectProductionDatabaseInitialState(prisma);

    expect(result).toEqual({
      allUsers: "clear",
      legacyUsers: "clear",
      userRelatedRows: "clear",
      auditLogs: "clear",
    });
    expect(transactionCall).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
    });
    expect(transaction.user.count).toHaveBeenNthCalledWith(1);
    expect(transaction.user.count).toHaveBeenNthCalledWith(2, {
      where: { deletedAt: { not: null } },
    });
    for (const model of [
      "refreshToken",
      "emailVerification",
      "passwordResetToken",
      "weakElement",
      "gameSession",
      "gameAnswer",
      "gameQuestionSet",
      "userStats",
      "auditLog",
    ] as const) {
      expect(transaction[model].count).toHaveBeenCalledOnce();
    }
    expect(JSON.stringify(result)).not.toContain("count");
  });

  it.each([
    ["allUsers", { allUsers: 1 }, "allUsers"],
    ["legacyUsers", { legacyUsers: 1 }, "legacyUsers"],
    ["userRelatedRows", { gameAnswers: 1 }, "userRelatedRows"],
    ["auditLogs", { auditLogs: 1 }, "auditLogs"],
  ] as const)("%sが1件以上なら件数を出さずpresentにする", async (_label, counts, key) => {
    const { prisma } = createPrismaMock(counts);

    const result = await inspectProductionDatabaseInitialState(prisma);

    expect(result[key]).toBe("present");
    expect(JSON.stringify(result)).not.toMatch(/[0-9]/);
  });

  it("transactionまたはcount失敗はraw errorを返さず全DB statusをunknownにする", async () => {
    const sensitiveError = new Error(
      "postgresql://sensitive-user:sensitive-password@resource-id/private",
    );
    const { prisma } = createPrismaMock({ passwordResetTokens: sensitiveError });

    const result = await inspectProductionDatabaseInitialState(prisma);
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      allUsers: "unknown",
      legacyUsers: "unknown",
      userRelatedRows: "unknown",
      auditLogs: "unknown",
    });
    expect(serialized).not.toContain("sensitive");
    expect(serialized).not.toContain("resource-id");
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const VERCEL_CONFIG = {
  accessToken: "vercel-secret-token",
  scopeId: "approved-scope-id",
  repository: "Gensoko",
};

describe("inspectVercelProductionDeployments", () => {
  it("承認scopeの全cursorをGETで走査し、別repositoryとPreviewだけならclearにする", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          deployments: [
            {
              target: "production",
              meta: { githubCommitRepo: "other-repository" },
            },
          ],
          pagination: { count: 1, next: 12345 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          deployments: [
            {
              target: "preview",
              meta: { githubCommitRepo: "Gensoko" },
            },
          ],
          pagination: { count: 1 },
        }),
      );

    await expect(inspectVercelProductionDeployments(fetch, VERCEL_CONFIG)).resolves.toBe("clear");
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls) {
      const parsedUrl = new URL(String(url));
      expect(parsedUrl.origin + parsedUrl.pathname).toBe("https://api.vercel.com/v6/deployments");
      expect(parsedUrl.searchParams.get("teamId")).toBe(VERCEL_CONFIG.scopeId);
      expect(parsedUrl.searchParams.get("target")).toBe("production");
      expect(init?.method).toBe("GET");
      expect(JSON.stringify(init)).not.toContain(VERCEL_CONFIG.scopeId);
    }
    expect(new URL(String(fetch.mock.calls[1][0])).searchParams.get("until")).toBe("12345");
  });

  it("Gensokoのproduction deploymentが1件でもあればpresentにする", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        deployments: [
          {
            target: "production",
            meta: { githubCommitRepo: "Gensoko" },
          },
        ],
        pagination: { count: 1 },
      }),
    );

    await expect(inspectVercelProductionDeployments(fetch, VERCEL_CONFIG)).resolves.toBe("present");
  });

  it.each([
    ["404", () => new Response(null, { status: 404 })],
    ["429", () => new Response(null, { status: 429 })],
    [
      "schema不一致",
      () => jsonResponse({ deployments: [{ target: "production" }], pagination: { count: 1 } }),
    ],
    ["page count不一致", () => jsonResponse({ deployments: [], pagination: { count: 1 } })],
    ["cursor loop", () => jsonResponse({ deployments: [], pagination: { count: 0, next: 12345 } })],
  ])("%sを履歴なしと推測せずunknownにする", async (_label, responseFactory) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => responseFactory());

    const result = await inspectVercelProductionDeployments(fetch, VERCEL_CONFIG);

    expect(result).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain(VERCEL_CONFIG.accessToken);
  });

  it("timeoutはunknownとし、raw errorを結果へ含めない", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
        async (_input, init) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new Error("vercel-secret-token raw timeout response"));
            });
          }),
      );

      const inspection = inspectVercelProductionDeployments(fetch, VERCEL_CONFIG);
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(inspection).resolves.toBe("unknown");
    } finally {
      vi.useRealTimers();
    }
  });
});

const CLOUDFLARE_CONFIG = {
  apiToken: "cloudflare-secret-token",
  accountId: "approved-account-id",
  workerName: "gensoko-production",
};

describe("inspectCloudflareProductionDeployments", () => {
  it("account全体のscript一覧に期待名がなければclearにする", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        success: true,
        result: [{ id: "other-worker" }],
      }),
    );

    await expect(inspectCloudflareProductionDeployments(fetch, CLOUDFLARE_CONFIG)).resolves.toBe(
      "clear",
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]?.method).toBe("GET");
  });

  it("期待scriptがありdeployment一覧が空ならclearにする", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          result: [{ id: CLOUDFLARE_CONFIG.workerName }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          result: { deployments: [] },
        }),
      );

    await expect(inspectCloudflareProductionDeployments(fetch, CLOUDFLARE_CONFIG)).resolves.toBe(
      "clear",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1][0])).toContain("/deployments");
    expect(fetch.mock.calls[1][1]?.method).toBe("GET");
  });

  it("期待scriptのdeploymentが1件でもあればIDを出さずpresentにする", async () => {
    const deploymentId = "182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e";
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          result: [{ id: CLOUDFLARE_CONFIG.workerName }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          result: { deployments: [{ id: deploymentId }] },
        }),
      );

    const result = await inspectCloudflareProductionDeployments(fetch, CLOUDFLARE_CONFIG);

    expect(result).toBe("present");
    expect(JSON.stringify(result)).not.toContain(deploymentId);
  });

  it.each([
    ["script一覧404", () => new Response(null, { status: 404 })],
    ["script一覧schema不一致", () => jsonResponse({ success: true, result: [{}] })],
  ])("%sを不存在と推測せずunknownにする", async (_label, responseFactory) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(responseFactory());

    await expect(inspectCloudflareProductionDeployments(fetch, CLOUDFLARE_CONFIG)).resolves.toBe(
      "unknown",
    );
  });

  it("個別deployment endpointの404もunknownにする", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          result: [{ id: CLOUDFLARE_CONFIG.workerName }],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(inspectCloudflareProductionDeployments(fetch, CLOUDFLARE_CONFIG)).resolves.toBe(
      "unknown",
    );
  });
});

const GITHUB_CONFIG = {
  repository: "owner/Gensoko",
  token: "github-secret-token",
};

function githubResponse(body: unknown, nextPage?: number): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (nextPage !== undefined) {
    headers.set(
      "link",
      `<https://api.github.com/repositories/1/resource?per_page=100&page=${nextPage}>; rel="next"`,
    );
  }
  return jsonResponse(body, { headers });
}

describe("inspectGitHubProductionHistory", () => {
  it("deployment・Artifact・全run/job pageをGETで完走して履歴なしならclearにする", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      const page = url.searchParams.get("page");

      if (url.pathname.endsWith("/deployments")) {
        return page === "1" ? githubResponse([], 2) : githubResponse([]);
      }
      if (url.pathname.endsWith("/actions/artifacts")) {
        return githubResponse({ total_count: 0, artifacts: [] });
      }
      if (url.pathname.endsWith("/actions/runs")) {
        return githubResponse({
          total_count: 1,
          workflow_runs: [{ id: 101, name: "Production Database Operations" }],
        });
      }
      if (url.pathname.endsWith("/actions/runs/101/jobs")) {
        return githubResponse({
          total_count: 1,
          jobs: [
            {
              steps: [
                {
                  name: "Create and verify encrypted logical backup",
                  conclusion: "skipped",
                },
              ],
            },
          ],
        });
      }
      throw new Error("unexpected fixture URL");
    });

    await expect(inspectGitHubProductionHistory(fetch, GITHUB_CONFIG)).resolves.toEqual({
      githubProductionDeployments: "clear",
      productionBackupHistory: "clear",
    });
    expect(fetch).toHaveBeenCalledTimes(5);
    for (const [, init] of fetch.mock.calls) {
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("x-github-api-version")).toBe("2026-03-10");
    }
  });

  it("production deploymentが1件でもあればpresentにする", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/deployments")) {
        return githubResponse([{ environment: "production" }]);
      }
      if (url.pathname.endsWith("/actions/artifacts")) {
        return githubResponse({ total_count: 0, artifacts: [] });
      }
      if (url.pathname.endsWith("/actions/runs")) {
        return githubResponse({ total_count: 0, workflow_runs: [] });
      }
      throw new Error("unexpected fixture URL");
    });

    const result = await inspectGitHubProductionHistory(fetch, GITHUB_CONFIG);

    expect(result.githubProductionDeployments).toBe("present");
    expect(result.productionBackupHistory).toBe("clear");
  });

  it.each([false, true])(
    "expired=%sでもbackup Artifact metadataがあればpresentにする",
    async (expired) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/deployments")) {
          return githubResponse([]);
        }
        if (url.pathname.endsWith("/actions/artifacts")) {
          return githubResponse({
            total_count: 1,
            artifacts: [{ name: "production-db-backup-123", expired }],
          });
        }
        throw new Error("Artifact検出後にrun履歴へ進んではいけません");
      });

      const result = await inspectGitHubProductionHistory(fetch, GITHUB_CONFIG);

      expect(result.productionBackupHistory).toBe("present");
    },
  );

  it("Artifactがなくても過去runのbackup step成功をpresentにする", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/deployments")) {
        return githubResponse([]);
      }
      if (url.pathname.endsWith("/actions/artifacts")) {
        return githubResponse({ total_count: 0, artifacts: [] });
      }
      if (url.pathname.endsWith("/actions/runs")) {
        return githubResponse({
          total_count: 1,
          workflow_runs: [{ id: 102, name: "Production Database Operations" }],
        });
      }
      if (url.pathname.endsWith("/actions/runs/102/jobs")) {
        return githubResponse({
          total_count: 1,
          jobs: [
            {
              steps: [
                {
                  name: "Create and verify encrypted logical backup",
                  conclusion: "success",
                },
              ],
            },
          ],
        });
      }
      throw new Error("unexpected fixture URL");
    });

    const result = await inspectGitHubProductionHistory(fetch, GITHUB_CONFIG);

    expect(result.productionBackupHistory).toBe("present");
  });

  it("pagination不完了・404・schema不一致をunknownへ倒す", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/deployments")) {
        return githubResponse([]);
      }
      if (url.pathname.endsWith("/actions/artifacts")) {
        return githubResponse({ total_count: 1, artifacts: [] });
      }
      throw new Error("backup確認はpagination不整合で停止する必要があります");
    });

    await expect(inspectGitHubProductionHistory(fetch, GITHUB_CONFIG)).resolves.toEqual({
      githubProductionDeployments: "clear",
      productionBackupHistory: "unknown",
    });
  });
});

const PRODUCTION_CONFIG: ProductionInitialStateConfig = {
  batchEnvironment: "production",
  databaseUrl:
    "postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
  productionSupabaseProjectRef: "abcdefghijklmnopqrst",
  githubRepository: GITHUB_CONFIG.repository,
  githubToken: GITHUB_CONFIG.token,
  vercelAccessToken: VERCEL_CONFIG.accessToken,
  vercelScopeId: VERCEL_CONFIG.scopeId,
  vercelRepository: VERCEL_CONFIG.repository,
  cloudflareApiToken: CLOUDFLARE_CONFIG.apiToken,
  cloudflareAccountId: CLOUDFLARE_CONFIG.accountId,
  cloudflareWorkerName: CLOUDFLARE_CONFIG.workerName,
  reviewedSha: "1234567890abcdef1234567890abcdef12345678",
  historyAttestation: "NO_DELETED_DEPLOYMENT_OR_EXTERNAL_BACKUP_COPY",
  changeFreezeAttestation: "NO_CONCURRENT_PRODUCTION_CHANGE",
};

function createClearProviderFetch(): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.origin === "https://api.vercel.com") {
      return jsonResponse({ deployments: [], pagination: { count: 0 } });
    }
    if (url.origin === "https://api.cloudflare.com") {
      return jsonResponse({ success: true, result: [] });
    }
    if (url.pathname.endsWith("/deployments")) {
      return githubResponse([]);
    }
    if (url.pathname.endsWith("/actions/artifacts")) {
      return githubResponse({ total_count: 0, artifacts: [] });
    }
    if (url.pathname.endsWith("/actions/runs")) {
      return githubResponse({ total_count: 0, workflow_runs: [] });
    }
    throw new Error("unexpected fixture URL");
  });
}

describe("inspectProductionInitialState", () => {
  it("provider履歴を先に確認し、最後にproduction DB snapshotを集計する", async () => {
    const { prisma, transactionCall } = createPrismaMock();
    const fetch = createClearProviderFetch();
    const callOrder: string[] = [];
    fetch.mockImplementation(async (input) => {
      callOrder.push("provider");
      const url = new URL(String(input));
      if (url.origin === "https://api.vercel.com") {
        return jsonResponse({ deployments: [], pagination: { count: 0 } });
      }
      if (url.origin === "https://api.cloudflare.com") {
        return jsonResponse({ success: true, result: [] });
      }
      if (url.pathname.endsWith("/deployments")) {
        return githubResponse([]);
      }
      if (url.pathname.endsWith("/actions/artifacts")) {
        return githubResponse({ total_count: 0, artifacts: [] });
      }
      if (url.pathname.endsWith("/actions/runs")) {
        return githubResponse({ total_count: 0, workflow_runs: [] });
      }
      throw new Error("unexpected fixture URL");
    });
    transactionCall.mockImplementation(async (callback) => {
      callOrder.push("database");
      return await callback(createPrismaMock().transaction);
    });

    const evidence = await inspectProductionInitialState({ prisma, fetch }, PRODUCTION_CONFIG);

    expect(evidence).toEqual({
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
    });
    expect(callOrder.at(-1)).toBe("database");
  });

  it("production DB target不一致ならqueryせずdatabase checkをunknownにする", async () => {
    const { prisma, transactionCall } = createPrismaMock();
    const fetch = createClearProviderFetch();

    const evidence = await inspectProductionInitialState(
      { prisma, fetch },
      {
        ...PRODUCTION_CONFIG,
        databaseUrl:
          "postgresql://postgres.other:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
      },
    );

    expect(evidence.databaseTarget).toBe("unknown");
    expect(evidence.allUsers).toBe("unknown");
    expect(evidence.legacyUsers).toBe("unknown");
    expect(evidence.userRelatedRows).toBe("unknown");
    expect(evidence.auditLogs).toBe("unknown");
    expect(transactionCall).not.toHaveBeenCalled();
  });

  it("attestationまたはconfig不一致は外部確認前に全項目unknownへ倒す", async () => {
    const { prisma, transactionCall } = createPrismaMock();
    const fetch = createClearProviderFetch();

    const evidence = await inspectProductionInitialState({ prisma, fetch }, {
      ...PRODUCTION_CONFIG,
      historyAttestation: "UNCONFIRMED",
    } as unknown as ProductionInitialStateConfig);

    expect(Object.values(evidence).filter((value) => value !== 1)).toEqual(
      expect.arrayContaining(Array(11).fill("unknown")),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(transactionCall).not.toHaveBeenCalled();
  });
});

describe("production initial state inspector source contract", () => {
  const source = readFileSync(INSPECTOR_SOURCE_PATH, "utf8");
  const schema = readFileSync(PRISMA_SCHEMA_PATH, "utf8");

  it("Prismaは対象modelのcountだけを使いraw query・write APIを持たない", () => {
    expect(source).not.toContain("$queryRaw");
    expect(source).not.toContain("$executeRaw");
    expect(source).not.toMatch(
      /transaction\.[A-Za-z]+\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/,
    );

    const expectedModels = [
      "AuditLog",
      "EmailVerification",
      "GameAnswer",
      "GameQuestionSet",
      "GameSession",
      "PasswordResetToken",
      "RefreshToken",
      "User",
      "UserStats",
      "WeakElement",
    ];
    const personalModels = [...schema.matchAll(/model\s+(\w+)\s+\{([\s\S]*?)\n\}/g)]
      .filter(
        ([, modelName, body]) =>
          ["User", "AuditLog", "GameAnswer"].includes(modelName) || /\buser\s+User\b/.test(body),
      )
      .map(([, modelName]) => modelName)
      .sort();

    expect(personalModels).toEqual(expectedModels);
    for (const delegate of [
      "user",
      "auditLog",
      "emailVerification",
      "gameAnswer",
      "gameQuestionSet",
      "gameSession",
      "passwordResetToken",
      "refreshToken",
      "userStats",
      "weakElement",
    ]) {
      expect(source).toContain(`transaction.${delegate}.count(`);
    }
  });

  it("external requestは共通GET境界だけを使いwrite methodを含まない", () => {
    expect(source).toContain('method: "GET"');
    expect(source).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/);
    expect(source).not.toMatch(/\b(fetch|request)\([^\n]+(POST|PUT|PATCH|DELETE)/i);
  });
});
