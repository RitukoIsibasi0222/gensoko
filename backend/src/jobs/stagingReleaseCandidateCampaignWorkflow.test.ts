import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/staging-release-candidate-campaign.yml", import.meta.url),
);

function workflow(): string {
  expect(existsSync(WORKFLOW_PATH)).toBe(true);
  return readFileSync(WORKFLOW_PATH, "utf8");
}

describe("M2 staging release candidate workflow", () => {
  it("manual-only・develop・exact SHA・M1 Path A gateへ固定する", () => {
    const source = workflow();

    expect(source).toContain("workflow_dispatch:");
    expect(source).not.toMatch(/^\s{2}(push|pull_request|schedule|workflow_call):/m);
    expect(source).toContain("reviewed_sha:");
    expect(source).toContain("m1_run_id:");
    expect(source).toContain("RUN_M2_STAGING_RELEASE_CANDIDATE");
    expect(source).toContain('if [ "$GITHUB_REF_NAME" != "develop" ]; then');
    expect(source).toContain('[ "$REVIEWED_SHA" != "$GITHUB_SHA" ]; then');
    expect(source).toContain("production-initial-state-evidence.json");
    expect(source).toContain("validate-m1");
  });

  it("M1 run自体のworkflow・event・success・same SHAをArtifact取得前に照合する", () => {
    const source = workflow();
    const runGate = source.indexOf("Validate exact M1 workflow run");
    const download = source.indexOf("Download exact M1 safe evidence");

    expect(runGate).toBeGreaterThan(-1);
    expect(runGate).toBeLessThan(download);
    expect(source).toContain("actions/runs/$M1_RUN_ID");
    expect(source).toContain('.event == "workflow_dispatch"');
    expect(source).toContain('.status == "completed"');
    expect(source).toContain('.conclusion == "success"');
    expect(source).toContain(".head_sha == $sha");
    expect(source).toContain('.path == ".github/workflows/production-initial-state-evidence.yml"');
  });

  it("staging Environment・共通concurrency・最小permissionだけを使う", () => {
    const source = workflow();

    expect(source).toContain("group: gensoko-batch-jobs");
    expect(source).toContain("cancel-in-progress: false");
    expect(source.match(/environment: staging/g)?.length).toBeGreaterThanOrEqual(5);
    expect(source).not.toContain("environment: production");
    expect(source).toContain("actions: read");
    expect(source).not.toMatch(/contents:\s*write/);
    expect(source).not.toContain("GITHUB_ENV");
  });

  it("prepare→API deploy→frontend deploy→campaign→recovery→final evidenceを分離する", () => {
    const source = workflow();
    const prepare = source.indexOf("  prepare:");
    const api = source.indexOf("  deploy-api:");
    const frontend = source.indexOf("  deploy-frontend:");
    const campaign = source.indexOf("  campaign:");
    const recovery = source.indexOf("  recovery-cleanup:");
    const evidence = source.indexOf("  final-evidence:");

    expect(prepare).toBeGreaterThan(-1);
    expect(api).toBeGreaterThan(prepare);
    expect(frontend).toBeGreaterThan(api);
    expect(campaign).toBeGreaterThan(frontend);
    expect(recovery).toBeGreaterThan(campaign);
    expect(evidence).toBeGreaterThan(recovery);
    expect(source).toContain("needs: prepare");
    expect(source).toContain("needs: deploy-api");
    expect(source).toContain("needs: deploy-frontend");
    expect(source).toContain("needs: campaign");
    expect(source).toContain("if: ${{ always() }}");
  });

  it("通常Worker build・deployとstaging frontend targeted deployだけを行う", () => {
    const source = workflow();

    expect(source).toContain("npm run workers:build");
    expect(source).toContain("wrangler deploy --config wrangler.jsonc --env staging");
    expect(source).toContain("src/worker.ts");
    expect(source).toContain("PasswordVerifierDurableObject");
    expect(source).toMatch(/vercel@[^ ]+ deploy --prebuilt --target preview/);
    expect(source).not.toContain("worker-staging-rollback-baseline");
    expect(source).not.toMatch(/--env\s+production|--target\s+production/);
  });

  it("API deploy後のsame SHA・health/CORS/header gate後だけfrontend deployへ進む", () => {
    const source = workflow();
    const apiJob = source.slice(
      source.indexOf("  deploy-api:"),
      source.indexOf("  deploy-frontend:"),
    );
    const frontendJob = source.slice(
      source.indexOf("  deploy-frontend:"),
      source.indexOf("  campaign:"),
    );

    expect(apiJob).toContain("wrangler deployments status");
    expect(apiJob).toContain("npm run staging:release-candidate-health");
    expect(apiJob).toContain(
      "M2_API_BASE_URL: https://gensoko-api-staging.rituko-labs.workers.dev/api/v1",
    );
    expect(apiJob).toContain(
      "M2_FRONTEND_ORIGIN: https://gensoko-frontend-staging-develop.vercel.app",
    );
    expect(frontendJob).toContain("uses: ./.github/actions/vercel-preview-alias");
    expect(frontendJob).not.toContain("frontend.includes(expected)");
  });

  it("frontend deploy後のalias更新とsmokeを共通actionへ委譲する", () => {
    const source = workflow();
    const frontendJob = source.slice(
      source.indexOf("  deploy-frontend:"),
      source.indexOf("  campaign:"),
    );

    expect(frontendJob).toContain("uses: ./.github/actions/vercel-preview-alias");
    expect(frontendJob).toContain("deployment-url-file:");
    expect(frontendJob).toContain("expected-sha:");
    expect(frontendJob).toContain("expected-ref: develop");
    expect(frontendJob).toContain("expected-target: preview");
  });

  it("45分campaign・5分cleanup・独立recovery・秘密のstep scopeを固定する", () => {
    const source = workflow();

    expect(source).toContain("timeout-minutes: 45");
    expect(source.match(/timeout-minutes: 5/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("needs.campaign.result != 'success'");
    expect(source).toContain("M2_STAGING_FIXTURE_ENABLED");
    expect(source).toContain('randomBytes(32).toString("hex")');
    expect(source).toContain("::add-mask::");
    expect(source).not.toContain("set -x");
    expect(source).not.toMatch(/echo .*DATABASE_URL/);
  });

  it("main/recovery判定後にexact 1 JSON Artifactを再構成する", () => {
    const source = workflow();

    expect(source).toContain("m2-staging-release-candidate-evidence.json");
    expect(source).toContain("actions/upload-artifact@v4");
    expect(source).toContain("if-no-files-found: error");
    expect(source).toContain("retention-days: 7");
    expect(source).toContain("staging:release-candidate-evidence");
    expect(source).toContain("Finalize M2 decision");
    expect(source).not.toMatch(/trace|screenshot|video|html-report/i);
  });
});
