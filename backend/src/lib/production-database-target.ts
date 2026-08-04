import { validateSupabaseDatabaseTarget } from "./supabase-database-target.js";

export type ProductionDatabaseTargetEnvironment = Readonly<{
  BATCH_ENVIRONMENT?: string;
  PRODUCTION_SUPABASE_PROJECT_REF?: string;
  DATABASE_URL?: string;
}>;

export function validateProductionDatabaseTarget(
  environment: ProductionDatabaseTargetEnvironment,
): void {
  validateSupabaseDatabaseTarget({
    environmentName: "production",
    batchEnvironment: environment.BATCH_ENVIRONMENT,
    projectRef: environment.PRODUCTION_SUPABASE_PROJECT_REF,
    databaseUrl: environment.DATABASE_URL,
  });
}
