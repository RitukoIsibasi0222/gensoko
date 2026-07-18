import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const FIXTURE_WORKFLOW_PATH = fileURLToPath(
  new URL(
    "../../../.github/workflows/staging-account-deletion-cleanup-fixtures.yml",
    import.meta.url,
  ),
);
const CLEANUP_WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/staging-account-data-deletion.yml", import.meta.url),
);

describe("staging account deletion cleanup fixture workflows", () => {
  it("fixture管理はmanual・staging・共通concurrency・専用flagに限定する", () => {
    const workflow = readFileSync(FIXTURE_WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("schedule:");
    expect(workflow).toContain("environment: staging");
    expect(workflow).toContain('if [ "$GITHUB_REF_NAME" != "develop" ]');
    expect(workflow).toContain("group: gensoko-batch-jobs");
    expect(workflow).toContain("ACCOUNT_DATA_DELETION_STAGING_FIXTURES_ENABLED");
    expect(workflow).toContain(
      "STAGING_SUPABASE_PROJECT_REF: ${{ secrets.STAGING_SUPABASE_PROJECT_REF }}",
    );
    expect(workflow).toContain("npx prisma generate");
    expect(workflow).toContain("npm run staging:account-deletion-cleanup-fixtures");
    expect(workflow).toContain("FIXTURE_OPERATION: ${{ inputs.operation }}");
    expect(workflow).toContain('--operation "$FIXTURE_OPERATION"');
    expect(workflow).not.toContain('--operation "${{ inputs.operation }}"');
  });

  it("cleanup workflowはdry-runとexecute前に完全一致preflightを通しexecute後を検証する", () => {
    const workflow = readFileSync(CLEANUP_WORKFLOW_PATH, "utf8");

    expect(workflow).toContain(
      "STAGING_SUPABASE_PROJECT_REF: ${{ secrets.STAGING_SUPABASE_PROJECT_REF }}",
    );
    expect(workflow).toContain("npx prisma generate");
    expect(workflow).toContain("--operation verify-isolated");
    expect(workflow).toContain("--operation verify-cleaned");
    expect(workflow).toContain("--staging-synthetic-only");
    expect(workflow.indexOf("--operation verify-isolated")).toBeLessThan(
      workflow.indexOf("npm run delete:legacy-soft-deleted-users"),
    );
  });
});
