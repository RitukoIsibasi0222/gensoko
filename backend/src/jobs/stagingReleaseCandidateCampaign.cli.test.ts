import { describe, expect, it, vi } from "vitest";

import { runM2CampaignCli } from "./stagingReleaseCandidateCampaign.cli.js";

const VALID_ENVIRONMENT = {
  BATCH_ENVIRONMENT: "staging",
  STAGING_SUPABASE_PROJECT_REF: "stagingref",
  DATABASE_URL:
    "postgresql://postgres.stagingref:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
  M2_STAGING_FIXTURE_ENABLED: "true",
  M2_API_BASE_URL: "https://gensoko-api-staging.rituko-labs.workers.dev/api/v1",
  M2_FRONTEND_ORIGIN: "https://gensoko-frontend-staging-develop.vercel.app",
  M2_SYNTHETIC_USERNAME: "m2_release_candidate_user",
  M2_SYNTHETIC_EMAIL: "m2-release-candidate-user@example.test",
  M2_SYNTHETIC_PASSWORD: "M2Synthetic1!password",
  M2_VERIFICATION_TOKEN: "ab".repeat(32),
  M2_CAMPAIGN_MARKER_PATH: "/runner-temp/m2-campaign.json",
  VERCEL_AUTOMATION_BYPASS_SECRET: "secret-bypass",
};

const SUMMARY = {
  registration: "clear",
  emailVerification: "clear",
  validLogin: "clear",
  refreshProtocol: "clear",
  mainWorkerCpu: "clear",
  authAllowedTen: "clear",
  authEleventh429: "clear",
  authRetryAfter: "clear",
  authReset: "clear",
  game: "clear",
  keyboard: "clear",
  viewport320: "clear",
  selfDeletion: "clear",
  oldCredentialRejection: "clear",
  headersCorsSafeErrors: "clear",
} as const;

describe("M2 campaign CLI", () => {
  it("safe summaryだけをrunner temp markerとstdoutへ出す", async () => {
    const writeFile = vi.fn();
    const info = vi.fn();
    const disconnect = vi.fn();
    const exitCode = await runM2CampaignCli({
      environment: VALID_ENVIRONMENT,
      runCampaign: vi.fn().mockResolvedValue(SUMMARY),
      loadDependencies: vi.fn().mockResolvedValue({ client: {}, disconnect }),
      runUiPhase: vi.fn(),
      writeFile,
      info,
      error: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(writeFile).toHaveBeenCalledWith(
      VALID_ENVIRONMENT.M2_CAMPAIGN_MARKER_PATH,
      `${JSON.stringify(SUMMARY)}\n`,
    );
    expect(info).toHaveBeenCalledWith({ event: "m2_campaign.completed", status: "clear" });
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("production origin・不正credentialを依存読込前に拒否する", async () => {
    const loadDependencies = vi.fn();
    const exitCode = await runM2CampaignCli({
      environment: { ...VALID_ENVIRONMENT, M2_API_BASE_URL: "https://production.example.com" },
      runCampaign: vi.fn(),
      loadDependencies,
      runUiPhase: vi.fn(),
      writeFile: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    });

    expect(exitCode).toBe(2);
    expect(loadDependencies).not.toHaveBeenCalled();
  });

  it("failureはraw error・credential・pathを固定messageへ縮約する", async () => {
    const error = vi.fn();
    const exitCode = await runM2CampaignCli({
      environment: VALID_ENVIRONMENT,
      runCampaign: vi.fn().mockRejectedValue(new Error("raw provider response")),
      loadDependencies: vi.fn().mockResolvedValue({ client: {}, disconnect: vi.fn() }),
      runUiPhase: vi.fn(),
      writeFile: vi.fn(),
      info: vi.fn(),
      error,
    });

    expect(exitCode).toBe(1);
    const output = JSON.stringify(error.mock.calls);
    expect(output).toContain("M2 campaign CLIの実行に失敗しました");
    expect(output).not.toContain("raw provider response");
    expect(output).not.toContain(VALID_ENVIRONMENT.M2_SYNTHETIC_PASSWORD);
    expect(output).not.toContain(VALID_ENVIRONMENT.M2_VERIFICATION_TOKEN);
    expect(output).not.toContain(VALID_ENVIRONMENT.M2_CAMPAIGN_MARKER_PATH);
  });
});
