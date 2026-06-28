import { describe, expect, it } from "vitest";
import {
  getRefreshTokenCookieBasePath,
  getRefreshTokenCookiePaths,
} from "./refresh-token-cookie.js";

describe("refresh-token-cookie helpers", () => {
  it("auth route の request path から refreshToken Cookie の base path を取得する", () => {
    expect(getRefreshTokenCookieBasePath("/api/v1/auth/login")).toBe("/api/v1/auth");
    expect(getRefreshTokenCookieBasePath("/auth/refresh")).toBe("/auth");
  });

  it("users route の request path から同じ API prefix の auth base path を取得する", () => {
    expect(getRefreshTokenCookieBasePath("/api/v1/users/me")).toBe("/api/v1/auth");
    expect(getRefreshTokenCookieBasePath("/users/me")).toBe("/auth");
  });

  it("refreshToken Cookie の現行 path と旧 refresh path を返す", () => {
    expect(getRefreshTokenCookiePaths("/api/v1/users/me")).toEqual([
      "/api/v1/auth",
      "/api/v1/auth/refresh",
    ]);
  });
});
