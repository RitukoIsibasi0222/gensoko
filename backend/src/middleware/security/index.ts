import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";

const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'none'"],
  baseUri: ["'none'"],
  frameAncestors: ["'none'"],
  formAction: ["'none'"],
};

const PERMISSIONS_POLICY = {
  camera: [],
  microphone: [],
  geolocation: [],
};

const HSTS_POLICY = "max-age=31536000; includeSubDomains";

export type SecurityHeadersOptions = {
  isProduction: boolean;
};

/**
 * JSON API向けのセキュリティヘッダーを全レスポンスへ付与する。
 *
 * Honoの既定値はバージョンによって変わり得るため、採用しない項目も含めて
 * 明示し、Gensokoの中央ポリシーを唯一の設定元にする。
 */
export const createSecurityHeadersMiddleware = ({
  isProduction,
}: SecurityHeadersOptions): MiddlewareHandler =>
  secureHeaders({
    contentSecurityPolicy: CONTENT_SECURITY_POLICY,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: "same-origin",
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    referrerPolicy: "strict-origin-when-cross-origin",
    strictTransportSecurity: isProduction ? HSTS_POLICY : false,
    xContentTypeOptions: "nosniff",
    xDnsPrefetchControl: false,
    xDownloadOptions: false,
    xFrameOptions: "DENY",
    xPermittedCrossDomainPolicies: "none",
    xXssProtection: "0",
    removePoweredBy: true,
    permissionsPolicy: PERMISSIONS_POLICY,
  });
