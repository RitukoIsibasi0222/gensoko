import { RateLimitCounter } from "./cloudflare/rate-limit-counter.js";
import { PasswordVerifierDurableObject } from "./cloudflare/password-verifier.js";
import type { WorkerRuntimeEnvironment } from "./lib/worker-config.js";
import { createWorkerRequestAdapters } from "./lib/worker-request-adapters.js";
import { createWorkerHandler } from "./worker-handler.js";

export { PasswordVerifierDurableObject, RateLimitCounter };

type StagingWorkerRuntimeEnvironment = Required<
  WorkerRuntimeEnvironment<
    DurableObjectNamespace<RateLimitCounter>,
    DurableObjectNamespace<PasswordVerifierDurableObject>
  >
>;

function requireStagingWorkerEnvironment(
  environment: CloudflareBindings,
): StagingWorkerRuntimeEnvironment {
  return environment;
}

const stagingWorker = createWorkerHandler({
  expectedTarget: "staging",
  createRequestAdapters: createWorkerRequestAdapters(),
});

const worker: ExportedHandler<CloudflareBindings> = {
  fetch(request, environment, executionContext) {
    return stagingWorker.fetch(
      request,
      requireStagingWorkerEnvironment(environment),
      executionContext,
    );
  },
};

export default worker;
