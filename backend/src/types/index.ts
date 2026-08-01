import type { Role } from "@prisma/client";
import type { RateLimitDependencies } from "../middleware/rateLimit/store.js";

// JWT ペイロード（最小限の情報のみ格納）
export type JwtPayload = {
  sub: string; // userId
  role: Role;
  iat?: number;
  exp?: number;
};

// 認証済みユーザー（c.get("user") の型）
export type AuthUser = {
  id: string;
  role: Role;
};

// Hono Variables 型拡張
export type AppVariables = {
  user?: AuthUser;
  rateLimit: RateLimitDependencies;
};
