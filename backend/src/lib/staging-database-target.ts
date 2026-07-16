const INVALID_STAGING_DATABASE_TARGET_MESSAGE = "staging DB接続先が不正です";

export type StagingDatabaseTargetEnvironment = Readonly<{
  BATCH_ENVIRONMENT?: string;
  STAGING_SUPABASE_PROJECT_REF?: string;
  DATABASE_URL?: string;
}>;

export function validateStagingDatabaseTarget(environment: StagingDatabaseTargetEnvironment): void {
  try {
    const projectRef = environment.STAGING_SUPABASE_PROJECT_REF;
    const databaseUrl = new URL(environment.DATABASE_URL ?? "");

    if (
      environment.BATCH_ENVIRONMENT !== "staging" ||
      !projectRef ||
      databaseUrl.protocol !== "postgresql:" ||
      databaseUrl.username !== "postgres." + projectRef ||
      !databaseUrl.hostname.endsWith(".pooler.supabase.com") ||
      databaseUrl.port !== "5432" ||
      databaseUrl.pathname !== "/postgres"
    ) {
      throw new Error(INVALID_STAGING_DATABASE_TARGET_MESSAGE);
    }
  } catch {
    throw new Error(INVALID_STAGING_DATABASE_TARGET_MESSAGE);
  }
}
