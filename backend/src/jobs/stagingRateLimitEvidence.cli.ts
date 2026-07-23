import {
  runStagingRateLimitEvidence,
  validateStagingRateLimitEvidenceEnvironment,
} from "./stagingRateLimitEvidence.js";

const COMPLETED_EVENT = "staging_rate_limit_evidence.completed";
const FAILED_EVENT = "staging_rate_limit_evidence.failed";
const INVALID_ENVIRONMENT_MESSAGE = "staging rate limit evidence設定が不正です";
const EXECUTION_FAILED_MESSAGE = "staging rate limit evidenceの実行に失敗しました";

export async function main(): Promise<void> {
  let environment: ReturnType<typeof validateStagingRateLimitEvidenceEnvironment>;
  try {
    environment = validateStagingRateLimitEvidenceEnvironment(process.env);
  } catch {
    console.error({ event: FAILED_EVENT, message: INVALID_ENVIRONMENT_MESSAGE });
    process.exitCode = 2;
    return;
  }

  try {
    const summary = await runStagingRateLimitEvidence(environment);
    console.info({ event: COMPLETED_EVENT, ...summary });
    process.exitCode = 0;
  } catch {
    console.error({ event: FAILED_EVENT, message: EXECUTION_FAILED_MESSAGE });
    process.exitCode = 1;
  }
}

export const executionPromise = main();
