import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/staging-account-deletion-performance.yml", import.meta.url),
);

describe("staging account deletion performance workflow", () => {
  const workflow = readFileSync(WORKFLOW_PATH, "utf8");

  it("manual-only・staging/develop固定・共通DB concurrencyで実行する", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("schedule:");
    expect(workflow).toContain("environment: staging");
    expect(workflow).not.toContain("production");
    expect(workflow).toContain('if [ "$GITHUB_REF_NAME" != "develop" ]; then');
    expect(workflow).toContain("group: gensoko-batch-jobs");
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("previewとexecuteだけを持ち、executeの専用flag・確認文字列・明示件数を要求する", () => {
    expect(workflow).toContain("- preview");
    expect(workflow).toContain("- execute");
    expect(workflow).toContain(
      "STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED: ${{ vars.STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED }}",
    );
    expect(workflow).toContain("MEASURE_STAGING_ACCOUNT_DELETION");
    expect(workflow).toContain("session_count:");
    expect(workflow).toContain("answer_count:");
    expect(workflow).toContain("platform_request_timeout_ms:");
  });

  it("project refとDB secretを検証して専用CLIだけを実行する", () => {
    expect(workflow).toContain(
      "STAGING_SUPABASE_PROJECT_REF: ${{ vars.STAGING_SUPABASE_PROJECT_REF }}",
    );
    expect(workflow).toContain("DATABASE_URL: ${{ secrets.DATABASE_URL }}");
    expect(workflow).toContain("npm run staging:account-deletion-performance");
    expect(workflow).not.toContain("delete:legacy-soft-deleted-users");
    expect(workflow).not.toContain('echo "$DATABASE_URL"');
    expect(workflow).not.toContain('echo "$STAGING_SUPABASE_PROJECT_REF"');
  });
});
