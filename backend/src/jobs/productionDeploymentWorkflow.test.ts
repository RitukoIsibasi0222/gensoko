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
    expect(source).toContain("vercel@50.17.1 promote");
  });

  it("stagingとproductionのcredential・target・concurrencyを分離する", () => {
    const source = workflow();
    expect(source).toContain("group: gensoko-production-release");
    expect(source).toContain("cancel-in-progress: false");
    expect(source).toContain("PRODUCTION_CLOUDFLARE_API_TOKEN");
    expect(source).toContain("PRODUCTION_VERCEL_TOKEN");
    expect(source).not.toMatch(/secrets\.(VERCEL_TOKEN|CLOUDFLARE_API_TOKEN|STAGING_[A-Z0-9_]+)/);
    expect(source).not.toContain("environment: staging");
    expect(source).not.toContain("gensoko-api-staging");
    expect(source).not.toContain("gensoko-frontend-staging");
    expect(source).not.toContain("target preview");
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
