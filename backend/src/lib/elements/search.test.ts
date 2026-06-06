import { describe, expect, it } from "vitest";
import {
  buildElementWhereInput,
  elementSearchQuerySchema,
  getElementIdsMatchingKeyword,
} from "./search.js";

describe("elementSearchQuerySchema", () => {
  it("q と category を trim し、period を number に変換する", () => {
    const result = elementSearchQuerySchema.parse({
      q: "  H  ",
      category: "  非金属  ",
      period: "2",
    });

    expect(result).toEqual({
      q: "H",
      category: "非金属",
      period: 2,
    });
  });

  it("空文字は未指定として扱う", () => {
    const result = elementSearchQuerySchema.parse({
      q: "   ",
      category: "",
      period: "",
    });

    expect(result).toEqual({});
  });

  it("未知の query key は無視する", () => {
    const result = elementSearchQuerySchema.parse({
      q: "水素",
      unknown: "ignored",
    });

    expect(result).toEqual({ q: "水素" });
  });

  it("period は 1 から 7 の整数だけ有効にする", () => {
    expect(elementSearchQuerySchema.safeParse({ period: "1" }).success).toBe(true);
    expect(elementSearchQuerySchema.safeParse({ period: "7" }).success).toBe(true);

    expect(elementSearchQuerySchema.safeParse({ period: "0" }).success).toBe(false);
    expect(elementSearchQuerySchema.safeParse({ period: "8" }).success).toBe(false);
    expect(elementSearchQuerySchema.safeParse({ period: "2.5" }).success).toBe(false);
    expect(elementSearchQuerySchema.safeParse({ period: "abc" }).success).toBe(false);
  });
});

describe("getElementIdsMatchingKeyword", () => {
  it("原子番号の文字列表現に keyword を含む ID を返す", () => {
    const result = getElementIdsMatchingKeyword("1");

    expect(result).toContain(1);
    expect(result).toContain(10);
    expect(result).toContain(21);
    expect(result).toContain(100);
    expect(result).toContain(118);
    expect(result).not.toContain(2);
    expect(result).not.toContain(99);
  });

  it("数字以外の keyword では空配列を返す", () => {
    expect(getElementIdsMatchingKeyword("H")).toEqual([]);
  });
});

describe("buildElementWhereInput", () => {
  it("検索条件がない場合は undefined を返す", () => {
    expect(buildElementWhereInput({})).toBeUndefined();
  });

  it("q から番号・記号・日本語名・英語名の OR 条件を作る", () => {
    const where = buildElementWhereInput({ q: "H" });

    expect(where).toEqual({
      OR: [
        { symbol: { contains: "H", mode: "insensitive" } },
        { nameJa: { contains: "H" } },
        { nameEn: { contains: "H", mode: "insensitive" } },
      ],
    });
  });

  it("数字 keyword の場合は id の候補も OR 条件に含める", () => {
    const where = buildElementWhereInput({ q: "1" });

    expect(where).toEqual({
      OR: [
        { id: { in: getElementIdsMatchingKeyword("1") } },
        { symbol: { contains: "1", mode: "insensitive" } },
        { nameJa: { contains: "1" } },
        { nameEn: { contains: "1", mode: "insensitive" } },
      ],
    });
  });

  it("category と period を完全一致条件として作る", () => {
    const where = buildElementWhereInput({
      category: "非金属",
      period: 2,
    });

    expect(where).toEqual({
      category: "非金属",
      period: 2,
    });
  });

  it("q/category/period を AND 条件として組み合わせる", () => {
    const where = buildElementWhereInput({
      q: "炭",
      category: "非金属",
      period: 2,
    });

    expect(where).toEqual({
      OR: [
        { symbol: { contains: "炭", mode: "insensitive" } },
        { nameJa: { contains: "炭" } },
        { nameEn: { contains: "炭", mode: "insensitive" } },
      ],
      category: "非金属",
      period: 2,
    });
  });
});
