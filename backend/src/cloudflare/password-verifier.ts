import { DurableObject } from "cloudflare:workers";
import bcrypt from "bcryptjs";

export type PasswordVerifierRpcInput = Readonly<{
  password: string;
  passwordHash: string;
}>;

export class PasswordVerifierDurableObject extends DurableObject {
  async verify({ password, passwordHash }: PasswordVerifierRpcInput): Promise<boolean> {
    return bcrypt.compare(password, passwordHash);
  }
}
