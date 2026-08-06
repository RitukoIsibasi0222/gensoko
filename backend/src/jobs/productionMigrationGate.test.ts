import { describe, expect, it, vi } from "vitest";

import { runProductionMigrationGateCli } from "./productionMigrationGate.cli.js";
import { classifyProductionMigrationStatus } from "./productionMigrationGate.js";

describe("production migration gate", () => {
  it("Prisma v7のcurrent markerだけをcurrentへ分類する", () => {
    expect(
      classifyProductionMigrationStatus({
        exitCode: 0,
        stdout: "Database schema is up to date!\n",
        stderr: "",
        timedOut: false,
      }),
    ).toBe("current");
  });

  it("Prisma v7のpending markerとexit 1の組合せだけをpendingへ分類する", () => {
    expect(
      classifyProductionMigrationStatus({
        exitCode: 1,
        stdout: "The following migration(s) have not yet been applied:\n20260806000000_example\n",
        stderr: "",
        timedOut: false,
      }),
    ).toBe("pending");
  });

  it.each([
    { exitCode: 0, stdout: "unexpected", stderr: "", timedOut: false },
    { exitCode: 1, stdout: "connection failed", stderr: "raw database detail", timedOut: false },
    { exitCode: null, stdout: "", stderr: "timeout detail", timedOut: true },
    {
      exitCode: 0,
      stdout: "The following migration(s) have not yet been applied:",
      stderr: "",
      timedOut: false,
    },
  ])("判定不能・矛盾・timeoutはunknownへ倒す", (input) => {
    expect(classifyProductionMigrationStatus(input)).toBe("unknown");
  });

  it("CLIは固定statusだけを出しpending/unknownを失敗終了する", async () => {
    const info = vi.fn();
    const error = vi.fn();
    const runStatus = vi
      .fn()
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "Database schema is up to date!",
        stderr: "",
        timedOut: false,
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: "raw migration name",
        stderr: "raw DB URL",
        timedOut: false,
      });

    await expect(runProductionMigrationGateCli({ runStatus, info, error })).resolves.toBe(0);
    await expect(runProductionMigrationGateCli({ runStatus, info, error })).resolves.toBe(1);
    expect(JSON.stringify([info.mock.calls, error.mock.calls])).not.toMatch(
      /raw migration name|raw DB URL/,
    );
  });
});
