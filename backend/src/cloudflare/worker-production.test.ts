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
});
