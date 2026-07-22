import type { AppPrismaClient } from "../../lib/prisma-client.js";
import { createAuditService } from "../../services/audit.service.js";
import { createAuthService } from "../../services/auth.service.js";
import { createAuthRouter } from "./index.js";

export function createAuthTestRouter(
  prisma: AppPrismaClient,
  options: { isProduction?: boolean } = {},
) {
  const mailSender = {
    async send(message: Parameters<(typeof import("../../lib/mail.js"))["mailer"]["sendMail"]>[0]) {
      const { mailer } = await import("../../lib/mail.js");
      await mailer.sendMail(message);
    },
  };

  return createAuthRouter({
    isProduction: options.isProduction ?? false,
    service: createAuthService({
      prisma,
      mailSender,
      jwtSecret: "test-secret-32chars-long-enough!!",
      frontendUrl: "http://localhost:5174",
      mailFrom: "noreply@gensoko.local",
      auditService: createAuditService(prisma),
    }),
  });
}
