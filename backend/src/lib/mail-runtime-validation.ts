import { z } from "zod";

const mailAddressSchema = z.email();

/**
 * runtime境界のメールアドレスを検証し、allowlist比較用に正規化する。
 */
export function normalizeMailAddress(value: string): string | null {
  const normalizedValue = value.trim().toLowerCase();
  return mailAddressSchema.safeParse(normalizedValue).success ? normalizedValue : null;
}

/**
 * userinfo・fragmentを含まないHTTPS endpointだけを正規化して返す。
 */
export function parseSafeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}
