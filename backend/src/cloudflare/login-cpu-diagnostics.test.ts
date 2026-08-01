import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { sign } from "hono/jwt";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { hashPassword } from "../lib/password.js";
import { createRateLimitKeyDigest } from "../middleware/rateLimit/key.js";
import type { RateLimitDependencies } from "../middleware/rateLimit/store.js";
import { createTestAppDependencies } from "../test/app-dependencies.js";
import {
  classifyLoginCpuMeasurements,
  LOGIN_CPU_DIAGNOSTIC_OPERATIONS,
  measureLoginCpuOperation,
  type LoginCpuDiagnosticOperation,
  type LoginCpuOperationMeasurement,
} from "./login-cpu-diagnostics.js";

vi.mock("@prisma/client", () => {
  class PrismaClientKnownRequestError extends Error {
    readonly code = "P2034";
  }

  return {
    AuditResult: { SUCCESS: "SUCCESS", FAILURE: "FAILURE" },
    Role: { USER: "USER", ADMIN: "ADMIN" },
    Prisma: {
      PrismaClientKnownRequestError,
      TransactionIsolationLevel: { Serializable: "Serializable" },
    },
  };
});

const SYNTHETIC_IP = "192.0.2.1";
const SYNTHETIC_EMAIL = "diagnostic@example.test";
const SYNTHETIC_USER_ID = "00000000-0000-4000-8000-000000000000";

const TEST_RATE_LIMIT_DEPENDENCIES: RateLimitDependencies = {
  getStore: () => ({
    consume: async () => ({
      allowed: true,
      limit: 1,
      remaining: 0,
      resetAtMs: 60_000,
      retryAfterSec: 0,
    }),
  }),
  keySecret: Buffer.from("0123456789abcdef0123456789abcdef").toString("base64"),
  resolveIp: () => SYNTHETIC_IP,
};

function createMeasurement(
  operation: LoginCpuDiagnosticOperation,
  medianMs: number,
): LoginCpuOperationMeasurement {
  return {
    operation,
    sampleCount: 3,
    minMs: medianMs,
    medianMs,
    maxMs: medianMs,
  };
}

function createCompleteMeasurements(
  overrides: Partial<Record<LoginCpuDiagnosticOperation, number>> = {},
) {
  return LOGIN_CPU_DIAGNOSTIC_OPERATIONS.map((operation) =>
    createMeasurement(operation, overrides[operation] ?? 1),
  );
}

describe("measureLoginCpuOperation", () => {
  it("各sampleの実行時間を昇順に集計し、奇数件の中央値を返す", async () => {
    const run = vi.fn(async () => undefined);
    const timestamps = [0, 3, 3, 10, 10, 15];
    let timestampIndex = 0;

    const result = await measureLoginCpuOperation({
      operation: "JWT_SIGN",
      sampleCount: 3,
      run,
      now: () => timestamps[timestampIndex++]!,
    });

    expect(run).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      operation: "JWT_SIGN",
      sampleCount: 3,
      minMs: 3,
      medianMs: 5,
      maxMs: 7,
    });
  });

  it("偶数件では中央2件の平均を中央値として返す", async () => {
    const timestamps = [0, 4, 4, 14, 14, 20, 20, 28];
    let timestampIndex = 0;

    const result = await measureLoginCpuOperation({
      operation: "REFRESH_TOKEN_CRYPTO",
      sampleCount: 4,
      run: async () => undefined,
      now: () => timestamps[timestampIndex++]!,
    });

    expect(result).toEqual({
      operation: "REFRESH_TOKEN_CRYPTO",
      sampleCount: 4,
      minMs: 4,
      medianMs: 7,
      maxMs: 10,
    });
  });

  it.each([0, -1, 1.5])("sampleCount=%s を固定日本語エラーで拒否する", async (sampleCount) => {
    await expect(
      measureLoginCpuOperation({
        operation: "JWT_SIGN",
        sampleCount,
        run: async () => undefined,
      }),
    ).rejects.toThrow("login CPU診断のsample数が不正です");
  });

  it.each([
    [2, 1],
    [0, Number.NaN],
    [0, Number.POSITIVE_INFINITY],
  ])("不正な計測値 %s → %s を固定日本語エラーで拒否する", async (start, end) => {
    const timestamps = [start, end];
    let timestampIndex = 0;

    await expect(
      measureLoginCpuOperation({
        operation: "JWT_SIGN",
        sampleCount: 1,
        run: async () => undefined,
        now: () => timestamps[timestampIndex++]!,
      }),
    ).rejects.toThrow("login CPU診断の計測時間が不正です");
  });
});

