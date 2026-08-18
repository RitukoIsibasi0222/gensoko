import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/staging-supabase-health-check.yml", import.meta.url),
);
const INTEGRITY_WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/repository-integrity.yml", import.meta.url),
);
const DEPLOYMENT_GUIDE_PATH = fileURLToPath(
  new URL("../../../docs/11_deployment.md", import.meta.url),
);

const workflow = readFileSync(WORKFLOW_PATH, "utf8");
const integrityWorkflow = readFileSync(INTEGRITY_WORKFLOW_PATH, "utf8");
const deploymentGuide = readFileSync(DEPLOYMENT_GUIDE_PATH, "utf8");

function getWorkflowStep(stepName: string): string {
  const marker = `      - name: ${stepName}`;
  const start = workflow.indexOf(marker);

  expect(start, `${stepName} step should exist`).toBeGreaterThanOrEqual(0);

  const nextStep = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, nextStep === -1 ? undefined : nextStep);
}

describe("staging Supabase health check GitHub Actions workflow", () => {
  it("runs three times daily and supports an explicit manual check", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow.match(/- cron: "17 0,8,16 \* \* \*"/g)).toHaveLength(1);
    expect(workflow).not.toContain("inputs:");
  });

  it("allows only the reviewed main workflow to send the request", () => {
    const branchValidationStep = getWorkflowStep("Validate workflow branch");

    expect(branchValidationStep).toContain('if [ "$GITHUB_REF_NAME" != "main" ]; then');
    expect(branchValidationStep).toContain("staging health checkはmain branchから実行してください");
  });

  it("uses the fixed staging element detail endpoint without credentials", () => {
    expect(workflow).toContain(
      "STAGING_HEALTH_CHECK_URL: https://gensoko-api-staging.rituko-labs.workers.dev/api/v1/elements/1",
    );
    expect(workflow).not.toContain("environment:");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("DATABASE_URL");
    expect(workflow).not.toContain("production-batch");
  });

  it("uses minimum permissions, bounded retries, and never prints the response body", () => {
    const healthCheckStep = getWorkflowStep("Query staging database through the API");

    expect(workflow).toContain("permissions: {}");
    expect(workflow).toContain("timeout-minutes: 5");
    expect(workflow).toContain("group: gensoko-staging-supabase-health-check");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).not.toContain("actions/checkout");
    expect(healthCheckStep).toContain('--header "Cache-Control: no-cache"');
    expect(healthCheckStep).toContain("--fail-with-body");
    expect(healthCheckStep).toContain("--connect-timeout 15");
    expect(healthCheckStep).toContain("--max-time 30");
    expect(healthCheckStep).toContain("--retry 2");
    expect(healthCheckStep).toContain("--retry-all-errors");
    expect(healthCheckStep).toContain("--output /dev/null");
    expect(healthCheckStep).toContain('--write-out "%{http_code}"');
    expect(healthCheckStep).toContain(
      'if [ "$curl_exit" -ne 0 ] || [ "$http_status" != "200" ]; then',
    );
    expect(healthCheckStep).not.toContain("cat ");
  });

  it("keeps the contract test in the always-on repository integrity check", () => {
    expect(integrityWorkflow).toContain("src/jobs/stagingSupabaseHealthCheckWorkflow.test.ts");
  });

  it("documents the free-plan limitation and recovery procedure", () => {
    expect(deploymentGuide).toContain("## Staging Supabase Free Plan自動停止防止");
    expect(deploymentGuide).toContain("保証される対策はPro Planへの変更");
    expect(deploymentGuide).toContain("Staging Supabase Health Check");
    expect(deploymentGuide).toContain("Resume project");
    expect(deploymentGuide).toContain("レスポンス本文をlogへ出さない");
  });
});
