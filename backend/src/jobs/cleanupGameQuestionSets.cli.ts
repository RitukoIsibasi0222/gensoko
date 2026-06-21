import { prisma } from "../lib/prisma.js";
import { cleanupExpiredGameQuestionSets } from "./cleanupGameQuestionSets.js";

async function main(): Promise<void> {
  try {
    await cleanupExpiredGameQuestionSets();
  } catch {
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
