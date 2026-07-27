import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/production-initial-state-evidence.yml", import.meta.url),
);

function readWorkflow(): string {
  expect(existsSync(WORKFLOW_PATH)).toBe(true);
  return readFileSync(WORKFLOW_PATH, "utf8");
}

describe("production initial state evidence workflow", () => {
  it("manual-only triggerとproduction承認境界へ固定する", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s{2}(push|pull_request|schedule|workflow_call):/m);
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("group: gensoko-batch-jobs");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain(
      "permissions:\n      actions: read\n      contents: read\n      deployments: read",
    );
  });

  it("review済みdevelop SHAと固定確認・attestationをcheckout前に検証する", () => {
    const workflow = readWorkflow();
    const validationIndex = workflow.indexOf("Validate read-only request");
    const checkoutIndex = workflow.indexOf("actions/checkout@v4");

    expect(workflow).toContain("reviewed_sha:");
    expect(workflow).toContain("confirmation:");
    expect(workflow).toContain("approver:");
    expect(workflow).toContain("change_record:");
    expect(workflow).toContain("history_attestation:");
    expect(workflow).toContain("change_freeze_attestation:");
    expect(workflow).toContain("READ_ONLY_PRODUCTION_INITIAL_STATE");
    expect(workflow).toContain("NO_DELETED_DEPLOYMENT_OR_EXTERNAL_BACKUP_COPY");
    expect(workflow).toContain("NO_CONCURRENT_PRODUCTION_CHANGE");
    expect(workflow).toContain('if [ "$GITHUB_REF_NAME" != "develop" ]; then');
    expect(workflow).toContain('if [ "$REVIEWED_SHA" != "$GITHUB_SHA" ]; then');
    expect(validationIndex).toBeGreaterThanOrEqual(0);
    expect(checkoutIndex).toBeGreaterThan(validationIndex);
  });

  it("Secretとresource identifierをinspection stepだけへ渡す", () => {
    const workflow = readWorkflow();
    const jobEnv = workflow.slice(workflow.indexOf("    env:"), workflow.indexOf("    steps:"));

    expect(jobEnv).not.toContain("DATABASE_URL");
    expect(jobEnv).not.toContain("M1_VERCEL_ACCESS_TOKEN");
    expect(jobEnv).not.toContain("M1_CLOUDFLARE_API_TOKEN");
    expect(workflow).toContain("PRODUCTION_SUPABASE_PROJECT_REF:");
    expect(workflow).toContain("M1_VERCEL_SCOPE_ID:");
    expect(workflow).toContain("M1_VERCEL_REPOSITORY:");
    expect(workflow).toContain("M1_CLOUDFLARE_ACCOUNT_ID:");
    expect(workflow).toContain("M1_CLOUDFLARE_WORKER_NAME:");
    expect(workflow).not.toContain('echo "$DATABASE_URL"');
    expect(workflow).not.toContain('echo "$M1_VERCEL_ACCESS_TOKEN"');
    expect(workflow).not.toContain('echo "$M1_CLOUDFLARE_API_TOKEN"');
  });

  it("GET-only CLIだけを実行し、write・deploy・migration・backup commandを持たない", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain("npm run inspect:production-initial-state");
    expect(workflow).not.toMatch(/\b(method|request-method):\s*(POST|PUT|PATCH|DELETE)\b/i);
    expect(workflow).not.toMatch(
      /\b(curl\s+[^\n]*-X|gh\s+api\s+[^\n]*--method)\s*(POST|PUT|PATCH|DELETE)\b/i,
    );
    expect(workflow).not.toMatch(
      /\b(prisma migrate|wrangler deploy|vercel deploy|supabase db dump|npm run delete:|npm run cleanup:)/,
    );
    expect(workflow).not.toContain("set -x");
  });

  it("safe markerとStep Summaryをalwaysで保存してからfail-closed判定する", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("production-initial-state-evidence.json");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("retention-days: 1");
    expect(workflow).toContain("GITHUB_STEP_SUMMARY");
    expect(workflow).toContain("Finalize M1 decision");
    expect(workflow).toContain("path-a");
  });

  it("validation失敗時も未検証inputをsummary/markerへ出さずstatusだけを再構成する", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain("SAFE_REVIEWED_SHA");
    expect(workflow).toContain("0000000000000000000000000000000000000000");
    expect(workflow).toContain("SAFE_APPROVER");
    expect(workflow).toContain("SAFE_CHANGE_RECORD");
    expect(workflow).not.toContain('echo "- Approver: $APPROVER"');
    expect(workflow).not.toContain('echo "- Change record: $CHANGE_RECORD"');
    expect(workflow).toContain("(.evidence | keys) == [");
    expect(workflow).toContain('"productionChangeFreezeAttestation"');
    expect(workflow).toContain(".reviewedSha == $expected_sha");
    expect(workflow).toContain('select(.key != "schemaVersion")');
    expect(workflow).toContain('all(. == "clear")');
  });
});
