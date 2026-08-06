export type ProductionMigrationGateStatus = "current" | "pending" | "unknown";

export type ProductionMigrationStatusInput = Readonly<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}>;

const CURRENT_MARKER = "Database schema is up to date!";
const PENDING_MARKERS = [
  "The following migration(s) have not yet been applied:",
  "Following migration(s) have not yet been applied:",
] as const;

export function classifyProductionMigrationStatus(
  input: ProductionMigrationStatusInput,
): ProductionMigrationGateStatus {
  if (input.timedOut) return "unknown";
  const output = `${input.stdout}\n${input.stderr}`;
  const hasCurrentMarker = output.includes(CURRENT_MARKER);
  const hasPendingMarker = PENDING_MARKERS.some((marker) => output.includes(marker));

  if (input.exitCode === 0 && hasCurrentMarker && !hasPendingMarker) return "current";
  if (input.exitCode === 1 && hasPendingMarker && !hasCurrentMarker) return "pending";
  return "unknown";
}
