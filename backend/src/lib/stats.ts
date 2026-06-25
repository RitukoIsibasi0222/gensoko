export type NormalizedCountPair = {
  correctCount: number;
  totalCount: number;
};

export function normalizeNonNegativeCount(value: number): number {
  return Math.max(0, value);
}

export function normalizeCountPair(correctCount: number, totalCount: number): NormalizedCountPair {
  const normalizedTotalCount = normalizeNonNegativeCount(totalCount);

  return {
    correctCount: Math.min(normalizeNonNegativeCount(correctCount), normalizedTotalCount),
    totalCount: normalizedTotalCount,
  };
}

export function calculateAccuracyRate(correctCount: number, totalCount: number): number {
  const normalized = normalizeCountPair(correctCount, totalCount);

  if (normalized.totalCount <= 0) {
    return 0;
  }

  return Math.round((normalized.correctCount / normalized.totalCount) * 100);
}
