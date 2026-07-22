import { parseArgs } from "node:util";
import { getRefreshTokenCleanupConfig } from "../lib/config.js";

const CLI_FAILED_MESSAGE = "refresh token cleanup CLIの実行に失敗しました";
const ARGUMENT_ERROR_MESSAGE = "refresh token cleanup CLIの引数が正しくありません";

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "dry-run": { type: "boolean" },
      execute: { type: "boolean" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values["dry-run"] && values.execute) {
    throw new Error(ARGUMENT_ERROR_MESSAGE);
  }

  const [{ cleanupExpiredRefreshTokens }, { prisma }] = await Promise.all([
    import("./cleanupExpiredRefreshTokens.js"),
    import("../lib/prisma.js"),
  ]);
  try {
    const result = await cleanupExpiredRefreshTokens({
      dryRun: values.execute !== true,
      executeEnabled: getRefreshTokenCleanupConfig().executeEnabled,
    });
    if (result.limitReached) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error({
    event: "refresh_tokens.cleanup.cli.failed",
    message:
      error instanceof Error && error.message === ARGUMENT_ERROR_MESSAGE
        ? ARGUMENT_ERROR_MESSAGE
        : CLI_FAILED_MESSAGE,
  });
  process.exitCode = 1;
});
