import type { Context } from "hono";
import {
  SERVICE_UNAVAILABLE_MESSAGE,
  SERVICE_UNAVAILABLE_RETRY_AFTER_SEC,
} from "./http-error-messages.js";

export function createServiceUnavailableResponse(context: Context): Response {
  context.header("Retry-After", String(SERVICE_UNAVAILABLE_RETRY_AFTER_SEC));
  return context.json({ error: SERVICE_UNAVAILABLE_MESSAGE }, 503);
}
