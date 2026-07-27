import {
  cancelResponseBodyBestEffort,
  findFailedResponseHeaderContract,
  hasJsonContentType,
  parseJson,
  requestStagingEvidence,
} from "./stagingEvidenceHttp.js";
import {
  classifyStagingUnexpectedResponse,
  StagingRateLimitEvidenceExecutionError,
} from "./stagingRateLimitEvidence.js";
import type { M2EvidenceStatus } from "./stagingReleaseCandidateEvidence.js";

const REQUEST_TIMEOUT_MS = 10_000;
const AUTH_WINDOW_MS = 600_000;
const MAX_WAIT_MS = 610_000;
const GAME_MODE = "SYMBOL_TO_NAME_LV1";
const EXECUTION_ERROR_MESSAGE = "M2 staging campaignの実行に失敗しました";

export type M2CampaignStage =
  | "REGISTRATION"
  | "EMAIL_VERIFICATION"
  | "VALID_LOGIN"
  | "REFRESH_PROTOCOL"
  | "AUTH_WINDOW_WAIT"
  | "AUTH_RATE_LIMIT"
  | "AUTH_RESET_WAIT"
  | "AUTH_RESET"
  | "GAME"
  | "UI_PHASE"
  | "OLD_CREDENTIAL_REJECTION";

export class M2CampaignExecutionError extends Error {
  readonly status: Exclude<M2EvidenceStatus, "clear">;
  readonly stage: M2CampaignStage;

  constructor(status: Exclude<M2EvidenceStatus, "clear">, stage: M2CampaignStage) {
    super(EXECUTION_ERROR_MESSAGE);
    this.name = "M2CampaignExecutionError";
    this.status = status;
    this.stage = stage;
  }
}

export type M2CampaignSafeSummary = Readonly<{
  registration: "clear";
  emailVerification: "clear";
  validLogin: "clear";
  refreshProtocol: "clear";
  mainWorkerCpu: "clear";
  authAllowedTen: "clear";
  authEleventh429: "clear";
  authRetryAfter: "clear";
  authReset: "clear";
  game: "clear";
  keyboard: "clear";
  viewport320: "clear";
  selfDeletion: "clear";
  oldCredentialRejection: "clear";
  headersCorsSafeErrors: "clear";
}>;

type JsonObject = Record<string, unknown>;
type UiPhaseSummary = Readonly<{
  keyboard: "clear";
  viewport320: "clear";
  selfDeletion: "clear";
}>;

type LoginResult = Readonly<{ accessToken: string; refreshCookie: string }>;
type QuestionResult = Readonly<{
  questionSetId: string;
  questions: ReadonlyArray<Readonly<{ questionId: string; choiceId: string }>>;
}>;

