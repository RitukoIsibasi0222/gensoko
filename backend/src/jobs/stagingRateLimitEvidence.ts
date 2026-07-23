import { normalizePassword } from "../lib/normalize.js";
import { strongPasswordSchema } from "../lib/validation/auth.js";
import { RATE_LIMIT_POLICIES } from "../middleware/rateLimit/policies.js";
import { STAGING_SYNTHETIC_E2E_USER } from "./stagingSyntheticAdminE2eFixtures.js";

const STAGING_API_BASE_URL = "https://gensoko-api-staging.rituko-labs.workers.dev/api/v1";
const STAGING_FRONTEND_ORIGIN = "https://gensoko-frontend-staging-develop.vercel.app";
const RATE_LIMIT_EXCEEDED_MESSAGE = "リクエストが多すぎます。しばらく待ってから再試行してください";
const EXPECTED_CONTENT_SECURITY_POLICY =
  "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const INVALID_ENVIRONMENT_MESSAGE = "staging rate limit evidence設定が不正です";
const INVALID_PREREQUISITE_RESPONSE_MESSAGE = "staging rate limit evidenceの前提応答が不正です";
const INVALID_RATE_LIMIT_RESPONSE_MESSAGE = "staging rate limit evidenceの429契約が不正です";
const GAME_MODE = "SYMBOL_TO_NAME_LV1";
const STAGING_RATE_LIMIT_REQUEST_TIMEOUT_MS = 10_000;

export type StagingRateLimitEvidenceCase = "auth" | "questions" | "game-submit";
type ObservedRateLimitPolicyId = "AUTH_IP" | "GAME_QUESTIONS_IP" | "GAME_SUBMIT_IP";

export type StagingRateLimitEvidenceEnvironment = Readonly<{
  BATCH_ENVIRONMENT?: string;
  STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED?: string;
  STAGING_RATE_LIMIT_EVIDENCE_CASE?: string;
  STAGING_RATE_LIMIT_API_BASE_URL?: string;
  STAGING_RATE_LIMIT_FRONTEND_ORIGIN?: string;
  STAGING_RATE_LIMIT_REQUEST_TIMEOUT_MS?: string;
  STAGING_SYNTHETIC_USER_PASSWORD?: string;
}>;

export type ValidatedStagingRateLimitEvidenceEnvironment = Readonly<{
  apiBaseUrl: typeof STAGING_API_BASE_URL;
  frontendOrigin: typeof STAGING_FRONTEND_ORIGIN;
  evidenceCase: StagingRateLimitEvidenceCase;
  requestTimeoutMs: typeof STAGING_RATE_LIMIT_REQUEST_TIMEOUT_MS;
  userPassword: string;
}>;

export type StagingRateLimitEvidenceSummary = Readonly<{
  evidenceCase: StagingRateLimitEvidenceCase;
  allowedRequests: number;
  limitedRequestNumber: number;
  limitedStatus: 429;
  policyId: ObservedRateLimitPolicyId;
  retryAfterSec: number;
  bodyContract: true;
  corsContract: true;
  securityHeadersContract: true;
}>;

type RunStagingRateLimitEvidenceOptions = Omit<
  ValidatedStagingRateLimitEvidenceEnvironment,
  "requestTimeoutMs"
> &
  Readonly<{
    fetchImpl?: typeof fetch;
    requestTimeoutMs?: number;
  }>;

type GameQuestion = Readonly<{
  questionId: string;
  choices: ReadonlyArray<Readonly<{ choiceId: string }>>;
}>;

type GameQuestionsResponse = Readonly<{
  questionSetId: string;
  questions: ReadonlyArray<GameQuestion>;
}>;

type LoginResponse = Readonly<{
  accessToken: string;
  user: Readonly<{
    id: string;
    username: string;
    role: "USER";
  }>;
}>;

