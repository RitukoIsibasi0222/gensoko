import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    gameSession: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../lib/prisma.js";
import { createElementMasteryService } from "./element-mastery.service.js";

const { getElementMasteryStatusMap } = createElementMasteryService(prisma as never);

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
      orderBy: [{ playedAt: "desc" }, { id: "desc" }],
      skip: 0,
      take: 50,
      select: {
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

  it("同一セッション内の同じ元素の複数正解は1回分として扱う", async () => {
    vi.mocked(prisma.gameSession.findMany).mockResolvedValue([
      {
        playedAt: new Date("2026-06-02T00:00:00.000Z"),
        answers: [
          { elementId: 1, isCorrect: true },
          { elementId: 1, isCorrect: true },
        ],
      },
    ] as never);

    const result = await getElementMasteryStatusMap("user-1", [1]);

    expect(result.get(1)).toBe("learning");
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

  it("最初のページで全対象元素の直近回答が必要件数に達したら次ページを取得しない", async () => {
    vi.mocked(prisma.gameSession.findMany).mockResolvedValueOnce([
      {
        playedAt: new Date("2026-06-03T00:00:00.000Z"),
        answers: [
          { elementId: 1, isCorrect: true },
          { elementId: 2, isCorrect: true },
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

    const result = await getElementMasteryStatusMap("user-1", [1, 2]);

    expect(result).toEqual(
      new Map([
        [1, "mastered"],
        [2, "mastered"],
      ]),
    );
    expect(prisma.gameSession.findMany).toHaveBeenCalledTimes(1);
  });

  it("最初のページで必要件数に達しない場合は次ページを取得する", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      playedAt: new Date(Date.UTC(2026, 5, index + 1)),
      answers: index === 0 ? [{ elementId: 1, isCorrect: true }] : [],
    }));

    vi.mocked(prisma.gameSession.findMany)
      .mockResolvedValueOnce(firstPage as never)
      .mockResolvedValueOnce([
        {
          playedAt: new Date("2026-05-01T00:00:00.000Z"),
          answers: [{ elementId: 1, isCorrect: true }],
        },
      ] as never);

    const result = await getElementMasteryStatusMap("user-1", [1]);

    expect(result).toEqual(new Map([[1, "mastered"]]));
    expect(prisma.gameSession.findMany).toHaveBeenNthCalledWith(2, {
      where: { userId: "user-1" },
      orderBy: [{ playedAt: "desc" }, { id: "desc" }],
      skip: 50,
      take: 50,
      select: {
        answers: {
          where: {
            elementId: { in: [1] },
          },
          select: {
            elementId: true,
            isCorrect: true,
          },
        },
      },
    });
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
