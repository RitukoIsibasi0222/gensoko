import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = fileURLToPath(
  new URL("../../../.github/workflows/backend-pr-quality.yml", import.meta.url),
);
const ACTION_PATH = fileURLToPath(
  new URL("../../../.github/actions/backend-quality/action.yml", import.meta.url),
);

describe("backend pull request quality workflow", () => {
  it("develop・main向けPRのbackend変更で必須品質checkを実行する", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    const action = readFileSync(ACTION_PATH, "utf8");
    const qualityContract = `${workflow}\n${action}`;

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("branches: [develop, main]");
    expect(workflow).toContain('"backend/**"');
    expect(workflow).toContain('".github/actions/backend-quality/**"');
    expect(workflow).toContain('".github/workflows/production-deploy.yml"');
    expect(workflow).toContain("uses: ./.github/actions/backend-quality");
    expect(qualityContract).toContain("npm ci");
    expect(qualityContract).toContain("npx prisma generate");
    expect(qualityContract).toContain("npm test -- --run");
    expect(qualityContract).toContain("npm run lint");
    expect(qualityContract).toContain("npm run format:check");
    expect(qualityContract).toContain("npm run build");
    expect(qualityContract).toContain("npm run workers:build");
    expect(qualityContract).toContain("npx prisma validate");
  });

  it("最小権限・重複実行cancel・timeoutを設定する", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).toContain("timeout-minutes: 20");
  });
});