function isEvidenceCase(value: unknown): value is StagingRateLimitEvidenceCase {
  return value === "auth" || value === "questions" || value === "game-submit";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function parseJson(response: Response): Promise<unknown | null> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasJsonContentType(response: Response): boolean {
  const contentType = response.headers.get("Content-Type");
  return contentType !== null && /^application\/json(?:\s*;|$)/i.test(contentType);
}

async function readExpectedJson(response: Response, expectedStatus: number): Promise<unknown> {
  if (response.status !== expectedStatus || !hasJsonContentType(response)) {
    await response.body?.cancel();
    throw new Error(INVALID_PREREQUISITE_RESPONSE_MESSAGE);
  }

  const body = await parseJson(response);
  if (body === null) {
    throw new Error(INVALID_PREREQUISITE_RESPONSE_MESSAGE);
  }
  return body;
}

async function requestEvidence(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  requestTimeoutMs: number,
): Promise<Response> {
  return await fetchImpl(input, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
}

function createCommonHeaders(frontendOrigin: string): Record<string, string> {
  return { Origin: frontendOrigin };
}

function createAuthenticatedHeaders(frontendOrigin: string, accessToken: string) {
  return {
    ...createCommonHeaders(frontendOrigin),
    Authorization: `Bearer ${accessToken}`,
  };
}

async function requestLogin({
  apiBaseUrl,
  frontendOrigin,
  userPassword,
  requestTimeoutMs,
  fetchImpl,
}: Pick<
  Required<RunStagingRateLimitEvidenceOptions>,
  "apiBaseUrl" | "frontendOrigin" | "userPassword" | "requestTimeoutMs" | "fetchImpl"
>): Promise<Response> {
  return await requestEvidence(
    fetchImpl,
    `${apiBaseUrl}/auth/login`,
    {
      method: "POST",
      headers: {
        ...createCommonHeaders(frontendOrigin),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: STAGING_SYNTHETIC_E2E_USER.email,
        password: userPassword,
      }),
    },
    requestTimeoutMs,
  );
}

async function parseLoginResponse(response: Response): Promise<LoginResponse> {
  const body = await readExpectedJson(response, 200);
  if (
    !isRecord(body) ||
    !isNonEmptyString(body.accessToken) ||
    !isRecord(body.user) ||
    !isNonEmptyString(body.user.id) ||
    !isNonEmptyString(body.user.username) ||
    body.user.role !== "USER"
  ) {
    throw new Error(INVALID_PREREQUISITE_RESPONSE_MESSAGE);
  }

  return {
    accessToken: body.accessToken,
    user: {
      id: body.user.id,
      username: body.user.username,
      role: body.user.role,
    },
  };
}

async function parseQuestionsResponse(response: Response): Promise<GameQuestionsResponse> {
  const body = await readExpectedJson(response, 200);
  if (
    !isRecord(body) ||
    !isNonEmptyString(body.questionSetId) ||
    !isNonEmptyString(body.expiresAt) ||
    !Array.isArray(body.questions) ||
    body.questions.length === 0
  ) {
    throw new Error(INVALID_PREREQUISITE_RESPONSE_MESSAGE);
  }

  const questions: GameQuestion[] = body.questions.map((question) => {
    if (
      !isRecord(question) ||
      !isNonEmptyString(question.questionId) ||
      typeof question.prompt !== "string" ||
      !Array.isArray(question.choices) ||
      question.choices.length === 0 ||
      "correctChoiceId" in question ||
      "elementId" in question
    ) {
      throw new Error(INVALID_PREREQUISITE_RESPONSE_MESSAGE);
    }
    const choices = question.choices.map((choice) => {
      if (
        !isRecord(choice) ||
        !isNonEmptyString(choice.choiceId) ||
        typeof choice.text !== "string" ||
        "correctChoiceId" in choice ||
        "elementId" in choice
      ) {
        throw new Error(INVALID_PREREQUISITE_RESPONSE_MESSAGE);
      }
      return { choiceId: choice.choiceId };
    });
    return { questionId: question.questionId, choices };
  });

  return { questionSetId: body.questionSetId, questions };
}

async function getQuestions({
  apiBaseUrl,
  frontendOrigin,
  accessToken,
  requestTimeoutMs,
  fetchImpl,
}: Pick<
  Required<RunStagingRateLimitEvidenceOptions>,
  "apiBaseUrl" | "frontendOrigin" | "requestTimeoutMs" | "fetchImpl"
> &
  Readonly<{ accessToken: string }>): Promise<Response> {
  const searchParams = new URLSearchParams({ mode: GAME_MODE });
  return await requestEvidence(
    fetchImpl,
    `${apiBaseUrl}/game/questions?${searchParams.toString()}`,
    {
      method: "GET",
      headers: createAuthenticatedHeaders(frontendOrigin, accessToken),
    },
    requestTimeoutMs,
  );
}

async function submitGame({
  apiBaseUrl,
  frontendOrigin,
  accessToken,
  questions,
  requestTimeoutMs,
  fetchImpl,
}: Pick<
  Required<RunStagingRateLimitEvidenceOptions>,
  "apiBaseUrl" | "frontendOrigin" | "requestTimeoutMs" | "fetchImpl"
> &
  Readonly<{
    accessToken: string;
    questions: GameQuestionsResponse;
  }>): Promise<Response> {
  return await requestEvidence(
    fetchImpl,
    `${apiBaseUrl}/game/sessions`,
    {
      method: "POST",
      headers: {
        ...createAuthenticatedHeaders(frontendOrigin, accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        questionSetId: questions.questionSetId,
        mode: GAME_MODE,
        answers: questions.questions.map((question) => ({
          questionId: question.questionId,
          chosenChoiceId: question.choices[0]!.choiceId,
          answerTimeSec: 0,
        })),
        durationSec: 1,
      }),
    },
    requestTimeoutMs,
  );
}

function isGameSessionResult(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.questionId) &&
    typeof value.elementId === "number" &&
    typeof value.prompt === "string" &&
    (value.chosenChoiceId === null || typeof value.chosenChoiceId === "string") &&
    typeof value.isCorrect === "boolean" &&
    typeof value.correctAnswer === "string" &&
    (value.yourAnswer === null || typeof value.yourAnswer === "string") &&
    typeof value.answerTimeSec === "number" &&
    typeof value.score === "number"
  );
}

