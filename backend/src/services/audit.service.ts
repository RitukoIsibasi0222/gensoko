import { prisma } from "../lib/prisma.js";
import {
  auditEventSchema,
  type AuditEventInput,
  type AuditLogClient,
  type ValidatedAuditEvent,
} from "./audit-events.js";

async function createAuditLog(client: AuditLogClient, event: ValidatedAuditEvent): Promise<void> {
  await client.auditLog.create({
    data: {
      action: event.action,
      result: event.result,
      actorId: event.actorId,
      actorRole: event.actorRole,
      targetType: event.targetType,
      targetId: event.targetId,
      failureReason: event.failureReason,
    },
  });
}

export async function recordAuditEvent(
  client: AuditLogClient,
  input: AuditEventInput,
): Promise<void> {
  const event = auditEventSchema.parse(input);
  await createAuditLog(client, event);
}

export async function recordAuditEventBestEffort(input: AuditEventInput): Promise<boolean> {
  const parsedEvent = auditEventSchema.safeParse(input);

  if (!parsedEvent.success) {
    console.error("[audit] 監査ログ入力が不正です");
    return false;
  }

  try {
    await createAuditLog(prisma, parsedEvent.data);
    return true;
  } catch {
    console.error(
      `[audit] 監査ログの保存に失敗しました: action=${parsedEvent.data.action} result=${parsedEvent.data.result}`,
    );
    return false;
  }
}
