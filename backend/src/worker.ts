import { RateLimitCounter } from "./cloudflare/rate-limit-counter.js";
import type { WorkerRuntimeEnvironment } from "./lib/worker-config.js";
import { createWorkerRequestAdapters } from "./lib/worker-request-adapters.js";
import { createWorkerHandler } from "./worker-handler.js";

export { RateLimitCounter };

type StagingWorkerRuntimeEnvironment = Required<
  WorkerRuntimeEnvironment<DurableObjectNamespace<RateLimitCounter>>
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
