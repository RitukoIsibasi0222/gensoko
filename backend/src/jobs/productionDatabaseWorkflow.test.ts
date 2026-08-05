import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/production-database.yml", import.meta.url),
);

const DAILY_BACKUP_CRON = "41 19 * * *";
const WEEKLY_BACKUP_CRON = "41 19 * * 6";
const CAPACITY_CHECK_CRON = "23 19 * * *";

function scheduleDeclaration(cron: string): string {
  return `- cron: "${cron}"`;
}

function scheduledOperationCase(cron: string, operation: "backup" | "capacity-check"): string {
  return `"${cron}")
                operation="${operation}"`;
}

function countOccurrences(source: string, fragment: string): number {
  return source.split(fragment).length - 1;
}

function extractPreflightScript(workflow: string): string {
  const stepStart = workflow.indexOf("      - name: Resolve and classify request");
  const runStart = workflow.indexOf("        run: |\n", stepStart);
  const jobEnd = workflow.indexOf("\n  production-database:", runStart);

  expect(stepStart).toBeGreaterThanOrEqual(0);
  expect(runStart).toBeGreaterThan(stepStart);
  expect(jobEnd).toBeGreaterThan(runStart);

  return workflow
    .slice(runStart + "        run: |\n".length, jobEnd)
    .split("\n")
    .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
    .join("\n");
}

