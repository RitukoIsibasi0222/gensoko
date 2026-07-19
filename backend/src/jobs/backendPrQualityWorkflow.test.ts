import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/backend-pr-quality.yml", import.meta.url),
);

describe("backend pull request quality workflow", () => {
  it("develop向けPRのbackend変更で必須品質checkを実行する", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("branches: [develop]");
    expect(workflow).toContain('"backend/**"');
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npx prisma generate");
    expect(workflow).toContain("npm test -- --run");
    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("npm run format:check");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("npm run workers:build");
    expect(workflow).toContain("npx prisma validate");
  });

  it("最小権限・重複実行cancel・timeoutを設定する", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).toContain("timeout-minutes: 20");
  });
});
