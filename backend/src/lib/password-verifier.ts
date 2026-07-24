export type PasswordVerificationInput = Readonly<{
  userId: string;
  password: string;
  passwordHash: string;
}>;

export interface PasswordVerifier {
  verify(input: PasswordVerificationInput): Promise<boolean>;
}

const PASSWORD_VERIFICATION_UNAVAILABLE_MESSAGE = "パスワード照合を利用できません";
export const PASSWORD_VERIFICATION_UNAVAILABLE_EVENT = "password_verification_unavailable";

export class PasswordVerificationUnavailableError extends Error {
  constructor() {
    super(PASSWORD_VERIFICATION_UNAVAILABLE_MESSAGE);
    this.name = "PasswordVerificationUnavailableError";
  }
}
