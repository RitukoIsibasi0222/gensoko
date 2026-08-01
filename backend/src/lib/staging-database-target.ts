import { validateSupabaseDatabaseTarget } from "./supabase-database-target.js";

export type StagingDatabaseTargetEnvironment = Readonly<{
  BATCH_ENVIRONMENT?: string;
  STAGING_SUPABASE_PROJECT_REF?: string;
  DATABASE_URL?: string;
}>;

export function validateStagingDatabaseTarget(environment: StagingDatabaseTargetEnvironment): void {
  validateSupabaseDatabaseTarget({
    environmentName: "staging",
    batchEnvironment: environment.BATCH_ENVIRONMENT,
    projectRef: environment.STAGING_SUPABASE_PROJECT_REF,
    databaseUrl: environment.DATABASE_URL,
  });
}
