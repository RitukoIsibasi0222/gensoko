import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOWS_DIRECTORY = fileURLToPath(new URL("../../../.github/workflows/", import.meta.url));
const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/batch.yml", import.meta.url),
);
const INTEGRITY_WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/repository-integrity.yml", import.meta.url),
);
const DEPLOYMENT_GUIDE_PATH = fileURLToPath(
  new URL("../../../docs/11_deployment.md", import.meta.url),
);
const workflow = readFileSync(WORKFLOW_PATH, "utf8");
const deploymentGuide = readFileSync(DEPLOYMENT_GUIDE_PATH, "utf8");

function getWorkflowStep(stepName: string): string {
  const marker = `      - name: ${stepName}`;
  const start = workflow.indexOf(marker);

  expect(start, `${stepName} step should exist`).toBeGreaterThanOrEqual(0);

  const nextStep = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, nextStep === -1 ? undefined : nextStep);
}

function getWorkflowDispatchInput(inputName: string, nextInputName: string): string {
  const start = workflow.indexOf(`      ${inputName}:`);
  const end = workflow.indexOf(`      ${nextInputName}:`, start);

  expect(start, `${inputName} input should exist`).toBeGreaterThanOrEqual(0);
  expect(end, `${nextInputName} input should follow ${inputName}`).toBeGreaterThan(start);

  return workflow.slice(start, end);
}

