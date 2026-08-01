import { describe, expect, it, vi } from "vitest";
import {
  normalizeAndValidateCreateAdminInput,
  parseCreateAdminArguments,
  resolveCreateAdminInput,
  runCreateAdminCommand,
  type ParsedCreateAdminArguments,
  type ResolvedCreateAdminInput,
} from "./createAdmin.js";
import { PASSWORD_TOO_LONG_MESSAGE } from "../lib/password.js";
import {
  STRONG_PASSWORD_72_BYTES,
  STRONG_PASSWORD_73_BYTES,
} from "../test/password-byte-boundary-fixtures.js";

const DATABASE_URL = "postgresql://gensoko:test-password@postgres:5432/gensoko";
const ARGUMENT_PASSWORD = STRONG_PASSWORD_72_BYTES;
const ENVIRONMENT_PASSWORD = STRONG_PASSWORD_72_BYTES;

const VALID_ENV: NodeJS.ProcessEnv = {
  DATABASE_URL,
  ADMIN_USERNAME: "env_admin",
  ADMIN_EMAIL: "EnvAdmin@Example.com",
  ADMIN_PASSWORD: ENVIRONMENT_PASSWORD,
};

function createResolvedInput(
  overrides: Partial<ResolvedCreateAdminInput> = {},
): ResolvedCreateAdminInput {
  return {
    username: "admin_user",
    email: "Admin@Example.com",
    password: "SecurePass1!",
    passwordSource: "argument",
    ...overrides,
  };
}

function createRuntimeMocks() {
  const createAdmin = vi.fn().mockResolvedValue(undefined);
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const loadDependencies = vi.fn().mockResolvedValue({ createAdmin, disconnect });

  return { createAdmin, disconnect, loadDependencies };
}

describe("parseCreateAdminArguments", () => {
  it("3項目の引数を解析する", () => {
    expect(
      parseCreateAdminArguments([
        "--username",
        "cli_admin",
        "--email",
        "CliAdmin@Example.com",
        "--password",
        ARGUMENT_PASSWORD,
      ]),
    ).toEqual({
      username: "cli_admin",
      email: "CliAdmin@Example.com",
      password: ARGUMENT_PASSWORD,
      help: false,
    });
  });

  it("helpと作成optionが混在していてもhelpを解析する", () => {
    expect(parseCreateAdminArguments(["--help", "--username", "ignored_admin"])).toMatchObject({
      help: true,
    });
  });

  it.each([
    ["未知option", ["--unknown", "secret-value"]],
    ["位置引数", ["secret@example.com"]],
    ["option値なし", ["--username"]],
  ])("%sを拒否する", (_caseName, argv) => {
    expect(() => parseCreateAdminArguments(argv)).toThrow();
  });
});

describe("resolveCreateAdminInput", () => {
  it("引数だけで3項目を解決する", () => {
    const args: ParsedCreateAdminArguments = {
      username: "cli_admin",
      email: "CliAdmin@Example.com",
      password: ARGUMENT_PASSWORD,
      help: false,
    };

    expect(resolveCreateAdminInput(args, {})).toEqual({
      username: "cli_admin",
      email: "CliAdmin@Example.com",
      password: ARGUMENT_PASSWORD,
      passwordSource: "argument",
    });
  });

  it("未指定の項目を環境変数から補完する", () => {
    const args: ParsedCreateAdminArguments = {
      username: undefined,
      email: undefined,
      password: undefined,
      help: false,
    };

    expect(resolveCreateAdminInput(args, VALID_ENV)).toEqual({
      username: "env_admin",
      email: "EnvAdmin@Example.com",
      password: ENVIRONMENT_PASSWORD,
      passwordSource: "environment",
    });
  });

  it("項目単位で引数を優先し、未指定項目だけ環境変数で補完する", () => {
    const args: ParsedCreateAdminArguments = {
      username: "cli_admin",
      email: undefined,
      password: ARGUMENT_PASSWORD,
      help: false,
    };

    expect(resolveCreateAdminInput(args, VALID_ENV)).toEqual({
      username: "cli_admin",
      email: "EnvAdmin@Example.com",
      password: ARGUMENT_PASSWORD,
      passwordSource: "argument",
    });
  });

  it("引数で明示された空文字を環境変数へfallbackしない", () => {
    const args: ParsedCreateAdminArguments = {
      username: "",
      email: " ",
      password: "",
      help: false,
    };

    expect(resolveCreateAdminInput(args, VALID_ENV)).toEqual({
      username: "",
      email: " ",
      password: "",
      passwordSource: "argument",
    });
  });

  it("passwordがどちらにもなければsourceをmissingにする", () => {
    const args: ParsedCreateAdminArguments = {
      username: undefined,
      email: undefined,
      password: undefined,
      help: false,
    };

    expect(resolveCreateAdminInput(args, {})).toMatchObject({
      password: undefined,
      passwordSource: "missing",
    });
  });
});

