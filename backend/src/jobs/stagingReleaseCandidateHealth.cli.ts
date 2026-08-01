import {
  M2_STAGING_API_BASE_URL,
  M2_STAGING_FRONTEND_ORIGIN,
  validateM2StagingHealth,
} from "./stagingReleaseCandidateHealth.js";

const COMPLETED_EVENT = "m2_staging_health.completed";
const FAILED_EVENT = "m2_staging_health.failed";
const EXECUTION_ERROR_MESSAGE = "M2 staging API health確認に失敗しました";

type SafeLogger = (value: Readonly<Record<string, string>>) => void;

export async function runM2StagingHealthCli({
  apiBaseUrl,
  frontendOrigin,
  validate = validateM2StagingHealth,
  info = console.info,
  error = console.error,
}: Readonly<{
  apiBaseUrl: string | undefined;
  frontendOrigin: string | undefined;
  validate?: typeof validateM2StagingHealth;
  info?: SafeLogger;
  error?: SafeLogger;
}>): Promise<0 | 1> {
  try {
    const result = await validate({
      apiBaseUrl: apiBaseUrl ?? "",
      frontendOrigin: frontendOrigin ?? "",
    });
    info({ event: COMPLETED_EVENT, status: result.status });
    return 0;
  } catch {
    error({ event: FAILED_EVENT, message: EXECUTION_ERROR_MESSAGE });
    return 1;
  }
}

export async function main(): Promise<void> {
  process.exitCode = await runM2StagingHealthCli({
    apiBaseUrl: process.env.M2_API_BASE_URL,
    frontendOrigin: process.env.M2_FRONTEND_ORIGIN,
  });
}

if (process.env.NODE_ENV !== "test") {
  void main();
}

export { M2_STAGING_API_BASE_URL, M2_STAGING_FRONTEND_ORIGIN };
