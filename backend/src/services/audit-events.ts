import { AuditResult, Role, type Prisma } from "@prisma/client";
import { z } from "zod";

export const AUDIT_ACTIONS = {
  LOGIN: "LOGIN",
  PASSWORD_CHANGE: "PASSWORD_CHANGE",
  PASSWORD_RESET: "PASSWORD_RESET",
  ADMIN_USER_SUSPEND: "ADMIN_USER_SUSPEND",
  ADMIN_USER_REACTIVATE: "ADMIN_USER_REACTIVATE",
  ADMIN_USER_ROLE_CHANGE: "ADMIN_USER_ROLE_CHANGE",
  ADMIN_USER_FORCE_DELETE: "ADMIN_USER_FORCE_DELETE",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_TARGET_TYPES = {
  USER: "USER",
} as const;

export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[keyof typeof AUDIT_TARGET_TYPES];

export const AUDIT_FAILURE_REASONS = {
  AUTHENTICATION_FAILED: "AUTHENTICATION_FAILED",
  TARGET_NOT_FOUND: "TARGET_NOT_FOUND",
  SELF_OPERATION_DENIED: "SELF_OPERATION_DENIED",
  LAST_ADMIN_PROTECTED: "LAST_ADMIN_PROTECTED",
  TARGET_STATE_CONFLICT: "TARGET_STATE_CONFLICT",
  SERIALIZATION_CONFLICT: "SERIALIZATION_CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type AuditFailureReason = (typeof AUDIT_FAILURE_REASONS)[keyof typeof AUDIT_FAILURE_REASONS];

const commonAuditEventShape = {
  action: z.enum(AUDIT_ACTIONS),
  actorId: z.string().min(1).nullable(),
  actorRole: z.enum(Role).nullable(),
  targetType: z.enum(AUDIT_TARGET_TYPES).nullable(),
  targetId: z.string().min(1).nullable(),
};

export const auditEventSchema = z
  .discriminatedUnion("result", [
    z
      .object({
        ...commonAuditEventShape,
        result: z.literal(AuditResult.SUCCESS),
        failureReason: z.null(),
      })
      .strict(),
    z
      .object({
        ...commonAuditEventShape,
        result: z.literal(AuditResult.FAILURE),
        failureReason: z.enum(AUDIT_FAILURE_REASONS),
      })
      .strict(),
  ])
  .superRefine((event, context) => {
    const hasTargetType = event.targetType !== null;
    const hasTargetId = event.targetId !== null;

    if (hasTargetType !== hasTargetId) {
      context.addIssue({
        code: "custom",
        message: "targetTypeとtargetIdは両方指定するか、両方nullにしてください",
        path: hasTargetType ? ["targetId"] : ["targetType"],
      });
    }
  });

export type AuditEventInput = z.input<typeof auditEventSchema>;
export type ValidatedAuditEvent = z.output<typeof auditEventSchema>;
export type AuditLogClient = Pick<Prisma.TransactionClient, "auditLog">;