describe("normalizeAndValidateCreateAdminInput", () => {
  it("正規化を一度行い、emailの大文字小文字は維持する", () => {
    expect(
      normalizeAndValidateCreateAdminInput(
        createResolvedInput({
          username: "  admin_user  ",
          email: "  Admin@Example.com  ",
          password: "  SecurePass1!  ",
        }),
      ),
    ).toEqual({
      username: "admin_user",
      email: "Admin@Example.com",
      password: "SecurePass1!",
    });
  });

  it.each([
    ["3文字未満", "ab", "ユーザー名は3文字以上にしてください"],
    ["20文字超過", "a".repeat(21), "ユーザー名は20文字以内にしてください"],
    ["不正文字", "admin-user", "ユーザー名は英数字とアンダースコアのみ使用できます"],
  ])("usernameが%sなら拒否する", (_caseName, username, message) => {
    expect(() => normalizeAndValidateCreateAdminInput(createResolvedInput({ username }))).toThrow(
      message,
    );
  });

  it("不正なemailを拒否する", () => {
    expect(() =>
      normalizeAndValidateCreateAdminInput(createResolvedInput({ email: "not-an-email" })),
    ).toThrow("有効なメールアドレスを入力してください");
  });

  it.each([
    ["8文字未満", "Short1!", "パスワードは8文字以上にしてください"],
    ["英大文字なし", "lowercase1!", "パスワードには英大文字を1文字以上含めてください"],
    ["英小文字なし", "UPPERCASE1!", "パスワードには英小文字を1文字以上含めてください"],
    ["数字なし", "NoNumber!", "パスワードには数字を1文字以上含めてください"],
    ["記号なし", "NoSymbol1", "パスワードには記号を1文字以上含めてください"],
    ["内部space", "Internal Pass1!", "パスワードにスペースは使用できません"],
  ])("passwordが%sなら拒否する", (_caseName, password, message) => {
    expect(() => normalizeAndValidateCreateAdminInput(createResolvedInput({ password }))).toThrow(
      message,
    );
  });

  it("passwordがusernameと同一なら拒否する", () => {
    expect(() =>
      normalizeAndValidateCreateAdminInput(
        createResolvedInput({ username: "Admin_User1", password: "Admin_User1" }),
      ),
    ).toThrow("パスワードはユーザー名と異なるものにしてください");
  });

  it("passwordがemailと同一なら拒否する", () => {
    expect(() =>
      normalizeAndValidateCreateAdminInput(
        createResolvedInput({ email: "Admin1@example.com", password: "Admin1@example.com" }),
      ),
    ).toThrow("パスワードはメールアドレスと異なるものにしてください");
  });
});

