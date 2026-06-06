import { z } from "zod";
import { ELEMENT_ID_SEARCH_MAX, ELEMENT_ID_SEARCH_MIN } from "./search.js";

export type ElementIdParam = {
  id: number;
};

const ELEMENT_ID_ERROR_MESSAGE = `元素IDは${ELEMENT_ID_SEARCH_MIN}から${ELEMENT_ID_SEARCH_MAX}の整数で指定してください`;
const DECIMAL_INTEGER_PATTERN = /^\d+$/;

function normalizeElementId(value: unknown, ctx: z.RefinementCtx): number {
  if (typeof value !== "string" && typeof value !== "number") {
    ctx.addIssue({
      code: "custom",
      message: ELEMENT_ID_ERROR_MESSAGE,
    });
    return z.NEVER;
  }

  const rawId = typeof value === "string" ? value.trim() : value;
  if (rawId === "") {
    ctx.addIssue({
      code: "custom",
      message: ELEMENT_ID_ERROR_MESSAGE,
    });
    return z.NEVER;
  }

  if (typeof rawId === "string" && !DECIMAL_INTEGER_PATTERN.test(rawId)) {
    ctx.addIssue({
      code: "custom",
      message: ELEMENT_ID_ERROR_MESSAGE,
    });
    return z.NEVER;
  }

  const id = typeof rawId === "number" ? rawId : Number(rawId);
  if (!Number.isInteger(id) || id < ELEMENT_ID_SEARCH_MIN || id > ELEMENT_ID_SEARCH_MAX) {
    ctx.addIssue({
      code: "custom",
      message: ELEMENT_ID_ERROR_MESSAGE,
    });
    return z.NEVER;
  }

  return id;
}

export const elementIdParamSchema = z
  .object({
    id: z.unknown().transform(normalizeElementId),
  })
  .strip()
  .transform(({ id }): ElementIdParam => ({ id }));
