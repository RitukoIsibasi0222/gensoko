import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ACTION_PATH = fileURLToPath(
  new URL("../../../.github/actions/vercel-preview-alias/action.yml", import.meta.url),
);

function action(): string {
  expect(existsSync(ACTION_PATH)).toBe(true);
  return readFileSync(ACTION_PATH, "utf8");
}

describe("Vercel Preview alias action", () => {
  it("candidate metadataを構造化parseしてSHA・ref・target・state・project完全一致で検証する", () => {
    const source = action();

    expect(source).toContain("JSON.parse");
    expect(source).toContain("githubCommitSha");
    expect(source).toContain("githubCommitRef");
    expect(source).toContain("expected-sha");
    expect(source).toContain("expected-ref");
    expect(source).toContain("expected-target");
    expect(source).toContain("VERCEL_PROJECT_ID");
    expect(source).not.toContain("api.vercel.com/v9/projects/");
    expect(source).toContain("list gensoko-frontend-staging");
    expect(source).toContain('deployment.name === "gensoko-frontend-staging"');
    expect(
      source.match(/deployment\.name !== "gensoko-frontend-staging"/g)?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(source).toMatch(/readyState|READY/);
    expect(source).not.toContain("includes(expected");
  });

  it("provider失敗を秘密非表示の固定段階へ分類する", () => {
    const source = action();

    expect(source).toContain("candidate deployment metadataが不一致です");
    expect(source).toContain("現在のstaging alias metadataを確認できません");
    expect(source).toContain("staging alias更新に失敗しました");
    expect(source).toContain("staging alias更新後metadataを確認できません");
    expect(source).toContain("staging alias更新後metadataが不一致です");
    expect(source).toContain("staging alias smokeに失敗しました");
  });

  it("smoke例外をstack traceにせず固定失敗へ寄せる", () => {
    const source = action();
    const smokeStart = source.indexOf('alias_failure_message="staging alias smokeに失敗しました"');
    const smoke = source.slice(smokeStart, source.indexOf("        trap - ERR", smokeStart));

    expect(smoke).toContain("try {");
    expect(smoke).toContain("} catch {");
    expect(smoke).toContain("process.exit(1)");
  });

  it("候補確認→直前参照保存→alias更新→post-check→smokeの順に実行する", () => {
    const source = action();
    const main = source.slice(source.indexOf("        vercel_list=("));
    const candidate = main.indexOf("vercel_list=(");
    const previous = main.indexOf('inspect "https://$INPUT_ALIAS"');
    const rollbackTrap = main.indexOf("trap rollback_alias ERR");
    const alias = main.indexOf('alias set "$candidate_url"');
    const postCheck = main.indexOf('>"$alias_state"');
    const smoke = main.indexOf('SMOKE_URL="https://$INPUT_ALIAS/"');

    expect(candidate).toBeGreaterThan(-1);
    expect(previous).toBeGreaterThan(candidate);
    expect(rollbackTrap).toBeGreaterThan(previous);
    expect(alias).toBeGreaterThan(rollbackTrap);
    expect(postCheck).toBeGreaterThan(alias);
    expect(smoke).toBeGreaterThan(postCheck);
  });

  it("alias更新後の失敗では直前deploymentへrollbackして再確認する", () => {
    const source = action();

    expect(source).toContain("rollback_alias");
    expect(source).toContain("trap");
    expect(source).toContain("ROLLED_BACK");
    expect(source.match(/alias set/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("rollback-state.json");
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
