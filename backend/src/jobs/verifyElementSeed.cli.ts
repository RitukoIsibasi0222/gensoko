import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import type { ElementReadClient } from "./seedElements.js";
import { verifyElementSeed } from "./seedElements.js";

const COMPLETED_MESSAGE = "確認完了: 118 件の元素が正本と一致しました";
const FAILED_MESSAGE = "元素データ118件の検証に失敗しました";
const DISCONNECT_FAILED_MESSAGE = "元素データ検証後のDB接続終了に失敗しました";

export type ElementSeedVerificationClient = ElementReadClient & Pick<PrismaClient, "$disconnect">;

export async function runVerifyElementSeedCli(
  client: ElementSeedVerificationClient,
  logger: Pick<Console, "info" | "error"> = console,
): Promise<number> {
  let exitCode = 0;

  try {
    const result = await verifyElementSeed(client);
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

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  process.exitCode = await runVerifyElementSeedCli(prisma);
}

const entrypointPath = process.argv[1];
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  void main();
}
