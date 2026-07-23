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

  it("固定staging URLと既存fixture guardを使いproduction targetを持たない", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("STAGING_SUPABASE_PROJECT_REF");
    expect(workflow).toContain("secrets.DATABASE_URL");
    expect(workflow).toContain("npm run staging:validate-database-target");
    expect(workflow).toContain("https://gensoko-frontend-staging-develop.vercel.app");
    expect(workflow).toContain("https://gensoko-api-staging.rituko-labs.workers.dev/api/v1");
    expect(workflow).toContain("STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED");
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
    const prepareIndex = workflow.indexOf("--operation prepare");
    const evidenceIndex = workflow.indexOf("npm run staging:rate-limit-evidence");
    const cleanupIndex = workflow.indexOf("--operation remove");

    expect(prepareIndex).toBeGreaterThan(-1);
    expect(evidenceIndex).toBeGreaterThan(prepareIndex);
    expect(cleanupIndex).toBeGreaterThan(evidenceIndex);
    expect(workflow.match(/--operation remove/g)).toHaveLength(2);
    expect(workflow).toContain("if: ${{ always() }}");
    expect(workflow).toContain("cleanup-staging-rate-limit-fixtures:");
    expect(workflow).toContain("needs: staging-rate-limit-evidence");
    expect(workflow).toContain("needs['staging-rate-limit-evidence'].result != 'success'");
    expect(workflow).toContain("timeout-minutes: 5");
  });
});
