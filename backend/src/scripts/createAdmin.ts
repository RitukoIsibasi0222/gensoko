import { parseArgs } from "node:util";
import { z } from "zod";
import { normalizePassword } from "../lib/normalize.js";
import { emailSchema, strongPasswordSchema, usernameSchema } from "../lib/validation/auth.js";

export type ParsedCreateAdminArguments = {
  username?: string;
  email?: string;
  password?: string;
  help: boolean;
};

export type ResolvedCreateAdminInput = {
  username: string | undefined;
  email: string | undefined;
  password: string | undefined;
  passwordSource: "argument" | "environment" | "missing";
};

export type NormalizedCreateAdminInput = {
  username: string;
  email: string;
  password: string;
};

export type CreateAdminCliExitCode = 0 | 1 | 2;

export type CreateAdminCliResult = {
  exitCode: CreateAdminCliExitCode;
  stdout: readonly string[];
  stderr: readonly string[];
};

export type CreateAdminRuntimeDependencies = {
  createAdmin: (input: NormalizedCreateAdminInput) => Promise<void>;
  disconnect: () => Promise<void>;
};

const createAdminInputSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: strongPasswordSchema,
});

const HELP_LINES = [
  "管理者アカウントを1件作成します。",
  "",
  "使用方法:",
  "  npm --silent run admin:create -- --username <username> --email <email> --password <password>",
  "",
  "オプション:",
  "  --username  管理者ユーザー名",
  "  --email     管理者メールアドレス",
  "  --password  管理者パスワード（環境変数方式を推奨）",
  "  --help      このヘルプを表示",
  "",
  "環境変数:",
  "  ADMIN_USERNAME",
  "  ADMIN_EMAIL",
  "  ADMIN_PASSWORD",
  "",
  "同じ項目が指定された場合はコマンド引数を優先します。",
] as const;

const ARGUMENT_ERROR_MESSAGE = "コマンド引数が正しくありません";
const DATABASE_CONFIG_ERROR_MESSAGE = "データベース接続設定がありません";
const CREATE_FAILED_MESSAGE = "管理者アカウントの作成に失敗しました";
const CREATE_SUCCEEDED_MESSAGE = "管理者アカウントを作成しました";
const DUPLICATE_USER_MESSAGE = "ユーザー名またはメールアドレスは既に使用されています";
const DISCONNECT_FAILED_MESSAGE = "データベース接続の終了処理に失敗しました";
const PASSWORD_ARGUMENT_WARNING =
  "パスワードをコマンド引数で指定すると履歴やプロセス一覧に残る可能性があります。環境変数の利用を推奨します";

class CreateAdminInputError extends Error {
  constructor(readonly messages: readonly string[]) {
    super(messages.join("\n"));
    this.name = "CreateAdminInputError";
  }
}

export function parseCreateAdminArguments(argv: readonly string[]): ParsedCreateAdminArguments {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      username: { type: "string" },
      email: { type: "string" },
      password: { type: "string" },
      help: { type: "boolean" },
    },
    strict: true,
    allowPositionals: false,
  });

  return {
    username: values.username,
    email: values.email,
    password: values.password,
    help: values.help === true,
  };
}

export function resolveCreateAdminInput(
  args: ParsedCreateAdminArguments,
  env: NodeJS.ProcessEnv,
): ResolvedCreateAdminInput {
  const password = args.password !== undefined ? args.password : env.ADMIN_PASSWORD;
  const passwordSource =
    args.password !== undefined
      ? "argument"
      : env.ADMIN_PASSWORD !== undefined
        ? "environment"
        : "missing";

  return {
    username: args.username !== undefined ? args.username : env.ADMIN_USERNAME,
    email: args.email !== undefined ? args.email : env.ADMIN_EMAIL,
    password,
    passwordSource,
  };
}

export function normalizeAndValidateCreateAdminInput(
  input: ResolvedCreateAdminInput,
): NormalizedCreateAdminInput {
  const normalizedInput = {
    username: input.username?.trim() ?? "",
    email: input.email?.trim() ?? "",
    password: normalizePassword(input.password ?? ""),
  };

  const missingMessages: string[] = [];
  if (normalizedInput.username.length === 0) {
    missingMessages.push("ユーザー名を入力してください");
  }
  if (normalizedInput.email.length === 0) {
    missingMessages.push("メールアドレスを入力してください");
  }
  if (normalizedInput.password.length === 0) {
    missingMessages.push("パスワードを入力してください");
  }
  if (missingMessages.length > 0) {
    throw new CreateAdminInputError(missingMessages);
  }

  const validationResult = createAdminInputSchema.safeParse(normalizedInput);
  if (!validationResult.success) {
    throw new CreateAdminInputError(validationResult.error.issues.map((issue) => issue.message));
  }

  const relationshipMessages: string[] = [];
  if (validationResult.data.password === validationResult.data.username) {
    relationshipMessages.push("パスワードはユーザー名と異なるものにしてください");
  }
  if (validationResult.data.password === validationResult.data.email) {
    relationshipMessages.push("パスワードはメールアドレスと異なるものにしてください");
  }
  if (relationshipMessages.length > 0) {
    throw new CreateAdminInputError(relationshipMessages);
  }

  return validationResult.data;
}

function isDuplicateUserError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "DUPLICATE_USER"
  );
}

function toInputErrorMessages(error: unknown): readonly string[] {
  if (error instanceof CreateAdminInputError) {
    return error.messages;
  }

  return ["入力内容が正しくありません"];
}

export async function runCreateAdminCommand(input: {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  loadDependencies: () => Promise<CreateAdminRuntimeDependencies>;
}): Promise<CreateAdminCliResult> {
  let args: ParsedCreateAdminArguments;
  try {
    args = parseCreateAdminArguments(input.argv);
  } catch {
    return { exitCode: 2, stdout: [], stderr: [ARGUMENT_ERROR_MESSAGE] };
  }

  if (args.help) {
    return { exitCode: 0, stdout: [...HELP_LINES], stderr: [] };
  }

  const resolvedInput = resolveCreateAdminInput(args, input.env);
  const warnings = resolvedInput.passwordSource === "argument" ? [PASSWORD_ARGUMENT_WARNING] : [];

  let normalizedInput: NormalizedCreateAdminInput;
  try {
    normalizedInput = normalizeAndValidateCreateAdminInput(resolvedInput);
  } catch (error) {
    return {
      exitCode: 2,
      stdout: [],
      stderr: [...warnings, ...toInputErrorMessages(error)],
    };
  }

  if (!input.env.DATABASE_URL?.trim()) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: [...warnings, DATABASE_CONFIG_ERROR_MESSAGE],
    };
  }

  let dependencies: CreateAdminRuntimeDependencies;
  try {
    dependencies = await input.loadDependencies();
  } catch {
    return {
      exitCode: 1,
      stdout: [],
      stderr: [...warnings, CREATE_FAILED_MESSAGE],
    };
  }

  let exitCode: CreateAdminCliExitCode = 0;
  let stdout: string[] = [];
  const stderr = [...warnings];

  try {
    await dependencies.createAdmin(normalizedInput);
    stdout = [CREATE_SUCCEEDED_MESSAGE];
  } catch (error) {
    exitCode = 1;
    stderr.push(isDuplicateUserError(error) ? DUPLICATE_USER_MESSAGE : CREATE_FAILED_MESSAGE);
  }

  try {
    await dependencies.disconnect();
  } catch {
    stderr.push(DISCONNECT_FAILED_MESSAGE);
  }

  return { exitCode, stdout, stderr };
}
