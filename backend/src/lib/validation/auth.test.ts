import { describe, expect, it } from "vitest";
import {
  getUtf8ByteLengthForTest,
  STRONG_PASSWORD_BYTE_BOUNDARY_FIXTURES,
} from "../../test/password-byte-boundary-fixtures.js";
import { PASSWORD_TOO_LONG_MESSAGE } from "../password.js";
import { strongPasswordSchema } from "./auth.js";

describe("strongPasswordSchema bcrypt 72バイト境界", () => {
  it.each(STRONG_PASSWORD_BYTE_BOUNDARY_FIXTURES)(
    "$nameは72バイトを受理し73バイトを共通メッセージで拒否する",
    ({ password72Bytes, password73Bytes }) => {
      expect(getUtf8ByteLengthForTest(password72Bytes)).toBe(72);
      expect(strongPasswordSchema.safeParse(password72Bytes).success).toBe(true);
      expect(getUtf8ByteLengthForTest(password73Bytes)).toBe(73);

      const result = strongPasswordSchema.safeParse(password73Bytes);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual([
          expect.objectContaining({
            message: PASSWORD_TOO_LONG_MESSAGE,
            path: [],
          }),
        ]);
      }
    },
  );
});
