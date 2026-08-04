import { describe, expect, it, vi } from "vitest";

import { ELEMENT_SEED } from "../lib/elements/seed-data.js";
import { ElementSeedStateError } from "./seedElements.js";
import { runSeedElementsCli, runSeedElementsCommand } from "./seedElements.cli.js";

function createLogger() {
  return { info: vi.fn(), error: vi.fn() };
}

describe("runSeedElementsCli", () => {
  it("1 transactionで118件を検証し固定messageだけを出す", async () => {
    const transaction = {
      element: {
        findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(ELEMENT_SEED),
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    const client = {
      $transaction: vi.fn(async (operation) => operation(transaction as never)),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const logger = createLogger();

    await expect(runSeedElementsCli(client as never, logger)).resolves.toBe(0);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 120_000,
    });
    expect(transaction.element.upsert).toHaveBeenCalledTimes(118);
    expect(logger.info).toHaveBeenCalledWith("完了: 118 件の元素を登録しました");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("DB transaction失敗を固定カテゴリにし、raw errorを出さない", async () => {
    const client = {
      $transaction: vi.fn().mockRejectedValue(new Error("secret connection detail")),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const logger = createLogger();

    await expect(runSeedElementsCli(client as never, logger)).resolves.toBe(1);
    expect(client.$disconnect).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret connection detail");
    expect(logger.error).toHaveBeenCalledWith("元素データのDBトランザクション実行に失敗しました");
  });

  it("既存状態不一致をpreflight固定カテゴリにする", async () => {
    const client = {
      $transaction: vi.fn().mockRejectedValue(new ElementSeedStateError("preflight")),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const logger = createLogger();

    await expect(runSeedElementsCli(client as never, logger)).resolves.toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      "元素データの事前状態が空または正本118件ではありません",
    );
  });

  it("transaction内の事後不一致をverification固定カテゴリにする", async () => {
    const client = {
      $transaction: vi.fn().mockRejectedValue(new ElementSeedStateError("verification")),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const logger = createLogger();

    await expect(runSeedElementsCli(client as never, logger)).resolves.toBe(1);
    expect(logger.error).toHaveBeenCalledWith("元素データのトランザクション内検証に失敗しました");
  });

  it("disconnect失敗もraw errorなしで非zeroにする", async () => {
    const transaction = {
      element: {
        findMany: vi.fn().mockResolvedValue(ELEMENT_SEED),
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    const client = {
      $transaction: vi.fn(async (operation) => operation(transaction as never)),
      $disconnect: vi.fn().mockRejectedValue(new Error("private disconnect detail")),
    };
    const logger = createLogger();

    await expect(runSeedElementsCli(client as never, logger)).resolves.toBe(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private disconnect detail");
    expect(logger.error).toHaveBeenCalledWith("元素データ投入後のDB接続終了に失敗しました");
  });
});

describe("runSeedElementsCommand", () => {
  it("client初期化失敗を固定カテゴリにし、raw errorを出さない", async () => {
    const logger = createLogger();
    const createClient = vi.fn(() => {
      throw new Error("private production connection detail");
    });

    await expect(
      runSeedElementsCommand({
        environment: { DATABASE_URL: "masked" },
        createClient,
        logger,
      }),
    ).resolves.toBe(1);
    expect(logger.info).toHaveBeenCalledWith("元素データCLIの起動を開始しました");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "private production connection detail",
    );
    expect(logger.error).toHaveBeenCalledWith("元素データCLIの初期化に失敗しました");
  });
});
