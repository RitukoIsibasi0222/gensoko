import { afterEach, describe, expect, it, vi } from "vitest";
import { getFrontendUrl, getRateLimitConfig } from "./config.js";

const DEVELOPMENT_FRONTEND_URL = "http://localhost:5174";
const PRODUCTION_FRONTEND_URL = "https://gensoko.example";
const VALID_RATE_LIMIT_KEY_SECRET = Buffer.from("0123456789abcdef0123456789abcdef").toString(
  "base64",
);
const SHORT_RATE_LIMIT_KEY_SECRET = Buffer.from("short-secret").toString("base64");

describe("getFrontendUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("設定済みのFRONTEND_URLを返す", () => {
    vi.stubEnv("FRONTEND_URL", PRODUCTION_FRONTEND_URL);

    expect(getFrontendUrl({ isProduction: true })).toBe(PRODUCTION_FRONTEND_URL);
  });

  it("developmentでは未設定時にlocalhostへフォールバックする", () => {
    vi.stubEnv("FRONTEND_URL", "");

    expect(getFrontendUrl({ isProduction: false })).toBe(DEVELOPMENT_FRONTEND_URL);
  });

  it("productionでは未設定時にfail-fastする", () => {
    vi.stubEnv("FRONTEND_URL", "");

    expect(() => getFrontendUrl({ isProduction: true })).toThrow(
      "production環境ではFRONTEND_URLの設定が必要です",
    );
  });

  it("呼び出し側が環境を指定しない場合はNODE_ENVを使う", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FRONTEND_URL", "");

    expect(() => getFrontendUrl()).toThrow("production環境ではFRONTEND_URLの設定が必要です");
  });

  it("末尾slashだけを含むURLはoriginへ正規化する", () => {
    vi.stubEnv("FRONTEND_URL", `${PRODUCTION_FRONTEND_URL}/`);

    expect(getFrontendUrl({ isProduction: true })).toBe(PRODUCTION_FRONTEND_URL);
  });

  it.each([
    ["URLではない値", "gensoko.example"],
    ["HTTP(S)以外のscheme", "javascript:alert(1)"],
    ["path付きURL", `${PRODUCTION_FRONTEND_URL}/app`],
    ["query付きURL", `${PRODUCTION_FRONTEND_URL}/?tenant=gensoko`],
    ["認証情報付きURL", "https://user:password@gensoko.example"],
  ])("%sを拒否する", (_caseName, frontendUrl) => {
    vi.stubEnv("FRONTEND_URL", frontendUrl);

    expect(() => getFrontendUrl({ isProduction: true })).toThrow(
      "FRONTEND_URLはHTTP(S)のオリジン形式で設定してください",
    );
  });
});

describe("getRateLimitConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("developmentではmemory storeと専用secretを返す", () => {
    vi.stubEnv("RATE_LIMIT_STORE", "memory");
    vi.stubEnv("RATE_LIMIT_KEY_SECRET", VALID_RATE_LIMIT_KEY_SECRET);

    expect(getRateLimitConfig({ runtime: "development" })).toEqual({
      store: "memory",
      keySecret: VALID_RATE_LIMIT_KEY_SECRET,
    });
  });

  it("productionではdurable-object storeと専用secretを返す", () => {
    vi.stubEnv("RATE_LIMIT_STORE", "durable-object");
    vi.stubEnv("RATE_LIMIT_KEY_SECRET", VALID_RATE_LIMIT_KEY_SECRET);

    expect(getRateLimitConfig({ runtime: "production" })).toEqual({
      store: "durable-object",
      keySecret: VALID_RATE_LIMIT_KEY_SECRET,
    });
  });

  it("productionではRATE_LIMIT_STORE未設定を拒否する", () => {
    vi.stubEnv("RATE_LIMIT_STORE", "");
    vi.stubEnv("RATE_LIMIT_KEY_SECRET", VALID_RATE_LIMIT_KEY_SECRET);

    expect(() => getRateLimitConfig({ runtime: "production" })).toThrow(
      "production環境ではRATE_LIMIT_STORE=durable-objectの設定が必要です",
    );
  });

  it("productionではmemory storeを拒否する", () => {
    vi.stubEnv("RATE_LIMIT_STORE", "memory");
    vi.stubEnv("RATE_LIMIT_KEY_SECRET", VALID_RATE_LIMIT_KEY_SECRET);

    expect(() => getRateLimitConfig({ runtime: "production" })).toThrow(
      "production環境ではRATE_LIMIT_STORE=durable-objectの設定が必要です",
    );
  });

  it("未対応のRATE_LIMIT_STOREを拒否する", () => {
    vi.stubEnv("RATE_LIMIT_STORE", "redis");
    vi.stubEnv("RATE_LIMIT_KEY_SECRET", VALID_RATE_LIMIT_KEY_SECRET);

    expect(() => getRateLimitConfig({ runtime: "development" })).toThrow(
      "RATE_LIMIT_STOREはmemoryまたはdurable-objectを設定してください",
    );
  });

  it("productionではRATE_LIMIT_KEY_SECRET未設定を拒否する", () => {
    vi.stubEnv("RATE_LIMIT_STORE", "durable-object");
    vi.stubEnv("RATE_LIMIT_KEY_SECRET", "");

    expect(() => getRateLimitConfig({ runtime: "production" })).toThrow(
      "RATE_LIMIT_KEY_SECRETの設定が必要です",
    );
  });

  it("base64形式でないRATE_LIMIT_KEY_SECRETを拒否する", () => {
    vi.stubEnv("RATE_LIMIT_STORE", "memory");
    vi.stubEnv("RATE_LIMIT_KEY_SECRET", "base64ではない値!");

    expect(() => getRateLimitConfig({ runtime: "development" })).toThrow(
      "RATE_LIMIT_KEY_SECRETはbase64形式で設定してください",
    );
  });

  it("復号後32バイト未満のRATE_LIMIT_KEY_SECRETを拒否する", () => {
    vi.stubEnv("RATE_LIMIT_STORE", "memory");
    vi.stubEnv("RATE_LIMIT_KEY_SECRET", SHORT_RATE_LIMIT_KEY_SECRET);

    expect(() => getRateLimitConfig({ runtime: "development" })).toThrow(
      "RATE_LIMIT_KEY_SECRETは復号後32バイト以上にしてください",
    );
  });
});
