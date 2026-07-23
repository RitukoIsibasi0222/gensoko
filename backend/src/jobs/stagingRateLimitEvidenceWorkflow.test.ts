import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/staging-rate-limit-evidence.yml", import.meta.url),
);

describe("staging rate limit evidence workflow", () => {
  it("manual・develop・staging Environment・共通concurrencyだけに限定する", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("schedule:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).not.toContain("push:");
    expect(workflow).toContain("environment: staging");
    expect(workflow).toContain('if [ "$GITHUB_REF_NAME" != "develop" ]');
    expect(workflow).toContain("group: gensoko-batch-jobs");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("contents: read");
  });

  it("1実行1caseに限定し、3つの境界caseだけを受け付ける", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("case:");
    expect(workflow).toContain("type: choice");
    expect(workflow).toContain("- auth");
    expect(workflow).toContain("- questions");
    expect(workflow).toContain("- game-submit");
    expect(workflow).toContain("STAGING_RATE_LIMIT_EVIDENCE_CASE: ${{ inputs.case }}");
    expect(workflow).toContain("npm run staging:rate-limit-evidence");
  });

  it("review済みSHA・確認文字列・承認者・change recordをfixture作成前に検証する", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    const gateIndex = workflow.indexOf("Validate branch, SHA and approval gates");
    const prepareIndex = workflow.indexOf("--operation prepare");

    expect(workflow).toContain("reviewed_sha:");
    expect(workflow).toContain("confirmation:");
    expect(workflow).toContain("approved_by:");
    expect(workflow).toContain("change_record:");
    expect(workflow).toContain("RUN_STAGING_RATE_LIMIT_EVIDENCE");
    expect(workflow).toContain('[[ ! "$REQUESTED_REVIEWED_SHA" =~ ^[0-9a-f]{40}$ ]]');
    expect(workflow).toContain('[ "$REQUESTED_REVIEWED_SHA" != "$GITHUB_SHA" ]');
    expect(workflow).toContain('[[ ! "$REQUESTED_APPROVED_BY" =~ ^[A-Za-z0-9._-]{1,100}$ ]]');
    expect(workflow).toContain('[[ ! "$REQUESTED_CHANGE_RECORD" =~ ^[A-Za-z0-9._:/-]{1,100}$ ]]');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(prepareIndex).toBeGreaterThan(gateIndex);
  });

  it("固定staging URLと既存fixture guardを使いproduction targetを持たない", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("STAGING_SUPABASE_PROJECT_REF");
    expect(workflow).toContain("secrets.DATABASE_URL");
    expect(workflow).toContain("npm run staging:validate-database-target");
    expect(workflow).toContain("https://gensoko-frontend-staging-develop.vercel.app");
    expect(workflow).toContain("https://gensoko-api-staging.rituko-labs.workers.dev/api/v1");
    expect(workflow).toContain("STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED");
    expect(workflow).toContain('STAGING_RATE_LIMIT_REQUEST_TIMEOUT_MS: "10000"');
    expect(workflow).not.toContain("environment: production");
    expect(workflow).not.toContain("secrets.PRODUCTION");
  });

  it("ephemeral credentialをmaskし、log・artifact・CLI引数へ出さない", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    const jobEnvironment = workflow.slice(
      workflow.indexOf("    env:"),
      workflow.indexOf("    steps:"),
    );

    expect(workflow).toContain("randomBytes");
    expect(workflow).toContain("::add-mask::");
    expect(workflow).toContain("GITHUB_OUTPUT");
    expect(workflow).not.toContain("GITHUB_ENV");
    expect(workflow).not.toContain("--password");
    expect(workflow).not.toContain("upload-artifact");
    expect(jobEnvironment).not.toContain("STAGING_SYNTHETIC_USER_PASSWORD");
    expect(workflow.match(/STAGING_SYNTHETIC_USER_PASSWORD:/g)).toHaveLength(2);
    expect(workflow).not.toContain("STAGING_SYNTHETIC_USER_EMAIL:");
  });

  it("fixture prepare後に時間制限付きrunnerを実行し、常時cleanupと独立recoveryを行う", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    const lifecycleIndex = workflow.indexOf("Mark fixture lifecycle started");
    const prepareIndex = workflow.indexOf("--operation prepare");
    const evidenceIndex = workflow.indexOf("npm run staging:rate-limit-evidence");
    const cleanupIndex = workflow.indexOf("--operation remove");

    expect(lifecycleIndex).toBeGreaterThan(-1);
    expect(prepareIndex).toBeGreaterThan(lifecycleIndex);
    expect(evidenceIndex).toBeGreaterThan(prepareIndex);
    expect(cleanupIndex).toBeGreaterThan(evidenceIndex);
    expect(workflow.match(/--operation remove/g)).toHaveLength(2);
    expect(workflow).toContain(
      "if: ${{ always() && steps.fixture_lifecycle.outputs.started == 'true' }}",
    );
    expect(workflow).toContain("cleanup-staging-rate-limit-fixtures:");
    expect(workflow).toContain("needs: staging-rate-limit-evidence");
    expect(workflow).toContain("needs['staging-rate-limit-evidence'].result != 'success'");
    expect(workflow).toContain(
      "needs['staging-rate-limit-evidence'].outputs.fixture_lifecycle_started == 'true'",
    );
    expect(workflow).toContain("timeout-minutes: 5");
  });

  it("承認記録と実行SHAを秘密値なしでjob summaryへ残す", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("GITHUB_STEP_SUMMARY");
    expect(workflow).toContain("REQUESTED_APPROVED_BY");
    expect(workflow).toContain("REQUESTED_CHANGE_RECORD");
    expect(workflow).toContain("GITHUB_SHA");
    expect(workflow).not.toContain('echo "$STAGING_SYNTHETIC_USER_PASSWORD"');
  });
});