describe("batch GitHub Actions workflow", () => {
  it("validates staging=develop and production/schedule=main before any Environment or secret", () => {
    const validationJobStart = workflow.indexOf("  validate-batch-request:");
    const batchJobStart = workflow.indexOf("  scheduled-batch:");
    const validationJob = workflow.slice(validationJobStart, batchJobStart);

    expect(validationJobStart).toBeGreaterThanOrEqual(0);
    expect(batchJobStart).toBeGreaterThan(validationJobStart);
    expect(validationJob).toContain('expected_branch="main"');
    expect(validationJob).toContain('expected_branch="develop"');
    expect(validationJob).toContain('if [ "$GITHUB_REF_NAME" != "$expected_branch" ]; then');
    expect(validationJob).toContain("permissions: {}");
    expect(validationJob).not.toContain("environment:");
    expect(validationJob).not.toContain("secrets.");
    expect(workflow.slice(batchJobStart)).toContain("needs: validate-batch-request");
  });

  it("uses staging or production for manual runs and production-batch only for schedules", () => {
    const targetEnvironmentInput = getWorkflowDispatchInput("target_environment", "batch_job");

    expect(targetEnvironmentInput).toContain("default: staging");
    expect(targetEnvironmentInput).toContain("- staging");
    expect(targetEnvironmentInput).toContain("- production");
    expect(targetEnvironmentInput).not.toContain("production-batch");
    expect(workflow).toContain(
      "name: ${{ github.event_name == 'schedule' && 'production-batch' || inputs.target_environment }}",
    );
  });

  it("keeps scheduled runs disabled unless the repository kill switch is true", () => {
    const jobStart = workflow.indexOf("  validate-batch-request:");
    const conditionStart = workflow.indexOf("    if: >-", jobStart);
    const validationStepStart = workflow.indexOf("    steps:", jobStart);

    expect(jobStart).toBeGreaterThanOrEqual(0);
    expect(conditionStart).toBeGreaterThan(jobStart);
    expect(conditionStart).toBeLessThan(validationStepStart);
    expect(workflow.slice(conditionStart, validationStepStart)).toContain(
      "github.event_name == 'workflow_dispatch' ||\n      vars.PRODUCTION_SCHEDULED_BATCH_ENABLED == 'true'",
    );
  });

  it("fails before database work when the selected environment is not configured", () => {
    expect(workflow).toContain("BATCH_ENVIRONMENT: ${{ vars.BATCH_ENVIRONMENT }}");

    const validationStep = getWorkflowStep("Validate batch environment");
    expect(validationStep).toContain(
      "EXPECTED_ENVIRONMENT: ${{ github.event_name == 'schedule' && 'production' || inputs.target_environment }}",
    );
    expect(validationStep).toContain("DATABASE_URL: ${{ secrets.DATABASE_URL }}");
    expect(validationStep).toContain(
      'if [ "$BATCH_ENVIRONMENT" != "$EXPECTED_ENVIRONMENT" ]; then',
    );
    expect(validationStep).toContain('if [ -z "$DATABASE_URL" ]; then');
    expect(validationStep).not.toContain('echo "$DATABASE_URL"');
  });

  it("schedules GameQuestionSet cleanup once daily and removes the 30-minute crons", () => {
    expect(workflow.match(/- cron: "17 18 \* \* \*"/g)).toHaveLength(1);
    expect(workflow).not.toContain('- cron: "17,47 * * * *"');
    expect(workflow).not.toContain("BATCH_CRON=17,47 * * * *");
    expect(workflow).not.toContain("*/30 * * * *");

    const resolveStep = getWorkflowStep("Resolve scheduled cron");
    expect(resolveStep).toContain('echo "BATCH_CRON=17 18 * * *" >> "$GITHUB_ENV"');
  });

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

  it("documents the refresh token cleanup flag for every batch Environment", () => {
    expect(workflow).toContain(
      "REFRESH_TOKEN_CLEANUP_ENABLED: ${{ vars.REFRESH_TOKEN_CLEANUP_ENABLED }}",
    );

    const documentedEnvironmentRows = deploymentGuide
      .split("\n")
      .filter((line) => line.startsWith("| ") && line.includes("`REFRESH_TOKEN_CLEANUP_ENABLED`"));

    expect(documentedEnvironmentRows).toHaveLength(3);
    for (const environmentName of ["staging", "production", "production-batch"]) {
      expect(documentedEnvironmentRows).toContainEqual(
        expect.stringMatching(new RegExp(`^\\| ${environmentName}\\s+\\| Variable \\|`)),
      );
    }
  });

  it("states that batch configuration belongs to Environments rather than repository-level Actions settings", () => {
    expect(deploymentGuide).toContain(
      "repository-level（Settings > Secrets and variables > Actions）へ登録せず、表に示す各Environmentへ登録する。",
    );
  });

  it("separates scheduled concurrency while preserving the manual database operation group", () => {
    expect(workflow).toContain(
      "group: ${{ github.event_name == 'schedule' && 'gensoko-scheduled-batch' || 'gensoko-batch-jobs' }}",
    );
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("allows production-batch references only in the batch workflow", () => {
    const workflowFiles = readdirSync(WORKFLOWS_DIRECTORY).filter(
      (fileName) => fileName.endsWith(".yml") || fileName.endsWith(".yaml"),
    );

    for (const fileName of workflowFiles) {
      const source = readFileSync(`${WORKFLOWS_DIRECTORY}/${fileName}`, "utf8");

      if (fileName === "batch.yml") {
        expect(source).toContain("production-batch");
      } else {
        expect(source, `${fileName} must not use production-batch`).not.toContain(
          "production-batch",
        );
      }
    }
  });

  it("defines an always-on minimum-permission repository integrity check", () => {
    const integrityWorkflow = readFileSync(INTEGRITY_WORKFLOW_PATH, "utf8");

    expect(integrityWorkflow).toContain("name: Repository Integrity");
    expect(integrityWorkflow).toContain("pull_request:");
    expect(integrityWorkflow).toContain("branches: [develop, main]");
    expect(integrityWorkflow).not.toContain("paths:");
    expect(integrityWorkflow).toContain("permissions:\n  contents: read");
    expect(integrityWorkflow).toContain("  repository-integrity:");
    expect(integrityWorkflow).not.toContain("environment:");
    expect(integrityWorkflow).not.toContain("secrets.");
    expect(integrityWorkflow).not.toContain("production-batch");
    expect(integrityWorkflow).toContain("src/jobs/batchWorkflow.test.ts");
    expect(integrityWorkflow).toContain("src/jobs/scheduled.test.ts");
    expect(integrityWorkflow).toContain("src/jobs/scheduled.cli.test.ts");
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
