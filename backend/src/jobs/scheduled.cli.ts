import { prisma } from "../lib/prisma.js";
import { runScheduledBatch } from "./scheduled.js";

const MISSING_CRON_MESSAGE = "BATCH_CRON を指定してください";
const INVALID_SCHEDULED_TIME_MESSAGE =
  "SCHEDULED_TIME は UNIX epoch milliseconds または ISO 8601 形式で指定してください";
const CLI_FAILED_EVENT = "batch.cron.cli.failed";
const CLI_FAILED_MESSAGE = "定期バッチCLIの実行に失敗しました";

function parseScheduledTime(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    return Date.now();
  }

  const numericValue = Number(value);

  if (Number.isFinite(numericValue)) {
    return numericValue;
  }

  const parsedValue = Date.parse(value);

  if (Number.isFinite(parsedValue)) {
    return parsedValue;
  }

  throw new Error(INVALID_SCHEDULED_TIME_MESSAGE);
}

async function disconnectPrisma(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch {
    // batch result is already determined; disconnect failure should not change CLI outcome.
  }
}

async function main(): Promise<void> {
  const cron = process.env.BATCH_CRON?.trim();

  if (!cron) {
    throw new Error(MISSING_CRON_MESSAGE);
  }

  const scheduledTime = parseScheduledTime(process.env.SCHEDULED_TIME);

  try {
    await runScheduledBatch({ cron, scheduledTime });
  } catch {
    // runScheduledBatch records a sanitized failure event; the CLI only controls the exit status.
    process.exitCode = 1;
  }
}

void main()
  .catch((error: unknown) => {
    console.error({
      event: CLI_FAILED_EVENT,
      message: error instanceof Error ? error.message : CLI_FAILED_MESSAGE,
    });
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