describe("classifyLoginCpuMeasurements", () => {
  it("bcrypt中央値が他操作の最大値の10倍以上ならBCRYPT_DOMINANTへ分類する", () => {
    const measurements = createCompleteMeasurements({
      BCRYPT_COMPARE_COST_12: 100,
      RATE_LIMIT_KEY_DIGEST_X3: 10,
      JWT_SIGN: 2,
      REFRESH_TOKEN_CRYPTO: 1,
      APP_DEPENDENCY_CONSTRUCTION: 3,
    });

    expect(classifyLoginCpuMeasurements(measurements)).toBe("BCRYPT_DOMINANT");
  });

  it("bcryptの優位性が10倍未満ならMIXED_OR_INCONCLUSIVEへ分類する", () => {
    const measurements = createCompleteMeasurements({
      BCRYPT_COMPARE_COST_12: 99,
      RATE_LIMIT_KEY_DIGEST_X3: 10,
    });

    expect(classifyLoginCpuMeasurements(measurements)).toBe("MIXED_OR_INCONCLUSIVE");
  });

  it("必須操作の欠落・重複・不正なsummaryはINSUFFICIENT_MEASUREMENTSへ分類する", () => {
    const complete = createCompleteMeasurements();
    const invalidSummary = {
      ...createMeasurement("JWT_SIGN", 1),
      minMs: 2,
    };

    expect(classifyLoginCpuMeasurements(complete.slice(1))).toBe("INSUFFICIENT_MEASUREMENTS");
    expect(classifyLoginCpuMeasurements([...complete, complete[0]!])).toBe(
      "INSUFFICIENT_MEASUREMENTS",
    );
    expect(
      classifyLoginCpuMeasurements(
        complete.map((measurement) =>
          measurement.operation === "JWT_SIGN" ? invalidSummary : measurement,
        ),
      ),
    ).toBe("INSUFFICIENT_MEASUREMENTS");
  });
});

describe("login CPU診断（ローカルworkerd）", () => {
  it("実login構成要素を計測し、秘密値を含まないsummaryで支配要因を分類する", async () => {
    const syntheticPassword = String.fromCharCode(82, 55, 45, 99, 112, 117, 45, 100, 105, 97, 103);
    const syntheticHash = await hashPassword(syntheticPassword);
    const jwtSecret = "local-diagnostic-jwt-secret";
    const rateLimitSecret = TEST_RATE_LIMIT_DEPENDENCIES.keySecret;

    expect(await bcrypt.compare(syntheticPassword, syntheticHash)).toBe(true);

    const measurementTasks = [
      () =>
        measureLoginCpuOperation({
          operation: "BCRYPT_COMPARE_COST_12",
          sampleCount: 3,
          run: async () => {
            if (!(await bcrypt.compare(syntheticPassword, syntheticHash))) {
              throw new Error("合成bcrypt照合に失敗しました");
            }
          },
        }),
      () =>
        measureLoginCpuOperation({
          operation: "RATE_LIMIT_KEY_DIGEST_X3",
          sampleCount: 5,
          run: async () => {
            await createRateLimitKeyDigest({
              secret: rateLimitSecret,
              policyId: "GENERAL_API_IP",
              operationScope: null,
              actorType: "ip",
              value: SYNTHETIC_IP,
            });
            await createRateLimitKeyDigest({
              secret: rateLimitSecret,
              policyId: "AUTH_IP",
              operationScope: "login",
              actorType: "ip",
              value: SYNTHETIC_IP,
            });
            await createRateLimitKeyDigest({
              secret: rateLimitSecret,
              policyId: "AUTH_EMAIL",
              operationScope: "login",
              actorType: "email",
              value: SYNTHETIC_EMAIL,
            });
          },
        }),
      () =>
        measureLoginCpuOperation({
          operation: "JWT_SIGN",
          sampleCount: 5,
          run: async () => {
            await sign({ userId: SYNTHETIC_USER_ID, role: "USER" }, jwtSecret, "HS256");
          },
        }),
      () =>
        measureLoginCpuOperation({
          operation: "REFRESH_TOKEN_CRYPTO",
          sampleCount: 5,
          run: async () => {
            const token = randomBytes(32).toString("hex");
            createHash("sha256").update(token).digest("hex");
          },
        }),
      () =>
        measureLoginCpuOperation({
          operation: "APP_DEPENDENCY_CONSTRUCTION",
          sampleCount: 5,
          run: async () => {
            createApp({
              isProduction: true,
              frontendUrl: "https://diagnostic.example.test",
              rateLimit: TEST_RATE_LIMIT_DEPENDENCIES,
              dependencies: createTestAppDependencies(),
            });
          },
        }),
    ] as const;
    const measurements: LoginCpuOperationMeasurement[] = [];

    for (const measureOperation of measurementTasks) {
      measurements.push(await measureOperation());
    }
    const classification = classifyLoginCpuMeasurements(measurements);
    const safeSummary = JSON.stringify({ classification, measurements });

    expect(classification).toBe("BCRYPT_DOMINANT");
    expect(safeSummary.includes(syntheticPassword)).toBe(false);
    expect(safeSummary.includes(syntheticHash)).toBe(false);
    expect(safeSummary.includes(jwtSecret)).toBe(false);
    expect(safeSummary.includes(rateLimitSecret)).toBe(false);
    expect(safeSummary.includes(SYNTHETIC_IP)).toBe(false);
    expect(safeSummary.includes(SYNTHETIC_EMAIL)).toBe(false);
    expect(safeSummary.includes(SYNTHETIC_USER_ID)).toBe(false);
    console.info(`R7_LOGIN_CPU_DIAGNOSTIC ${safeSummary}`);
  });
});