describe("runCreateAdminCommand", () => {
  it("引数方式で正規化済み入力をserviceへ渡し、警告付きで成功する", async () => {
    const { createAdmin, disconnect, loadDependencies } = createRuntimeMocks();

    const result = await runCreateAdminCommand({
      argv: [
        "--username",
        " cli_admin ",
        "--email",
        " CliAdmin@Example.com ",
        "--password",
        ` ${ARGUMENT_PASSWORD} `,
      ],
      env: VALID_ENV,
      loadDependencies,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toEqual(["管理者アカウントを作成しました"]);
    expect(result.stderr).toHaveLength(1);
    expect(result.stderr[0]).toContain("環境変数");
    const allOutput = [...result.stdout, ...result.stderr].join("\n");
    expect(allOutput).not.toContain("cli_admin");
    expect(allOutput).not.toContain("CliAdmin@Example.com");
    expect(allOutput).not.toContain(ARGUMENT_PASSWORD);
    expect(loadDependencies).toHaveBeenCalledTimes(1);
    expect(createAdmin).toHaveBeenCalledWith({
      username: "cli_admin",
      email: "CliAdmin@Example.com",
      password: ARGUMENT_PASSWORD,
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("環境変数方式ではpassword引数の警告を出さない", async () => {
    const { createAdmin, disconnect, loadDependencies } = createRuntimeMocks();

    const result = await runCreateAdminCommand({ argv: [], env: VALID_ENV, loadDependencies });

    expect(result).toEqual({
      exitCode: 0,
      stdout: ["管理者アカウントを作成しました"],
      stderr: [],
    });
    expect(createAdmin).toHaveBeenCalledWith({
      username: "env_admin",
      email: "EnvAdmin@Example.com",
      password: ENVIRONMENT_PASSWORD,
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("helpを優先し、DB dependencyをloadしない", async () => {
    const { createAdmin, disconnect, loadDependencies } = createRuntimeMocks();

    const result = await runCreateAdminCommand({
      argv: ["--help", "--password", ARGUMENT_PASSWORD],
      env: {},
      loadDependencies,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.join("\n")).toContain("--username");
    expect(result.stdout.join("\n")).toContain("ADMIN_PASSWORD");
    expect(result.stdout.join("\n")).toContain("npm --silent run admin:create");
    expect(result.stdout.join("\n")).not.toContain(ARGUMENT_PASSWORD);
    expect(result.stdout.join("\n")).not.toContain("DATABASE_URL");
    expect(result.stderr).toEqual([]);
    expect(loadDependencies).not.toHaveBeenCalled();
    expect(createAdmin).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it.each([
    ["未知option", ["--unknown", "secret-option-value"], "secret-option-value"],
    ["位置引数", ["secret-admin@example.com"], "secret-admin@example.com"],
    ["option値なし", ["--username"], "--username"],
  ] as const)("%sを固定文言へ変換し、入力値を出力しない", async (_name, argv, secretValue) => {
    const { loadDependencies } = createRuntimeMocks();

    const result = await runCreateAdminCommand({ argv, env: VALID_ENV, loadDependencies });

    expect(result).toEqual({
      exitCode: 2,
      stdout: [],
      stderr: ["コマンド引数が正しくありません"],
    });
    expect(result.stderr.join("\n")).not.toContain(secretValue);
    expect(loadDependencies).not.toHaveBeenCalled();
  });

  it.each([
    ["username", "ADMIN_USERNAME", "ユーザー名を入力してください"],
    ["email", "ADMIN_EMAIL", "メールアドレスを入力してください"],
    ["password", "ADMIN_PASSWORD", "パスワードを入力してください"],
  ] as const)("%s不足を日本語で返し、DB dependencyをloadしない", async (_name, envKey, message) => {
    const { loadDependencies } = createRuntimeMocks();
    const env = { ...VALID_ENV };
    delete env[envKey];

    const result = await runCreateAdminCommand({ argv: [], env, loadDependencies });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toEqual([]);
    expect(result.stderr).toContain(message);
    expect(loadDependencies).not.toHaveBeenCalled();
  });

  it("引数の明示的な空値を環境変数へfallbackせず入力エラーにする", async () => {
    const { loadDependencies } = createRuntimeMocks();

    const result = await runCreateAdminCommand({
      argv: ["--username", ""],
      env: VALID_ENV,
      loadDependencies,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("ユーザー名を入力してください");
    expect(loadDependencies).not.toHaveBeenCalled();
  });

  it.each([
    ["username", "ADMIN_USERNAME", "   ", "ユーザー名を入力してください"],
    ["email", "ADMIN_EMAIL", "", "メールアドレスを入力してください"],
    ["password", "ADMIN_PASSWORD", "   ", "パスワードを入力してください"],
  ] as const)("%sの環境変数が空なら入力エラーにする", async (_name, envKey, value, message) => {
    const { loadDependencies } = createRuntimeMocks();
    const env = { ...VALID_ENV, [envKey]: value };

    const result = await runCreateAdminCommand({ argv: [], env, loadDependencies });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(message);
    expect(loadDependencies).not.toHaveBeenCalled();
  });

  it("validationエラーでは入力値を出力せず、DB dependencyをloadしない", async () => {
    const { loadDependencies } = createRuntimeMocks();
    const invalidUsername = "private-admin-name";

    const result = await runCreateAdminCommand({
      argv: ["--username", invalidUsername],
      env: VALID_ENV,
      loadDependencies,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("ユーザー名は英数字とアンダースコアのみ使用できます");
    expect(result.stderr.join("\n")).not.toContain(invalidUsername);
    expect(loadDependencies).not.toHaveBeenCalled();
  });

  it.each([
    {
      source: "コマンド引数",
      argv: ["--password", STRONG_PASSWORD_73_BYTES],
      env: VALID_ENV,
    },
    {
      source: "環境変数",
      argv: [],
      env: { ...VALID_ENV, ADMIN_PASSWORD: STRONG_PASSWORD_73_BYTES },
    },
  ])(
    "$sourceの73バイトpasswordはcode 2で拒否しDB dependencyをloadしない",
    async ({ argv, env }) => {
      const { loadDependencies } = createRuntimeMocks();

      const result = await runCreateAdminCommand({ argv, env, loadDependencies });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(PASSWORD_TOO_LONG_MESSAGE);
      expect(result.stderr.join("\n")).not.toContain(STRONG_PASSWORD_73_BYTES);
      expect(loadDependencies).not.toHaveBeenCalled();
    },
  );

  it("DATABASE_URL不足ではDB dependencyをloadせず安全に失敗する", async () => {
    const { loadDependencies } = createRuntimeMocks();
    const env = { ...VALID_ENV };
    delete env.DATABASE_URL;

    const result = await runCreateAdminCommand({ argv: [], env, loadDependencies });

    expect(result).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: ["データベース接続設定がありません"],
    });
    expect(loadDependencies).not.toHaveBeenCalled();
  });

  it("P2002から変換された重複エラーを固定文言へ変換してdisconnectする", async () => {
    const { createAdmin, disconnect, loadDependencies } = createRuntimeMocks();
    createAdmin.mockRejectedValue(
      Object.assign(new Error("duplicate: env_admin / EnvAdmin@Example.com"), {
        code: "DUPLICATE_USER",
      }),
    );

    const result = await runCreateAdminCommand({ argv: [], env: VALID_ENV, loadDependencies });

    expect(result).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: ["ユーザー名またはメールアドレスは既に使用されています"],
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("想定外のDBエラーを固定文言へ変換してdisconnectする", async () => {
    const { createAdmin, disconnect, loadDependencies } = createRuntimeMocks();
    createAdmin.mockRejectedValue(new Error(`connection failed: ${DATABASE_URL}`));

    const result = await runCreateAdminCommand({ argv: [], env: VALID_ENV, loadDependencies });

    expect(result).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: ["管理者アカウントの作成に失敗しました"],
    });
    expect(result.stderr.join("\n")).not.toContain(DATABASE_URL);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("dependencyのload失敗を固定文言へ変換する", async () => {
    const { loadDependencies } = createRuntimeMocks();
    loadDependencies.mockRejectedValue(new Error(`Prisma initialization failed: ${DATABASE_URL}`));

    const result = await runCreateAdminCommand({ argv: [], env: VALID_ENV, loadDependencies });

    expect(result).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: ["管理者アカウントの作成に失敗しました"],
    });
  });

  it("作成成功後のdisconnect失敗では成功codeを維持し、再実行を避ける警告を返す", async () => {
    const { disconnect, loadDependencies } = createRuntimeMocks();
    disconnect.mockRejectedValue(new Error(`disconnect failed: ${DATABASE_URL}`));

    const result = await runCreateAdminCommand({ argv: [], env: VALID_ENV, loadDependencies });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toEqual(["管理者アカウントを作成しました"]);
    expect(result.stderr).toEqual([
      "管理者アカウントは作成済みですが、データベース接続の終了処理に失敗しました。再実行せず、接続状態を確認してください",
    ]);
    expect(result.stderr.join("\n")).not.toContain(DATABASE_URL);
  });

  it("作成失敗後のdisconnect失敗では元の失敗codeを維持する", async () => {
    const { createAdmin, disconnect, loadDependencies } = createRuntimeMocks();
    createAdmin.mockRejectedValue(new Error("create failed"));
    disconnect.mockRejectedValue(new Error("disconnect failed"));

    const result = await runCreateAdminCommand({ argv: [], env: VALID_ENV, loadDependencies });

    expect(result).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: ["管理者アカウントの作成に失敗しました", "データベース接続の終了処理に失敗しました"],
    });
  });

  it("stdoutとstderrへ認証情報・hash・ID・接続文字列・内部errorを含めない", async () => {
    const { createAdmin, loadDependencies } = createRuntimeMocks();
    const sensitiveValues = [
      VALID_ENV.ADMIN_USERNAME!,
      VALID_ENV.ADMIN_EMAIL!,
      VALID_ENV.ADMIN_PASSWORD!,
      "$2b$12$private-password-hash",
      "private-user-id",
      DATABASE_URL,
      "P2002 private meta",
    ];
    createAdmin.mockRejectedValue(
      Object.assign(
        new Error(
          `${sensitiveValues[0]} ${sensitiveValues[1]} ${sensitiveValues[2]} ${sensitiveValues[3]} ${sensitiveValues[4]} ${sensitiveValues[5]}`,
        ),
        { code: "P2002", meta: sensitiveValues[6] },
      ),
    );

    const result = await runCreateAdminCommand({ argv: [], env: VALID_ENV, loadDependencies });
    const allOutput = [...result.stdout, ...result.stderr].join("\n");

    for (const sensitiveValue of sensitiveValues) {
      expect(allOutput).not.toContain(sensitiveValue);
    }
  });
});
