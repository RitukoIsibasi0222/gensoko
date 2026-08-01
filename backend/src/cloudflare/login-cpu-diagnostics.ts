export const LOGIN_CPU_DIAGNOSTIC_OPERATIONS = [
  "BCRYPT_COMPARE_COST_12",
  "RATE_LIMIT_KEY_DIGEST_X3",
  "JWT_SIGN",
  "REFRESH_TOKEN_CRYPTO",
  "APP_DEPENDENCY_CONSTRUCTION",
] as const;

export type LoginCpuDiagnosticOperation = (typeof LOGIN_CPU_DIAGNOSTIC_OPERATIONS)[number];

export type LoginCpuOperationMeasurement = Readonly<{
  operation: LoginCpuDiagnosticOperation;
  sampleCount: number;
  minMs: number;
  medianMs: number;
  maxMs: number;
}>;

export type LoginCpuDiagnosticClassification =
  | "BCRYPT_DOMINANT"
  | "MIXED_OR_INCONCLUSIVE"
  | "INSUFFICIENT_MEASUREMENTS";

type MeasureLoginCpuOperationOptions = Readonly<{
  operation: LoginCpuDiagnosticOperation;
  sampleCount: number;
  run: () => void | Promise<void>;
  now?: () => number;
}>;

const SAMPLE_COUNT_ERROR_MESSAGE = "login CPU診断のsample数が不正です";
const TIMER_ERROR_MESSAGE = "login CPU診断の計測時間が不正です";
const BCRYPT_DOMINANCE_RATIO = 10;
const REQUIRED_OPERATION_SET = new Set<string>(LOGIN_CPU_DIAGNOSTIC_OPERATIONS);

function calculateMedian(sortedValues: readonly number[]): number {
  const centerIndex = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 1) {
    return sortedValues[centerIndex]!;
  }

  return (sortedValues[centerIndex - 1]! + sortedValues[centerIndex]!) / 2;
}

/** ローカルworkerd上で1操作のCPU時間sampleを集計する。 */
export async function measureLoginCpuOperation({
  operation,
  sampleCount,
  run,
  now = () => performance.now(),
}: MeasureLoginCpuOperationOptions): Promise<LoginCpuOperationMeasurement> {
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 1) {
    throw new RangeError(SAMPLE_COUNT_ERROR_MESSAGE);
  }

  const elapsedSamples: number[] = [];

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const startedAt = now();
    await run();
    const elapsedMs = now() - startedAt;

    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new RangeError(TIMER_ERROR_MESSAGE);
    }

    elapsedSamples.push(elapsedMs);
  }

  elapsedSamples.sort((left, right) => left - right);

  return {
    operation,
    sampleCount,
    minMs: elapsedSamples[0]!,
    medianMs: calculateMedian(elapsedSamples),
    maxMs: elapsedSamples[elapsedSamples.length - 1]!,
  };
}

function isValidMeasurement(measurement: LoginCpuOperationMeasurement): boolean {
  return (
    REQUIRED_OPERATION_SET.has(measurement.operation) &&
    Number.isSafeInteger(measurement.sampleCount) &&
    measurement.sampleCount > 0 &&
    Number.isFinite(measurement.minMs) &&
    Number.isFinite(measurement.medianMs) &&
    Number.isFinite(measurement.maxMs) &&
    measurement.minMs >= 0 &&
    measurement.minMs <= measurement.medianMs &&
    measurement.medianMs <= measurement.maxMs
  );
}

/** 必須5操作の中央値から、bcryptが10倍以上支配的かを固定分類する。 */
export function classifyLoginCpuMeasurements(
  measurements: readonly LoginCpuOperationMeasurement[],
): LoginCpuDiagnosticClassification {
  if (measurements.length !== LOGIN_CPU_DIAGNOSTIC_OPERATIONS.length) {
    return "INSUFFICIENT_MEASUREMENTS";
  }

  const measurementsByOperation = new Map<
    LoginCpuDiagnosticOperation,
    LoginCpuOperationMeasurement
  >();

  for (const measurement of measurements) {
    if (!isValidMeasurement(measurement) || measurementsByOperation.has(measurement.operation)) {
      return "INSUFFICIENT_MEASUREMENTS";
    }
    measurementsByOperation.set(measurement.operation, measurement);
  }

  if (measurementsByOperation.size !== LOGIN_CPU_DIAGNOSTIC_OPERATIONS.length) {
    return "INSUFFICIENT_MEASUREMENTS";
  }

  const bcryptMedian = measurementsByOperation.get("BCRYPT_COMPARE_COST_12")!.medianMs;
  const maximumOtherMedian = Math.max(
    ...LOGIN_CPU_DIAGNOSTIC_OPERATIONS.filter(
      (operation) => operation !== "BCRYPT_COMPARE_COST_12",
    ).map((operation) => measurementsByOperation.get(operation)!.medianMs),
  );

  if (bcryptMedian > 0 && bcryptMedian >= maximumOtherMedian * BCRYPT_DOMINANCE_RATIO) {
    return "BCRYPT_DOMINANT";
  }

  return "MIXED_OR_INCONCLUSIVE";
}
