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

    expect(workflow).toContain("randomBytes");
    expect(workflow).toContain("GITHUB_ENV");
    expect(workflow).toContain("::add-mask::");
    expect(workflow).not.toContain("--password");
    expect(workflow).not.toContain("upload-artifact");
    expect(workflow).not.toContain("actions/upload-artifact");
    expect(workflow).toContain("STAGING_SYNTHETIC_ADMIN_PASSWORD");
    expect(workflow).toContain("STAGING_SYNTHETIC_USER_PASSWORD");
  });

  it("fixture prepare後にPlaywrightを実行し、失敗・cancel時もalways cleanupする", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");

    const prepareIndex = workflow.indexOf("--operation prepare");
    const playwrightIndex = workflow.indexOf("npm run test:e2e:staging");
    const cleanupIndex = workflow.indexOf("--operation remove");
    expect(prepareIndex).toBeGreaterThan(-1);
    expect(playwrightIndex).toBeGreaterThan(prepareIndex);
    expect(cleanupIndex).toBeGreaterThan(playwrightIndex);
    expect(workflow).toContain("if: $" + "{{ always() }}");
    expect(workflow).toContain("npm run staging:synthetic-admin-e2e-fixtures");
  });
});
