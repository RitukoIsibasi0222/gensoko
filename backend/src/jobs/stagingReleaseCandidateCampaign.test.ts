import { describe, expect, it, vi } from "vitest";

import {
  M2CampaignExecutionError,
  runM2StagingReleaseCandidateCampaign,
} from "./stagingReleaseCandidateCampaign.js";
import { M2_STAGING_FIXTURE } from "./stagingReleaseCandidateFixtures.js";
import { StagingRateLimitEvidenceExecutionError } from "./stagingRateLimitEvidence.js";

const API_BASE_URL = "https://gensoko-api-staging.rituko-labs.workers.dev/api/v1";
const FRONTEND_ORIGIN = "https://gensoko-frontend-staging-develop.vercel.app";
const PASSWORD = "M2Synthetic1!password";
const TOKEN = "ab".repeat(32);
const CSP = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const SAFE_HEADERS = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Origin": FRONTEND_ORIGIN,
  "Content-Security-Policy": CSP,
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
  "X-XSS-Protection": "0",
} as const;

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...SAFE_HEADERS, ...headers },
  });
}

function successfulResponses(): Response[] {
  const loginBody = {
    accessToken: "secret-access-token",
    user: { id: "secret-user-id", username: M2_STAGING_FIXTURE.username, role: "USER" },
  };
  const questions = {
    questionSetId: "secret-question-set",
    expiresAt: "2026-07-28T01:00:00.000Z",
    questions: [
      {
        questionId: "secret-question",
        prompt: "H",
        choices: [{ choiceId: "secret-choice", text: "水素" }],
      },
    ],
  };
  const session = {
    sessionId: "secret-session",
    mode: "SYMBOL_TO_NAME_LV1",
    correctCount: 1,
    totalCount: 1,
    totalScore: 100,
    maxStreak: 1,
    durationSec: 1,
    playedAt: "2026-07-28T00:10:00.000Z",
    results: [],
  };
  return [
    response(201, { message: "確認メールを送信しました" }),
    response(200, { message: "メールアドレスを確認しました" }),
    response(400, { error: "無効または期限切れのトークンです" }),
    response(200, loginBody, {
      "Set-Cookie":
        "refreshToken=old-refresh; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth",
    }),
    response(200, loginBody, {
      "Set-Cookie":
        "refreshToken=new-refresh; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth",
    }),
    response(401, { error: "無効なリフレッシュトークンです" }),
    response(200, loginBody, {
      "Set-Cookie":
        "refreshToken=reset-refresh; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth",
    }),
    response(200, questions),
    response(201, session),
    response(200, { sessions: [session], nextCursor: null }),
    response(200, session),
    response(401, { error: "ユーザーが見つかりません" }),
    response(401, { error: "無効なリフレッシュトークンです" }),
    response(401, { error: "メールアドレスまたはパスワードが正しくありません" }),
  ];
}

function options(fetchImpl: typeof fetch) {
  return {
    apiBaseUrl: API_BASE_URL,
    frontendOrigin: FRONTEND_ORIGIN,
    username: M2_STAGING_FIXTURE.username,
    email: M2_STAGING_FIXTURE.email,
    password: PASSWORD,
    verificationToken: TOKEN,
    fetchImpl,
    armVerification: vi.fn().mockResolvedValue({ status: "clear" }),
    runAuthRateLimitEvidence: vi.fn().mockResolvedValue({ retryAfterSec: 2 }),
    runUiPhase: vi.fn().mockResolvedValue({
      keyboard: "clear",
      viewport320: "clear",
      selfDeletion: "clear",
    }),
    wait: vi.fn().mockResolvedValue(undefined),
    now: vi.fn().mockReturnValue(0),
  } as const;
}

describe("M2 staging release candidate campaign", () => {
  it("registerから旧credential拒否までを1 fixtureで順序実行しsafe summaryへ縮約する", async () => {
    const responses = successfulResponses();
    const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift()!);
    const campaignOptions = options(fetchImpl);

    const summary = await runM2StagingReleaseCandidateCampaign(campaignOptions);

    expect(fetchImpl).toHaveBeenCalledTimes(14);
    expect(campaignOptions.armVerification).toHaveBeenCalledWith(TOKEN);
    expect(campaignOptions.runAuthRateLimitEvidence).toHaveBeenCalledWith({
      email: M2_STAGING_FIXTURE.email,
      password: PASSWORD,
    });
    expect(campaignOptions.wait).toHaveBeenNthCalledWith(1, 600_000);
    expect(campaignOptions.wait).toHaveBeenNthCalledWith(2, 3_000);
    expect(Object.values(summary).every((status) => status === "clear")).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("secret-");
    expect(JSON.stringify(summary)).not.toContain(PASSWORD);
    expect(JSON.stringify(summary)).not.toContain(TOKEN);
  });

  it("main Worker 503はpresentへ固定分類して追加requestを止める", async () => {
    const responses = successfulResponses();
    responses[3] = response(
      503,
      { error: "一時的に利用できません。しばらく待ってから再試行してください" },
      { "Retry-After": "60" },
    );
    const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift()!);

    const failure = await runM2StagingReleaseCandidateCampaign(options(fetchImpl)).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(M2CampaignExecutionError);
    expect(failure).toMatchObject({ status: "present", stage: "VALID_LOGIN" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(failure)).not.toContain("一時的に利用できません");
  });

  it("network timeout・non-JSON・schema不一致はunknownへ倒す", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("raw timeout detail"));
    const failure = await runM2StagingReleaseCandidateCampaign(options(fetchImpl)).catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({ status: "unknown", stage: "REGISTRATION" });
    expect(String(failure)).not.toContain("raw timeout detail");
  });

  it("auth rate-limit runnerの通信不能はunknownへ縮約する", async () => {
    const responses = successfulResponses();
    const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift()!);
    const requestFailure = new StagingRateLimitEvidenceExecutionError({
      message: "raw network detail",
      failureStage: "AUTH_ALLOWED_REQUEST",
      failureKind: "REQUEST_FAILED",
      requestNumber: 1,
      observedStatus: null,
      failedContract: null,
      observedResponseClass: null,
      observed503FailedContract: null,
    });

    const failure = await runM2StagingReleaseCandidateCampaign({
      ...options(fetchImpl),
      runAuthRateLimitEvidence: vi.fn().mockRejectedValue(requestFailure),
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ status: "unknown", stage: "AUTH_RATE_LIMIT" });
    expect(String(failure)).not.toContain("raw network detail");
  });

  it("bounded waitが610秒を超えるRetry-Afterを拒否する", async () => {
    const responses = successfulResponses();
    const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift()!);
    const campaignOptions = {
      ...options(fetchImpl),
      runAuthRateLimitEvidence: vi.fn().mockResolvedValue({ retryAfterSec: 611 }),
    };

    await expect(runM2StagingReleaseCandidateCampaign(campaignOptions)).rejects.toMatchObject({
      status: "unknown",
      stage: "AUTH_RESET_WAIT",
    });
  });
});