async function assertGameSessionResponse(response: Response): Promise<void> {
  const body = await readExpectedJson(response, 201);
  if (
    !isRecord(body) ||
    !isNonEmptyString(body.sessionId) ||
    body.mode !== GAME_MODE ||
    typeof body.totalCount !== "number" ||
    typeof body.correctCount !== "number" ||
    typeof body.totalScore !== "number" ||
    typeof body.maxStreak !== "number" ||
    typeof body.durationSec !== "number" ||
    !isNonEmptyString(body.playedAt) ||
    !Array.isArray(body.results) ||
    !body.results.every(isGameSessionResult)
  ) {
    throw new Error(INVALID_PREREQUISITE_RESPONSE_MESSAGE);
  }
}

async function createRateLimitSummary({
  evidenceCase,
  allowedRequests,
  policyId,
  response,
  frontendOrigin,
}: {
  evidenceCase: StagingRateLimitEvidenceCase;
  allowedRequests: number;
  policyId: ObservedRateLimitPolicyId;
  response: Response;
  frontendOrigin: string;
}): Promise<StagingRateLimitEvidenceSummary> {
  if (response.status !== 429 || !hasJsonContentType(response)) {
    await response.body?.cancel();
    throw new Error(INVALID_RATE_LIMIT_RESPONSE_MESSAGE);
  }

  const retryAfter = response.headers.get("Retry-After");
  const body = await parseJson(response);
  const bodyContract =
    isRecord(body) && Object.keys(body).length === 1 && body.error === RATE_LIMIT_EXCEEDED_MESSAGE;
  const corsContract =
    response.headers.get("Access-Control-Allow-Origin") === frontendOrigin &&
    response.headers.get("Access-Control-Allow-Credentials") === "true";
  const securityHeadersContract =
    response.headers.get("Content-Security-Policy") === EXPECTED_CONTENT_SECURITY_POLICY &&
    response.headers.get("Cross-Origin-Resource-Policy") === "same-origin" &&
    response.headers.get("Permissions-Policy") === "camera=(), microphone=(), geolocation=()" &&
    response.headers.get("Referrer-Policy") === "strict-origin-when-cross-origin" &&
    response.headers.get("Strict-Transport-Security") === "max-age=31536000; includeSubDomains" &&
    response.headers.get("X-Content-Type-Options") === "nosniff" &&
    response.headers.get("X-Frame-Options") === "DENY" &&
    response.headers.get("X-Permitted-Cross-Domain-Policies") === "none" &&
    response.headers.get("X-XSS-Protection") === "0" &&
    response.headers.get("X-Powered-By") === null;
  const retryAfterSec = retryAfter === null ? Number.NaN : Number(retryAfter);
  const maximumRetryAfterSec = Math.ceil(RATE_LIMIT_POLICIES[policyId].windowMs / 1_000);

  if (
    retryAfter === null ||
    !/^[1-9]\d*$/.test(retryAfter) ||
    !Number.isSafeInteger(retryAfterSec) ||
    retryAfterSec > maximumRetryAfterSec ||
    !bodyContract ||
    !corsContract ||
    !securityHeadersContract
  ) {
    throw new Error(INVALID_RATE_LIMIT_RESPONSE_MESSAGE);
  }

  return {
    evidenceCase,
    allowedRequests,
    limitedRequestNumber: allowedRequests + 1,
    limitedStatus: 429,
    policyId,
    retryAfterSec,
    bodyContract: true,
    corsContract: true,
    securityHeadersContract: true,
  };
}

