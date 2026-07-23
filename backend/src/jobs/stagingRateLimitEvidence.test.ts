import { describe, expect, it, vi } from "vitest";

import {
  runStagingRateLimitEvidence,
  validateStagingRateLimitEvidenceEnvironment,
  type StagingRateLimitEvidenceCase,
} from "./stagingRateLimitEvidence.js";

const API_BASE_URL = "https://gensoko-api-staging.rituko-labs.workers.dev/api/v1";
const FRONTEND_ORIGIN = "https://gensoko-frontend-staging-develop.vercel.app";
const USER_PASSWORD = "SyntheticUser1!password";
const RATE_LIMIT_MESSAGE = "リクエストが多すぎます。しばらく待ってから再試行してください";
const CSP = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

const VALID_ENVIRONMENT = {
  BATCH_ENVIRONMENT: "staging",
  STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED: "true",
  STAGING_RATE_LIMIT_EVIDENCE_CASE: "auth",
  STAGING_RATE_LIMIT_API_BASE_URL: API_BASE_URL,
  STAGING_RATE_LIMIT_FRONTEND_ORIGIN: FRONTEND_ORIGIN,
  STAGING_SYNTHETIC_USER_PASSWORD: USER_PASSWORD,
} as const;

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function rateLimitedResponse(overrides: Record<string, string> = {}) {
  return jsonResponse(
    429,
    { error: RATE_LIMIT_MESSAGE },
    {
      "Access-Control-Allow-Origin": FRONTEND_ORIGIN,
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Retry-After": "42",
      ...overrides,
    },
  );
}

function loginResponse() {
  return jsonResponse(200, {
    accessToken: "secret-access-token",
    user: { id: "secret-user-id", username: "synthetic", role: "USER" },
  });
}

function questionsResponse(sequence: number) {
  return jsonResponse(200, {
    questionSetId: `secret-question-set-${sequence}`,
    expiresAt: "2026-07-23T12:00:00.000Z",
    questions: [
      {
        questionId: `secret-question-${sequence}`,
        prompt: "H",
        choices: [{ choiceId: "1", text: "水素" }],
      },
    ],
  });
}

