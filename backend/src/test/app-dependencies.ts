import { createAppDependencies } from "../lib/app-dependencies.js";
import { createBcryptPasswordVerifier } from "../lib/bcrypt-password-verifier.js";

export function createTestAppDependencies() {
  return createAppDependencies({
    prisma: {} as never,
    mailSender: { send: async () => undefined },
    jwtSecret: "test-jwt-secret",
    frontendUrl: "http://localhost:5174",
    mailFrom: "noreply@example.test",
    passwordVerifier: createBcryptPasswordVerifier(),
  });
}
