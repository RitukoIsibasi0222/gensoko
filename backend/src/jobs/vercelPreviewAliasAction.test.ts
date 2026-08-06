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
    expect(source).toContain("api.vercel.com/v9/projects/");
    expect(source).toContain("project.id !== process.env.VERCEL_PROJECT_ID");
    expect(source).toContain('project.name !== "gensoko-frontend-staging"');
    expect(source).toContain("list gensoko-frontend-staging");
    expect(source).toContain('--scope="$VERCEL_ORG_ID"');
    expect(source).toMatch(/readyState|READY/);
    expect(source).not.toContain("includes(expected");
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
});
