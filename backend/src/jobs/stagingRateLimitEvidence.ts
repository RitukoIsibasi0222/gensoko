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

export type StagingRateLimitEvidenceCase = "auth" | "questions" | "game-submit";

export type StagingRateLimitEvidenceEnvironment = Readonly<{
  BATCH_ENVIRONMENT?: string;
  STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED?: string;
  STAGING_RATE_LIMIT_EVIDENCE_CASE?: string;
  STAGING_RATE_LIMIT_API_BASE_URL?: string;
  STAGING_RATE_LIMIT_FRONTEND_ORIGIN?: string;
  STAGING_SYNTHETIC_USER_PASSWORD?: string;
}>;

export type ValidatedStagingRateLimitEvidenceEnvironment = Readonly<{
  apiBaseUrl: typeof STAGING_API_BASE_URL;
  frontendOrigin: typeof STAGING_FRONTEND_ORIGIN;
  evidenceCase: StagingRateLimitEvidenceCase;
  userPassword: string;
}>;

export type StagingRateLimitEvidenceSummary = Readonly<{
  evidenceCase: StagingRateLimitEvidenceCase;
  allowedRequests: number;
  limitedRequestNumber: number;
  limitedStatus: 429;
  retryAfterSec: number;
  bodyContract: true;
  corsContract: true;
  securityHeadersContract: true;
}>;

type RunStagingRateLimitEvidenceOptions = ValidatedStagingRateLimitEvidenceEnvironment &
  Readonly<{ fetchImpl?: typeof fetch }>;

type GameQuestion = Readonly<{
  questionId: string;
  choices: ReadonlyArray<Readonly<{ choiceId: string }>>;
}>;

type GameQuestionsResponse = Readonly<{
  questionSetId: string;
  questions: ReadonlyArray<GameQuestion>;
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

function createCommonHeaders(frontendOrigin: string): Record<string, string> {
  return { Origin: frontendOrigin };
}

function createAuthenticatedHeaders(frontendOrigin: string, accessToken: string) {
  return {
    ...createCommonHeaders(frontendOrigin),
    Authorization: `Bearer ${accessToken}`,
  };
}

async function login({
  apiBaseUrl,
  frontendOrigin,
  userPassword,
  fetchImpl,
}: Pick<RunStagingRateLimitEvidenceOptions, "apiBaseUrl" | "frontendOrigin" | "userPassword"> &
  Readonly<{ fetchImpl: typeof fetch }>): Promise<{ response: Response; body: unknown | null }> {
  const response = await fetchImpl(`${apiBaseUrl}/auth/login`, {
    method: "POST",
    headers: {
      ...createCommonHeaders(frontendOrigin),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: STAGING_SYNTHETIC_E2E_USER.email,
      password: userPassword,
    }),
  });
  return { response, body: await parseJson(response) };
}

function requireAccessToken(response: Response, body: unknown): string {
  if (response.status !== 200 || !isRecord(body) || typeof body.accessToken !== "string") {
    throw new Error(INVALID_PREREQUISITE_RESPONSE_MESSAGE);
  }
  return body.accessToken;
}

