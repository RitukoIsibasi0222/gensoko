import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    $disconnect: vi.fn(),
  },
}));

vi.mock("./resetWeeklyScores.js", () => ({
  resetWeeklyScores: vi.fn(),
}));

import { prisma } from "../lib/prisma.js";
import { resetWeeklyScores } from "./resetWeeklyScores.js";

describe("resetWeeklyScores.cli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it("calls the reset job and disconnects prisma on success", async () => {
    vi.mocked(resetWeeklyScores).mockResolvedValue({
      resetCount: 3,
      executedAt: new Date("2026-06-29T00:00:00.000Z"),
    });
    vi.mocked(prisma.$disconnect).mockResolvedValue(undefined);

    await import("./resetWeeklyScores.cli.js");

    await vi.waitFor(() => {
      expect(resetWeeklyScores).toHaveBeenCalledTimes(1);
      expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("sets a non-zero exit code and still disconnects prisma when the job fails", async () => {
    vi.mocked(resetWeeklyScores).mockRejectedValue(new Error("unexpected"));
    vi.mocked(prisma.$disconnect).mockResolvedValue(undefined);

    await import("./resetWeeklyScores.cli.js");

    await vi.waitFor(() => {
      expect(resetWeeklyScores).toHaveBeenCalledTimes(1);
      expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    });
    expect(process.exitCode).toBe(1);
  });
});
