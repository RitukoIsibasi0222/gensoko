import { cors } from "hono/cors";

export function createCorsMiddleware(frontendUrl: string) {
  return cors({
    origin: frontendUrl,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  });
}
