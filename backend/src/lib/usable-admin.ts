import { Prisma, Role } from "@prisma/client";

export type AccountAvailability = {
  role: Role;
  isActive: boolean;
  emailVerified: boolean;
  lockedUntil: Date | null;
  deletedAt: Date | null;
};

export function getUsableAdminWhere(now: Date): Prisma.UserWhereInput {
  return {
    role: Role.ADMIN,
    isActive: true,
    deletedAt: null,
    emailVerified: true,
    OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
  };
}

export function isUsableAccount(user: AccountAvailability, now: Date): boolean {
  return (
    user.isActive &&
    user.deletedAt === null &&
    user.emailVerified &&
    (user.lockedUntil === null || user.lockedUntil <= now)
  );
}

export function isUsableAdmin(user: AccountAvailability, now: Date): boolean {
  return user.role === Role.ADMIN && isUsableAccount(user, now);
}
