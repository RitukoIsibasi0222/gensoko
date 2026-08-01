import type { MailSender } from "./mail-sender.js";
import type { AppPrismaClient } from "./prisma-client.js";
import type { PasswordVerifier } from "./password-verifier.js";
import { createSerializableTransactionRunner } from "./serializable-transaction-core.js";
import { createAuthMiddlewares } from "../middleware/auth/index.js";
import { createAdminService } from "../services/admin.service.js";
import { createAuditService } from "../services/audit.service.js";
import { createAuthService } from "../services/auth.service.js";
import { createElementMasteryService } from "../services/element-mastery.service.js";
import { createGameService } from "../services/game.service.js";
import { createRankingService } from "../services/ranking.service.js";
import { createUserService } from "../services/user.service.js";
import { createWeakService } from "../services/weak.service.js";

export type CreateAppDependenciesOptions = Readonly<{
  prisma: AppPrismaClient;
  mailSender: MailSender;
  jwtSecret: string;
  frontendUrl: string;
  mailFrom: string;
  passwordVerifier: PasswordVerifier;
}>;

export function createAppDependencies({
  prisma,
  mailSender,
  jwtSecret,
  frontendUrl,
  mailFrom,
  passwordVerifier,
}: CreateAppDependenciesOptions) {
  const auditService = createAuditService(prisma);
  const runSerializableTransaction = createSerializableTransactionRunner(prisma);
  const auth = createAuthMiddlewares({ prisma, jwtSecret });

  return {
    prisma,
    auth,
    services: {
      admin: createAdminService({ prisma, runSerializableTransaction, auditService }),
      auth: createAuthService({
        prisma,
        mailSender,
        jwtSecret,
        frontendUrl,
        mailFrom,
        auditService,
        passwordVerifier,
      }),
      elementMastery: createElementMasteryService(prisma),
      game: createGameService(prisma),
      ranking: createRankingService(prisma),
      users: createUserService({ prisma, runSerializableTransaction }),
      weak: createWeakService(prisma),
    },
  } as const;
}

export type AppDependencies = ReturnType<typeof createAppDependencies>;