describe("production database GitHub Actions workflow", () => {
  const workflow = readFileSync(WORKFLOW_PATH, "utf8");

  it("classifies every request before Environment, secrets, dependencies, or database access", () => {
    const validationJobStart = workflow.indexOf("  validate-production-request:");
    const productionJobStart = workflow.indexOf("  production-database:");
    const validationJob = workflow.slice(validationJobStart, productionJobStart);

    expect(validationJobStart).toBeGreaterThanOrEqual(0);
    expect(productionJobStart).toBeGreaterThan(validationJobStart);
    expect(validationJob).toContain("PRODUCTION_SCHEDULED_BATCH_ENABLED");
    expect(validationJob).toContain('result_category="disabled"');
    expect(validationJob).toContain('result_category="skipped"');
    expect(validationJob).toContain('result_category="failure"');
    expect(validationJob).toContain('result_category="ready"');
    expect(validationJob).toContain('should_run="false"');
    expect(validationJob).toContain('should_run="true"');
    expect(validationJob).toContain('if [ "$GITHUB_REF_NAME" != "main" ]; then');
    expect(validationJob).toContain("permissions: {}");
    expect(validationJob).not.toContain("environment:");
    expect(validationJob).not.toContain("secrets.");
    expect(validationJob).not.toContain("actions/checkout");
    expect(validationJob).not.toContain("npm ");
    expect(validationJob).not.toContain("psql ");
    expect(workflow.slice(productionJobStart)).toContain("needs: validate-production-request");
    expect(workflow.slice(productionJobStart)).toContain(
      "if: needs.validate-production-request.outputs.should_run == 'true'",
    );
  });

  it("ends a disabled schedule before operation resolution and exposes only a fixed safe category", () => {
    const validationJobStart = workflow.indexOf("  validate-production-request:");
    const productionJobStart = workflow.indexOf("  production-database:");
    const validationJob = workflow.slice(validationJobStart, productionJobStart);
    const disabledCheckIndex = validationJob.indexOf(
      'if [ "$PRODUCTION_SCHEDULED_BATCH_ENABLED" != "true" ]; then',
    );
    const scheduleResolutionIndex = validationJob.indexOf('case "$SCHEDULE_EXPRESSION" in');

    expect(disabledCheckIndex).toBeGreaterThanOrEqual(0);
    expect(scheduleResolutionIndex).toBeGreaterThan(disabledCheckIndex);
    expect(validationJob).toContain('echo "- Result category: $result_category"');
    expect(validationJob).toContain("- Database access: not started");
    expect(validationJob).not.toContain('echo "$PRODUCTION_SCHEDULED_BATCH_ENABLED"');
  });

  it("reproduces a disabled schedule locally without entering protected work", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "gensoko-production-preflight-"));
    const outputPath = join(temporaryDirectory, "output.txt");
    const summaryPath = join(temporaryDirectory, "summary.txt");

    try {
      const result = spawnSync("bash", ["-c", extractPreflightScript(workflow)], {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: "schedule",
          GITHUB_REF_NAME: "main",
          GITHUB_OUTPUT: outputPath,
          GITHUB_STEP_SUMMARY: summaryPath,
          PRODUCTION_SCHEDULED_BATCH_ENABLED: "false",
          REQUESTED_OPERATION: "",
          SCHEDULE_EXPRESSION: CAPACITY_CHECK_CRON,
        },
      });

      expect(result.status).toBe(0);
      expect(readFileSync(outputPath, "utf8")).toBe(
        "operation=none\nresult_category=disabled\nshould_run=false\n",
      );
      expect(readFileSync(summaryPath, "utf8")).toContain("- Result category: disabled");
      expect(readFileSync(summaryPath, "utf8")).toContain("- Database access: not started");
      expect(result.stdout).toContain("kill switchにより無効です");
      expect(result.stderr).toBe("");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("schedules encrypted backups daily at JST 04:41 without changing the capacity schedule", () => {
    expect(countOccurrences(workflow, scheduleDeclaration(DAILY_BACKUP_CRON))).toBe(1);
    expect(countOccurrences(workflow, scheduledOperationCase(DAILY_BACKUP_CRON, "backup"))).toBe(1);
    expect(workflow).not.toContain(WEEKLY_BACKUP_CRON);
    expect(countOccurrences(workflow, scheduleDeclaration(CAPACITY_CHECK_CRON))).toBe(1);
    expect(
      countOccurrences(workflow, scheduledOperationCase(CAPACITY_CHECK_CRON, "capacity-check")),
    ).toBe(1);
  });

  it("keeps manual protection while separating scheduled Environment and concurrency", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("          - backup");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain(
      "name: ${{ github.event_name == 'schedule' && 'production-batch' || 'production' }}",
    );
    expect(workflow).not.toContain("environment: staging");
    expect(workflow).toContain(
      "group: ${{ github.event_name == 'schedule' && 'gensoko-scheduled-production-database' || 'gensoko-batch-jobs' }}",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("permissions:\n      actions: read\n      contents: read");
  });

  it("resolves the requested operation before the protected production job", () => {
    const validationJobStart = workflow.indexOf("  validate-production-request:");
    const productionJobStart = workflow.indexOf("  production-database:");
    const validationJob = workflow.slice(validationJobStart, productionJobStart);
    const productionJob = workflow.slice(productionJobStart);

    expect(validationJob).toContain('operation="$REQUESTED_OPERATION"');
    expect(validationJob).toContain('echo "operation=$operation" >> "$GITHUB_OUTPUT"');
    expect(productionJob).toContain(
      "OPERATION: ${{ needs.validate-production-request.outputs.operation }}",
    );
    expect(productionJob).not.toContain("- name: Resolve requested operation");
  });

  it("adds a manual-only production Element seed operation with explicit approval inputs", () => {
    expect(workflow).toContain("          - seed-elements");
    expect(workflow).toContain("element_seed_reviewed_sha:");
    expect(workflow).toContain("element_seed_confirmation:");
    expect(workflow).toContain("element_seed_approver:");
    expect(workflow).toContain("element_seed_change_record:");
    expect(workflow).toContain(
      "capacity-check|backup|migrate-deploy|verify-v0-1-migration-indexes|account-deletion-dry-run|account-deletion-execute|seed-elements)",
    );
    expect(workflow).not.toContain('operation="seed-elements"');
  });

  it("rejects an unreviewed production Element seed before database access", () => {
    expect(workflow).toContain('if [ "$ELEMENT_SEED_REVIEWED_SHA" != "$GITHUB_SHA" ]; then');
    expect(workflow).toContain(
      'if [ "$ELEMENT_SEED_CONFIRMATION" != "SEED_PRODUCTION_ELEMENTS" ]; then',
    );
    expect(workflow).toContain(
      'if ! [[ "$ELEMENT_SEED_APPROVER" =~ ^[A-Za-z0-9._@/-]{1,100}$ ]]; then',
    );
    expect(workflow).toContain(
      'if ! [[ "$ELEMENT_SEED_CHANGE_RECORD" =~ ^[A-Za-z0-9._:/-]{1,200}$ ]]; then',
    );
  });

  it("validates the exact production target and current migrations before Element seed", () => {
    expect(workflow).toContain(
      "PRODUCTION_SUPABASE_PROJECT_REF: ${{ secrets.PRODUCTION_SUPABASE_PROJECT_REF }}",
    );
    const targetValidationIndex = workflow.indexOf("npm run production:validate-database-target");
    const migrationValidationIndex = workflow.indexOf(
      "Validate current migrations before production Element seed",
    );
    const startupProbeIndex = workflow.indexOf("node --import tsx --input-type=module --eval");
    const seedIndex = workflow.indexOf(
      'node --import tsx src/jobs/seedElements.cli.ts > "$seed_log" 2>&1',
    );

    expect(targetValidationIndex).toBeGreaterThanOrEqual(0);
    expect(migrationValidationIndex).toBeGreaterThan(targetValidationIndex);
    expect(startupProbeIndex).toBeGreaterThan(migrationValidationIndex);
    expect(seedIndex).toBeGreaterThan(startupProbeIndex);
  });

  it("generates Prisma Client only for Element seed before database access and module loading", () => {
    const installIndex = workflow.indexOf("- name: Install backend dependencies");
    const generateStepStart = workflow.indexOf(
      "- name: Generate Prisma Client for production Element seed",
    );
    const targetValidationIndex = workflow.indexOf(
      "- name: Validate exact production database target",
    );
    const startupProbeIndex = workflow.indexOf("node --import tsx --input-type=module --eval");

    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(generateStepStart).toBeGreaterThan(installIndex);
    expect(targetValidationIndex).toBeGreaterThan(generateStepStart);
    expect(startupProbeIndex).toBeGreaterThan(targetValidationIndex);

    const generateStep = workflow.slice(generateStepStart, targetValidationIndex);

    expect(generateStep).toContain("if: env.OPERATION == 'seed-elements'");
    expect(generateStep).toContain("working-directory: backend");
    expect(generateStep).toContain(
      'generate_log="$RUNNER_TEMP/production-element-seed-prisma-generate.log"',
    );
    expect(generateStep).toContain('npx prisma generate > "$generate_log" 2>&1');
    expect(generateStep).toContain('rm -f "$generate_log"');
    expect(generateStep).toContain("production元素データ用Prisma Clientの生成に失敗しました");
    expect(generateStep).not.toContain('cat "$generate_log"');
    expect(generateStep).not.toContain("DATABASE_URL");
    expect(generateStep).not.toContain("secrets.");
  });

  it("hides seed logs and independently verifies the committed 118 Elements", () => {
    const seedStepStart = workflow.indexOf("- name: Seed production Elements");
    const verifyStepStart = workflow.indexOf("- name: Verify production Elements independently");

    expect(seedStepStart).toBeGreaterThanOrEqual(0);
    expect(verifyStepStart).toBeGreaterThan(seedStepStart);

    const seedStep = workflow.slice(seedStepStart, verifyStepStart);

    expect(seedStep).toContain("timeout-minutes: 3");
    expect(workflow).toContain('startup_log="$RUNNER_TEMP/production-element-seed-startup.log"');
    expect(workflow).toContain('seed_log="$RUNNER_TEMP/production-element-seed.log"');
    expect(workflow).toContain('rm -f "$startup_log" "$seed_log"');
    expect(workflow).toContain('verify_log="$RUNNER_TEMP/production-element-seed-verify.log"');
    expect(workflow).toContain(
      'node --import tsx --input-type=module --eval "await import(\'./src/jobs/seedElements.cli.ts\')" > "$startup_log" 2>&1',
    );
    expect(workflow).toContain("production元素データCLI moduleの読込に失敗しました");
    expect(workflow).toContain('node --import tsx src/jobs/seedElements.cli.ts > "$seed_log" 2>&1');
    expect(workflow).toContain(
      'grep -Fq "元素データの事前状態が空または正本118件ではありません" "$seed_log"',
    );
    expect(workflow).toContain(
      'grep -Fq "元素データのトランザクション内検証に失敗しました" "$seed_log"',
    );
    expect(workflow).toContain(
      'grep -Fq "元素データのDBトランザクション実行に失敗しました" "$seed_log"',
    );
    expect(workflow).toContain('grep -Fq "元素データ投入後のDB接続終了に失敗しました" "$seed_log"');
    expect(workflow).toContain('grep -Fq "元素データCLIの初期化に失敗しました" "$seed_log"');
    expect(workflow).toContain('grep -Fq "元素データCLIの起動を開始しました" "$seed_log"');
    expect(workflow).toContain("production元素データCLIの起動前に失敗しました");
    expect(workflow).toContain("production元素データCLIの起動後に予期せず失敗しました");
    expect(workflow).toContain(
      'node --import tsx src/jobs/verifyElementSeed.cli.ts > "$verify_log" 2>&1',
    );
    expect(workflow).not.toContain("npm run seed:elements");
    expect(workflow).not.toContain("npm run verify:element-seed");
    expect(workflow).not.toContain('cat "$startup_log"');
    expect(workflow).not.toContain('cat "$seed_log"');
    expect(workflow).not.toContain('cat "$verify_log"');
    expect(workflow).toContain("production元素データ118件を独立検証しました");
    expect(workflow).toContain("- Reviewed SHA: verified");
    expect(workflow).toContain("- Element count and canonical data: 118 verified");
  });

  it("validates production markers and secrets without printing secret values", () => {
    expect(workflow).toContain("BATCH_ENVIRONMENT: ${{ vars.BATCH_ENVIRONMENT }}");
    expect(workflow).toContain("DATABASE_URL: ${{ secrets.DATABASE_URL }}");
    expect(workflow).toContain(
      "BACKUP_ENCRYPTION_PASSPHRASE: ${{ secrets.BACKUP_ENCRYPTION_PASSPHRASE }}",
    );
    expect(workflow).toContain('if [ "$BATCH_ENVIRONMENT" != "production" ]; then');
    expect(workflow).toContain('if [ -z "$DATABASE_URL" ]; then');
    expect(workflow).not.toContain('echo "$DATABASE_URL"');
    expect(workflow).not.toContain('echo "$BACKUP_ENCRYPTION_PASSPHRASE"');
  });

  it("checks the Free Plan quota at the documented warning and critical thresholds", () => {
    expect(workflow).toContain('DATABASE_QUOTA_BYTES: "500000000"');
    expect(workflow).toContain('DATABASE_WARNING_PERCENT: "70"');
    expect(workflow).toContain('DATABASE_CRITICAL_PERCENT: "85"');
    expect(workflow).toContain("SELECT pg_database_size(current_database());");
    expect(workflow).toContain("容量警告");
    expect(workflow).toContain("容量重大");
    expect(workflow).toContain('capacity_error_log="$RUNNER_TEMP/production-capacity-error.log"');
    expect(workflow).toContain('2>"$capacity_error_log"');
    expect(workflow).not.toContain('cat "$capacity_error_log"');
  });

  it("uploads only an encrypted logical backup and verifies it before upload", () => {
    expect(workflow).toContain("if: env.OPERATION == 'backup'");
    expect(workflow).toContain("supabase db dump");
    expect(workflow).toContain("--role-only");
    expect(workflow).toContain("--data-only");
    expect(workflow).toContain("--use-copy");
    expect(workflow).toContain("--cipher-algo AES256");
    expect(workflow).toContain("--passphrase-fd 0");
    expect(workflow).toContain("gpg --decrypt");
    expect(workflow).toContain("tar -tzf");
    expect(workflow).toContain("sha256sum");
    expect(workflow).toContain("trap cleanup_plaintext EXIT");
    expect(workflow).toContain('backup_command_log="$RUNNER_TEMP/production-backup-command.log"');
    expect(workflow).toContain('> "$backup_command_log" 2>&1');
    expect(workflow).not.toContain('cat "$backup_command_log"');
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("retention-days: 7");
    expect(workflow).toContain("path: ${{ runner.temp }}/production-db-artifacts");
    expect(workflow).not.toContain("path: roles.sql");
    expect(workflow).not.toContain("path: schema.sql");
    expect(workflow).not.toContain("path: data.sql");
  });

  it("requires a successful unexpired backup artifact before protected database operations", () => {
    expect(workflow).toContain("confirmed_backup_run_id:");
    expect(workflow).toContain(
      "if: env.OPERATION == 'migrate-deploy' || env.OPERATION == 'account-deletion-execute'",
    );
    expect(workflow).toContain("if: env.OPERATION == 'migrate-deploy'");
    expect(workflow).toContain("production-db-backup-${BACKUP_RUN_ID}");
    expect(workflow).toContain("artifacts");
    expect(workflow).toContain("expired");
    expect(workflow).toContain("run: npx prisma migrate deploy");
  });
});
