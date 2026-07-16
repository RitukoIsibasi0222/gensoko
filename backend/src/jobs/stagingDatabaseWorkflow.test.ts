import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/staging-database.yml", import.meta.url),
);

describe("staging database GitHub Actions workflow", () => {
  const workflow = readFileSync(WORKFLOW_PATH, "utf8");

  it("is manual-only and always uses the staging environment", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("schedule:");
    expect(workflow).toContain("environment: staging");
    expect(workflow).not.toContain("production");
    expect(workflow).toContain("group: gensoko-batch-jobs");
  });

  it("validates the environment marker and database secret without printing the URL", () => {
    expect(workflow).toContain("BATCH_ENVIRONMENT: ${{ vars.BATCH_ENVIRONMENT }}");
    expect(workflow).toContain("DATABASE_URL: ${{ secrets.DATABASE_URL }}");
    expect(workflow).toContain(
      "STAGING_SUPABASE_PROJECT_REF: ${{ vars.STAGING_SUPABASE_PROJECT_REF }}",
    );
    expect(workflow).toContain('if [ "$BATCH_ENVIRONMENT" != "staging" ]; then');
    expect(workflow).toContain(
      'if [ -z "$STAGING_SUPABASE_PROJECT_REF" ] || [ -z "$DATABASE_URL" ]; then',
    );
    expect(workflow).toContain("run: npm run staging:validate-database-target");
    expect(workflow).not.toContain('echo "$DATABASE_URL"');
  });

  it("applies existing Prisma migrations with least-privilege workflow permissions", () => {
    expect(workflow).toContain("permissions:\n      contents: read");
    expect(workflow).toContain("working-directory: backend");
    expect(workflow).toContain("run: npm ci");
    expect(workflow).toContain("npx prisma migrate deploy");
    expect(workflow).toContain("migrationDurationMs");
    expect(workflow).toContain("writeProbeMaxDurationMs");
  });

  it("対象migrationだけを初回計測し、synthetic write probeへ三重gateを要求する", () => {
    expect(workflow).toContain("20260716112500_add_account_deletion_indexes");
    expect(workflow).toContain("migration_status_exit=$?");
    expect(workflow).toContain('if [ "$migration_status_exit" -ne 1 ]; then');
    expect(workflow).toContain("/^Following migrations? have not yet been applied:$/");
    expect(workflow).toContain('grep -Fxq "20260716112500_add_account_deletion_indexes"');
    expect(workflow).not.toContain('grep -Fq "20260716112500_add_account_deletion_indexes"');
    expect(workflow).toContain(
      "STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED: ${{ vars.STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED }}",
    );
    expect(workflow).toContain("MEASURE_STAGING_ACCOUNT_DELETION_MIGRATION");
    expect(workflow).toContain("--migration-write-probe");
    expect(workflow).toContain("--probe-duration-ms=");
    expect(workflow).not.toContain('echo "$STAGING_SUPABASE_PROJECT_REF"');
    expect(workflow).not.toContain('echo "$DATABASE_URL"');
  });
});
