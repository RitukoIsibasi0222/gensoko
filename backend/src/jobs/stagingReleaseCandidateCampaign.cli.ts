import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { normalizePassword } from "../lib/normalize.js";
import { strongPasswordSchema } from "../lib/validation/auth.js";
import {
  runM2StagingReleaseCandidateCampaign,
  type M2CampaignSafeSummary,
  type RunM2StagingReleaseCandidateCampaignOptions,
} from "./stagingReleaseCandidateCampaign.js";
import {
  M2_STAGING_FIXTURE,
  armM2EmailVerification,
  validateM2StagingFixtureEnvironment,
  type M2StagingFixtureClient,
} from "./stagingReleaseCandidateFixtures.js";
import { runStagingRateLimitEvidence } from "./stagingRateLimitEvidence.js";

const API_BASE_URL = "https://gensoko-api-staging.rituko-labs.workers.dev/api/v1";
const FRONTEND_ORIGIN = "https://gensoko-frontend-staging-develop.vercel.app";
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const COMPLETED_EVENT = "m2_campaign.completed";
const FAILED_EVENT = "m2_campaign.failed";
const ENVIRONMENT_ERROR_MESSAGE = "M2 campaign設定が不正です";
const EXECUTION_ERROR_MESSAGE = "M2 campaign CLIの実行に失敗しました";

type SafeLogger = (value: Readonly<Record<string, string>>) => void;
type CampaignEnvironment = Readonly<{
  BATCH_ENVIRONMENT?: string;
  STAGING_SUPABASE_PROJECT_REF?: string;
  DATABASE_URL?: string;
  M2_STAGING_FIXTURE_ENABLED?: string;
  M2_API_BASE_URL?: string;
  M2_FRONTEND_ORIGIN?: string;
  M2_SYNTHETIC_USERNAME?: string;
  M2_SYNTHETIC_EMAIL?: string;
  M2_SYNTHETIC_PASSWORD?: string;
  M2_VERIFICATION_TOKEN?: string;
  M2_CAMPAIGN_MARKER_PATH?: string;
  VERCEL_AUTOMATION_BYPASS_SECRET?: string;
}>;

type ValidatedCampaignEnvironment = Readonly<{
  apiBaseUrl: typeof API_BASE_URL;
  frontendOrigin: typeof FRONTEND_ORIGIN;
  username: typeof M2_STAGING_FIXTURE.username;
  email: typeof M2_STAGING_FIXTURE.email;
  password: string;
  verificationToken: string;
  markerPath: string;
}>;

type CampaignDependencies = Readonly<{
  client: M2StagingFixtureClient;
  disconnect: () => Promise<void>;
}>;

function validateEnvironment(environment: CampaignEnvironment): ValidatedCampaignEnvironment {
  try {
    validateM2StagingFixtureEnvironment(environment);
    const password = normalizePassword(environment.M2_SYNTHETIC_PASSWORD ?? "");
    const verificationToken = environment.M2_VERIFICATION_TOKEN ?? "";
    const markerPath = environment.M2_CAMPAIGN_MARKER_PATH ?? "";
    if (
      environment.M2_API_BASE_URL !== API_BASE_URL ||
      environment.M2_FRONTEND_ORIGIN !== FRONTEND_ORIGIN ||
      environment.M2_SYNTHETIC_USERNAME !== M2_STAGING_FIXTURE.username ||
      environment.M2_SYNTHETIC_EMAIL !== M2_STAGING_FIXTURE.email ||
      !strongPasswordSchema.safeParse(password).success ||
      !TOKEN_PATTERN.test(verificationToken) ||
      !markerPath.startsWith("/") ||
      !environment.VERCEL_AUTOMATION_BYPASS_SECRET ||
      /\s/.test(environment.VERCEL_AUTOMATION_BYPASS_SECRET)
    ) {
      throw new Error(ENVIRONMENT_ERROR_MESSAGE);
    }
    return {
      apiBaseUrl: API_BASE_URL,
      frontendOrigin: FRONTEND_ORIGIN,
      username: M2_STAGING_FIXTURE.username,
      email: M2_STAGING_FIXTURE.email,
      password,
      verificationToken,
      markerPath,
    };
  } catch {
    throw new Error(ENVIRONMENT_ERROR_MESSAGE);
  }
}

