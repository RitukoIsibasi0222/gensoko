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

export const ADMIN_AUDIT_ACTIONS = [
  AUDIT_ACTIONS.ADMIN_USER_SUSPEND,
  AUDIT_ACTIONS.ADMIN_USER_REACTIVATE,
  AUDIT_ACTIONS.ADMIN_USER_ROLE_CHANGE,
  AUDIT_ACTIONS.ADMIN_USER_FORCE_DELETE,
] as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

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

const ADMIN_AUDIT_FAILURE_REASONS = [
  AUDIT_FAILURE_REASONS.TARGET_NOT_FOUND,
  AUDIT_FAILURE_REASONS.SELF_OPERATION_DENIED,
  AUDIT_FAILURE_REASONS.LAST_ADMIN_PROTECTED,
  AUDIT_FAILURE_REASONS.TARGET_STATE_CONFLICT,
  AUDIT_FAILURE_REASONS.SERIALIZATION_CONFLICT,
  AUDIT_FAILURE_REASONS.INTERNAL_ERROR,
] as const;

export type AdminAuditFailureReason = (typeof ADMIN_AUDIT_FAILURE_REASONS)[number];

const UNCONFIRMED_TARGET_FAILURE_REASONS: readonly AdminAuditFailureReason[] = [
  AUDIT_FAILURE_REASONS.TARGET_NOT_FOUND,
  AUDIT_FAILURE_REASONS.SERIALIZATION_CONFLICT,
  AUDIT_FAILURE_REASONS.INTERNAL_ERROR,
];

const internalIdSchema = z.string().min(1);
const actorRoleSchema = z.enum(Role);
const adminActionSchema = z.enum(ADMIN_AUDIT_ACTIONS);

const actorIsTargetSuccessSchema = z
  .object({
    action: z.enum([AUDIT_ACTIONS.LOGIN, AUDIT_ACTIONS.PASSWORD_CHANGE]),
    result: z.literal(AuditResult.SUCCESS),
    actorId: internalIdSchema,
    actorRole: actorRoleSchema,
    targetType: z.literal(AUDIT_TARGET_TYPES.USER),
    targetId: internalIdSchema,
    failureReason: z.null(),
  })
  .strict();

const passwordResetSuccessSchema = z
  .object({
    action: z.literal(AUDIT_ACTIONS.PASSWORD_RESET),
    result: z.literal(AuditResult.SUCCESS),
    actorId: z.null(),
    actorRole: z.null(),
    targetType: z.literal(AUDIT_TARGET_TYPES.USER),
    targetId: internalIdSchema,
    failureReason: z.null(),
  })
  .strict();

const adminSuccessSchema = z
  .object({
    action: adminActionSchema,
    result: z.literal(AuditResult.SUCCESS),
    actorId: internalIdSchema,
    actorRole: z.literal(Role.ADMIN),
    targetType: z.literal(AUDIT_TARGET_TYPES.USER),
    targetId: internalIdSchema,
    failureReason: z.null(),
  })
  .strict();

const loginFailureSchema = z
  .object({
    action: z.literal(AUDIT_ACTIONS.LOGIN),
    result: z.literal(AuditResult.FAILURE),
    actorId: z.null(),
    actorRole: z.null(),
    targetType: z.null(),
    targetId: z.null(),
    failureReason: z.literal(AUDIT_FAILURE_REASONS.AUTHENTICATION_FAILED),
  })
  .strict();

const adminFailureSchema = z
  .object({
    action: adminActionSchema,
    result: z.literal(AuditResult.FAILURE),
    actorId: internalIdSchema,
    actorRole: z.literal(Role.ADMIN),
    targetType: z.literal(AUDIT_TARGET_TYPES.USER).nullable(),
    targetId: internalIdSchema.nullable(),
    failureReason: z.enum(ADMIN_AUDIT_FAILURE_REASONS),
  })
  .strict();

export const auditEventSchema = z
  .union([
    actorIsTargetSuccessSchema,
    passwordResetSuccessSchema,
    adminSuccessSchema,
    loginFailureSchema,
    adminFailureSchema,
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

    if (
      event.result === AuditResult.SUCCESS &&
      (event.action === AUDIT_ACTIONS.LOGIN || event.action === AUDIT_ACTIONS.PASSWORD_CHANGE) &&
      event.actorId !== event.targetId
    ) {
      context.addIssue({
        code: "custom",
        message: "本人操作のactorIdとtargetIdは一致させてください",
        path: ["targetId"],
      });
    }

    if (event.result === AuditResult.FAILURE && event.action !== AUDIT_ACTIONS.LOGIN) {
      const requiresNullTarget = UNCONFIRMED_TARGET_FAILURE_REASONS.includes(event.failureReason);

      if (requiresNullTarget && (hasTargetType || hasTargetId)) {
        context.addIssue({
          code: "custom",
          message: "対象未確認の失敗イベントにはtargetを指定できません",
          path: ["targetId"],
        });
      }

      if (!requiresNullTarget && (!hasTargetType || !hasTargetId)) {
        context.addIssue({
          code: "custom",
          message: "対象確認済みの失敗イベントにはtargetが必要です",
          path: ["targetId"],
        });
      }
    }
  });

export type AuditEventInput = z.input<typeof auditEventSchema>;
export type ValidatedAuditEvent = z.output<typeof auditEventSchema>;
export type AuditLogClient = Pick<Prisma.TransactionClient, "auditLog">;
