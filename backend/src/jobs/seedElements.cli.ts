import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { ElementSeedStateError, seedElements } from "./seedElements.js";

const COMPLETED_MESSAGE = "完了: 118 件の元素を登録しました";
const PREFLIGHT_FAILED_MESSAGE = "元素データの事前状態が空または正本118件ではありません";
const VERIFICATION_FAILED_MESSAGE = "元素データのトランザクション内検証に失敗しました";
const TRANSACTION_FAILED_MESSAGE = "元素データのDBトランザクション実行に失敗しました";
const DISCONNECT_FAILED_MESSAGE = "元素データ投入後のDB接続終了に失敗しました";
const ELEMENT_SEED_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 120_000,
} as const;

export type ElementSeedTransactionClient = Pick<PrismaClient, "$transaction" | "$disconnect">;

function seedFailureMessage(error: unknown): string {
  if (error instanceof ElementSeedStateError) {
    return error.stage === "preflight" ? PREFLIGHT_FAILED_MESSAGE : VERIFICATION_FAILED_MESSAGE;
  }

  return TRANSACTION_FAILED_MESSAGE;
}

export async function runSeedElementsCli(
  client: ElementSeedTransactionClient,
  logger: Pick<Console, "info" | "error"> = console,
): Promise<number> {
  let exitCode = 0;

  try {
    const result = await client.$transaction(
      (transaction) => seedElements(transaction),
      ELEMENT_SEED_TRANSACTION_OPTIONS,
    );
    if (result.count !== 118) {
      throw new ElementSeedStateError("verification");
    }
    logger.info(COMPLETED_MESSAGE);
  } catch (error) {
    logger.error(seedFailureMessage(error));
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
