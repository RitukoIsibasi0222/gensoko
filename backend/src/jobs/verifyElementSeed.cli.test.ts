import { describe, expect, it, vi } from "vitest";

import { ELEMENT_SEED } from "../lib/elements/seed-data.js";
import { runVerifyElementSeedCli } from "./verifyElementSeed.cli.js";

function createLogger() {
  return { info: vi.fn(), error: vi.fn() };
}

describe("runVerifyElementSeedCli", () => {
  it("別接続で正本118件を検証して固定messageだけを出す", async () => {
    const client = {
      element: { findMany: vi.fn().mockResolvedValue(ELEMENT_SEED) },
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const logger = createLogger();

    await expect(runVerifyElementSeedCli(client, logger)).resolves.toBe(0);
    expect(logger.info).toHaveBeenCalledWith("確認完了: 118 件の元素が正本と一致しました");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("検証失敗のraw値を出さず非zeroにする", async () => {
    const client = {
      element: { findMany: vi.fn().mockRejectedValue(new Error("private database detail")) },
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const logger = createLogger();

    await expect(runVerifyElementSeedCli(client, logger)).resolves.toBe(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private database detail");
    expect(logger.error).toHaveBeenCalledWith("元素データ118件の検証に失敗しました");
  });
});
