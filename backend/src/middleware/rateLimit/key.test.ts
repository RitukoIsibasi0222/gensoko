import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createRateLimitKeyDigest,
  normalizeIpActor,
  normalizeRateLimitEmail,
  resolveClientIp,
} from "./key.js";

const KEY_SECRET = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");

describe("normalizeRateLimitEmail", () => {
  it("前後空白を除去し小文字へ正規化する", () => {
    expect(normalizeRateLimitEmail(" User.Name+Game@Example.COM ")).toBe(
      "user.name+game@example.com",
    );
  });
});

describe("normalizeIpActor", () => {
  it("有効なIPv4を正規化する", () => {
    expect(normalizeIpActor(" 203.0.113.7 ")).toBe("203.0.113.7");
  });

  it.each(["", "unknown", "203.0.113.7, 198.51.100.2", "203.0.113.999", "192.168.001.1"])(
    "不正なIP %s を拒否する",
    (ip) => {
      expect(normalizeIpActor(ip)).toBeNull();
    },
  );

  it("IPv6をcanonicalな/64 prefixへ正規化する", () => {
    expect(normalizeIpActor("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe("2001:db8:85a3::/64");
  });

  it("同じ/64内のIPv6 privacy addressを同じactorとして扱う", () => {
    const first = normalizeIpActor("2001:db8:85a3:0:8a2e:370:7334:1");
    const second = normalizeIpActor("2001:db8:85a3::ffff");

    expect(first).toBe("2001:db8:85a3::/64");
    expect(second).toBe(first);
  });

  it("異なる/64のIPv6を別actorとして扱う", () => {
    expect(normalizeIpActor("2001:db8:85a3:1::1")).not.toBe(normalizeIpActor("2001:db8:85a3:2::1"));
  });

  it("IPv4-mapped IPv6をIPv4と同じactorへ正規化する", () => {
    expect(normalizeIpActor("::ffff:192.0.2.128")).toBe("192.0.2.128");
    expect(normalizeIpActor("::ffff:c000:0280")).toBe("192.0.2.128");
  });

  it("zone ID付きIPv6を拒否する", () => {
    expect(normalizeIpActor("fe80::1%eth0")).toBeNull();
  });
});

describe("resolveClientIp", () => {
  it("Workers productionではCF-Connecting-IPだけを採用する", () => {
    expect(
      resolveClientIp({
        runtime: "cloudflare-workers",
        cfConnectingIp: "203.0.113.7",
        socketAddress: "198.51.100.10",
        xForwardedFor: "192.0.2.10",
        xRealIp: "192.0.2.11",
      }),
    ).toBe("203.0.113.7");
  });

  it("Workers productionではCF-Connecting-IP欠損時にXFFへfallbackしない", () => {
    expect(
      resolveClientIp({
        runtime: "cloudflare-workers",
        xForwardedFor: "192.0.2.10",
        xRealIp: "192.0.2.11",
      }),
    ).toBeNull();
  });

  it("Workers productionでは複数値や不正なCF-Connecting-IPを拒否する", () => {
    expect(
      resolveClientIp({
        runtime: "cloudflare-workers",
        cfConnectingIp: "203.0.113.7, 198.51.100.10",
      }),
    ).toBeNull();
  });

  it("Node developmentではsocket addressだけを採用する", () => {
    expect(
      resolveClientIp({
        runtime: "node",
        socketAddress: "::ffff:192.0.2.128",
        xForwardedFor: "203.0.113.7",
        xRealIp: "203.0.113.8",
      }),
    ).toBe("192.0.2.128");
  });

  it("Node developmentではsocket address欠損時にheaderへfallbackしない", () => {
    expect(
      resolveClientIp({
        runtime: "node",
        xForwardedFor: "203.0.113.7",
        xRealIp: "203.0.113.8",
      }),
    ).toBeNull();
  });
});

describe("createRateLimitKeyDigest", () => {
  it("version付きcanonical tupleをHMAC-SHA-256のhexへ変換する", async () => {
    const canonicalInput = JSON.stringify([
      "v1",
      "AUTH_EMAIL",
      "login",
      "email",
      "user@example.com",
    ]);
    const expectedDigest = createHmac("sha256", Buffer.from(KEY_SECRET, "base64"))
      .update(canonicalInput)
      .digest("hex");

    await expect(
      createRateLimitKeyDigest({
        secret: KEY_SECRET,
        policyId: "AUTH_EMAIL",
        operationScope: "login",
        actorType: "email",
        value: "user@example.com",
      }),
    ).resolves.toBe(expectedDigest);
  });

  it("同じ入力から常に同じ64文字hex digestを返す", async () => {
    const input = {
      secret: KEY_SECRET,
      policyId: "GAME_SUBMIT_USER" as const,
      operationScope: null,
      actorType: "user" as const,
      value: "user-id-1",
    };

    const first = await createRateLimitKeyDigest(input);
    const second = await createRateLimitKeyDigest(input);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(first).not.toContain(input.value);
  });

  it("同じactorでもpolicyが異なれば別digestを返す", async () => {
    const common = {
      secret: KEY_SECRET,
      operationScope: null,
      actorType: "ip" as const,
      value: "203.0.113.7",
    };

    const general = await createRateLimitKeyDigest({
      ...common,
      policyId: "GENERAL_API_IP",
    });
    const auth = await createRateLimitKeyDigest({ ...common, policyId: "AUTH_IP" });

    expect(general).not.toBe(auth);
  });

  it("区切り文字を含むscopeとvalueを曖昧に連結しない", async () => {
    const first = await createRateLimitKeyDigest({
      secret: KEY_SECRET,
      policyId: "AUTH_EMAIL",
      operationScope: "login:email",
      actorType: "email",
      value: "value",
    });
    const second = await createRateLimitKeyDigest({
      secret: KEY_SECRET,
      policyId: "AUTH_EMAIL",
      operationScope: "login",
      actorType: "email",
      value: "email:value",
    });

    expect(first).not.toBe(second);
  });

  it("operationScopeのnullと空文字を区別する", async () => {
    const common = {
      secret: KEY_SECRET,
      policyId: "AUTH_EMAIL" as const,
      actorType: "email" as const,
      value: "user@example.com",
    };

    const withoutScope = await createRateLimitKeyDigest({ ...common, operationScope: null });
    const emptyScope = await createRateLimitKeyDigest({ ...common, operationScope: "" });

    expect(withoutScope).not.toBe(emptyScope);
  });
});
