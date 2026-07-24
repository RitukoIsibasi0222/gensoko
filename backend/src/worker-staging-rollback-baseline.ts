import { RateLimitCounter } from "./cloudflare/rate-limit-counter.js";
import { PasswordVerifierDurableObject } from "./cloudflare/password-verifier.js";
import { createBcryptPasswordVerifier } from "./lib/bcrypt-password-verifier.js";
import type { WorkerRuntimeEnvironment } from "./lib/worker-config.js";
import { createWorkerRequestAdapters } from "./lib/worker-request-adapters.js";
import { createWorkerHandler } from "./worker-handler.js";

export { PasswordVerifierDurableObject, RateLimitCounter };

type StagingRollbackBaselineRuntimeEnvironment = Required<
  WorkerRuntimeEnvironment<
    DurableObjectNamespace<RateLimitCounter>,
    DurableObjectNamespace<PasswordVerifierDurableObject>
  >
>;

function requireStagingRollbackBaselineEnvironment(
  environment: CloudflareBindings,
): StagingRollbackBaselineRuntimeEnvironment {
  return environment;
}

const stagingRollbackBaseline = createWorkerHandler({
  expectedTarget: "staging",
  createRequestAdapters: createWorkerRequestAdapters({
    createPasswordVerifier: () => createBcryptPasswordVerifier(),
  }),
});

const worker: ExportedHandler<CloudflareBindings> = {
  fetch(request, environment, executionContext) {
    return stagingRollbackBaseline.fetch(
      request,
      requireStagingRollbackBaselineEnvironment(environment),
      executionContext,
    );
  },
};

export default worker;
