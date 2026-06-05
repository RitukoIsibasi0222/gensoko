import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    gameSession: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../lib/prisma.js";
import { getElementMasteryStatusMap } from "./element-mastery.service.js";

describe("getElementMasteryStatusMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("表示対象の元素IDが空なら DB を参照せず空の Map を返す", async () => {
    const result = await getElementMasteryStatusMap("user-1", []);

    expect(result).toEqual(new Map());
    expect(prisma.gameSession.findMany).not.toHaveBeenCalled();
  });

  it("回答履歴がない元素は unlearned を返す", async () => {
    vi.mocked(prisma.gameSession.findMany).mockResolvedValue([] as never);

    const result = await getElementMasteryStatusMap("user-1", [1, 2]);

    expect(result).toEqual(
      new Map([
        [1, "unlearned"],
        [2, "unlearned"],
      ]),
    );
    expect(prisma.gameSession.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { playedAt: "desc" },
      select: {
        playedAt: true,
        answers: {
          where: {
            elementId: { in: [1, 2] },
          },
          select: {
            elementId: true,
            isCorrect: true,
          },
        },
      },
    });
  });

  it("直近1回だけ正解している元素は learning を返す", async () => {
    vi.mocked(prisma.gameSession.findMany).mockResolvedValue([
      {
        playedAt: new Date("2026-06-01T00:00:00.000Z"),
        answers: [{ elementId: 1, isCorrect: true }],
      },
    ] as never);

    const result = await getElementMasteryStatusMap("user-1", [1]);

    expect(result.get(1)).toBe("learning");
  });

  it("直近2回連続で正解している元素は mastered を返す", async () => {
    vi.mocked(prisma.gameSession.findMany).mockResolvedValue([
      {
        playedAt: new Date("2026-06-02T00:00:00.000Z"),
        answers: [{ elementId: 1, isCorrect: true }],
      },
      {
        playedAt: new Date("2026-06-01T00:00:00.000Z"),
        answers: [{ elementId: 1, isCorrect: true }],
      },
    ] as never);

    const result = await getElementMasteryStatusMap("user-1", [1]);

    expect(result.get(1)).toBe("mastered");
  });

  it("直近2回のどちらかが不正解なら learning を返す", async () => {
    vi.mocked(prisma.gameSession.findMany).mockResolvedValue([
      {
        playedAt: new Date("2026-06-02T00:00:00.000Z"),
        answers: [{ elementId: 1, isCorrect: false }],
      },
      {
        playedAt: new Date("2026-06-01T00:00:00.000Z"),
        answers: [{ elementId: 1, isCorrect: true }],
      },
    ] as never);

    const result = await getElementMasteryStatusMap("user-1", [1]);

    expect(result.get(1)).toBe("learning");
  });

  it("古い2連続正解があっても直近が不正解なら learning を返す", async () => {
    vi.mocked(prisma.gameSession.findMany).mockResolvedValue([
      {
        playedAt: new Date("2026-06-03T00:00:00.000Z"),
        answers: [{ elementId: 1, isCorrect: false }],
      },
      {
        playedAt: new Date("2026-06-02T00:00:00.000Z"),
        answers: [{ elementId: 1, isCorrect: true }],
      },
      {
        playedAt: new Date("2026-06-01T00:00:00.000Z"),
        answers: [{ elementId: 1, isCorrect: true }],
      },
    ] as never);

    const result = await getElementMasteryStatusMap("user-1", [1]);

    expect(result.get(1)).toBe("learning");
  });

  it("複数元素の状態を同じ Map にまとめて返す", async () => {
    vi.mocked(prisma.gameSession.findMany).mockResolvedValue([
      {
        playedAt: new Date("2026-06-03T00:00:00.000Z"),
        answers: [
          { elementId: 1, isCorrect: true },
          { elementId: 2, isCorrect: false },
        ],
      },
      {
        playedAt: new Date("2026-06-02T00:00:00.000Z"),
        answers: [
          { elementId: 1, isCorrect: true },
          { elementId: 2, isCorrect: true },
        ],
      },
    ] as never);

    const result = await getElementMasteryStatusMap("user-1", [1, 2, 3]);

    expect(result).toEqual(
      new Map([
        [1, "mastered"],
        [2, "learning"],
        [3, "unlearned"],
      ]),
    );
  });

  it("表示対象ではない元素IDの回答は Map に含めない", async () => {
    vi.mocked(prisma.gameSession.findMany).mockResolvedValue([
      {
        playedAt: new Date("2026-06-01T00:00:00.000Z"),
        answers: [{ elementId: 99, isCorrect: true }],
      },
    ] as never);

    const result = await getElementMasteryStatusMap("user-1", [1]);

    expect(result).toEqual(new Map([[1, "unlearned"]]));
  });
});
