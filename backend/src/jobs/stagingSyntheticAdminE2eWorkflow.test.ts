import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/staging-synthetic-admin-e2e.yml", import.meta.url),
);

describe("staging synthetic Admin Playwright workflow", () => {
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
    expect(workflow).toContain("permissions:");
    expect(workflow).toContain("contents: read");
  });

  it("staging DB validatorと固定Vercel/Worker URL guardを使いproduction targetを持たない", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("environment: staging");
    expect(workflow).toContain("STAGING_SUPABASE_PROJECT_REF");
    expect(workflow).toContain("secrets.DATABASE_URL");
    expect(workflow).toContain("npm run staging:validate-database-target");
    expect(workflow).toContain("https://gensoko-frontend-staging-develop.vercel.app");
    expect(workflow).toContain("https://gensoko-api-staging.rituko-labs.workers.dev/api/v1");
    expect(workflow).not.toContain("environment: production");
    expect(workflow).not.toContain("secrets.PRODUCTION");
  });

  it("ephemeral credentialをlog・artifact・CLI引数へ出さずPlaywrightへ環境変数で渡す", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    const jobEnvironment = workflow.slice(
      workflow.indexOf("    env:"),
      workflow.indexOf("    steps:"),
    );
    const backendInstallIndex = workflow.indexOf("Install backend dependencies");
    const prismaGenerateIndex = workflow.indexOf("Generate Prisma Client");
    const frontendInstallIndex = workflow.indexOf("Install frontend dependencies");
    const browserInstallIndex = workflow.indexOf("Install Playwright Chromium");
    const credentialIndex = workflow.indexOf("Generate ephemeral masked credentials");
    const prepareIndex = workflow.indexOf("--operation prepare");

    expect(workflow).toContain("randomBytes");
    expect(workflow).toContain("GITHUB_OUTPUT");
    expect(workflow).not.toContain("GITHUB_ENV");
    expect(workflow).toContain("::add-mask::");
    expect(workflow).not.toContain("--password");
    expect(workflow).not.toContain("upload-artifact");
    expect(workflow).not.toContain("actions/upload-artifact");
    expect(workflow).toContain("STAGING_SYNTHETIC_ADMIN_PASSWORD");
    expect(workflow).toContain("STAGING_SYNTHETIC_USER_PASSWORD");
    expect(workflow.match(/STAGING_SYNTHETIC_ADMIN_PASSWORD:/g)).toHaveLength(2);
    expect(workflow.match(/STAGING_SYNTHETIC_USER_PASSWORD:/g)).toHaveLength(2);
    expect(jobEnvironment).not.toContain("STAGING_SUPABASE_PROJECT_REF");
    expect(credentialIndex).toBeGreaterThan(backendInstallIndex);
    expect(credentialIndex).toBeGreaterThan(prismaGenerateIndex);
    expect(credentialIndex).toBeGreaterThan(frontendInstallIndex);
    expect(credentialIndex).toBeGreaterThan(browserInstallIndex);
    expect(prepareIndex).toBeGreaterThan(credentialIndex);
  });

  it("Vercel automation bypass Secretをjob全体へ置かずfixture作成前に検証する", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    const jobEnvironment = workflow.slice(
      workflow.indexOf("    env:"),
      workflow.indexOf("    steps:"),
    );
    const bypassValidationIndex = workflow.indexOf('if [ -z "$VERCEL_AUTOMATION_BYPASS_SECRET" ]');
    const prepareIndex = workflow.indexOf("--operation prepare");

    expect(workflow.match(/VERCEL_AUTOMATION_BYPASS_SECRET:/g)).toHaveLength(2);
    expect(jobEnvironment).not.toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(bypassValidationIndex).toBeGreaterThan(-1);
    expect(workflow).toContain('[[ "$VERCEL_AUTOMATION_BYPASS_SECRET" =~ [[:space:]] ]]');
    expect(workflow.indexOf("Install backend dependencies")).toBeGreaterThan(bypassValidationIndex);
    expect(prepareIndex).toBeGreaterThan(bypassValidationIndex);
    expect(workflow).not.toContain("?x-vercel-protection-bypass=");
  });

  it("fixture prepare後に時間制限付きPlaywrightを実行し、非成功時は独立jobでもcleanupする", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");

    const prepareIndex = workflow.indexOf("--operation prepare");
    const playwrightIndex = workflow.indexOf("npm run test:e2e:staging");
    const cleanupIndex = workflow.indexOf("--operation remove");
    expect(prepareIndex).toBeGreaterThan(-1);
    expect(playwrightIndex).toBeGreaterThan(prepareIndex);
    expect(cleanupIndex).toBeGreaterThan(playwrightIndex);
    expect(workflow.match(/--operation remove/g)).toHaveLength(2);
    expect(workflow).toContain("cleanup-staging-synthetic-fixtures:");
    expect(workflow).toContain("needs: staging-synthetic-admin-e2e");
    expect(workflow).toContain("if: $" + "{{ always() && github.ref_name == 'develop' }}");
    expect(workflow).toContain("needs['staging-synthetic-admin-e2e'].result != 'success'");
    expect(workflow).toContain("timeout-minutes: 5");
    expect(workflow).toContain("npm run staging:synthetic-admin-e2e-fixtures");
  });
});
