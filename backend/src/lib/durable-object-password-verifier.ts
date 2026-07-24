import type { PasswordVerifierDurableObject } from "../cloudflare/password-verifier.js";
import {
  PasswordVerificationUnavailableError,
  type PasswordVerifier,
} from "./password-verifier.js";

export function createDurableObjectPasswordVerifier(
  namespace: DurableObjectNamespace<PasswordVerifierDurableObject>,
): PasswordVerifier {
  return {
    async verify({ userId, password, passwordHash }) {
      try {
        const stub = namespace.get(namespace.idFromName(userId));
        const result: unknown = await stub.verify({ password, passwordHash });
        if (typeof result !== "boolean") {
          throw new PasswordVerificationUnavailableError();
        }
        return result;
      } catch {
        throw new PasswordVerificationUnavailableError();
      }
    },
  };
}
