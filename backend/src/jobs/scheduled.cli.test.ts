import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    $disconnect: vi.fn(),
  },
}));

vi.mock("./scheduled.js", () => ({
  runScheduledBatch: vi.fn(),
}));

import { prisma } from "../lib/prisma.js";
import { runScheduledBatch } from "./scheduled.js";

const BATCH_CRON = "7 15 * * 0";
const SCHEDULED_TIME = "2026-07-05T15:07:00.000Z";

describe("scheduled.cli", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.exitCode = undefined;
    delete process.env.BATCH_CRON;
    delete process.env.SCHEDULED_TIME;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.exitCode = undefined;
    delete process.env.BATCH_CRON;
    delete process.env.SCHEDULED_TIME;
    consoleErrorSpy.mockRestore();
  });

  it("passes BATCH_CRON and ISO SCHEDULED_TIME to runScheduledBatch", async () => {
    process.env.BATCH_CRON = BATCH_CRON;
    process.env.SCHEDULED_TIME = SCHEDULED_TIME;
    vi.mocked(runScheduledBatch).mockResolvedValue({
      job: "resetWeeklyScores",
      cron: BATCH_CRON,
      executedAt: new Date(SCHEDULED_TIME),
      resetCount: 0,
    });
    vi.mocked(prisma.$disconnect).mockResolvedValue(undefined);

    await import("./scheduled.cli.js");

    await vi.waitFor(() => {
      expect(runScheduledBatch).toHaveBeenCalledWith({
        cron: BATCH_CRON,
        scheduledTime: Date.parse(SCHEDULED_TIME),
      });
      expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("ignores prisma disconnect failures after a successful batch", async () => {
    process.env.BATCH_CRON = BATCH_CRON;
    process.env.SCHEDULED_TIME = SCHEDULED_TIME;
    vi.mocked(runScheduledBatch).mockResolvedValue({
      job: "resetWeeklyScores",
      cron: BATCH_CRON,
      executedAt: new Date(SCHEDULED_TIME),
      resetCount: 0,
    });
    vi.mocked(prisma.$disconnect).mockRejectedValue(new Error("disconnect failed"));

    await import("./scheduled.cli.js");

    await vi.waitFor(() => {
      expect(runScheduledBatch).toHaveBeenCalledTimes(1);
      expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    });
    expect(process.exitCode).toBeUndefined();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("sets a non-zero exit code and disconnects when BATCH_CRON is missing", async () => {
    vi.mocked(prisma.$disconnect).mockResolvedValue(undefined);

    await import("./scheduled.cli.js");

    await vi.waitFor(() => {
      expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    });
    expect(runScheduledBatch).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "batch.cron.cli.failed",
      message: "BATCH_CRON を指定してください",
    });
  });

  it("sets a non-zero exit code and disconnects when SCHEDULED_TIME is invalid", async () => {
    process.env.BATCH_CRON = BATCH_CRON;
    process.env.SCHEDULED_TIME = "not-a-date";
    vi.mocked(prisma.$disconnect).mockResolvedValue(undefined);

    await import("./scheduled.cli.js");

    await vi.waitFor(() => {
      expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    });
    expect(runScheduledBatch).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "batch.cron.cli.failed",
      message: "SCHEDULED_TIME は UNIX epoch milliseconds または ISO 8601 形式で指定してください",
    });
  });

  it("sets a non-zero exit code and disconnects when the cron is unsupported", async () => {
    const cron = "5 * * * *";
    process.env.BATCH_CRON = cron;
    vi.mocked(runScheduledBatch).mockRejectedValue(new Error("未対応の定期バッチCronです"));
    vi.mocked(prisma.$disconnect).mockResolvedValue(undefined);

    await import("./scheduled.cli.js");

    await vi.waitFor(() => {
      expect(runScheduledBatch).toHaveBeenCalledWith({
        cron,
        scheduledTime: expect.any(Number),
      });
      expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    });
    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith({
      event: "batch.cron.cli.failed",
      message: "未対応の定期バッチCronです",
    });
  });
});
