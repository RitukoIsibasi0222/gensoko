import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/production-deploy.yml", import.meta.url),
);
const LIVE_MAIN_ACTION_PATH = fileURLToPath(
  new URL("../../../.github/actions/validate-live-main/action.yml", import.meta.url),
);

function workflow(): string {
  expect(existsSync(WORKFLOW_PATH)).toBe(true);
  return readFileSync(WORKFLOW_PATH, "utf8");
}

function liveMainAction(): string {
  expect(existsSync(LIVE_MAIN_ACTION_PATH)).toBe(true);
  return readFileSync(LIVE_MAIN_ACTION_PATH, "utf8");
}

describe("production deployment workflow", () => {
  it("deploy対象のmain pushと入力なしmanual再開だけを許可する", () => {
    const source = workflow();
    expect(source).toMatch(/^on:\n\s{2}push:/m);
    expect(source).toContain("branches: [main]");
    expect(source).toMatch(/^\s{2}workflow_dispatch:\s*\{\}\s*$/m);
    expect(source).not.toMatch(/^\s{4}inputs:/m);
    expect(source).not.toMatch(/^\s{2}(pull_request|schedule|workflow_run|repository_dispatch):/m);
    expect(source).not.toContain('"docs/**"');
  });

  it("Secret非参照validationからexact SHA qualityを経て単一production jobへ進む", () => {
    const source = workflow();
    const validation = source.slice(
      source.indexOf("  validate-release:"),
      source.indexOf("  backend-quality:"),
    );
    const release = source.slice(source.indexOf("  production-release:"));

    expect(validation).toContain("permissions: {}");
    expect(validation).not.toContain("environment:");
    expect(validation).not.toMatch(/secrets\.|vars\.|DATABASE_URL|VERCEL_|CLOUDFLARE_/);
    expect(source).toContain("uses: ./.github/actions/backend-quality");
    expect(source).toContain("uses: ./.github/actions/frontend-quality");
    expect(source).toContain("persist-credentials: false");
    expect(source.split("uses: ./.github/actions/validate-live-main")).toHaveLength(7);
    expect(liveMainAction()).toContain("git rev-parse HEAD");
    expect(release).toContain("environment: production");
    expect(source.match(/environment: production/g)).toHaveLength(1);
    expect(release).toContain("needs: [validate-release, backend-quality, frontend-quality]");
  });

  it("main先端・DB target・migrationをprovider mutation前にfail-closed検証する", () => {
    const source = workflow();
    const ordered = [
      "Validate live main head before protected access",
      "Validate production database target",
      "Check production migration status",
      "Validate production provider credentials",
      "Preflight production Vercel credential scope",
      "Deploy exact production API",
      "Validate production API health",
      "Deploy staged production frontend",
      "Promote verified production frontend",
      "Run read-only production smoke",
      "Build safe production release evidence",
    ];
    let previous = -1;
    for (const marker of ordered) {
      const current = source.indexOf(marker);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
    expect(source).not.toContain("prisma migrate deploy");
    expect(source).toContain("Production Database Operations");
    expect(source).toContain("--skip-domain");
    expect(source).toContain("vercel@56.3.2 promote");
  });

  it("stagingとproductionのcredential・target・concurrencyを分離する", () => {
    const source = workflow();
    expect(source).toContain("group: gensoko-production-release");
    expect(source).toContain("cancel-in-progress: false");
    expect(source).toContain("PRODUCTION_CLOUDFLARE_API_TOKEN");
    expect(source).toContain("PRODUCTION_VERCEL_TOKEN");
    expect(source).toContain("PRODUCTION_VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(source).not.toMatch(/secrets\.(VERCEL_TOKEN|CLOUDFLARE_API_TOKEN|STAGING_[A-Z0-9_]+)/);
    expect(source).not.toContain("environment: staging");
    expect(source).not.toContain("gensoko-api-staging");
    expect(source).not.toContain("gensoko-frontend-staging");
    expect(source).not.toContain("target preview");
  });

  it("全provider credentialをAPI mutation前に検証しbypass Secretを両frontend検証へ渡す", () => {
    const source = workflow();
    const credentials = source.slice(
      source.indexOf("Validate production provider credentials"),
      source.indexOf("Deploy exact production API"),
    );

    for (const name of [
      "PRODUCTION_CLOUDFLARE_API_TOKEN",
      "PRODUCTION_CLOUDFLARE_ACCOUNT_ID",
      "PRODUCTION_VERCEL_TOKEN",
      "PRODUCTION_VERCEL_ORG_ID",
      "PRODUCTION_VERCEL_PROJECT_ID",
      "PRODUCTION_VERCEL_AUTOMATION_BYPASS_SECRET",
    ]) {
      expect(credentials).toContain(name + ": ${{ secrets." + name + " }}");
      expect(credentials).toContain(name);
    }
    expect(credentials).toContain('[ -z "$credential" ]');
    expect(credentials).toContain('[[ "$credential" =~ [[:space:]] ]]');
    expect(source.match(/PRODUCTION_VERCEL_AUTOMATION_BYPASS_SECRET:/g)).toHaveLength(3);
  });

  it("Vercel token・team・projectをresponse body非出力でAPI mutation前にfail-closed検証する", () => {
    const source = workflow();
    const preflightStart = source.indexOf("Preflight production Vercel credential scope");
    const preflightEnd = source.indexOf("Revalidate live main before API mutation");

    expect(preflightStart).toBeGreaterThanOrEqual(0);
    expect(preflightEnd).toBeGreaterThan(preflightStart);
    const preflight = source.slice(preflightStart, preflightEnd);
    expect(preflight).toContain("VERCEL_TOKEN: ${{ secrets.PRODUCTION_VERCEL_TOKEN }}");
    expect(preflight).toContain("VERCEL_ORG_ID: ${{ secrets.PRODUCTION_VERCEL_ORG_ID }}");
    expect(preflight).toContain("VERCEL_PROJECT_ID: ${{ secrets.PRODUCTION_VERCEL_PROJECT_ID }}");
    expect(preflight).toContain("/v2/teams/$VERCEL_ORG_ID");
    expect(preflight).toContain("/v9/projects/$VERCEL_PROJECT_ID?teamId=$VERCEL_ORG_ID");
    expect(preflight.match(/--output \/dev\/null/g)).toHaveLength(1);
    expect(preflight.match(/--write-out "%\{http_code\}"/g)).toHaveLength(1);
    expect(preflight).toContain("Authorization: Bearer $VERCEL_TOKEN");
    expect(preflight).toContain('if [ "$team_status" != "200" ]');
    expect(preflight).toContain('if [ "$project_status" != "200" ]');
    for (const category of [
      "token_invalid",
      "rate_limited",
      "provider_unavailable",
      "unexpected_status",
      "network_unknown",
    ]) {
      expect(preflight).toContain(category);
    }
    expect(preflight).toContain('echo "${resource}_access_denied"');
    expect(preflight).toContain('echo "${resource}_not_found"');
    expect(preflight).toContain('classify_vercel_http_status team "$team_status"');
    expect(preflight).toContain('classify_vercel_http_status project "$project_status"');
    expect(preflight).toContain('echo "vercel_preflight_category=$category"');
    expect(preflight).not.toMatch(/cat\s+|response[_ -]?body|provider raw/i);
    expect(preflight).not.toContain('echo "$team_status"');
    expect(preflight).not.toContain('echo "$project_status"');
  });

  it("Git未接続production projectでprovider envをpullせずprebuilt成果物とexact SHA metadataを使う", () => {
    const source = workflow();
    const frontendCandidateStart = source.indexOf("Deploy staged production frontend");
    const frontendCandidateEnd = source.indexOf("Revalidate live main before frontend promotion");

    expect(frontendCandidateStart).toBeGreaterThanOrEqual(0);
    expect(frontendCandidateEnd).toBeGreaterThan(frontendCandidateStart);
    const frontendCandidate = source.slice(frontendCandidateStart, frontendCandidateEnd);
    expect(frontendCandidate).not.toMatch(/vercel@\S+ pull/);
    expect(frontendCandidate).not.toMatch(/vercel@\S+ build/);
    expect(frontendCandidate).toContain("VERCEL_ENV: production");
    expect(frontendCandidate).toContain("VERCEL_ORG_ID: ${{ secrets.PRODUCTION_VERCEL_ORG_ID }}");
    expect(frontendCandidate).toContain(
      "VERCEL_PROJECT_ID: ${{ secrets.PRODUCTION_VERCEL_PROJECT_ID }}",
    );
    expect(frontendCandidate).toContain("npm run build");
    expect(frontendCandidate).toContain("node scripts/check-vercel-build-output.mjs");
    expect(frontendCandidate).toContain(
      "vercel@56.3.2 deploy --yes --non-interactive --no-color --prebuilt --prod --skip-domain",
    );
    expect(frontendCandidate).toContain("vercel@56.3.2 list --yes --non-interactive --no-color");
    expect(frontendCandidate).not.toContain('--project="$VERCEL_PROJECT_ID"');
    expect(frontendCandidate).not.toContain('list "$VERCEL_PROJECT_ID"');
    expect(frontendCandidate).toContain('--meta githubCommitSha="$EXPECTED_SHA"');
    expect(frontendCandidate).toContain("--meta githubCommitRef=main");
  });

  it("classifies Vercel CLI failures without printing raw provider output", () => {
    const source = workflow();
    const frontendCandidateStart = source.indexOf("Deploy staged production frontend");
    const frontendCandidateEnd = source.indexOf("Revalidate live main before frontend promotion");
    const frontendCandidate = source.slice(frontendCandidateStart, frontendCandidateEnd);

    expect(frontendCandidate).toContain("classify_vercel_failure()");
    expect(frontendCandidate).toContain("project_access_denied");
    expect(frontendCandidate).toContain("project_not_found");
    expect(frontendCandidate).toContain("prebuilt_contract_rejected");
    expect(frontendCandidate).toContain("deployment_api_rejected");
    expect(frontendCandidate).toContain("unknown");
    expect(frontendCandidate).toContain('category=$(classify_vercel_failure "$provider_log")');
    expect(frontendCandidate).toContain('echo "vercel_failure_category=$category"');
    expect(frontendCandidate).not.toMatch(/cat\s+"?\$provider_log/);
  });

  it("provider raw responseを一時fileへ閉じtrap cleanupしsafe evidenceだけを短期保存する", () => {
    const source = workflow();
    expect(source).toContain("$RUNNER_TEMP");
    expect(source).toContain("trap cleanup_release_files EXIT");
    expect(source).not.toMatch(/cat\s+[^\n]*(provider|deployment|response)/i);
    expect(source).toContain("production-release-evidence.json");
    expect(source).toContain('rm -rf "$GITHUB_WORKSPACE/frontend/.vercel"');
    expect(source).toContain("retention-days: 7");
    const releaseJobHeader = source.slice(
      source.indexOf("  production-release:"),
      source.indexOf("    steps:", source.indexOf("  production-release:")),
    );
    expect(releaseJobHeader).not.toContain("DATABASE_URL");
  });
});
