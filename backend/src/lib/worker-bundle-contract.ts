import {
  isWorkerBundleProfile,
  WORKER_BUNDLE_ENTRYPOINT_BY_PROFILE,
  WORKER_BUNDLE_PROFILES,
  type WorkerBundleProfile,
} from "./worker-bundle-profile.js";

export const WORKER_BUNDLE_DEPENDENCY_ERROR_MESSAGE =
  "Workers bundleに許可されない依存が含まれています";

export { isWorkerBundleProfile, WORKER_BUNDLE_PROFILES, type WorkerBundleProfile };

const COMMON_FORBIDDEN_DEPENDENCIES = [
  { id: "node-entrypoint", suffix: "/src/index.ts" },
  { id: "node-server", fragment: "/@hono/node-server/" },
  { id: "nodemailer", fragment: "/nodemailer/" },
  { id: "node-mail-adapter", suffix: "/src/lib/mail.ts" },
  { id: "node-prisma-singleton", suffix: "/src/lib/prisma.ts" },
  {
    id: "memory-rate-limit-store",
    suffix: "/src/middleware/ratelimit/in-memory-store.ts",
  },
] as const;

type WorkerBundleDependency = Readonly<
  { id: string; suffix: string } | { id: string; fragment: string }
>;

function getProfileForbiddenDependencies(
  profile: WorkerBundleProfile,
): readonly WorkerBundleDependency[] {
  const entrypointDependencies = WORKER_BUNDLE_PROFILES.filter(
    (candidate) => candidate !== profile,
  ).map((candidate) => ({
    id:
      candidate === "staging-rollback-baseline"
        ? "staging-rollback-baseline-entrypoint"
        : `${candidate}-entrypoint`,
    suffix: `/src/${WORKER_BUNDLE_ENTRYPOINT_BY_PROFILE[candidate]}`,
  }));

  if (profile === "staging-rollback-baseline") {
    return entrypointDependencies;
  }

  return [
    ...entrypointDependencies,
    {
      id: "node-bcrypt-password-verifier",
      suffix: "/src/lib/bcrypt-password-verifier.ts",
    },
  ];
}

function normalizeBundleInputPath(inputPath: string): string {
  const normalizedPath = `/${inputPath.replaceAll("\\", "/").toLowerCase()}`;
  return normalizedPath.replaceAll("//", "/");
}

export function findForbiddenWorkerBundleDependencies(
  inputPaths: readonly string[],
  profile: WorkerBundleProfile = "standard",
): readonly string[] {
  const matches = new Set<string>();
  const forbiddenDependencies: readonly WorkerBundleDependency[] = [
    ...COMMON_FORBIDDEN_DEPENDENCIES,
    ...getProfileForbiddenDependencies(profile),
  ];

  for (const inputPath of inputPaths) {
    const normalizedPath = normalizeBundleInputPath(inputPath);
    for (const dependency of forbiddenDependencies) {
      const isMatch =
        ("suffix" in dependency && normalizedPath.endsWith(dependency.suffix)) ||
        ("fragment" in dependency && normalizedPath.includes(dependency.fragment));
      if (isMatch) {
        matches.add(dependency.id);
      }
    }
  }

  return [...matches];
}

export function assertWorkerBundleInputs(
  inputPaths: readonly string[],
  profile: WorkerBundleProfile = "standard",
): void {
  if (findForbiddenWorkerBundleDependencies(inputPaths, profile).length > 0) {
    throw new Error(WORKER_BUNDLE_DEPENDENCY_ERROR_MESSAGE);
  }
}
