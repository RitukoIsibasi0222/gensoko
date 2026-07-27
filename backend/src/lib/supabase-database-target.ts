const INVALID_TARGET_MESSAGES = {
  staging: "staging DB接続先が不正です",
  production: "production DB接続先が不正です",
} as const;

const SUPABASE_PROJECT_REF_PATTERN = /^[a-z0-9]+$/;
const SUPABASE_POOLER_HOST_SUFFIX = ".pooler.supabase.com";

export type SupabaseDatabaseTarget = Readonly<{
  environmentName: "staging" | "production";
  batchEnvironment: string | undefined;
  projectRef: string | undefined;
  databaseUrl: string | undefined;
}>;

export function validateSupabaseDatabaseTarget(target: SupabaseDatabaseTarget): void {
  const invalidTargetMessage = INVALID_TARGET_MESSAGES[target.environmentName];

  try {
    const projectRef = target.projectRef;
    const databaseUrl = new URL(target.databaseUrl ?? "");

    if (
      target.batchEnvironment !== target.environmentName ||
      !projectRef ||
      !SUPABASE_PROJECT_REF_PATTERN.test(projectRef) ||
      databaseUrl.protocol !== "postgresql:" ||
      databaseUrl.username !== "postgres." + projectRef ||
      !databaseUrl.hostname.endsWith(SUPABASE_POOLER_HOST_SUFFIX) ||
      databaseUrl.hostname === SUPABASE_POOLER_HOST_SUFFIX.slice(1) ||
      databaseUrl.port !== "5432" ||
      databaseUrl.pathname !== "/postgres" ||
      databaseUrl.search !== "" ||
      databaseUrl.hash !== ""
    ) {
      throw new Error(invalidTargetMessage);
    }
  } catch {
    throw new Error(invalidTargetMessage);
  }
}
