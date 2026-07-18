import { getDatabaseUrl } from "./config.js";
import { createPrismaClient } from "./prisma-client.js";

export const prisma = createPrismaClient(getDatabaseUrl());
