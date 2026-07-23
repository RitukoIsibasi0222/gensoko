import { describe, expect, it, vi } from "vitest";

import {
  SERVICE_UNAVAILABLE_MESSAGE,
  SERVICE_UNAVAILABLE_RETRY_AFTER_SEC,
} from "../lib/http-error-messages.js";
import {
  runStagingRateLimitEvidence,
  StagingRateLimitEvidenceExecutionError,
  validateStagingRateLimitEvidenceEnvironment,
  type StagingRateLimitEvidenceCase,
} from "./stagingRateLimitEvidence.js";

const API_BASE_URL = "https://gensoko-api-staging.rituko-labs.workers.dev/api/v1";
const FRONTEND_ORIGIN = "https://gensoko-frontend-staging-develop.vercel.app";
const USER_PASSWORD = "SyntheticUser1!password";
const RATE_LIMIT_MESSAGE = "リクエストが多すぎます。しばらく待ってから再試行してください";
const CSP = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const REQUEST_TIMEOUT_MS = 10_000;
const SAFE_RESPONSE_HEADERS = {
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
const RATE_LIMIT_HEADERS = {
  ...SAFE_RESPONSE_HEADERS,
  "Retry-After": "42",
} as const;
const SERVICE_UNAVAILABLE_HEADERS = {
  ...SAFE_RESPONSE_HEADERS,
  "Retry-After": String(SERVICE_UNAVAILABLE_RETRY_AFTER_SEC),
} as const;

const VALID_ENVIRONMENT = {
  BATCH_ENVIRONMENT: "staging",
  STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED: "true",
  STAGING_RATE_LIMIT_EVIDENCE_CASE: "auth",
  STAGING_RATE_LIMIT_API_BASE_URL: API_BASE_URL,
  STAGING_RATE_LIMIT_FRONTEND_ORIGIN: FRONTEND_ORIGIN,
  STAGING_RATE_LIMIT_REQUEST_TIMEOUT_MS: String(REQUEST_TIMEOUT_MS),
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
      ...RATE_LIMIT_HEADERS,
      ...overrides,
    },
  );
}

