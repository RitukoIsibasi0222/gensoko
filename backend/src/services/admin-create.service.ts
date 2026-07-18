import { hashPassword } from "../lib/password.js";
import { isUniqueConstraintViolation } from "../lib/prisma-errors.js";
import { prisma } from "../lib/prisma.js";

export type AdminCreateInput = {
  username: string;
  email: string;
  password: string;
};

const DUPLICATE_USER_MESSAGE = "ユーザー名またはメールアドレスは既に使用されています";

export class AdminCreateError extends Error {
  readonly code = "DUPLICATE_USER" as const;

  constructor() {
    super(DUPLICATE_USER_MESSAGE);
    this.name = "AdminCreateError";
  }
}

export async function createAdmin(input: AdminCreateInput): Promise<void> {
  const passwordHash = await hashPassword(input.password);

  try {
    await prisma.user.create({
      data: {
        username: input.username,
        email: input.email,
        passwordHash,
        role: "ADMIN",
        emailVerified: true,
        isActive: true,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new AdminCreateError();
    }

    throw error;
  }
}
