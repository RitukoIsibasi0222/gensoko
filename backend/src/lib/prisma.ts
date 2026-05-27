import { PrismaPg } from "@prisma/adapter-pg";
import prismaClientModule from "@prisma/client";

const { PrismaClient } = prismaClientModule;

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

export const prisma = new PrismaClient({ adapter });
