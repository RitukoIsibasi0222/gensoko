import { afterEach, describe, expect, it, vi } from "vitest";
import { getFrontendUrl } from "./config.js";

const DEVELOPMENT_FRONTEND_URL = "http://localhost:5174";
const PRODUCTION_FRONTEND_URL = "https://gensoko.example";

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
