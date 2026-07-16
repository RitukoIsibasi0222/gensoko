import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

const DEFAULT_MAX_ATTEMPTS = 2;

export class SerializationRetryExhaustedError extends Error {
  constructor(cause: unknown) {
    super("Serializable transactionの再試行上限に達しました", { cause });
    this.name = "SerializationRetryExhaustedError";
  }
}

function isSerializationConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export async function runSerializableTransaction<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { maxAttempts?: number } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttemptsは1以上の整数で指定してください");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isSerializationConflict(error)) {
        throw error;
      }

      if (attempt === maxAttempts) {
        throw new SerializationRetryExhaustedError(error);
      }
    }
  }

  throw new SerializationRetryExhaustedError(undefined);
}
