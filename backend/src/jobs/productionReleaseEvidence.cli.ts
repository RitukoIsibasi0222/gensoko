import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  PRODUCTION_RELEASE_STATUSES,
  toProductionReleaseEvidence,
} from "./productionReleaseEvidence.js";

export function runProductionReleaseEvidenceCli(
  environment: Readonly<Record<string, string | undefined>>,
  logger: Pick<Console, "info" | "error"> = console,
): 0 | 1 {
  try {
    const outputPath = environment.PRODUCTION_RELEASE_EVIDENCE_PATH ?? "";
    if (!outputPath) throw new Error("missing output");
    const statuses = (environment.PRODUCTION_RELEASE_STATUSES_CSV ?? "").split(",").filter(Boolean);
    const evidence = toProductionReleaseEvidence({
      sha: environment.GITHUB_SHA ?? "",
      event: environment.GITHUB_EVENT_NAME ?? "",
      runId: environment.GITHUB_RUN_ID ?? "",
      runAttempt: Number(environment.GITHUB_RUN_ATTEMPT),
      statuses: statuses.length > 0 ? statuses : PRODUCTION_RELEASE_STATUSES,
      createdAt: new Date(),
    });
    writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    logger.info({ event: "production_release_evidence.completed", status: "clear" });
    return 0;
  } catch {
    logger.error({
      event: "production_release_evidence.failed",
      message: "production release evidenceを作成できませんでした",
    });
    return 1;
  }
}

const entrypointPath = process.argv[1];
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  process.exitCode = runProductionReleaseEvidenceCli(process.env);
}
