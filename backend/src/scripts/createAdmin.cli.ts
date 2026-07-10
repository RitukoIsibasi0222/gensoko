import { runCreateAdminCommand, type CreateAdminRuntimeDependencies } from "./createAdmin.js";

async function loadDependencies(): Promise<CreateAdminRuntimeDependencies> {
  const [{ createAdmin }, { prisma }] = await Promise.all([
    import("../services/admin-create.service.js"),
    import("../lib/prisma.js"),
  ]);

  return {
    createAdmin,
    disconnect: () => prisma.$disconnect(),
  };
}

export async function main(): Promise<void> {
  const result = await runCreateAdminCommand({
    argv: process.argv.slice(2),
    env: process.env,
    loadDependencies,
  });

  for (const line of result.stdout) {
    console.log(line);
  }
  for (const line of result.stderr) {
    console.error(line);
  }

  process.exitCode = result.exitCode;
}

void main();
