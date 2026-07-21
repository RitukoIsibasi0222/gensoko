import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAccountDataDeletionConfig,
  getAuditLogRetentionConfig,
  getDatabaseUrl,
  getFrontendUrl,
  getRateLimitConfig,
  getStagingAccountDeletionPerformanceConfig,
} from "./config.js";

const DEVELOPMENT_FRONTEND_URL = "http://localhost:5174";
const PRODUCTION_FRONTEND_URL = "https://gensoko.example";
const VALID_RATE_LIMIT_KEY_SECRET = Buffer.from("0123456789abcdef0123456789abcdef").toString(
  "base64",
);
const SHORT_RATE_LIMIT_KEY_SECRET = Buffer.from("short-secret").toString("base64");

describe("getDatabaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["未設定", undefined],
    ["空文字", ""],
    ["空白のみ", "   "],
  ])("DATABASE_URLが%sの場合はfail-fastする", (_caseName, databaseUrl) => {
    expect(() =>
      getDatabaseUrl({
        environment: { DATABASE_URL: databaseUrl },
      }),
    ).toThrow("DATABASE_URLの設定が必要です");
  });

  it("前後空白を除去したDATABASE_URLを返す", () => {
    expect(
      getDatabaseUrl({
        environment: { DATABASE_URL: "  postgresql://localhost:5432/gensoko  " },
      }),
    ).toBe("postgresql://localhost:5432/gensoko");
  });

  it("environment未指定時はprocess.envのDATABASE_URLを使う", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/gensoko");

    expect(getDatabaseUrl()).toBe("postgresql://localhost:5432/gensoko");
  });
});

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

  it("明示environmentをprocess.envより優先する", () => {
    vi.stubEnv("FRONTEND_URL", "https://process-env.example");

    expect(
      getFrontendUrl({
        isProduction: true,
        environment: { FRONTEND_URL: PRODUCTION_FRONTEND_URL },
      }),
    ).toBe(PRODUCTION_FRONTEND_URL);
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

describe("getAuditLogRetentionConfig", () => {
  it("保持期間とcleanup有効化設定を返す", () => {
    expect(
      getAuditLogRetentionConfig({
        environment: {
          AUDIT_LOG_RETENTION_DAYS: "365",
          AUDIT_LOG_CLEANUP_ENABLED: "true",
        },
      }),
    ).toEqual({
      retentionDays: 365,
      cleanupEnabled: true,
    });
  });

  it.each([
    ["未設定", undefined],
    ["空文字", ""],
  ])("AUDIT_LOG_RETENTION_DAYSが%sの場合は拒否する", (_caseName, retentionDays) => {
    expect(() =>
      getAuditLogRetentionConfig({
        environment: {
          AUDIT_LOG_RETENTION_DAYS: retentionDays,
          AUDIT_LOG_CLEANUP_ENABLED: "false",
        },
      }),
    ).toThrow("AUDIT_LOG_RETENTION_DAYSの設定が必要です");
  });

  it.each([
    ["下限", "30", 30],
    ["上限", "3650", 3650],
  ])("AUDIT_LOG_RETENTION_DAYSの%sを受理する", (_caseName, retentionDays, expected) => {
    expect(
      getAuditLogRetentionConfig({
        environment: {
          AUDIT_LOG_RETENTION_DAYS: retentionDays,
          AUDIT_LOG_CLEANUP_ENABLED: "false",
        },
      }),
    ).toEqual({
      retentionDays: expected,
      cleanupEnabled: false,
    });
  });

  it.each(["29", "3651", "0", "-1", "1.5", "NaN", "Infinity", "30日"])(
    "不正なAUDIT_LOG_RETENTION_DAYS=%sを拒否する",
    (retentionDays) => {
      expect(() =>
        getAuditLogRetentionConfig({
          environment: {
            AUDIT_LOG_RETENTION_DAYS: retentionDays,
            AUDIT_LOG_CLEANUP_ENABLED: "false",
          },
        }),
      ).toThrow("AUDIT_LOG_RETENTION_DAYSは30から3650までの10進整数で設定してください");
    },
  );

  it("AUDIT_LOG_CLEANUP_ENABLEDが未設定の場合は安全側のfalseを返す", () => {
    expect(
      getAuditLogRetentionConfig({
        environment: {
          AUDIT_LOG_RETENTION_DAYS: "365",
        },
      }),
    ).toEqual({
      retentionDays: 365,
      cleanupEnabled: false,
    });
  });

  it.each([
    ["true", true],
    ["false", false],
  ])("AUDIT_LOG_CLEANUP_ENABLED=%sをbooleanへ変換する", (cleanupEnabled, expected) => {
    expect(
      getAuditLogRetentionConfig({
        environment: {
          AUDIT_LOG_RETENTION_DAYS: "365",
          AUDIT_LOG_CLEANUP_ENABLED: cleanupEnabled,
        },
      }),
    ).toEqual({
      retentionDays: 365,
      cleanupEnabled: expected,
    });
  });

  it.each(["", "TRUE", "1", "yes"])(
    "不正なAUDIT_LOG_CLEANUP_ENABLED=%sを拒否する",
    (cleanupEnabled) => {
      expect(() =>
        getAuditLogRetentionConfig({
          environment: {
            AUDIT_LOG_RETENTION_DAYS: "365",
            AUDIT_LOG_CLEANUP_ENABLED: cleanupEnabled,
          },
        }),
      ).toThrow("AUDIT_LOG_CLEANUP_ENABLEDはtrueまたはfalseで設定してください");
    },
  );
});

describe("getAccountDataDeletionConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("未設定の場合は実行無効・batch size 25を返す", () => {
    expect(getAccountDataDeletionConfig({ environment: {} })).toEqual({
      executeEnabled: false,
      batchSize: 25,
    });
  });

  it("前後の空白を除去して実行許可とbatch sizeを返す", () => {
    expect(
      getAccountDataDeletionConfig({
        environment: {
          ACCOUNT_DATA_DELETION_EXECUTE_ENABLED: " true ",
          ACCOUNT_DATA_DELETION_BATCH_SIZE: " 100 ",
        },
      }),
    ).toEqual({
      executeEnabled: true,
      batchSize: 100,
    });
  });

  it("呼び出し側が環境を指定しない場合はprocess.envを使う", () => {
    vi.stubEnv("ACCOUNT_DATA_DELETION_EXECUTE_ENABLED", "false");
    vi.stubEnv("ACCOUNT_DATA_DELETION_BATCH_SIZE", "1");

    expect(getAccountDataDeletionConfig()).toEqual({
      executeEnabled: false,
      batchSize: 1,
    });
  });

  it.each([
    ["下限", "1", 1],
    ["上限", "100", 100],
  ])("ACCOUNT_DATA_DELETION_BATCH_SIZEの%sを受理する", (_caseName, batchSize, expected) => {
    expect(
      getAccountDataDeletionConfig({
        environment: {
          ACCOUNT_DATA_DELETION_BATCH_SIZE: batchSize,
        },
      }),
    ).toEqual({
      executeEnabled: false,
      batchSize: expected,
    });
  });

  it.each(["", "TRUE", "1", "yes"])(
    "不正なACCOUNT_DATA_DELETION_EXECUTE_ENABLED=%sを拒否する",
    (executeEnabled) => {
      expect(() =>
        getAccountDataDeletionConfig({
          environment: {
            ACCOUNT_DATA_DELETION_EXECUTE_ENABLED: executeEnabled,
          },
        }),
      ).toThrow("ACCOUNT_DATA_DELETION_EXECUTE_ENABLEDはtrueまたはfalseで設定してください");
    },
  );

  it.each(["", "0", "101", "-1", "1.5", "NaN", "Infinity", "25件"])(
    "不正なACCOUNT_DATA_DELETION_BATCH_SIZE=%sを拒否する",
    (batchSize) => {
      expect(() =>
        getAccountDataDeletionConfig({
          environment: {
            ACCOUNT_DATA_DELETION_BATCH_SIZE: batchSize,
          },
        }),
      ).toThrow("ACCOUNT_DATA_DELETION_BATCH_SIZEは1から100までの10進整数で設定してください");
    },
  );
});

describe("getStagingAccountDeletionPerformanceConfig", () => {
  it("未設定時は性能測定executeを無効化する", () => {
    expect(getStagingAccountDeletionPerformanceConfig({ environment: {} })).toEqual({
      executeEnabled: false,
    });
  });

  it("前後空白を除去したtrueだけを有効値として受理する", () => {
    expect(
      getStagingAccountDeletionPerformanceConfig({
        environment: {
          STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED: " true ",
        },
      }),
    ).toEqual({ executeEnabled: true });
  });

  it.each(["", "TRUE", "1", "yes"])(
    "不正なSTAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED=%sを拒否する",
    (executeEnabled) => {
      expect(() =>
        getStagingAccountDeletionPerformanceConfig({
          environment: {
            STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED: executeEnabled,
          },
        }),
      ).toThrow("STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLEDはtrueまたはfalseで設定してください");
    },
  );
});