export type RunM2StagingReleaseCandidateCampaignOptions = Readonly<{
  apiBaseUrl: string;
  frontendOrigin: string;
  username: string;
  email: string;
  password: string;
  verificationToken: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  armVerification: (token: string) => Promise<Readonly<{ status: "clear" }>>;
  runAuthRateLimitEvidence: (credential: {
    email: string;
    password: string;
  }) => Promise<Readonly<{ retryAfterSec: number }>>;
  runUiPhase: () => Promise<UiPhaseSummary>;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function assertSafeHeaders(
  response: Response,
  frontendOrigin: string,
  stage: M2CampaignStage,
): void {
  if (findFailedResponseHeaderContract(response, frontendOrigin) !== null) {
    throw new M2CampaignExecutionError("present", stage);
  }
}

async function parseJsonObject(response: Response, stage: M2CampaignStage): Promise<JsonObject> {
  if (!hasJsonContentType(response)) {
    await cancelResponseBodyBestEffort(response);
    throw new M2CampaignExecutionError("unknown", stage);
  }
  const body = await parseJson(response);
  if (!isObject(body)) {
    throw new M2CampaignExecutionError("unknown", stage);
  }
  return body;
}

async function requestResponse({
  fetchImpl,
  input,
  init,
  requestTimeoutMs,
  frontendOrigin,
  stage,
}: {
  fetchImpl: typeof fetch;
  input: string;
  init: RequestInit;
  requestTimeoutMs: number;
  frontendOrigin: string;
  stage: M2CampaignStage;
}): Promise<Response> {
  let response: Response;
  try {
    response = await requestStagingEvidence(fetchImpl, input, init, requestTimeoutMs);
  } catch {
    throw new M2CampaignExecutionError("unknown", stage);
  }
  if (response.status === 503) {
    const classification = await classifyStagingUnexpectedResponse(response, frontendOrigin);
    throw new M2CampaignExecutionError(
      classification.observedResponseClass === "SAFE_JSON_503_CONTRACT" ? "present" : "unknown",
      stage,
    );
  }
  assertSafeHeaders(response, frontendOrigin, stage);
  return response;
}

function jsonHeaders(frontendOrigin: string, accessToken?: string): Record<string, string> {
  return {
    Origin: frontendOrigin,
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function assertStatus(response: Response, expected: number, stage: M2CampaignStage): void {
  if (response.status !== expected) {
    throw new M2CampaignExecutionError("present", stage);
  }
}

async function expectMessageResponse(
  response: Response,
  expectedStatus: number,
  stage: M2CampaignStage,
): Promise<void> {
  assertStatus(response, expectedStatus, stage);
  const body = await parseJsonObject(response, stage);
  if (!isNonEmptyString(body.message)) {
    throw new M2CampaignExecutionError("unknown", stage);
  }
}

function extractRefreshCookie(response: Response, stage: M2CampaignStage): string {
  const issuedCookies = response.headers
    .getSetCookie()
    .filter(
      (cookie) => /^refreshToken=/i.test(cookie) && !/(?:^|;)\s*Max-Age=0(?:;|$)/i.test(cookie),
    );
  const issuedCookie = issuedCookies[0] ?? "";
  const match = /^refreshToken=([^;]+);/i.exec(issuedCookie);
  if (
    issuedCookies.length !== 1 ||
    !match?.[1] ||
    !/;\s*HttpOnly(?:;|$)/i.test(issuedCookie) ||
    !/;\s*Secure(?:;|$)/i.test(issuedCookie) ||
    !/;\s*SameSite=Strict(?:;|$)/i.test(issuedCookie) ||
    !/;\s*Path=\/api\/v1\/auth(?:;|$)/i.test(issuedCookie) ||
    !/;\s*Max-Age=604800(?:;|$)/i.test(issuedCookie) ||
    /;\s*Domain=/i.test(issuedCookie)
  ) {
    throw new M2CampaignExecutionError("present", stage);
  }
  return `refreshToken=${match[1]}`;
}

async function parseLogin(
  response: Response,
  stage: M2CampaignStage,
  expectedUsername: string,
): Promise<LoginResult> {
  assertStatus(response, 200, stage);
  const body = await parseJsonObject(response, stage);
  if (
    !isNonEmptyString(body.accessToken) ||
    !isObject(body.user) ||
    !isNonEmptyString(body.user.id) ||
    body.user.username !== expectedUsername ||
    body.user.role !== "USER"
  ) {
    throw new M2CampaignExecutionError("unknown", stage);
  }
  return { accessToken: body.accessToken, refreshCookie: extractRefreshCookie(response, stage) };
}

async function expectSafeRejection(
  response: Response,
  expectedStatus: number,
  stage: M2CampaignStage,
): Promise<void> {
  assertStatus(response, expectedStatus, stage);
  const body = await parseJsonObject(response, stage);
  if (
    Object.keys(body).some((key) => !["error", "details"].includes(key)) ||
    !isNonEmptyString(body.error)
  ) {
    throw new M2CampaignExecutionError("unknown", stage);
  }
}

async function parseQuestions(response: Response): Promise<QuestionResult> {
  const stage = "GAME" as const;
  assertStatus(response, 200, stage);
  const body = await parseJsonObject(response, stage);
  if (
    !isNonEmptyString(body.questionSetId) ||
    !Array.isArray(body.questions) ||
    body.questions.length === 0
  ) {
    throw new M2CampaignExecutionError("unknown", stage);
  }
  const questions = body.questions.map((question) => {
    if (
      !isObject(question) ||
      !isNonEmptyString(question.questionId) ||
      !Array.isArray(question.choices)
    ) {
      throw new M2CampaignExecutionError("unknown", stage);
    }
    const choice = question.choices[0];
    if (!isObject(choice) || !isNonEmptyString(choice.choiceId)) {
      throw new M2CampaignExecutionError("unknown", stage);
    }
    return { questionId: question.questionId, choiceId: choice.choiceId };
  });
  return { questionSetId: body.questionSetId, questions };
}

async function waitBounded(
  milliseconds: number,
  stage: M2CampaignStage,
  wait: (milliseconds: number) => Promise<void>,
): Promise<void> {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > MAX_WAIT_MS) {
    throw new M2CampaignExecutionError("unknown", stage);
  }
  try {
    await wait(milliseconds);
  } catch {
    throw new M2CampaignExecutionError("unknown", stage);
  }
}

export async function runM2StagingReleaseCandidateCampaign({
  apiBaseUrl,
  frontendOrigin,
  username,
  email,
  password,
  verificationToken,
  armVerification,
  runAuthRateLimitEvidence,
  runUiPhase,
  fetchImpl = fetch,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  wait = async (milliseconds) => await new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => Date.now(),
}: RunM2StagingReleaseCandidateCampaignOptions): Promise<M2CampaignSafeSummary> {
  const campaignStartedAt = now();
  const request = async (path: string, init: RequestInit, stage: M2CampaignStage) =>
    await requestResponse({
      fetchImpl,
      input: `${apiBaseUrl}${path}`,
      init,
      requestTimeoutMs,
      frontendOrigin,
      stage,
    });

  await expectMessageResponse(
    await request(
      "/auth/register",
      {
        method: "POST",
        headers: jsonHeaders(frontendOrigin),
        body: JSON.stringify({ username, email, password }),
      },
      "REGISTRATION",
    ),
    201,
    "REGISTRATION",
  );

  try {
    await armVerification(verificationToken);
  } catch {
    throw new M2CampaignExecutionError("unknown", "EMAIL_VERIFICATION");
  }
  await expectMessageResponse(
    await request(
      "/auth/verify-email",
      {
        method: "POST",
        headers: jsonHeaders(frontendOrigin),
        body: JSON.stringify({ token: verificationToken }),
      },
      "EMAIL_VERIFICATION",
    ),
    200,
    "EMAIL_VERIFICATION",
  );
  await expectSafeRejection(
    await request(
      "/auth/verify-email",
      {
        method: "POST",
        headers: jsonHeaders(frontendOrigin),
        body: JSON.stringify({ token: verificationToken }),
      },
      "EMAIL_VERIFICATION",
    ),
    400,
    "EMAIL_VERIFICATION",
  );

  const initialLogin = await parseLogin(
    await request(
      "/auth/login",
      {
        method: "POST",
        headers: jsonHeaders(frontendOrigin),
        body: JSON.stringify({ email, password }),
      },
      "VALID_LOGIN",
    ),
    "VALID_LOGIN",
    username,
  );

  const refreshResponse = await request(
    "/auth/refresh",
    {
      method: "POST",
      headers: { Origin: frontendOrigin, Cookie: initialLogin.refreshCookie },
    },
    "REFRESH_PROTOCOL",
  );
  const refreshedLogin = await parseLogin(refreshResponse, "REFRESH_PROTOCOL", username);
  if (refreshedLogin.refreshCookie === initialLogin.refreshCookie) {
    throw new M2CampaignExecutionError("present", "REFRESH_PROTOCOL");
  }
  await expectSafeRejection(
    await request(
      "/auth/refresh",
      { method: "POST", headers: { Origin: frontendOrigin, Cookie: initialLogin.refreshCookie } },
      "REFRESH_PROTOCOL",
    ),
    401,
    "REFRESH_PROTOCOL",
  );

  const elapsedMs = Math.max(0, now() - campaignStartedAt);
  await waitBounded(Math.max(0, AUTH_WINDOW_MS - elapsedMs), "AUTH_WINDOW_WAIT", wait);

  let retryAfterSec: number;
  try {
    ({ retryAfterSec } = await runAuthRateLimitEvidence({ email, password }));
  } catch (error) {
    if (error instanceof M2CampaignExecutionError) {
      throw error;
    }
    if (
      error instanceof StagingRateLimitEvidenceExecutionError &&
      error.failureKind === "REQUEST_FAILED"
    ) {
      throw new M2CampaignExecutionError("unknown", "AUTH_RATE_LIMIT");
    }
    throw new M2CampaignExecutionError("present", "AUTH_RATE_LIMIT");
  }
  await waitBounded((retryAfterSec + 1) * 1_000, "AUTH_RESET_WAIT", wait);

  await parseLogin(
    await request(
      "/auth/login",
      {
        method: "POST",
        headers: jsonHeaders(frontendOrigin),
        body: JSON.stringify({ email, password }),
      },
      "AUTH_RESET",
    ),
    "AUTH_RESET",
    username,
  );

  const questions = await parseQuestions(
    await request(
      `/game/questions?${new URLSearchParams({ mode: GAME_MODE }).toString()}`,
      { method: "GET", headers: jsonHeaders(frontendOrigin, refreshedLogin.accessToken) },
      "GAME",
    ),
  );
  const sessionResponse = await request(
    "/game/sessions",
    {
      method: "POST",
      headers: jsonHeaders(frontendOrigin, refreshedLogin.accessToken),
      body: JSON.stringify({
        questionSetId: questions.questionSetId,
        mode: GAME_MODE,
        answers: questions.questions.map((question) => ({
          questionId: question.questionId,
          chosenChoiceId: question.choiceId,
          answerTimeSec: 0,
        })),
        durationSec: 1,
      }),
    },
    "GAME",
  );
  assertStatus(sessionResponse, 201, "GAME");
  const session = await parseJsonObject(sessionResponse, "GAME");
  if (!isNonEmptyString(session.sessionId)) {
    throw new M2CampaignExecutionError("unknown", "GAME");
  }
  const historyResponse = await request(
    "/game/sessions?limit=20",
    { method: "GET", headers: jsonHeaders(frontendOrigin, refreshedLogin.accessToken) },
    "GAME",
  );
  assertStatus(historyResponse, 200, "GAME");
  const history = await parseJsonObject(historyResponse, "GAME");
  if (!Array.isArray(history.sessions) || history.sessions.length === 0) {
    throw new M2CampaignExecutionError("unknown", "GAME");
  }
  const detailResponse = await request(
    `/game/sessions/${encodeURIComponent(session.sessionId)}`,
    { method: "GET", headers: jsonHeaders(frontendOrigin, refreshedLogin.accessToken) },
    "GAME",
  );
  assertStatus(detailResponse, 200, "GAME");
  const detail = await parseJsonObject(detailResponse, "GAME");
  if (detail.sessionId !== session.sessionId) {
    throw new M2CampaignExecutionError("unknown", "GAME");
  }

  let uiSummary: UiPhaseSummary;
  try {
    uiSummary = await runUiPhase();
  } catch {
    throw new M2CampaignExecutionError("unknown", "UI_PHASE");
  }
  if (Object.values(uiSummary).some((status) => status !== "clear")) {
    throw new M2CampaignExecutionError("present", "UI_PHASE");
  }

  await expectSafeRejection(
    await request(
      `/game/questions?${new URLSearchParams({ mode: GAME_MODE }).toString()}`,
      { method: "GET", headers: jsonHeaders(frontendOrigin, refreshedLogin.accessToken) },
      "OLD_CREDENTIAL_REJECTION",
    ),
    401,
    "OLD_CREDENTIAL_REJECTION",
  );
  await expectSafeRejection(
    await request(
      "/auth/refresh",
      { method: "POST", headers: { Origin: frontendOrigin, Cookie: refreshedLogin.refreshCookie } },
      "OLD_CREDENTIAL_REJECTION",
    ),
    401,
    "OLD_CREDENTIAL_REJECTION",
  );
  await expectSafeRejection(
    await request(
      "/auth/login",
      {
        method: "POST",
        headers: jsonHeaders(frontendOrigin),
        body: JSON.stringify({ email, password }),
      },
      "OLD_CREDENTIAL_REJECTION",
    ),
    401,
    "OLD_CREDENTIAL_REJECTION",
  );

  return {
    registration: "clear",
    emailVerification: "clear",
    validLogin: "clear",
    refreshProtocol: "clear",
    mainWorkerCpu: "clear",
    authAllowedTen: "clear",
    authEleventh429: "clear",
    authRetryAfter: "clear",
    authReset: "clear",
    game: "clear",
    keyboard: uiSummary.keyboard,
    viewport320: uiSummary.viewport320,
    selfDeletion: uiSummary.selfDeletion,
    oldCredentialRejection: "clear",
    headersCorsSafeErrors: "clear",
  };
}
