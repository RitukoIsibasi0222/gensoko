import { createPrismaClient } from "./prisma-client.js";

export const prisma = createPrismaClient(process.env.DATABASE_URL!);
