import { describe, expect, it } from "vitest";
import { elementIdParamSchema } from "./detail.js";

describe("elementIdParamSchema", () => {
  it("1 から 118 の整数文字列を number に変換する", () => {
    expect(elementIdParamSchema.parse({ id: "1" })).toEqual({ id: 1 });
    expect(elementIdParamSchema.parse({ id: "118" })).toEqual({ id: 118 });
  });

  it("前後空白を trim して number に変換する", () => {
    expect(elementIdParamSchema.parse({ id: " 6 " })).toEqual({ id: 6 });
  });

  it("1 未満、118 より大きい値、小数、数字以外を無効にする", () => {
    expect(elementIdParamSchema.safeParse({ id: "0" }).success).toBe(false);
    expect(elementIdParamSchema.safeParse({ id: "119" }).success).toBe(false);
    expect(elementIdParamSchema.safeParse({ id: "1.5" }).success).toBe(false);
    expect(elementIdParamSchema.safeParse({ id: "abc" }).success).toBe(false);
    expect(elementIdParamSchema.safeParse({ id: "" }).success).toBe(false);
  });

  it("10進整数以外の数値表記を無効にする", () => {
    expect(elementIdParamSchema.safeParse({ id: "1e2" }).success).toBe(false);
    expect(elementIdParamSchema.safeParse({ id: "0x10" }).success).toBe(false);
    expect(elementIdParamSchema.safeParse({ id: "+1" }).success).toBe(false);
  });

  it("未知の param key は無視する", () => {
    expect(elementIdParamSchema.parse({ id: "2", unknown: "ignored" })).toEqual({ id: 2 });
  });
});
