import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("production相当staging Worker graph", () => {
  it("外部DB・mail providerへ接続せずhealthを処理する", async () => {
    const response = await SELF.fetch("https://api.example.invalid/api/v1/health", {
      headers: { Origin: "https://staging.example.invalid" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://staging.example.invalid",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("CF-Connecting-IPからproduction DO rate limit graphを通して認証入力を制限する", async () => {
    const requestLogin = () =>
      SELF.fetch("https://api.example.invalid/api/v1/auth/login", {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "203.0.113.70",
          "Content-Type": "application/json",
          Origin: "https://staging.example.invalid",
        },
        body: JSON.stringify({}),
      });

    for (let requestCount = 0; requestCount < 10; requestCount += 1) {
      const response = await requestLogin();
      expect(response.status).toBe(400);
    }

    const limitedResponse = await requestLogin();
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get("Retry-After")).toMatch(/^\d+$/);
    await expect(limitedResponse.json()).resolves.toEqual({
      error: "リクエストが多すぎます。しばらく待ってから再試行してください",
    });
  });

  it("forwarded headerへfallbackせずsensitive policyを503で閉じる", async () => {
    const response = await SELF.fetch("https://api.example.invalid/api/v1/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://staging.example.invalid",
        "X-Forwarded-For": "203.0.113.80",
        "X-Real-IP": "203.0.113.81",
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    await expect(response.json()).resolves.toEqual({
      error: "一時的に利用できません。しばらく待ってから再試行してください",
    });
  });
});
