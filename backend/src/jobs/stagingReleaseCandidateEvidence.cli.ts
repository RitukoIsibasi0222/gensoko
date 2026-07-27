import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { createM2Evidence, validateM1PathAEvidence } from "./stagingReleaseCandidateEvidence.js";

const COMPLETED_EVENT = "m2_evidence.completed";
const FAILED_EVENT = "m2_evidence.failed";
const ARGUMENT_ERROR_MESSAGE = "M2 evidence CLIの引数が正しくありません";
const EXECUTION_ERROR_MESSAGE = "M2 evidence CLIの実行に失敗しました";

type SafeLogger = (value: Readonly<Record<string, string>>) => void;

type EvidenceCliOptions =
  | Readonly<{ operation: "build"; input: string; output: string }>
  | Readonly<{ operation: "validate-m1"; input: string; expectedSha: string }>;

function parseOptions(argv: readonly string[]): EvidenceCliOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      input: { type: "string" },
      output: { type: "string" },
      operation: { type: "string", default: "build" },
      "expected-sha": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.operation === "validate-m1" && values.input && values["expected-sha"]) {
    return {
      operation: "validate-m1",
      input: values.input,
      expectedSha: values["expected-sha"],
    };
  }
  if (
    values.operation !== "build" ||
    !values.input ||
    !values.output ||
    values.input === values.output ||
    values["expected-sha"]
  ) {
    throw new Error(ARGUMENT_ERROR_MESSAGE);
  }
  return { operation: "build", input: values.input, output: values.output };
}

export async function runM2EvidenceCli({
  argv,
  readFile: readFileImpl = async (path) => await readFile(path, "utf8"),
  writeFile: writeFileImpl = async (path, value) => await writeFile(path, value, "utf8"),
  info = console.info,
  error = console.error,
}: {
  argv: readonly string[];
  readFile?: (path: string) => Promise<string>;
  writeFile?: (path: string, value: string) => Promise<unknown>;
  info?: SafeLogger;
  error?: SafeLogger;
}): Promise<0 | 1 | 2> {
  let options: EvidenceCliOptions;
  try {
    options = parseOptions(argv);
  } catch {
    error({ event: FAILED_EVENT, message: ARGUMENT_ERROR_MESSAGE });
    return 2;
  }

  try {
    const input = JSON.parse(await readFileImpl(options.input)) as unknown;
    if (options.operation === "validate-m1") {
      const result = validateM1PathAEvidence(input, options.expectedSha);
      if (result.status !== "clear") {
        throw new Error(EXECUTION_ERROR_MESSAGE);
      }
      info({ event: COMPLETED_EVENT, decision: "clear" });
      return 0;
    }
    const evidence = createM2Evidence(input);
    await writeFileImpl(options.output, `${JSON.stringify(evidence)}\n`);
    info({ event: COMPLETED_EVENT, decision: evidence.decision });
    return 0;
  } catch {
    error({ event: FAILED_EVENT, message: EXECUTION_ERROR_MESSAGE });
    return 1;
  }
}

export async function main(): Promise<void> {
  process.exitCode = await runM2EvidenceCli({ argv: process.argv.slice(2) });
}

if (process.env.NODE_ENV !== "test") {
  void main();
}
