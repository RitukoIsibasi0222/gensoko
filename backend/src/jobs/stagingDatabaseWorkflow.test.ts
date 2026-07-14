import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/staging-database.yml", import.meta.url),
);

describe("staging database GitHub Actions workflow", () => {
  const workflow = readFileSync(WORKFLOW_PATH, "utf8");

  it("is manual-only and always uses the staging environment", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("schedule:");
    expect(workflow).toContain("environment: staging");
    expect(workflow).not.toContain("production");
  });

  it("validates the environment marker and database secret without printing the URL", () => {
    expect(workflow).toContain("BATCH_ENVIRONMENT: ${{ vars.BATCH_ENVIRONMENT }}");
    expect(workflow).toContain("DATABASE_URL: ${{ secrets.DATABASE_URL }}");
    expect(workflow).toContain('if [ "$BATCH_ENVIRONMENT" != "staging" ]; then');
    expect(workflow).toContain('if [ -z "$DATABASE_URL" ]; then');
    expect(workflow).not.toContain('echo "$DATABASE_URL"');
  });

  it("applies existing Prisma migrations with least-privilege workflow permissions", () => {
    expect(workflow).toContain("permissions:\n      contents: read");
    expect(workflow).toContain("working-directory: backend");
    expect(workflow).toContain("run: npm ci");
    expect(workflow).toContain("run: npx prisma migrate deploy");
  });
});
