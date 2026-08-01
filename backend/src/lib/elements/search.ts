import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { isDecimalIntegerString } from "./number.js";

export type ElementSearchQuery = {
  q?: string;
  category?: string;
  period?: number;
};

export const ELEMENT_ID_SEARCH_MIN = 1;
export const ELEMENT_ID_SEARCH_MAX = 118;
export const ELEMENT_PERIOD_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;

const PERIOD_ERROR_MESSAGE = "周期は1から7の整数で指定してください";
const QUERY_STRING_ERROR_MESSAGE = "検索条件は文字列で指定してください";

function normalizeOptionalString(value: unknown, ctx: z.RefinementCtx): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    ctx.addIssue({
      code: "custom",
      message: QUERY_STRING_ERROR_MESSAGE,
    });
    return z.NEVER;
  }

  const normalized = value.trim();
  return normalized === "" ? undefined : normalized;
}

function normalizeOptionalPeriod(value: unknown, ctx: z.RefinementCtx): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    ctx.addIssue({
      code: "custom",
      message: PERIOD_ERROR_MESSAGE,
    });
    return z.NEVER;
  }

  const rawPeriod = typeof value === "string" ? value.trim() : value;
  if (rawPeriod === "") {
    return undefined;
  }

  const period = typeof rawPeriod === "number" ? rawPeriod : Number(rawPeriod);
  if (
    !Number.isInteger(period) ||
    !ELEMENT_PERIOD_OPTIONS.includes(period as (typeof ELEMENT_PERIOD_OPTIONS)[number])
  ) {
    ctx.addIssue({
      code: "custom",
      message: PERIOD_ERROR_MESSAGE,
    });
    return z.NEVER;
  }

  return period;
}

export const elementSearchQuerySchema = z
  .object({
    q: z.unknown().transform(normalizeOptionalString).optional(),
    category: z.unknown().transform(normalizeOptionalString).optional(),
    period: z.unknown().transform(normalizeOptionalPeriod).optional(),
  })
  .strip()
  .transform(({ q, category, period }) => {
    const query: ElementSearchQuery = {};

    if (q !== undefined) {
      query.q = q;
    }

    if (category !== undefined) {
      query.category = category;
    }

    if (period !== undefined) {
      query.period = period;
    }

    return query;
  });

export function getElementIdsMatchingKeyword(keyword: string): number[] {
  if (!isDecimalIntegerString(keyword)) {
    return [];
  }

  const ids: number[] = [];
  for (let id = ELEMENT_ID_SEARCH_MIN; id <= ELEMENT_ID_SEARCH_MAX; id += 1) {
    if (String(id).includes(keyword)) {
      ids.push(id);
    }
  }

  return ids;
}

export function buildElementWhereInput(
  query: ElementSearchQuery,
): Prisma.ElementWhereInput | undefined {
  const where: Prisma.ElementWhereInput = {};

  if (query.q !== undefined) {
    const keywordConditions: Prisma.ElementWhereInput[] = [];
    const elementIds = getElementIdsMatchingKeyword(query.q);

    if (elementIds.length > 0) {
      keywordConditions.push({ id: { in: elementIds } });
    }

    keywordConditions.push(
      { symbol: { contains: query.q, mode: "insensitive" } },
      { nameJa: { contains: query.q } },
      { nameEn: { contains: query.q, mode: "insensitive" } },
    );
    where.OR = keywordConditions;
  }

  if (query.category !== undefined) {
    where.category = query.category;
  }

  if (query.period !== undefined) {
    where.period = query.period;
  }

  return Object.keys(where).length === 0 ? undefined : where;
}
