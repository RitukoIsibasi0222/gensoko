import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

function normalizePassword(rawPassword: string): string {
  return rawPassword.trim();
}

export class UserError extends Error {
  constructor(
    public readonly status: 400 | 403 | 409,
    message: string,
  ) {
    super(message);
    this.name = "UserError";
  }
}

export type CurrentUserProfile = {
  id: string;
  username: string;
  email: string;
  role: Role;
  createdAt: Date;
};

export async function getCurrentUserProfile(userId: string): Promise<CurrentUserProfile> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new UserError(403, "ユーザーが見つかりません");
  }

  return user;
}

export async function updateCurrentUsername(input: { userId: string; username: string }): Promise<{
  user: { id: string; username: string; role: Role };
}> {
  const normalizedUsername = input.username.trim();

  const currentUser = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, username: true, role: true },
  });

  if (!currentUser) {
    throw new UserError(403, "ユーザーが見つかりません");
  }

  if (currentUser.username === normalizedUsername) {
    return {
      user: {
        id: currentUser.id,
        username: currentUser.username,
        role: currentUser.role,
      },
    };
  }

  const duplicatedUser = await prisma.user.findFirst({
    where: {
      username: normalizedUsername,
      id: { not: input.userId },
    },
    select: { id: true },
  });

  if (duplicatedUser) {
    throw new UserError(409, "このユーザー名は既に使用されています");
  }

  const updatedUser = await prisma.user.update({
    where: { id: input.userId },
    data: { username: normalizedUsername },
    select: { id: true, username: true, role: true },
  });

  return { user: updatedUser };
}

export async function changeCurrentPassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const normalizedCurrentPassword = normalizePassword(input.currentPassword);
  const normalizedNewPassword = normalizePassword(input.newPassword);

  if (normalizedCurrentPassword === normalizedNewPassword) {
    throw new UserError(400, "新しいパスワードは現在のパスワードと異なるものにしてください");
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, passwordHash: true },
  });

  if (!user) {
    throw new UserError(403, "ユーザーが見つかりません");
  }

  const isCurrentPasswordValid = await bcrypt.compare(normalizedCurrentPassword, user.passwordHash);
  if (!isCurrentPasswordValid) {
    throw new UserError(400, "現在のパスワードが正しくありません");
  }

  const newPasswordHash = await bcrypt.hash(normalizedNewPassword, 12);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      data: { passwordHash: newPasswordHash },
    });
    await tx.refreshToken.deleteMany({ where: { userId: input.userId } });
  });
}

export async function deleteCurrentUser(input: {
  userId: string;
  currentPassword: string;
}): Promise<void> {
  const normalizedCurrentPassword = normalizePassword(input.currentPassword);

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, passwordHash: true },
  });

  if (!user) {
    throw new UserError(403, "ユーザーが見つかりません");
  }

  const isCurrentPasswordValid = await bcrypt.compare(normalizedCurrentPassword, user.passwordHash);
  if (!isCurrentPasswordValid) {
    throw new UserError(400, "現在のパスワードが正しくありません");
  }

  await prisma.$transaction(async (tx) => {
    // 監査目的のためユーザー行は削除せず、論理削除フラグを立てる
    await tx.user.update({
      where: { id: input.userId },
      data: {
        isActive: false,
        deletedAt: new Date(),
        lockedUntil: null,
      },
    });
    await tx.refreshToken.deleteMany({ where: { userId: input.userId } });
    await tx.passwordResetToken.deleteMany({ where: { userId: input.userId } });
    await tx.emailVerification.deleteMany({ where: { userId: input.userId } });
  });
}
