import ipaddr from "ipaddr.js";
import type { RateLimitPolicyId } from "./policies.js";

const RATE_LIMIT_KEY_VERSION = "v1";
const IPV6_PREFIX_PARTS = 4;
const IPV6_TOTAL_PARTS = 8;
const HEX_BYTE_LENGTH = 2;

export type RateLimitActorType = "ip" | "email" | "user";
export type ClientIpRuntime = "node" | "cloudflare-workers";

export type ClientIpInput = Readonly<{
  runtime: ClientIpRuntime;
  cfConnectingIp?: string | null;
  socketAddress?: string | null;
  xForwardedFor?: string | null;
  xRealIp?: string | null;
}>;

export type RateLimitKeyDigestInput = Readonly<{
  secret: string;
  policyId: RateLimitPolicyId;
  operationScope: string | null;
  actorType: RateLimitActorType;
  value: string;
}>;

export function normalizeRateLimitEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeIpv4(ip: string): string | null {
  const octets = ip.split(".");

  if (octets.length !== 4) {
    return null;
  }

  const isCanonicalDecimal = octets.every((octet) => {
    if (!/^\d+$/.test(octet)) {
      return false;
    }

    if (octet.length > 1 && octet.startsWith("0")) {
      return false;
    }

    const value = Number(octet);
    return value >= 0 && value <= 255;
  });

  if (!isCanonicalDecimal || !ipaddr.IPv4.isValidFourPartDecimal(ip)) {
    return null;
  }

  return octets.map(Number).join(".");
}

function normalizeIpv6(ip: string): string | null {
  if (ip.includes("%") || !ipaddr.IPv6.isValid(ip)) {
    return null;
  }

  const address = ipaddr.IPv6.parse(ip);

  if (address.isIPv4MappedAddress()) {
    return address.toIPv4Address().toString();
  }

  const prefixParts = address.parts.slice(0, IPV6_PREFIX_PARTS);
  const networkParts = [
    ...prefixParts,
    ...Array<number>(IPV6_TOTAL_PARTS - IPV6_PREFIX_PARTS).fill(0),
  ];
  const networkAddress = new ipaddr.IPv6(networkParts).toRFC5952String();

  return `${networkAddress}/64`;
}

export function normalizeIpActor(ip: string): string | null {
  const normalizedIp = ip.trim();

  if (!normalizedIp) {
    return null;
  }

  const ipv4 = normalizeIpv4(normalizedIp);
  if (ipv4) {
    return ipv4;
  }

  return normalizeIpv6(normalizedIp);
}

export function resolveClientIp(input: ClientIpInput): string | null {
  const candidate =
    input.runtime === "cloudflare-workers" ? input.cfConnectingIp : input.socketAddress;

  if (!candidate) {
    return null;
  }

  return normalizeIpActor(candidate);
}

function decodeBase64(value: string): ArrayBuffer {
  const decoded = atob(value);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));

  return bytes.buffer;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(HEX_BYTE_LENGTH, "0")).join("");
}

export async function createRateLimitKeyDigest({
  secret,
  policyId,
  operationScope,
  actorType,
  value,
}: RateLimitKeyDigestInput): Promise<string> {
  const canonicalInput = JSON.stringify([
    RATE_LIMIT_KEY_VERSION,
    policyId,
    operationScope,
    actorType,
    value,
  ]);
  const hmacKey = await globalThis.crypto.subtle.importKey(
    "raw",
    decodeBase64(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    hmacKey,
    new TextEncoder().encode(canonicalInput),
  );

  return bytesToHex(new Uint8Array(signature));
}
