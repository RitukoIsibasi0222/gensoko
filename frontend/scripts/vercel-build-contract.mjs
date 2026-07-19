const SECRET_IDENTIFIERS = ['DATABASE_URL', 'JWT_SECRET', 'RATE_LIMIT_KEY_SECRET', 'MAIL_API_KEY'];
const BUILD_FAILURE_PREFIX = 'Vercel Preview build契約の検証に失敗しました';

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * stack traceや不定形のthrow値を露出せず、検証エラーのmessageだけを返す。
 *
 * @param {unknown} error
 * @returns {string}
 */
export function formatVercelBuildFailure(error) {
  const message = error instanceof Error && error.message ? error.message : '不明なエラー';
  return `${BUILD_FAILURE_PREFIX}: ${message}`;
}

/**
 * @param {unknown} config
 */
export function validateVercelOutputConfig(config) {
  if (!isRecord(config) || config.version !== 3) {
    throw new Error('Vercel Build Outputのversion 3が必要です');
  }

  const hasSsrCatchAll =
    Array.isArray(config.routes) &&
    config.routes.some(
      (route) =>
        isRecord(route) &&
        route.src === '/.*' &&
        typeof route.dest === 'string' &&
        route.dest.length > 0
    );

  if (!hasSsrCatchAll) {
    throw new Error('SSR catch-all routeが生成されていません');
  }
}

/**
 * @param {unknown[]} functionConfigs
 * @param {string} expectedRuntime
 */
export function validateFunctionConfigs(functionConfigs, expectedRuntime) {
  if (
    functionConfigs.length === 0 ||
    functionConfigs.some((config) => !isRecord(config) || config.runtime !== expectedRuntime)
  ) {
    throw new Error(`Vercel Function runtimeが${expectedRuntime}ではありません`);
  }
}

/**
 * @param {string[]} artifactContents
 * @param {string} expectedApiUrl
 */
export function assertExpectedApiUrl(artifactContents, expectedApiUrl) {
  if (!expectedApiUrl || !artifactContents.some((content) => content.includes(expectedApiUrl))) {
    throw new Error('VITE_API_BASE_URLが成果物に含まれていません');
  }
}

/**
 * @param {string[]} artifactContents
 */
export function assertNoFrontendSecrets(artifactContents) {
  if (
    artifactContents.some((content) =>
      SECRET_IDENTIFIERS.some((identifier) => content.includes(identifier))
    )
  ) {
    throw new Error('frontend成果物にsecret識別子が含まれています');
  }
}

export const expectedVercelRuntime = 'nodejs22.x';
