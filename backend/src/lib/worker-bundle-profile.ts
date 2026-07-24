export const WORKER_BUNDLE_ENTRYPOINT_BY_PROFILE = {
  standard: "worker.ts",
  production: "worker-production.ts",
  "staging-rollback-baseline": "worker-staging-rollback-baseline.ts",
} as const;

export type WorkerBundleProfile = keyof typeof WORKER_BUNDLE_ENTRYPOINT_BY_PROFILE;

export const WORKER_BUNDLE_PROFILES = Object.freeze(
  Object.keys(WORKER_BUNDLE_ENTRYPOINT_BY_PROFILE) as WorkerBundleProfile[],
);

export function isWorkerBundleProfile(value: unknown): value is WorkerBundleProfile {
  return WORKER_BUNDLE_PROFILES.some((profile) => profile === value);
}