export function validateStagingRateLimitEvidenceEnvironment(
  environment: StagingRateLimitEvidenceEnvironment,
): ValidatedStagingRateLimitEvidenceEnvironment {
  const userPassword = normalizePassword(environment.STAGING_SYNTHETIC_USER_PASSWORD ?? "");
  const passwordResult = strongPasswordSchema.safeParse(userPassword);

  if (
    environment.BATCH_ENVIRONMENT !== "staging" ||
    environment.STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED !== "true" ||
    !isEvidenceCase(environment.STAGING_RATE_LIMIT_EVIDENCE_CASE) ||
    environment.STAGING_RATE_LIMIT_API_BASE_URL !== STAGING_API_BASE_URL ||
    environment.STAGING_RATE_LIMIT_FRONTEND_ORIGIN !== STAGING_FRONTEND_ORIGIN ||
    environment.STAGING_RATE_LIMIT_REQUEST_TIMEOUT_MS !==
      String(STAGING_RATE_LIMIT_REQUEST_TIMEOUT_MS) ||
    !passwordResult.success
  ) {
    throw new Error(INVALID_ENVIRONMENT_MESSAGE);
  }

  return {
    apiBaseUrl: STAGING_API_BASE_URL,
    frontendOrigin: STAGING_FRONTEND_ORIGIN,
    evidenceCase: environment.STAGING_RATE_LIMIT_EVIDENCE_CASE,
    requestTimeoutMs: STAGING_RATE_LIMIT_REQUEST_TIMEOUT_MS,
    userPassword: passwordResult.data,
  };
}

export async function runStagingRateLimitEvidence({
  apiBaseUrl,
  frontendOrigin,
  evidenceCase,
  userPassword,
  requestTimeoutMs = STAGING_RATE_LIMIT_REQUEST_TIMEOUT_MS,
  fetchImpl = fetch,
}: RunStagingRateLimitEvidenceOptions): Promise<StagingRateLimitEvidenceSummary> {
  if (evidenceCase === "auth") {
    for (
      let requestNumber = 1;
      requestNumber <= RATE_LIMIT_POLICIES.AUTH_IP.limit;
      requestNumber += 1
    ) {
      const response = await requestLogin({
        apiBaseUrl,
        frontendOrigin,
        userPassword,
        requestTimeoutMs,
        fetchImpl,
      });
      await parseLoginResponse(response);
    }
    const response = await requestLogin({
      apiBaseUrl,
      frontendOrigin,
      userPassword,
      requestTimeoutMs,
      fetchImpl,
    });
    return await createRateLimitSummary({
      evidenceCase,
      allowedRequests: RATE_LIMIT_POLICIES.AUTH_IP.limit,
      policyId: "AUTH_IP",
      response,
      frontendOrigin,
    });
  }

  const loginResponse = await requestLogin({
    apiBaseUrl,
    frontendOrigin,
    userPassword,
    requestTimeoutMs,
    fetchImpl,
  });
  const { accessToken } = await parseLoginResponse(loginResponse);

  if (evidenceCase === "questions") {
    for (
      let requestNumber = 1;
      requestNumber <= RATE_LIMIT_POLICIES.GAME_QUESTIONS_IP.limit;
      requestNumber += 1
    ) {
      const response = await getQuestions({
        apiBaseUrl,
        frontendOrigin,
        accessToken,
        requestTimeoutMs,
        fetchImpl,
      });
      await parseQuestionsResponse(response);
    }
    const response = await getQuestions({
      apiBaseUrl,
      frontendOrigin,
      accessToken,
      requestTimeoutMs,
      fetchImpl,
    });
    return await createRateLimitSummary({
      evidenceCase,
      allowedRequests: RATE_LIMIT_POLICIES.GAME_QUESTIONS_IP.limit,
      policyId: "GAME_QUESTIONS_IP",
      response,
      frontendOrigin,
    });
  }

  for (
    let requestNumber = 1;
    requestNumber <= RATE_LIMIT_POLICIES.GAME_SUBMIT_IP.limit;
    requestNumber += 1
  ) {
    const questionsResponse = await getQuestions({
      apiBaseUrl,
      frontendOrigin,
      accessToken,
      requestTimeoutMs,
      fetchImpl,
    });
    const questions = await parseQuestionsResponse(questionsResponse);
    const submitResponse = await submitGame({
      apiBaseUrl,
      frontendOrigin,
      accessToken,
      questions,
      requestTimeoutMs,
      fetchImpl,
    });
    await assertGameSessionResponse(submitResponse);
  }

  const questionsResponse = await getQuestions({
    apiBaseUrl,
    frontendOrigin,
    accessToken,
    requestTimeoutMs,
    fetchImpl,
  });
  const questions = await parseQuestionsResponse(questionsResponse);
  const response = await submitGame({
    apiBaseUrl,
    frontendOrigin,
    accessToken,
    questions,
    requestTimeoutMs,
    fetchImpl,
  });
  return await createRateLimitSummary({
    evidenceCase,
    allowedRequests: RATE_LIMIT_POLICIES.GAME_SUBMIT_IP.limit,
    policyId: "GAME_SUBMIT_IP",
    response,
    frontendOrigin,
  });
}
