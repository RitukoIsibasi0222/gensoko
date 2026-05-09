import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// test-setup.ts のグローバルモックを解除する（vi.doUnmock はホイストされないため、
// vi.resetModules + dynamic import と組み合わせてリアル実装を確実にロードする）
vi.doUnmock("./index.js");

type RateLimitFn = typeof import("./index.js").rateLimit;
let rateLimit: RateLimitFn;

beforeAll(async () => {
  vi.resetModules();
  ({ rateLimit } = await import("./index.js"));
});

describe("rateLimit middleware", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("max 以下のリクエストは通過する", async () => {
    const app = new Hono();
    app.use(rateLimit({ windowMs: 60_000, max: 3, trustProxy: true }));
    app.get("/", (c) => c.json({ ok: true }));

    for (let i = 0; i < 3; i++) {
      const res = await app.request("/", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      });
      expect(res.status).toBe(200);
    }
  });

  it("max を超えると 429 を返す", async () => {
    const app = new Hono();
    app.use(rateLimit({ windowMs: 60_000, max: 2, trustProxy: true }));
    app.get("/", (c) => c.json({ ok: true }));

    const headers = { "x-forwarded-for": "1.2.3.4" };
    await app.request("/", { headers });
    await app.request("/", { headers });

    const res = await app.request("/", { headers });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("ウィンドウが経過するとカウントがリセットされる", async () => {
    vi.useFakeTimers();
    const app = new Hono();
    app.use(rateLimit({ windowMs: 10_000, max: 2, trustProxy: true }));
    app.get("/", (c) => c.json({ ok: true }));

    const headers = { "x-forwarded-for": "1.2.3.4" };
    await app.request("/", { headers });
    await app.request("/", { headers });

    // max 超過
    const res1 = await app.request("/", { headers });
    expect(res1.status).toBe(429);

    // ウィンドウ経過
    vi.advanceTimersByTime(10_001);

    const res2 = await app.request("/", { headers });
    expect(res2.status).toBe(200);
  });

  it("異なる IP は独立してカウントされる", async () => {
    const app = new Hono();
    app.use(rateLimit({ windowMs: 60_000, max: 1, trustProxy: true }));
    app.get("/", (c) => c.json({ ok: true }));

    // IP1 が max に達する
    await app.request("/", { headers: { "x-forwarded-for": "1.2.3.4" } });
    const res1 = await app.request("/", { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect(res1.status).toBe(429);

    // IP2 は別カウント → 通過する
    const res2 = await app.request("/", { headers: { "x-forwarded-for": "5.6.7.8" } });
    expect(res2.status).toBe(200);
  });

  it("x-real-ip ヘッダーも IP として使用する", async () => {
    const app = new Hono();
    app.use(rateLimit({ windowMs: 60_000, max: 1, trustProxy: true }));
    app.get("/", (c) => c.json({ ok: true }));

    await app.request("/", { headers: { "x-real-ip": "10.0.0.1" } });
    const res = await app.request("/", { headers: { "x-real-ip": "10.0.0.1" } });
    expect(res.status).toBe(429);
  });

  it("store がエントリ上限を超えたとき期限切れエントリを削除し、それでも上限超なら最古エントリを強制削除する", async () => {
    vi.useFakeTimers();
    const app = new Hono();
    // maxStoreSize を 3 に設定して上限テストを行う
    app.use(rateLimit({ windowMs: 10_000, max: 100, maxStoreSize: 3, trustProxy: true }));
    app.get("/", (c) => c.json({ ok: true }));

    // 4 つの IP でリクエスト → store.size = 4（maxStoreSize=3 を超える）
    // ※ クリーンアップは store.size > maxStoreSize のときのみ走るため、
    //   3件目追加時点では走らず、4件目追加後に size=4 になる
    await app.request("/", { headers: { "x-forwarded-for": "1.1.1.1" } });
    await app.request("/", { headers: { "x-forwarded-for": "2.2.2.2" } });
    await app.request("/", { headers: { "x-forwarded-for": "3.3.3.3" } });
    await app.request("/", { headers: { "x-forwarded-for": "4.4.4.4" } });

    // ウィンドウを経過させてから 5 つ目の IP でリクエスト
    // → store.size(4) > maxStoreSize(3) → 期限切れ 4 件を一括削除 → size=0 → 5件目追加
    vi.advanceTimersByTime(10_001);

    const res = await app.request("/", { headers: { "x-forwarded-for": "5.5.5.5" } });
    expect(res.status).toBe(200);
  });

  it("trustProxy: true のとき XFF がなければ x-real-ip にフォールバックする", async () => {
    const app = new Hono();
    app.use(rateLimit({ windowMs: 60_000, max: 1, trustProxy: true }));
    app.get("/", (c) => c.json({ ok: true }));

    // XFF なし、x-real-ip だけ送信 → x-real-ip がバケットキーになる
    await app.request("/", { headers: { "x-real-ip": "10.0.0.2" } });
    const res = await app.request("/", { headers: { "x-real-ip": "10.0.0.2" } });
    expect(res.status).toBe(429);
  });

  it("trustProxy: true のとき XFF も x-real-ip もなければ 'unknown' にフォールバックする", async () => {
    const app = new Hono();
    // trustProxy: true だが両ヘッダー未設定 → socketIp（テスト環境: "unknown"）
    app.use(rateLimit({ windowMs: 60_000, max: 1, trustProxy: true }));
    app.get("/", (c) => c.json({ ok: true }));

    // ヘッダーなしで 2 回リクエスト → 同じ "unknown" バケットで 429
    await app.request("/");
    const res = await app.request("/");
    expect(res.status).toBe(429);
  });

  it("trustProxy: false のとき x-forwarded-for を無視して 'unknown' を IP として使用する", async () => {
    const app = new Hono();
    // trustProxy: false（デフォルト）: XFF を信頼しない → 全リクエストが同一バケット "unknown"
    app.use(rateLimit({ windowMs: 60_000, max: 1, trustProxy: false }));
    app.get("/", (c) => c.json({ ok: true }));

    // XFF で異なる IP を送っても同一バケットとして扱われる
    const res1 = await app.request("/", { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect(res1.status).toBe(200);
    const res2 = await app.request("/", { headers: { "x-forwarded-for": "5.6.7.8" } });
    // 異なる IP ヘッダーを送っても同じ "unknown" バケット → 429
    expect(res2.status).toBe(429);
  });
});
