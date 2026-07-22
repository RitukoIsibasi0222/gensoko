import { readFileSync } from "node:fs";
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

describe("production database GitHub Actions workflow", () => {
  const workflow = readFileSync(WORKFLOW_PATH, "utf8");

  it("schedules encrypted backups daily at JST 04:41 without changing the capacity schedule", () => {
    expect(countOccurrences(workflow, scheduleDeclaration(DAILY_BACKUP_CRON))).toBe(1);
    expect(countOccurrences(workflow, scheduledOperationCase(DAILY_BACKUP_CRON, "backup"))).toBe(1);
    expect(workflow).not.toContain(WEEKLY_BACKUP_CRON);
    expect(countOccurrences(workflow, scheduleDeclaration(CAPACITY_CHECK_CRON))).toBe(1);
    expect(
      countOccurrences(workflow, scheduledOperationCase(CAPACITY_CHECK_CRON, "capacity-check")),
    ).toBe(1);
  });

  it("fixes every operation to production and serializes database jobs", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("          - backup");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("environment: production");
    expect(workflow).not.toContain("environment: staging");
    expect(workflow).toContain("group: gensoko-batch-jobs");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("permissions:\n      actions: read\n      contents: read");
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
