export function normalizeGameSessionIdParam(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalizedSessionId = value.trim();
  return normalizedSessionId.length > 0 ? normalizedSessionId : null;
}