function parseQuestionsResponse(response: Response, body: unknown): GameQuestionsResponse {
  if (
    response.status !== 200 ||
    !isRecord(body) ||
    typeof body.questionSetId !== "string" ||
    !Array.isArray(body.questions) ||
    body.questions.length === 0
  ) {
    throw new Error(INVALID_PREREQUISITE_RESPONSE_MESSAGE);
  }

  const questions: GameQuestion[] = body.questions.map((question) => {
    if (
      !isRecord(question) ||
      typeof question.questionId !== "string" ||
      !Array.isArray(question.choices) ||
      question.choices.length === 0
    ) {
      throw new Error(INVALID_PREREQUISITE_RESPONSE_MESSAGE);
    }
    const choices = question.choices.map((choice) => {
      if (!isRecord(choice) || typeof choice.choiceId !== "string") {
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
  fetchImpl,
}: Pick<RunStagingRateLimitEvidenceOptions, "apiBaseUrl" | "frontendOrigin"> &
  Readonly<{ accessToken: string; fetchImpl: typeof fetch }>): Promise<Response> {
  const searchParams = new URLSearchParams({ mode: GAME_MODE });
  return await fetchImpl(`${apiBaseUrl}/game/questions?${searchParams.toString()}`, {
    method: "GET",
    headers: createAuthenticatedHeaders(frontendOrigin, accessToken),
  });
}

async function submitGame({
  apiBaseUrl,
  frontendOrigin,
  accessToken,
  questions,
  fetchImpl,
}: Pick<RunStagingRateLimitEvidenceOptions, "apiBaseUrl" | "frontendOrigin"> &
  Readonly<{
    accessToken: string;
    questions: GameQuestionsResponse;
    fetchImpl: typeof fetch;
  }>): Promise<Response> {
  return await fetchImpl(`${apiBaseUrl}/game/sessions`, {
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
  });
}

async function assertAllowedResponse(response: Response, expectedStatus: number): Promise<void> {
  if (response.status !== expectedStatus) {
    await response.body?.cancel();
    throw new Error(INVALID_PREREQUISITE_RESPONSE_MESSAGE);
  }
  await response.body?.cancel();
}

async function createRateLimitSummary({
  evidenceCase,
  allowedRequests,
  response,
  frontendOrigin,
  parsedBody,
}: {
  evidenceCase: StagingRateLimitEvidenceCase;
  allowedRequests: number;
  response: Response;
  frontendOrigin: string;
  parsedBody?: unknown | null;
}): Promise<StagingRateLimitEvidenceSummary> {
  const retryAfter = response.headers.get("Retry-After");
  const body = parsedBody === undefined ? await parseJson(response) : parsedBody;
  const bodyContract =
    isRecord(body) && Object.keys(body).length === 1 && body.error === RATE_LIMIT_EXCEEDED_MESSAGE;
  const corsContract = response.headers.get("Access-Control-Allow-Origin") === frontendOrigin;
  const securityHeadersContract =
    response.headers.get("Content-Security-Policy") === EXPECTED_CONTENT_SECURITY_POLICY &&
    response.headers.get("X-Content-Type-Options") === "nosniff" &&
    response.headers.get("X-Frame-Options") === "DENY";

  if (
    response.status !== 429 ||
    retryAfter === null ||
    !/^[1-9]\d*$/.test(retryAfter) ||
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
    retryAfterSec: Number(retryAfter),
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
    !passwordResult.success
  ) {
    throw new Error(INVALID_ENVIRONMENT_MESSAGE);
  }

  return {
    apiBaseUrl: STAGING_API_BASE_URL,
    frontendOrigin: STAGING_FRONTEND_ORIGIN,
    evidenceCase: environment.STAGING_RATE_LIMIT_EVIDENCE_CASE,
    userPassword: passwordResult.data,
  };
}

export async function runStagingRateLimitEvidence({
  apiBaseUrl,
  frontendOrigin,
  evidenceCase,
  userPassword,
  fetchImpl = fetch,
}: RunStagingRateLimitEvidenceOptions): Promise<StagingRateLimitEvidenceSummary> {
  if (evidenceCase === "auth") {
    for (
      let requestNumber = 1;
      requestNumber <= RATE_LIMIT_POLICIES.AUTH_IP.limit;
      requestNumber += 1
    ) {
      const { response, body } = await login({
        apiBaseUrl,
        frontendOrigin,
        userPassword,
        fetchImpl,
      });
      requireAccessToken(response, body);
    }
    const { response, body } = await login({
      apiBaseUrl,
      frontendOrigin,
      userPassword,
      fetchImpl,
    });
    return await createRateLimitSummary({
      evidenceCase,
      allowedRequests: RATE_LIMIT_POLICIES.AUTH_IP.limit,
      response,
      frontendOrigin,
      parsedBody: body,
    });
  }

  const loginResult = await login({ apiBaseUrl, frontendOrigin, userPassword, fetchImpl });
  const accessToken = requireAccessToken(loginResult.response, loginResult.body);

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
        fetchImpl,
      });
      await assertAllowedResponse(response, 200);
    }
    const response = await getQuestions({ apiBaseUrl, frontendOrigin, accessToken, fetchImpl });
    return await createRateLimitSummary({
      evidenceCase,
      allowedRequests: RATE_LIMIT_POLICIES.GAME_QUESTIONS_IP.limit,
      response,
      frontendOrigin,
    });
  }

  for (
    let requestNumber = 1;
    requestNumber <= RATE_LIMIT_POLICIES.GAME_SUBMIT_USER.limit;
    requestNumber += 1
  ) {
    const questionsResponse = await getQuestions({
      apiBaseUrl,
      frontendOrigin,
      accessToken,
      fetchImpl,
    });
    const questions = parseQuestionsResponse(questionsResponse, await parseJson(questionsResponse));
    const submitResponse = await submitGame({
      apiBaseUrl,
      frontendOrigin,
      accessToken,
      questions,
      fetchImpl,
    });
    await assertAllowedResponse(submitResponse, 201);
  }

  const questionsResponse = await getQuestions({
    apiBaseUrl,
    frontendOrigin,
    accessToken,
    fetchImpl,
  });
  const questions = parseQuestionsResponse(questionsResponse, await parseJson(questionsResponse));
  const response = await submitGame({
    apiBaseUrl,
    frontendOrigin,
    accessToken,
    questions,
    fetchImpl,
  });
  return await createRateLimitSummary({
    evidenceCase,
    allowedRequests: RATE_LIMIT_POLICIES.GAME_SUBMIT_USER.limit,
    response,
    frontendOrigin,
  });
}
