export const WORKER_BUNDLE_DEPENDENCY_ERROR_MESSAGE =
  "Workers bundleにNode専用依存が含まれています";

const FORBIDDEN_DEPENDENCIES = [
  { id: "node-entrypoint", suffix: "/src/index.ts" },
  { id: "node-server", fragment: "/@hono/node-server/" },
  { id: "nodemailer", fragment: "/nodemailer/" },
  { id: "node-mail-adapter", suffix: "/src/lib/mail.ts" },
  { id: "node-prisma-singleton", suffix: "/src/lib/prisma.ts" },
  {
    id: "memory-rate-limit-store",
    suffix: "/src/middleware/ratelimit/in-memory-store.ts",
  },
  {
    id: "node-bcrypt-password-verifier",
    suffix: "/src/lib/bcrypt-password-verifier.ts",
  },
] as const;

function normalizeBundleInputPath(inputPath: string): string {
  const normalizedPath = `/${inputPath.replaceAll("\\", "/").toLowerCase()}`;
  return normalizedPath.replaceAll("//", "/");
}

export function findForbiddenWorkerBundleDependencies(
  inputPaths: readonly string[],
): readonly string[] {
  const matches = new Set<string>();

  for (const inputPath of inputPaths) {
    const normalizedPath = normalizeBundleInputPath(inputPath);
    for (const dependency of FORBIDDEN_DEPENDENCIES) {
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

export function assertWorkerBundleInputs(inputPaths: readonly string[]): void {
  if (findForbiddenWorkerBundleDependencies(inputPaths).length > 0) {
    throw new Error(WORKER_BUNDLE_DEPENDENCY_ERROR_MESSAGE);
  }
}
