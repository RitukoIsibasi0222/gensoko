import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/batch.yml", import.meta.url),
);
const workflow = readFileSync(WORKFLOW_PATH, "utf8");

function getWorkflowStep(stepName: string): string {
  const marker = `      - name: ${stepName}`;
  const start = workflow.indexOf(marker);

  expect(start, `${stepName} step should exist`).toBeGreaterThanOrEqual(0);

  const nextStep = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, nextStep === -1 ? undefined : nextStep);
}

describe("batch GitHub Actions workflow", () => {
  it("schedules audit log cleanup daily at UTC 18:37", () => {
    expect(workflow).toContain('- cron: "37 18 * * *"');
  });

  it("offers separate explicit manual dry-run and execute modes", () => {
    expect(workflow).toContain("- audit-log-cleanup-dry-run");
    expect(workflow).toContain("- audit-log-cleanup-execute");

    const dryRunStep = getWorkflowStep("Preview audit log cleanup");
    expect(dryRunStep).toContain("inputs.batch_job == 'audit-log-cleanup-dry-run'");
    expect(dryRunStep).toContain("npm run cleanup:audit-logs -- --dry-run");

    const executeStep = getWorkflowStep("Execute audit log cleanup");
    expect(executeStep).toContain("inputs.batch_job == 'audit-log-cleanup-execute'");
    expect(executeStep).toContain("npm run cleanup:audit-logs -- --execute");
  });

  it("routes manual audit modes around the scheduled batch steps", () => {
    for (const stepName of ["Resolve scheduled cron", "Run scheduled batch"]) {
      const step = getWorkflowStep(stepName);

      expect(step).toContain("github.event_name == 'schedule'");
      expect(step).toContain("inputs.batch_job == 'weekly-reset'");
      expect(step).toContain("inputs.batch_job == 'game-question-set-cleanup'");
      expect(step).not.toContain("audit-log-cleanup-dry-run");
      expect(step).not.toContain("audit-log-cleanup-execute");
    }
  });

  it("passes retention settings as Variables and the database URL as a Secret", () => {
    expect(workflow).toContain("AUDIT_LOG_RETENTION_DAYS: ${{ vars.AUDIT_LOG_RETENTION_DAYS }}");
    expect(workflow).toContain("AUDIT_LOG_CLEANUP_ENABLED: ${{ vars.AUDIT_LOG_CLEANUP_ENABLED }}");

    for (const stepName of [
      "Run scheduled batch",
      "Preview audit log cleanup",
      "Execute audit log cleanup",
    ]) {
      expect(getWorkflowStep(stepName)).toContain("DATABASE_URL: ${{ secrets.DATABASE_URL }}");
    }
  });

  it("serializes scheduled and manual batch executions with one stable concurrency group", () => {
    expect(workflow).toContain("group: gensoko-batch-jobs");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).not.toContain("group: batch-${{");
  });

  it("allows the 8-minute service limit to finish before workflow timeout", () => {
    expect(workflow).toContain("    timeout-minutes: 20");

    for (const stepName of [
      "Run scheduled batch",
      "Preview audit log cleanup",
      "Execute audit log cleanup",
    ]) {
      expect(getWorkflowStep(stepName)).toContain("        timeout-minutes: 10");
    }
  });
});