function serviceUnavailableResponse(
  body: unknown = { error: SERVICE_UNAVAILABLE_MESSAGE },
  overrides: Record<string, string> = {},
) {
  return jsonResponse(503, body, {
    ...SERVICE_UNAVAILABLE_HEADERS,
    ...overrides,
  });
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

function sessionResponse(sequence: number) {
  return jsonResponse(201, {
    sessionId: `secret-session-${sequence}`,
    mode: "SYMBOL_TO_NAME_LV1",
    correctCount: 1,
    totalCount: 1,
    totalScore: 100,
    maxStreak: 1,
    durationSec: 1,
    playedAt: "2026-07-23T12:00:00.000Z",
    results: [
      {
        questionId: `secret-question-${sequence}`,
        elementId: 1,
        prompt: "H",
        chosenChoiceId: "1",
        isCorrect: true,
        correctAnswer: "水素",
        yourAnswer: "水素",
        answerTimeSec: 0,
        score: 100,
      },
    ],
  });
}

async function captureAuthFailure(response: Response, allowedRequestsBeforeFailure = 4) {
  let callCount = 0;
  const fetchMock = vi.fn<typeof fetch>(async () => {
    callCount += 1;
    return callCount <= allowedRequestsBeforeFailure ? loginResponse() : response;
  });
  let failure: unknown;

  try {
    await runStagingRateLimitEvidence({
      apiBaseUrl: API_BASE_URL,
      frontendOrigin: FRONTEND_ORIGIN,
      evidenceCase: "auth",
      userPassword: USER_PASSWORD,
      fetchImpl: fetchMock,
    });
  } catch (error) {
    failure = error;
  }

  return { failure, fetchMock };
}

describe("staging rate limit evidence", () => {
  it("staging・固定URL・既存fixture flag・case・credentialをすべて要求する", () => {
    expect(validateStagingRateLimitEvidenceEnvironment(VALID_ENVIRONMENT)).toEqual({
      apiBaseUrl: API_BASE_URL,
      frontendOrigin: FRONTEND_ORIGIN,
      evidenceCase: "auth",
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      userPassword: USER_PASSWORD,
    });

    for (const invalidEnvironment of [
      { ...VALID_ENVIRONMENT, BATCH_ENVIRONMENT: "production" },
      { ...VALID_ENVIRONMENT, STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED: "false" },
      { ...VALID_ENVIRONMENT, STAGING_RATE_LIMIT_EVIDENCE_CASE: "unknown" },
      { ...VALID_ENVIRONMENT, STAGING_RATE_LIMIT_API_BASE_URL: "https://api.example.test" },
      { ...VALID_ENVIRONMENT, STAGING_RATE_LIMIT_FRONTEND_ORIGIN: "https://example.test" },
      { ...VALID_ENVIRONMENT, STAGING_RATE_LIMIT_REQUEST_TIMEOUT_MS: "9999" },
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
      policyId: "AUTH_IP",
      retryAfterSec: 42,
      bodyContract: true,
      corsContract: true,
      securityHeadersContract: true,
    });
    expect(JSON.stringify(result)).not.toContain("secret-");
    expect(JSON.stringify(result)).not.toContain(USER_PASSWORD);
    expect(fetchMock.mock.calls.every(([, init]) => init?.redirect === "error")).toBe(true);
    expect(fetchMock.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(
      true,
    );
  });

  it("authは1〜4回目成功後の完全な503契約をrequest 5の固定classへ分類する", async () => {
    const { failure, fetchMock } = await captureAuthFailure(serviceUnavailableResponse());

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(failure).toBeInstanceOf(StagingRateLimitEvidenceExecutionError);
    expect(failure).toMatchObject({
      message: "staging rate limit evidenceの前提応答が不正です",
      failureStage: "AUTH_ALLOWED_REQUEST",
      failureKind: "RESPONSE_CONTRACT_FAILED",
      requestNumber: 5,
      observedStatus: 503,
      failedContract: "EXPECTED_STATUS",
      observedResponseClass: "SAFE_JSON_503_CONTRACT",
    });
    expect(JSON.stringify(failure)).not.toContain(SERVICE_UNAVAILABLE_MESSAGE);
  });

  it.each([
    [
      "非JSON Content-Type",
      () =>
        new Response("secret-html-body", {
          status: 503,
          headers: { ...SERVICE_UNAVAILABLE_HEADERS, "Content-Type": "text/html" },
        }),
    ],
    [
      "JSON parse失敗",
      () =>
        new Response("{secret-invalid-json", {
          status: 503,
          headers: { ...SERVICE_UNAVAILABLE_HEADERS, "Content-Type": "application/json" },
        }),
    ],
    [
      "error以外のfieldを含むbody",
      () => serviceUnavailableResponse({ error: SERVICE_UNAVAILABLE_MESSAGE, detail: "secret" }),
    ],
    ["日本語error message不一致", () => serviceUnavailableResponse({ error: "別のメッセージ" })],
    [
      "Retry-After欠損",
      () => jsonResponse(503, { error: SERVICE_UNAVAILABLE_MESSAGE }, { ...SAFE_RESPONSE_HEADERS }),
    ],
    ["Retry-After不正", () => serviceUnavailableResponse(undefined, { "Retry-After": "NaN" })],
    [
      "Retry-After期待値不一致",
      () => serviceUnavailableResponse(undefined, { "Retry-After": "61" }),
    ],
    [
      "CORS不一致",
      () =>
        serviceUnavailableResponse(undefined, {
          "Access-Control-Allow-Origin": "https://example.test",
        }),
    ],
    [
      "production security header不一致",
      () => serviceUnavailableResponse(undefined, { "Strict-Transport-Security": "" }),
    ],
    ["X-Powered-By露出", () => serviceUnavailableResponse(undefined, { "X-Powered-By": "Hono" })],
  ] as const)("auth 5回目503の%sを固定された未分類503として扱う", async (_name, createResponse) => {
    const { failure } = await captureAuthFailure(createResponse());

    expect(failure).toMatchObject({
      failureStage: "AUTH_ALLOWED_REQUEST",
      failureKind: "RESPONSE_CONTRACT_FAILED",
      requestNumber: 5,
      observedStatus: 503,
      failedContract: "EXPECTED_STATUS",
      observedResponseClass: "EDGE_OR_UNCLASSIFIED_503",
    });
    const serializedFailure = JSON.stringify(failure);
    expect(serializedFailure).not.toContain("secret");
    expect(serializedFailure).not.toContain(SERVICE_UNAVAILABLE_MESSAGE);
  });

  it.each([500, 502, 504] as const)(
    "auth 5回目のstatus %iを503と混同しない固定classへ分類する",
    async (status) => {
      const { failure } = await captureAuthFailure(
        jsonResponse(status, { error: "secret-response-body" }),
      );

      expect(failure).toMatchObject({
        failureStage: "AUTH_ALLOWED_REQUEST",
        requestNumber: 5,
        observedStatus: status,
        failedContract: "EXPECTED_STATUS",
        observedResponseClass: "OTHER_UNEXPECTED_STATUS",
      });
      expect(JSON.stringify(failure)).not.toContain("secret-response-body");
    },
  );

  it("auth 5回目503のheader getter例外とbody cancel拒否をraw値なしで固定分類する", async () => {
    const response = new Response("secret-response-body", { status: 503 });
    const cancelSpy = vi
      .spyOn(response.body!, "cancel")
      .mockRejectedValue(new Error("cancel-internal-secret"));
    Object.defineProperty(response, "headers", {
      value: {
        get: vi.fn(() => {
          throw new Error("header-internal-secret");
        }),
      },
    });

    const { failure } = await captureAuthFailure(response);

    expect(cancelSpy).toHaveBeenCalledOnce();
    expect(failure).toMatchObject({
      requestNumber: 5,
      observedStatus: 503,
      failedContract: "EXPECTED_STATUS",
      observedResponseClass: "EDGE_OR_UNCLASSIFIED_503",
    });
    const serializedFailure = JSON.stringify(failure);
    expect(serializedFailure).not.toContain("header-internal-secret");
    expect(serializedFailure).not.toContain("cancel-internal-secret");
    expect(serializedFailure).not.toContain("secret-response-body");
  });

  it("auth 11回目503をlimited段階とRATE_LIMIT_STATUSを保って固定分類する", async () => {
    const { failure, fetchMock } = await captureAuthFailure(serviceUnavailableResponse(), 10);

    expect(fetchMock).toHaveBeenCalledTimes(11);
    expect(failure).toMatchObject({
      failureStage: "AUTH_LIMITED_REQUEST",
      failureKind: "RESPONSE_CONTRACT_FAILED",
      requestNumber: 11,
      observedStatus: 503,
      failedContract: "RATE_LIMIT_STATUS",
      observedResponseClass: "SAFE_JSON_503_CONTRACT",
    });
    expect(JSON.stringify(failure)).not.toContain(SERVICE_UNAVAILABLE_MESSAGE);
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
        return sessionResponse(submitCalls);
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
    expect(result.policyId).toBe("GAME_SUBMIT_IP");
  });

  it.each([
    ["Retry-Afterなし", { "Retry-After": "" }],
    ["CORS不一致", { "Access-Control-Allow-Origin": "https://example.test" }],
    ["CORS credentialsなし", { "Access-Control-Allow-Credentials": "" }],
    ["CSP不一致", { "Content-Security-Policy": "default-src *" }],
    ["HSTS不一致", { "Strict-Transport-Security": "" }],
    ["Referrer-Policy不一致", { "Referrer-Policy": "" }],
    ["Permissions-Policy不一致", { "Permissions-Policy": "" }],
    ["Cross-Origin-Resource-Policy不一致", { "Cross-Origin-Resource-Policy": "" }],
    ["X-Permitted-Cross-Domain-Policies不一致", { "X-Permitted-Cross-Domain-Policies": "" }],
    ["X-XSS-Protection不一致", { "X-XSS-Protection": "" }],
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

    let failure: unknown;
    try {
      await runStagingRateLimitEvidence({
        apiBaseUrl: API_BASE_URL,
        frontendOrigin: FRONTEND_ORIGIN,
        evidenceCase: "auth",
        userPassword: USER_PASSWORD,
        fetchImpl: fetchMock,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(StagingRateLimitEvidenceExecutionError);
    expect(failure).toMatchObject({
      message: "staging rate limit evidenceの前提応答が不正です",
      failureStage: "AUTH_ALLOWED_REQUEST",
      failureKind: "RESPONSE_CONTRACT_FAILED",
      requestNumber: 1,
      observedStatus: 500,
      failedContract: "EXPECTED_STATUS",
    });
    expect(JSON.stringify(failure)).not.toContain("secret-response-body");
  });

  it("auth validatorの予期しない失敗でも未消費response bodyをcancelする", async () => {
    const response = new Response("secret-response-body", { status: 200 });
    const cancelSpy = vi
      .spyOn(response.body!, "cancel")
      .mockRejectedValue(new Error("cancel-internal-secret"));
    Object.defineProperty(response, "headers", {
      value: {
        get: vi.fn(() => {
          throw new Error("validator-internal-secret");
        }),
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);

    let failure: unknown;
    try {
      await runStagingRateLimitEvidence({
        apiBaseUrl: API_BASE_URL,
        frontendOrigin: FRONTEND_ORIGIN,
        evidenceCase: "auth",
        userPassword: USER_PASSWORD,
        fetchImpl: fetchMock,
      });
    } catch (error) {
      failure = error;
    }

    expect(cancelSpy).toHaveBeenCalledOnce();
    expect(failure).toMatchObject({
      message: "staging rate limit evidenceの前提応答が不正です",
      failureStage: "AUTH_ALLOWED_REQUEST",
      failureKind: "RESPONSE_CONTRACT_FAILED",
      requestNumber: 1,
      observedStatus: 200,
      failedContract: null,
    });
    expect(JSON.stringify(failure)).not.toContain("validator-internal-secret");
    expect(JSON.stringify(failure)).not.toContain("cancel-internal-secret");
  });

  it.each([
    ["status", () => jsonResponse(500, { error: "safe-test-error" }), "EXPECTED_STATUS", 500],
    [
      "Content-Type",
      () => new Response("safe-test-body", { status: 200 }),
      "EXPECTED_CONTENT_TYPE",
      200,
    ],
  ] as const)(
    "auth許可requestの%s契約はbody cancel拒否でも分類を維持する",
    async (_name, createResponse, failedContract, observedStatus) => {
      const response = createResponse();
      const cancelSpy = vi
        .spyOn(response.body!, "cancel")
        .mockRejectedValue(new Error("cancel-internal-secret"));
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);

      await expect(
        runStagingRateLimitEvidence({
          apiBaseUrl: API_BASE_URL,
          frontendOrigin: FRONTEND_ORIGIN,
          evidenceCase: "auth",
          userPassword: USER_PASSWORD,
          fetchImpl: fetchMock,
        }),
      ).rejects.toMatchObject({
        failureStage: "AUTH_ALLOWED_REQUEST",
        requestNumber: 1,
        observedStatus,
        failedContract,
      });
      expect(cancelSpy).toHaveBeenCalled();
    },
  );

  it.each([
    [
      "status",
      () => jsonResponse(500, { error: "safe-test-error" }, RATE_LIMIT_HEADERS),
      "RATE_LIMIT_STATUS",
      500,
    ],
    [
      "Content-Type",
      () => new Response("safe-test-body", { status: 429, headers: RATE_LIMIT_HEADERS }),
      "RATE_LIMIT_CONTENT_TYPE",
      429,
    ],
  ] as const)(
    "auth制限requestの%s契約はbody cancel拒否でも分類を維持する",
    async (_name, createResponse, failedContract, observedStatus) => {
      let requestNumber = 0;
      const response = createResponse();
      const cancelSpy = vi
        .spyOn(response.body!, "cancel")
        .mockRejectedValue(new Error("cancel-internal-secret"));
      const fetchMock = vi.fn<typeof fetch>(async () => {
        requestNumber += 1;
        return requestNumber <= 10 ? loginResponse() : response;
      });

      await expect(
        runStagingRateLimitEvidence({
          apiBaseUrl: API_BASE_URL,
          frontendOrigin: FRONTEND_ORIGIN,
          evidenceCase: "auth",
          userPassword: USER_PASSWORD,
          fetchImpl: fetchMock,
        }),
      ).rejects.toMatchObject({
        failureStage: "AUTH_LIMITED_REQUEST",
        requestNumber: 11,
        observedStatus,
        failedContract,
      });
      expect(cancelSpy).toHaveBeenCalled();
    },
  );

  it("auth request失敗はraw例外を保持せずrequest番号とstatusなしだけを残す", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("token=secret network=https://private.invalid"));

    let failure: unknown;
    try {
      await runStagingRateLimitEvidence({
        apiBaseUrl: API_BASE_URL,
        frontendOrigin: FRONTEND_ORIGIN,
        evidenceCase: "auth",
        userPassword: USER_PASSWORD,
        fetchImpl: fetchMock,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(StagingRateLimitEvidenceExecutionError);
    expect(failure).toMatchObject({
      message: "staging rate limit evidenceの実行に失敗しました",
      failureStage: "AUTH_ALLOWED_REQUEST",
      failureKind: "REQUEST_FAILED",
      requestNumber: 1,
      observedStatus: null,
      failedContract: null,
      observedResponseClass: null,
    });
    const serializedFailure = JSON.stringify(failure);
    expect(serializedFailure).not.toContain("secret");
    expect(serializedFailure).not.toContain("private.invalid");
  });

  it("auth 11回目の契約違反はlimited段階・request番号・statusだけを残す", async () => {
    let callCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      callCount += 1;
      return callCount <= 10
        ? loginResponse()
        : rateLimitedResponse({ "Strict-Transport-Security": "" });
    });

    let failure: unknown;
    try {
      await runStagingRateLimitEvidence({
        apiBaseUrl: API_BASE_URL,
        frontendOrigin: FRONTEND_ORIGIN,
        evidenceCase: "auth",
        userPassword: USER_PASSWORD,
        fetchImpl: fetchMock,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(StagingRateLimitEvidenceExecutionError);
    expect(failure).toMatchObject({
      message: "staging rate limit evidenceの429契約が不正です",
      failureStage: "AUTH_LIMITED_REQUEST",
      failureKind: "RESPONSE_CONTRACT_FAILED",
      requestNumber: 11,
      observedStatus: 429,
      failedContract: "STRICT_TRANSPORT_SECURITY",
      observedResponseClass: null,
    });
  });

  it("redirectを追跡せず、全requestを固定timeout signal付きで送る", async () => {
    let callCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      callCount += 1;
      return callCount <= 10 ? loginResponse() : rateLimitedResponse();
    });

    await expect(
      runStagingRateLimitEvidence({
        apiBaseUrl: API_BASE_URL,
        frontendOrigin: FRONTEND_ORIGIN,
        evidenceCase: "auth",
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        userPassword: USER_PASSWORD,
        fetchImpl: fetchMock,
      }),
    ).resolves.toEqual(expect.objectContaining({ policyId: "AUTH_IP" }));
  });

  it("request timeoutで停止し、後続requestを送らない", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      return await new Promise<Response>((_resolve, reject) => {
        if (!init?.signal) {
          reject(new Error("timeout signalがありません"));
          return;
        }
        init.signal.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });

    await expect(
      runStagingRateLimitEvidence({
        apiBaseUrl: API_BASE_URL,
        frontendOrigin: FRONTEND_ORIGIN,
        evidenceCase: "auth",
        requestTimeoutMs: 1,
        userPassword: USER_PASSWORD,
        fetchImpl: fetchMock,
      }),
    ).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["空access token", { accessToken: "", user: { id: "user-1", username: "user", role: "USER" } }],
    ["user欠落", { accessToken: "secret-access-token" }],
    [
      "空user ID",
      { accessToken: "secret-access-token", user: { id: "", username: "user", role: "USER" } },
    ],
  ])("login 200でも%sなら前提応答エラーにする", async (_name, body) => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(200, body));

    await expect(
      runStagingRateLimitEvidence({
        apiBaseUrl: API_BASE_URL,
        frontendOrigin: FRONTEND_ORIGIN,
        evidenceCase: "auth",
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        userPassword: USER_PASSWORD,
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow("staging rate limit evidenceの前提応答が不正です");
  });

  it("questionsの許可応答も公開response shapeを満たさなければ停止する", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => loginResponse())
      .mockImplementationOnce(async () => jsonResponse(200, {}));

    await expect(
      runStagingRateLimitEvidence({
        apiBaseUrl: API_BASE_URL,
        frontendOrigin: FRONTEND_ORIGIN,
        evidenceCase: "questions",
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        userPassword: USER_PASSWORD,
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow("staging rate limit evidenceの前提応答が不正です");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["非JSON Content-Type", { "Content-Type": "text/plain" }],
    ["policy window超過Retry-After", { "Retry-After": "601" }],
    ["safe integer外Retry-After", { "Retry-After": "999999999999999999999999999999999" }],
    ["X-Powered-By露出", { "X-Powered-By": "Hono" }],
  ])("429の%sを契約違反として停止する", async (_name, headers) => {
    let callCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      callCount += 1;
      return callCount <= 10 ? loginResponse() : rateLimitedResponse(headers);
    });

    await expect(
      runStagingRateLimitEvidence({
        apiBaseUrl: API_BASE_URL,
        frontendOrigin: FRONTEND_ORIGIN,
        evidenceCase: "auth",
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        userPassword: USER_PASSWORD,
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow("staging rate limit evidenceの429契約が不正です");
  });

  it("429が非JSONなら本文を露出せず契約違反として停止する", async () => {
    let callCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      callCount += 1;
      if (callCount <= 10) {
        return loginResponse();
      }
      return new Response("secret-non-json-body", {
        status: 429,
        headers: { ...RATE_LIMIT_HEADERS, "Content-Type": "text/html" },
      });
    });

    await expect(
      runStagingRateLimitEvidence({
        apiBaseUrl: API_BASE_URL,
        frontendOrigin: FRONTEND_ORIGIN,
        evidenceCase: "auth",
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        userPassword: USER_PASSWORD,
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow("staging rate limit evidenceの429契約が不正です");
  });
});
