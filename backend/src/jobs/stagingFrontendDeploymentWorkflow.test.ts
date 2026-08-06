import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/staging-frontend-deploy.yml", import.meta.url),
);

function workflow(): string {
  expect(existsSync(WORKFLOW_PATH)).toBe(true);
  return readFileSync(WORKFLOW_PATH, "utf8");
}

describe("staging frontend deployment workflow", () => {
  it("developへのfrontend pushだけを契機にする", () => {
    const source = workflow();

    expect(source).toMatch(/^on:\n\s{2}push:/m);
    expect(source).toContain("branches: [develop]");
    expect(source).toContain('"frontend/**"');
    expect(source).not.toMatch(/^\s{2}(pull_request|workflow_dispatch|schedule|workflow_call):/m);
  });

  it("staging・read-only permission・latest-run優先へ固定する", () => {
    const source = workflow();

    expect(source).toContain("permissions:");
    expect(source).toContain("contents: read");
    expect(source).not.toMatch(/contents:\s*write/);
    expect(source).toContain("environment: staging");
    expect(source).toContain("group: staging-frontend-deploy");
    expect(source).toContain("cancel-in-progress: true");
    expect(source).not.toContain("environment: production");
  });

  it("frontend品質gateの成功後だけalias actionへ進む", () => {
    const source = workflow();
    const commands = [
      "npm ci",
      "npm audit --audit-level=moderate",
      "npm run test:run",
      "npm run lint",
      "npm run check",
      "npm run format:check",
      "npm run build:preview",
      "uses: ./.github/actions/vercel-preview-alias",
    ];

    let previous = -1;
    for (const command of commands) {
      const current = source.indexOf(command);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it("exact SHA Previewをbounded pollしdevelop先端再確認後に昇格する", () => {
    const source = workflow();

    expect(source).toContain("vercel@50.17.1 list");
    expect(source).toContain("list gensoko-frontend-staging");
    expect(source).toContain('--scope="$VERCEL_ORG_ID"');
    expect(source).toMatch(/--meta "?githubCommitSha=/);
    expect(source).toContain("--format=json");
    expect(source).toContain("for attempt in");
    expect(source).toContain("githubCommitSha");
    expect(source).toContain("refs/heads/develop");
    expect(source).toContain("deployment-url-file:");
    expect(source).not.toMatch(/vercel@[^\n]+ deploy/);
  });

  it("production・API・DB・fixture・artifactを日常経路へ混ぜない", () => {
    const source = workflow();

    expect(source).not.toMatch(/--target[ =]production|--prod\b/);
    expect(source).not.toContain("wrangler deploy");
    expect(source).not.toContain("DATABASE_URL");
    expect(source).not.toContain("prisma migrate");
    expect(source).not.toContain("fixture");
    expect(source).not.toContain("upload-artifact");
    expect(source).not.toContain("provider response");
  });
});