describe("staging rate limit evidence", () => {
  it("staging・固定URL・既存fixture flag・case・credentialをすべて要求する", () => {
    expect(validateStagingRateLimitEvidenceEnvironment(VALID_ENVIRONMENT)).toEqual({
      apiBaseUrl: API_BASE_URL,
      frontendOrigin: FRONTEND_ORIGIN,
      evidenceCase: "auth",
      userPassword: USER_PASSWORD,
    });

    for (const invalidEnvironment of [
      { ...VALID_ENVIRONMENT, BATCH_ENVIRONMENT: "production" },
      { ...VALID_ENVIRONMENT, STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED: "false" },
      { ...VALID_ENVIRONMENT, STAGING_RATE_LIMIT_EVIDENCE_CASE: "unknown" },
      { ...VALID_ENVIRONMENT, STAGING_RATE_LIMIT_API_BASE_URL: "https://api.example.test" },
      { ...VALID_ENVIRONMENT, STAGING_RATE_LIMIT_FRONTEND_ORIGIN: "https://example.test" },
      { ...VALID_ENVIRONMENT, STAGING_SYNTHETIC_USER_PASSWORD: "" },
    ]) {
      expect(() => validateStagingRateLimitEvidenceEnvironment(invalidEnvironment)).toThrow(
        "staging rate limit evidence設定が不正です",
      );
    }
  });

  it("authは正しいloginを10回許可し、11回目の429契約だけを安全なsummaryへ残す", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => loginResponse())
      .mockImplementationOnce(async () => loginResponse())
      .mockImplementationOnce(async () => loginResponse())
      .mockImplementationOnce(async () => loginResponse())
      .mockImplementationOnce(async () => loginResponse())
      .mockImplementationOnce(async () => loginResponse())
      .mockImplementationOnce(async () => loginResponse())
      .mockImplementationOnce(async () => loginResponse())
      .mockImplementationOnce(async () => loginResponse())
      .mockImplementationOnce(async () => loginResponse())
      .mockImplementationOnce(async () => rateLimitedResponse());

    const result = await runStagingRateLimitEvidence({
      apiBaseUrl: API_BASE_URL,
      frontendOrigin: FRONTEND_ORIGIN,
      evidenceCase: "auth",
      userPassword: USER_PASSWORD,
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(11);
    expect(fetchMock.mock.calls.every(([url]) => url === `${API_BASE_URL}/auth/login`)).toBe(true);
    expect(result).toEqual({
      evidenceCase: "auth",
      allowedRequests: 10,
      limitedRequestNumber: 11,
      limitedStatus: 429,
      retryAfterSec: 42,
      bodyContract: true,
      corsContract: true,
      securityHeadersContract: true,
    });
    expect(JSON.stringify(result)).not.toContain("secret-");
    expect(JSON.stringify(result)).not.toContain(USER_PASSWORD);
  });

  it("questionsはlogin後に30回許可し、31回目を429として確認する", async () => {
    let questionCalls = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return loginResponse();
      }
      questionCalls += 1;
      return questionCalls <= 30 ? questionsResponse(questionCalls) : rateLimitedResponse();
    });

    const result = await runStagingRateLimitEvidence({
      apiBaseUrl: API_BASE_URL,
      frontendOrigin: FRONTEND_ORIGIN,
      evidenceCase: "questions",
      userPassword: USER_PASSWORD,
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(32);
    expect(result.allowedRequests).toBe(30);
    expect(result.limitedRequestNumber).toBe(31);
  });

  it("game-submitは20組の新規question setを送信し、21回目のsubmitを429として確認する", async () => {
    let questionCalls = 0;
    let submitCalls = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        return loginResponse();
      }
      if (url.includes("/game/questions?")) {
        questionCalls += 1;
        return questionsResponse(questionCalls);
      }
      submitCalls += 1;
      if (submitCalls <= 20) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.questionSetId).toBe(`secret-question-set-${submitCalls}`);
        return jsonResponse(201, { sessionId: `secret-session-${submitCalls}` });
      }
      return rateLimitedResponse();
    });

    const result = await runStagingRateLimitEvidence({
      apiBaseUrl: API_BASE_URL,
      frontendOrigin: FRONTEND_ORIGIN,
      evidenceCase: "game-submit",
      userPassword: USER_PASSWORD,
      fetchImpl: fetchMock,
    });

    expect(questionCalls).toBe(21);
    expect(submitCalls).toBe(21);
    expect(fetchMock).toHaveBeenCalledTimes(43);
    expect(result.allowedRequests).toBe(20);
    expect(result.limitedRequestNumber).toBe(21);
  });

  it.each([
    ["Retry-Afterなし", { "Retry-After": "" }],
    ["CORS不一致", { "Access-Control-Allow-Origin": "https://example.test" }],
    ["CSP不一致", { "Content-Security-Policy": "default-src *" }],
  ])("429の%sを契約違反として固定文言で停止する", async (_name, headers) => {
    const evidenceCase: StagingRateLimitEvidenceCase = "auth";
    let callCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      callCount += 1;
      return callCount <= 10 ? loginResponse() : rateLimitedResponse(headers);
    });

    await expect(
      runStagingRateLimitEvidence({
        apiBaseUrl: API_BASE_URL,
        frontendOrigin: FRONTEND_ORIGIN,
        evidenceCase,
        userPassword: USER_PASSWORD,
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow("staging rate limit evidenceの429契約が不正です");
  });

  it("閾値より前の異常応答を本文非出力の固定文言で停止する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(500, { error: "secret-response-body" }),
    );

    await expect(
      runStagingRateLimitEvidence({
        apiBaseUrl: API_BASE_URL,
        frontendOrigin: FRONTEND_ORIGIN,
        evidenceCase: "auth",
        userPassword: USER_PASSWORD,
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow("staging rate limit evidenceの前提応答が不正です");
  });
});
