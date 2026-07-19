import { createWorkerRequestAdapters } from "./lib/worker-request-adapters.js";
import { createWorkerHandler } from "./worker-handler.js";

export { RateLimitCounter } from "./cloudflare/rate-limit-counter.js";

const stagingWorker = createWorkerHandler({
  expectedTarget: "staging",
  createRequestAdapters: createWorkerRequestAdapters(),
});

export default stagingWorker satisfies ExportedHandler<CloudflareBindings>;
