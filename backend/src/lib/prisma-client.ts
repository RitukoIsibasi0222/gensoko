import { PrismaPg } from "@prisma/adapter-pg";
import prismaClientModule from "@prisma/client";

const { PrismaClient } = prismaClientModule;

export function createPrismaClient(connectionString: string) {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export type AppPrismaClient = ReturnType<typeof createPrismaClient>;