async function loadDefaultDependencies(): Promise<CampaignDependencies> {
  const { prisma } = await import("../lib/prisma.js");
  return {
    client: prisma as unknown as M2StagingFixtureClient,
    disconnect: async () => await prisma.$disconnect(),
  };
}

async function runDefaultUiPhase(environment: CampaignEnvironment): Promise<{
  keyboard: "clear";
  viewport320: "clear";
  selfDeletion: "clear";
}> {
  const frontendDirectory = fileURLToPath(new URL("../../../frontend", import.meta.url));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(
      "npx",
      ["playwright", "test", "--config", "playwright.staging-release-candidate.config.ts"],
      {
        cwd: frontendDirectory,
        env: { ...process.env, ...environment },
        stdio: "ignore",
        shell: false,
      },
    );
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(EXECUTION_ERROR_MESSAGE);
  }
  return { keyboard: "clear", viewport320: "clear", selfDeletion: "clear" };
}

export async function runM2CampaignCli({
  environment,
  runCampaign = runM2StagingReleaseCandidateCampaign,
  loadDependencies = loadDefaultDependencies,
  runUiPhase = async () => await runDefaultUiPhase(environment),
  writeFile: writeFileImpl = async (path, value) => await writeFile(path, value, "utf8"),
  info = console.info,
  error = console.error,
}: {
  environment: CampaignEnvironment;
  runCampaign?: (
    options: RunM2StagingReleaseCandidateCampaignOptions,
  ) => Promise<M2CampaignSafeSummary>;
  loadDependencies?: () => Promise<CampaignDependencies>;
  runUiPhase?: RunM2StagingReleaseCandidateCampaignOptions["runUiPhase"];
  writeFile?: (path: string, value: string) => Promise<unknown>;
  info?: SafeLogger;
  error?: SafeLogger;
}): Promise<0 | 1 | 2> {
  let validated: ValidatedCampaignEnvironment;
  try {
    validated = validateEnvironment(environment);
  } catch {
    error({ event: FAILED_EVENT, message: ENVIRONMENT_ERROR_MESSAGE });
    return 2;
  }

  let dependencies: CampaignDependencies;
  try {
    dependencies = await loadDependencies();
  } catch {
    error({ event: FAILED_EVENT, message: EXECUTION_ERROR_MESSAGE });
    return 1;
  }

  try {
    const summary = await runCampaign({
      apiBaseUrl: validated.apiBaseUrl,
      frontendOrigin: validated.frontendOrigin,
      username: validated.username,
      email: validated.email,
      password: validated.password,
      verificationToken: validated.verificationToken,
      armVerification: async (token) =>
        await armM2EmailVerification({
          client: dependencies.client,
          token,
          expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
        }),
      runAuthRateLimitEvidence: async ({ email, password }) => {
        const result = await runStagingRateLimitEvidence({
          apiBaseUrl: validated.apiBaseUrl,
          frontendOrigin: validated.frontendOrigin,
          evidenceCase: "auth",
          userEmail: email,
          userPassword: password,
        });
        return { retryAfterSec: result.retryAfterSec };
      },
      runUiPhase,
    });
    await writeFileImpl(validated.markerPath, `${JSON.stringify(summary)}\n`);
    info({ event: COMPLETED_EVENT, status: "clear" });
    return 0;
  } catch {
    error({ event: FAILED_EVENT, message: EXECUTION_ERROR_MESSAGE });
    return 1;
  } finally {
    try {
      await dependencies.disconnect();
    } catch {
      // DB切断失敗はraw errorを出力せず、既存の固定結果を維持する
    }
  }
}

export async function main(): Promise<void> {
  process.exitCode = await runM2CampaignCli({ environment: process.env });
}

if (process.env.NODE_ENV !== "test") {
  void main();
}
