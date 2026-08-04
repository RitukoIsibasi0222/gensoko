import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { seedElements } from "./seedElements.js";

const COMPLETED_MESSAGE = "完了: 118 件の元素を登録しました";
const FAILED_MESSAGE = "元素データの投入に失敗しました";
const DISCONNECT_FAILED_MESSAGE = "元素データ投入後のDB接続終了に失敗しました";

export type ElementSeedTransactionClient = Pick<PrismaClient, "$transaction" | "$disconnect">;

export async function runSeedElementsCli(
  client: ElementSeedTransactionClient,
  logger: Pick<Console, "info" | "error"> = console,
): Promise<number> {
  let exitCode = 0;

  try {
    const result = await client.$transaction((transaction) => seedElements(transaction));
    if (result.count !== 118) {
      throw new Error(FAILED_MESSAGE);
    }
    logger.info(COMPLETED_MESSAGE);
  } catch {
    logger.error(FAILED_MESSAGE);
    exitCode = 1;
  }

  try {
    await client.$disconnect();
  } catch {
    logger.error(DISCONNECT_FAILED_MESSAGE);
    exitCode = 1;
  }

  return exitCode;
}

export async function runSeedElementsCommand(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  process.exitCode = await runSeedElementsCli(prisma);
}

const entrypointPath = process.argv[1];
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  void runSeedElementsCommand();
}
