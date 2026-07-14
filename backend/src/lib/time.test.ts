import { describe, expect, it } from "vitest";

import { MILLISECONDS_PER_DAY } from "./time.js";

describe("time constants", () => {
  it("defines one UTC day in milliseconds", () => {
    expect(MILLISECONDS_PER_DAY).toBe(86_400_000);
  });
});
