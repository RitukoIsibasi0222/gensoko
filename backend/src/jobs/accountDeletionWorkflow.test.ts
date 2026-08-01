import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const STAGING_WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/staging-account-data-deletion.yml", import.meta.url),
);
const PRODUCTION_WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/production-database.yml", import.meta.url),
);

function readStagingWorkflow(): string {
  return readFileSync(STAGING_WORKFLOW_PATH, "utf8");
}

function readProductionWorkflow(): string {
  return readFileSync(PRODUCTION_WORKFLOW_PATH, "utf8");
}

describe("staging account data deletion workflow", () => {
  it("manual-only・staging固定・共通batch concurrencyで実行する", () => {
    const workflow = readStagingWorkflow();

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("schedule:");
    expect(workflow).toContain("environment: staging");
    expect(workflow).not.toContain("environment: production");
    expect(workflow).toContain("group: gensoko-batch-jobs");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("permissions:\n      contents: read");
  });

  it("dry-runとexecuteだけを選択でき、develop以外を拒否する", () => {
    const workflow = readStagingWorkflow();

    expect(workflow).toContain("operation:");
    expect(workflow).toContain("- dry-run");
    expect(workflow).toContain("- execute");
    expect(workflow).toContain('if [ "$GITHUB_REF_NAME" != "develop" ]; then');
    expect(workflow).not.toContain("- account-deletion-dry-run");
    expect(workflow).not.toContain("- account-deletion-execute");
  });

  it("staging marker・DB secret・execute flag・確認文字列をDB操作前に検証する", () => {
    const workflow = readStagingWorkflow();

    expect(workflow).toContain("BATCH_ENVIRONMENT: ${{ vars.BATCH_ENVIRONMENT }}");
    expect(workflow).toContain(
      "ACCOUNT_DATA_DELETION_EXECUTE_ENABLED: ${{ vars.ACCOUNT_DATA_DELETION_EXECUTE_ENABLED }}",
    );
    expect(workflow).toContain("DATABASE_URL: ${{ secrets.DATABASE_URL }}");
    expect(workflow).toContain('if [ "$BATCH_ENVIRONMENT" != "staging" ]; then');
    expect(workflow).toContain("confirmation:");
    expect(workflow).toContain("DELETE_LEGACY_SOFT_DELETED_USERS");
  });

  it("専用CLIだけを起動し、schedule wrapperや秘密値出力を行わない", () => {
    const workflow = readStagingWorkflow();

    expect(workflow).toContain("npm run delete:legacy-soft-deleted-users");
    expect(workflow).toContain("--execute");
    expect(workflow).toContain("--confirm=DELETE_LEGACY_SOFT_DELETED_USERS");
    expect(workflow).not.toContain("npm run batch:scheduled");
    expect(workflow).not.toContain('echo "$DATABASE_URL"');
    expect(workflow).not.toContain('echo "$ACCOUNT_DATA_DELETION_EXECUTE_ENABLED"');
  });
});

describe("production account data deletion workflow", () => {
  it("既存production DB workflowのmanual operationへdry-runとexecuteを追加する", () => {
    const workflow = readProductionWorkflow();

    expect(workflow).toContain("- account-deletion-dry-run");
    expect(workflow).toContain("- account-deletion-execute");
    expect(workflow).toContain("account_deletion_confirmation:");
    expect(workflow).toContain("account_deletion_approver:");
    expect(workflow).toContain("account_deletion_change_record:");
    expect(workflow).toContain("account_deletion_dry_run_run_id:");
  });

  it("production・main・execute flag・確認文字列・承認記録を必須にする", () => {
    const workflow = readProductionWorkflow();

    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("BATCH_ENVIRONMENT: ${{ vars.BATCH_ENVIRONMENT }}");
    expect(workflow).toContain(
      "ACCOUNT_DATA_DELETION_EXECUTE_ENABLED: ${{ vars.ACCOUNT_DATA_DELETION_EXECUTE_ENABLED }}",
    );
    expect(workflow).toContain('if [ "$GITHUB_REF_NAME" != "main" ]; then');
    expect(workflow).toContain('if [ "$OPERATION" = "account-deletion-execute" ]; then');
    expect(workflow).toContain('if [ "$ACCOUNT_DATA_DELETION_EXECUTE_ENABLED" != "true" ]; then');
    expect(workflow).toContain("DELETE_LEGACY_SOFT_DELETED_USERS");
    expect(workflow).toContain("ACCOUNT_DELETION_APPROVER");
    expect(workflow).toContain("ACCOUNT_DELETION_CHANGE_RECORD");
  });

  it("execute前にmain上の24時間以内の成功backup Artifactを検証する", () => {
    const workflow = readProductionWorkflow();

    expect(workflow).toContain(
      "env.OPERATION == 'migrate-deploy' || env.OPERATION == 'account-deletion-execute'",
    );
    expect(workflow).toContain("confirmed_backup_run_id:");
    expect(workflow).toContain("production-db-backup-${BACKUP_RUN_ID}");
    expect(workflow).toContain("production-account-deletion-dry-run-${DRY_RUN_RUN_ID}");
    expect(workflow).toContain("run_conclusion=\"$(jq --raw-output '.conclusion'");
    expect(workflow).toContain("run_head_branch=\"$(jq --raw-output '.head_branch'");
    expect(workflow).toContain('"main"');
    expect(workflow).toContain("86400");
    expect(workflow).toContain("expired == false");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("retention-days: 1");
  });

  it("dry-runと三重gate付きexecuteで専用CLIを起動し、change recordをsummaryへ残す", () => {
    const workflow = readProductionWorkflow();

    expect(workflow).toContain("if: env.OPERATION == 'account-deletion-dry-run'");
    expect(workflow).toContain("if: env.OPERATION == 'account-deletion-execute'");
    expect(workflow).toContain("npm run delete:legacy-soft-deleted-users");
    expect(workflow).toContain("--execute");
    expect(workflow).toContain("--confirm=DELETE_LEGACY_SOFT_DELETED_USERS");
    expect(workflow).toContain("Account data deletion change record");
    expect(workflow).toContain("ACCOUNT_DELETION_APPROVER");
    expect(workflow).toContain("ACCOUNT_DELETION_CHANGE_RECORD");
    expect(workflow).not.toContain('echo "$DATABASE_URL"');
  });

  it("account deletionをscheduleから選択せず、既存batch concurrencyを維持する", () => {
    const workflow = readProductionWorkflow();
    const scheduleBranchStart = workflow.indexOf('if [ "$GITHUB_EVENT_NAME" = "schedule" ]; then');
    const manualBranchStart = workflow.indexOf("else", scheduleBranchStart);
    const scheduleBranch = workflow.slice(scheduleBranchStart, manualBranchStart);

    expect(scheduleBranchStart).toBeGreaterThanOrEqual(0);
    expect(manualBranchStart).toBeGreaterThan(scheduleBranchStart);
    expect(scheduleBranch).not.toContain("account-deletion-dry-run");
    expect(scheduleBranch).not.toContain("account-deletion-execute");
    expect(workflow).toContain("group: gensoko-batch-jobs");
    expect(workflow).toContain("cancel-in-progress: false");
  });
});
