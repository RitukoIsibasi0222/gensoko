import { RateLimitCounter } from "./cloudflare/rate-limit-counter.js";
import { PasswordVerifierDurableObject } from "./cloudflare/password-verifier.js";
import type { WorkerRuntimeEnvironment } from "./lib/worker-config.js";
import { createWorkerRequestAdapters } from "./lib/worker-request-adapters.js";
import { createWorkerHandler } from "./worker-handler.js";

export { PasswordVerifierDurableObject, RateLimitCounter };

type ProductionWorkerRuntimeEnvironment = Required<
  WorkerRuntimeEnvironment<
    DurableObjectNamespace<RateLimitCounter>,
    DurableObjectNamespace<PasswordVerifierDurableObject>
  >
>;

function requireProductionWorkerEnvironment(
  environment: CloudflareBindings,
): ProductionWorkerRuntimeEnvironment {
  return environment;
}

const productionWorker = createWorkerHandler({
  expectedTarget: "production",
  createRequestAdapters: createWorkerRequestAdapters(),
});

const worker: ExportedHandler<CloudflareBindings> = {
  fetch(request, environment, executionContext) {
    return productionWorker.fetch(
      request,
      requireProductionWorkerEnvironment(environment),
      executionContext,
    );
  },
};

export default worker;
