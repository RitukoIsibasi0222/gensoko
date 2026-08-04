import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/staging-database.yml", import.meta.url),
);
const SEED_PATH = fileURLToPath(new URL("./seedElements.cli.ts", import.meta.url));

describe("staging database GitHub Actions workflow", () => {
  const workflow = readFileSync(WORKFLOW_PATH, "utf8");

  it("is manual-only and always uses the staging environment", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("default: apply");
    expect(workflow).toContain("- apply");
    expect(workflow).toContain("- measure-account-deletion-indexes");
    expect(workflow).toContain("- seed-elements");
    expect(workflow).not.toContain("schedule:");
    expect(workflow).toContain("environment: staging");
    expect(workflow).not.toContain("production");
    expect(workflow).toContain("group: gensoko-batch-jobs");
  });

  it("validates the environment marker and database secret without printing the URL", () => {
    expect(workflow).toContain("BATCH_ENVIRONMENT: ${{ vars.BATCH_ENVIRONMENT }}");
    expect(workflow).toContain("DATABASE_URL: ${{ secrets.DATABASE_URL }}");
    expect(workflow).toContain(
      "STAGING_SUPABASE_PROJECT_REF: ${{ secrets.STAGING_SUPABASE_PROJECT_REF }}",
    );
    expect(workflow).not.toContain("${{ vars.STAGING_SUPABASE_PROJECT_REF }}");
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
    expect(workflow).toContain("if: inputs.operation == 'apply'");
    expect(workflow).toContain("npx prisma migrate deploy");
    expect(workflow).toContain("migrationDurationMs");
    expect(workflow).toContain("writeProbeMaxDurationMs");
  });

  it("Prisma Clientを生成してからmigration write probe CLIを起動する", () => {
    const generateIndex = workflow.indexOf("run: npx prisma generate");
    const probeIndex = workflow.indexOf("npm run staging:account-deletion-performance");

    expect(generateIndex).toBeGreaterThan(-1);
    expect(probeIndex).toBeGreaterThan(generateIndex);
  });

  it("対象migrationだけを初回計測し、synthetic write probeへ三重gateを要求する", () => {
    expect(workflow).toContain("20260716112500_add_account_deletion_indexes");
    expect(workflow).toContain("migration_status_exit=$?");
    expect(workflow).toContain("/^Following migrations? have not yet been applied:$/");
    expect(workflow).toContain('target_migration="20260716112500_add_account_deletion_indexes"');
    expect(workflow).toContain(
      'if printf \'%s\\n\' "$pending_migrations" | grep -Fxq "$target_migration"; then',
    );
    expect(workflow).toContain(
      'if [ "$migration_status_exit" -ne 1 ] || [ "$pending_migrations" != "$target_migration" ]; then',
    );
    expect(workflow).not.toContain('grep -Fxq "20260716112500_add_account_deletion_indexes"');
    expect(workflow).not.toContain('grep -Fq "20260716112500_add_account_deletion_indexes"');
    expect(workflow).toContain(
      "STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED: ${{ vars.STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED }}",
    );
    expect(workflow).toContain("MEASURE_STAGING_ACCOUNT_DELETION_MIGRATION");
    expect(workflow).toContain("if: inputs.operation == 'measure-account-deletion-indexes'");
    expect(workflow).toContain("--migration-write-probe");
    expect(workflow).toContain("--probe-duration-ms=");
    expect(workflow).not.toContain('echo "$STAGING_SUPABASE_PROJECT_REF"');
    expect(workflow).not.toContain('echo "$DATABASE_URL"');
  });

  it("probe失敗時も安全な結果だけを集計し、migration確認後にjobを失敗させる", () => {
    expect(workflow).toContain("id: measure-account-deletion-indexes");
    expect(workflow).toContain('migration_log="$RUNNER_TEMP/account-deletion-migration.log"');
    expect(workflow).toContain('npx prisma migrate deploy > "$migration_log" 2>&1');
    expect(workflow).toContain('npx prisma migrate status > "$migration_status_log" 2>&1');
    expect(workflow).toContain("set +e");
    expect(workflow).toContain('wait "$probe_pid"');
    expect(workflow).toContain("probe_status=$?");
    expect(workflow).toContain("set -e");
    expect(workflow).toContain("fixtureCleanupStatus");
    expect(workflow).toContain('echo "measurement_result=$measurement_result" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain(
      "if: inputs.operation == 'apply' || steps.measure-account-deletion-indexes.outputs.measurement_result != ''",
    );
    expect(workflow).toContain(
      "if: steps.measure-account-deletion-indexes.outputs.measurement_result == 'failure'",
    );
    expect(workflow).not.toContain('cat "$probe_log"');
    expect(workflow).not.toContain('cat "$migration_log"');
    expect(workflow).not.toContain('cat "$migration_status_log"');
  });

  it("Element seedは明示確認と互換schemaを要求し、接続先検証後だけ実行する", () => {
    expect(workflow).toContain("SEED_STAGING_ELEMENTS");
    expect(workflow).toContain("seed-elements)");
    expect(workflow).toContain('if [ "$REQUESTED_CONFIRMATION" != "SEED_STAGING_ELEMENTS" ]; then');
    expect(workflow).toContain(
      'if [ "$migration_status_exit" -eq 1 ] && [ "$pending_migrations" != "$target_migration" ]; then',
    );
    expect(workflow).toContain("Element seed前に対象外のstaging migrationを適用してください");

    const targetValidationIndex = workflow.indexOf("run: npm run staging:validate-database-target");
    const seedIndex = workflow.indexOf("npm run seed:elements");

    expect(seedIndex).toBeGreaterThan(targetValidationIndex);
    expect(workflow).toContain("if: inputs.operation == 'seed-elements'");
    expect(workflow).toContain('seed_log="$RUNNER_TEMP/staging-element-seed.log"');
    expect(workflow).toContain('npm run seed:elements > "$seed_log" 2>&1');
    expect(workflow).not.toContain('cat "$seed_log"');
  });

  it("Element seedとdisconnectの失敗を固定カテゴリにし、生Errorを出さない", () => {
    const seed = readFileSync(SEED_PATH, "utf8");

    expect(seed).toContain(
      'const PREFLIGHT_FAILED_MESSAGE = "元素データの事前状態が空または正本118件ではありません"',
    );
    expect(seed).toContain(
      'const VERIFICATION_FAILED_MESSAGE = "元素データのトランザクション内検証に失敗しました"',
    );
    expect(seed).toContain(
      'const TRANSACTION_FAILED_MESSAGE = "元素データのDBトランザクション実行に失敗しました"',
    );
    expect(seed).toContain(
      'const DISCONNECT_FAILED_MESSAGE = "元素データ投入後のDB接続終了に失敗しました"',
    );
    expect(seed).toContain("await client.$disconnect()");
    expect(seed).toContain("exitCode = 1");
    expect(seed).not.toContain(".catch(console.error)");
    expect(seed).not.toContain(".finally(");
  });
});
