import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ACTION_PATH = fileURLToPath(
  new URL("../../../.github/actions/vercel-preview-domain/action.yml", import.meta.url),
);

function action(): string {
  expect(existsSync(ACTION_PATH)).toBe(true);
  return readFileSync(ACTION_PATH, "utf8");
}

describe("Vercel Preview branch domain action", () => {
  it("listでexact候補を再確認し共通verifierで固定domainのcontentを照合する", () => {
    const source = action();

    expect(source).toContain("JSON.parse");
    expect(source).toContain("githubCommitSha");
    expect(source).toContain("githubCommitRef");
    expect(source).toContain("expected-sha");
    expect(source).toContain("expected-ref");
    expect(source).toContain("expected-target");
    expect(source).toContain("VERCEL_PROJECT_ID");
    expect(source).toContain("list gensoko-frontend-staging");
    expect(source).toContain("frontend/scripts/verify-staging-frontend-content.mjs");
    expect(source).toContain('STAGING_CANDIDATE_URL="$candidate_url"');
    expect(source).toContain('STAGING_DOMAIN_URL="https://$INPUT_DOMAIN/"');
    expect(source).toContain("matches.length !== 1");
    expect(source).toContain("for attempt in");
    expect(source).not.toContain("alias ls");
    expect(source).not.toContain(" inspect ");
    expect(source).not.toContain("/v13/deployments/");
  });

  it("provider失敗を秘密非表示の固定段階へ分類する", () => {
    const source = action();

    expect(source).toContain("candidate deployment metadataを確認できません");
    expect(source).toContain("candidate deployment metadataが不一致です");
    expect(source).toContain(
      "staging branch domainが対象deployment contentへ更新される前にtimeoutしました",
    );
  });

  it("domainの変更・deploy・rollbackを行わない", () => {
    const source = action();

    expect(source).not.toContain("alias set");
    expect(source).not.toContain("alias rm");
    expect(source).not.toContain("rollback");
    expect(source).not.toMatch(/vercel@[^\n]+ deploy/);
    expect(source).not.toContain('method: "POST"');
    expect(source).not.toContain('method: "DELETE"');
  });

  it("content verifier失敗をstack traceにせず固定失敗へ寄せる", () => {
    const source = action();
    const verifierStart = source.indexOf('STAGING_CANDIDATE_URL="$candidate_url"');
    const verifier = source.slice(verifierStart);

    expect(verifier).toContain("verify-staging-frontend-content.mjs");
    expect(verifier).toContain("2>/dev/null");
  });

  it("秘密・固有URL・provider JSONをoutputやArtifactへ残さない", () => {
    const source = action();
    const tokenEchoLines = source.match(/^.*echo .*VERCEL_TOKEN.*$/gm) ?? [];

    expect(source).not.toContain("GITHUB_OUTPUT");
    expect(source).not.toContain("upload-artifact");
    expect(source).not.toContain("set -x");
    expect(tokenEchoLines.map((line) => line.trim())).toEqual([
      'echo "::add-mask::$INPUT_VERCEL_TOKEN"',
    ]);
    expect(source).not.toContain("environment: production");
    expect(source).not.toMatch(/--target[ =]production|--prod\b/);
  });

  it("複数行のprovider出力から最後の非空URL行だけを読む", () => {
    const source = action();

    expect(source).toContain("NF { line=$0 } END { print line }");
    expect(source).not.toContain("tr -d '\\r\\n'");
  });
});
