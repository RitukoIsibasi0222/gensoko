import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./prisma.js", () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

import { prisma } from "./prisma.js";
import {
  SerializationRetryExhaustedError,
  runSerializableTransaction,
} from "./serializable-transaction.js";

function createSerializationConflictError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Transaction write conflict", {
    code: "P2034",
    clientVersion: "test",
  });
}

describe("runSerializableTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Serializable transactionの結果を返す", async () => {
    const callback = vi.fn().mockResolvedValue("result");
    vi.mocked(prisma.$transaction).mockImplementation(async (transactionCallback, options) => {
      expect(options).toEqual({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      return transactionCallback({} as never);
    });

    await expect(runSerializableTransaction(callback)).resolves.toBe("result");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("P2034が1回発生した場合はtransaction全体を再試行する", async () => {
    const callback = vi.fn().mockResolvedValue("result");
    vi.mocked(prisma.$transaction)
      .mockRejectedValueOnce(createSerializationConflictError())
      .mockImplementationOnce(async (transactionCallback) => transactionCallback({} as never));

    await expect(runSerializableTransaction(callback)).resolves.toBe("result");
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("P2034が2回続いた場合は専用errorを投げる", async () => {
    const callback = vi.fn();
    vi.mocked(prisma.$transaction).mockRejectedValue(createSerializationConflictError());

    await expect(runSerializableTransaction(callback)).rejects.toBeInstanceOf(
      SerializationRetryExhaustedError,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(callback).not.toHaveBeenCalled();
  });

  it("P2034以外のerrorは再試行せずそのまま投げる", async () => {
    const unexpectedError = new Error("unexpected");
    const callback = vi.fn();
    vi.mocked(prisma.$transaction).mockRejectedValue(unexpectedError);

    await expect(runSerializableTransaction(callback)).rejects.toBe(unexpectedError);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalled();
  });
});
