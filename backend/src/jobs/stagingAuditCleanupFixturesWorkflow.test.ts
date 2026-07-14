import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/staging-audit-cleanup-fixtures.yml", import.meta.url),
);
const workflow = readFileSync(WORKFLOW_PATH, "utf8");

describe("staging audit cleanup fixture workflow", () => {
  it("is manual-only and fixed to staging", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("schedule:");
    expect(workflow).toContain("environment: staging");
    expect(workflow).not.toContain("production");
  });

  it("offers only prepare, verify-cleaned, and remove operations", () => {
    expect(workflow).toContain("operation:");
    expect(workflow).toContain("- prepare");
    expect(workflow).toContain("- verify-cleaned");
    expect(workflow).toContain("- remove");
  });

  it("requires the staging safety variables and secret", () => {
    expect(workflow).toContain(
      "AUDIT_LOG_STAGING_FIXTURES_ENABLED: ${{ vars.AUDIT_LOG_STAGING_FIXTURES_ENABLED }}",
    );
    expect(workflow).toContain(
      "STAGING_SUPABASE_PROJECT_REF: ${{ vars.STAGING_SUPABASE_PROJECT_REF }}",
    );
    expect(workflow).toContain("DATABASE_URL: ${{ secrets.DATABASE_URL }}");
  });

  it("runs the fixture CLI without printing configuration values", () => {
    expect(workflow).toContain(
      'npm run staging:audit-cleanup-fixtures -- --operation "${{ inputs.operation }}"',
    );
    expect(workflow).not.toContain('echo "$DATABASE_URL"');
    expect(workflow).not.toContain('echo "$STAGING_SUPABASE_PROJECT_REF"');
  });
});
