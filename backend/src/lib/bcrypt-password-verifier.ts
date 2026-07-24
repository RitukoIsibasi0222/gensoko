import bcrypt from "bcryptjs";
import {
  PasswordVerificationUnavailableError,
  type PasswordVerifier,
} from "./password-verifier.js";

export function createBcryptPasswordVerifier(): PasswordVerifier {
  return {
    async verify({ password, passwordHash }) {
      try {
        const result: unknown = await bcrypt.compare(password, passwordHash);
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
