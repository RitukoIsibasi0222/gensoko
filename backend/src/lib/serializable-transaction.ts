import { prisma } from "./prisma.js";
import {
  createSerializableTransactionRunner,
  SerializationRetryExhaustedError,
} from "./serializable-transaction-core.js";

export { SerializationRetryExhaustedError };

export const runSerializableTransaction = createSerializableTransactionRunner(prisma);
