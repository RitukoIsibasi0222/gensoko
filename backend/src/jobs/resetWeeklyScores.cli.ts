import { prisma } from "../lib/prisma.js";
import { resetWeeklyScores } from "./resetWeeklyScores.js";

async function main(): Promise<void> {
  try {
    await resetWeeklyScores();
  } catch {
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
