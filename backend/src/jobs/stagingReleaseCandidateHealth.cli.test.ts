import { describe, expect, it, vi } from "vitest";

import {
  M2_STAGING_API_BASE_URL,
  M2_STAGING_FRONTEND_ORIGIN,
  runM2StagingHealthCli,
} from "./stagingReleaseCandidateHealth.cli.js";

describe("M2 staging health CLI", () => {
  it("clearだけをsafe eventへ出力する", async () => {
    const info = vi.fn();
    const validate = vi.fn().mockResolvedValue({ status: "clear" as const });

    await expect(
      runM2StagingHealthCli({
        apiBaseUrl: M2_STAGING_API_BASE_URL,
        frontendOrigin: M2_STAGING_FRONTEND_ORIGIN,
        validate,
        info,
      }),
    ).resolves.toBe(0);
    expect(info).toHaveBeenCalledWith({ event: "m2_staging_health.completed", status: "clear" });
  });

  it("失敗詳細を出さず固定errorへ縮約する", async () => {
    const error = vi.fn();
    const validate = vi.fn().mockRejectedValue(new Error("raw provider detail"));

    await expect(
      runM2StagingHealthCli({
        apiBaseUrl: M2_STAGING_API_BASE_URL,
        frontendOrigin: M2_STAGING_FRONTEND_ORIGIN,
        validate,
        error,
      }),
    ).resolves.toBe(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain("raw provider detail");
  });
});
