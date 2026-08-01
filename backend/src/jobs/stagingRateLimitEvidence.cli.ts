import {
  runStagingRateLimitEvidence,
  STAGING_RATE_LIMIT_EVIDENCE_EXECUTION_FAILED_MESSAGE,
  StagingRateLimitEvidenceExecutionError,
  validateStagingRateLimitEvidenceEnvironment,
} from "./stagingRateLimitEvidence.js";

const COMPLETED_EVENT = "staging_rate_limit_evidence.completed";
const FAILED_EVENT = "staging_rate_limit_evidence.failed";
const INVALID_ENVIRONMENT_MESSAGE = "staging rate limit evidence設定が不正です";

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
  } catch (error) {
    const failureMetadata =
      error instanceof StagingRateLimitEvidenceExecutionError
        ? {
            failureStage: error.failureStage,
            failureKind: error.failureKind,
            requestNumber: error.requestNumber,
            observedStatus: error.observedStatus,
            failedContract: error.failedContract,
            observedResponseClass: error.observedResponseClass,
            observed503FailedContract: error.observed503FailedContract,
          }
        : {};
    console.error({
      event: FAILED_EVENT,
      message: STAGING_RATE_LIMIT_EVIDENCE_EXECUTION_FAILED_MESSAGE,
      ...failureMetadata,
    });
    process.exitCode = 1;
  }
}

export const executionPromise = main();
