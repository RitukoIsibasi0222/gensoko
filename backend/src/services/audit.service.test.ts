import { AuditResult } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from "../lib/prisma.js";
import { AUDIT_ACTIONS, AUDIT_FAILURE_REASONS, AUDIT_TARGET_TYPES } from "./audit-events.js";
import { recordAuditEvent, recordAuditEventBestEffort } from "./audit.service.js";

const successEvent = {
  action: AUDIT_ACTIONS.LOGIN,
  result: AuditResult.SUCCESS,
  actorId: "user-1",
  actorRole: "USER" as const,
  targetType: AUDIT_TARGET_TYPES.USER,
  targetId: "user-1",
  failureReason: null,
};

const failureEvent = {
  action: AUDIT_ACTIONS.LOGIN,
  result: AuditResult.FAILURE,
  actorId: null,
  actorRole: null,
  targetType: null,
  targetId: null,
  failureReason: AUDIT_FAILURE_REASONS.AUTHENTICATION_FAILED,
};

describe("recordAuditEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("正常系: 成功イベントを許可された列だけで保存する", async () => {
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await recordAuditEvent(prisma, successEvent);

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: "LOGIN",
        result: AuditResult.SUCCESS,
        actorId: "user-1",
        actorRole: "USER",
        targetType: "USER",
        targetId: "user-1",
        failureReason: null,
      },
    });
  });

  it("正常系: 操作者と対象を特定できない失敗イベントを保存する", async () => {
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await recordAuditEvent(prisma, failureEvent);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: "LOGIN",
        result: AuditResult.FAILURE,
        actorId: null,
        actorRole: null,
        targetType: null,
        targetId: null,
        failureReason: "AUTHENTICATION_FAILED",
      },
    });
  });

  it("異常系: 成功イベントにfailureReasonがある場合はDB書込み前に拒否する", async () => {
    await expect(
      recordAuditEvent(prisma, {
        ...successEvent,
        failureReason: AUDIT_FAILURE_REASONS.INTERNAL_ERROR,
      } as never),
    ).rejects.toThrow();

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("異常系: 失敗イベントにfailureReasonがない場合はDB書込み前に拒否する", async () => {
    const eventWithoutReason: Record<string, unknown> = { ...failureEvent };
    delete eventWithoutReason.failureReason;

    await expect(recordAuditEvent(prisma, eventWithoutReason as never)).rejects.toThrow();

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "targetTypeのみ",
      event: { ...successEvent, targetId: null },
    },
    {
      name: "targetIdのみ",
      event: { ...successEvent, targetType: null },
    },
  ])("異常系: $nameの対象指定は拒否する", async ({ event }) => {
    await expect(recordAuditEvent(prisma, event as never)).rejects.toThrow();

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "未定義action",
      event: { ...successEvent, action: "UNKNOWN_ACTION" },
    },
    {
      name: "未定義targetType",
      event: { ...successEvent, targetType: "UNKNOWN_TARGET" },
    },
    {
      name: "未定義failureReason",
      event: { ...failureEvent, failureReason: "UNKNOWN_REASON" },
    },
  ])("異常系: $nameは拒否する", async ({ event }) => {
    await expect(recordAuditEvent(prisma, event as never)).rejects.toThrow();

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    "password",
    "passwordHash",
    "email",
    "token",
    "tokenHash",
    "Cookie",
    "Authorization",
    "body",
    "headers",
    "error",
    "metadata",
    "occurredAt",
  ])("セキュリティ: 禁止項目 %s が追加されたイベントを拒否する", async (key) => {
    const eventWithForbiddenField = {
      ...successEvent,
      [key]: "保存禁止値",
    };

    await expect(recordAuditEvent(prisma, eventWithForbiddenField as never)).rejects.toThrow();

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("recordAuditEventBestEffort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("正常系: 保存成功時はtrueを返す", async () => {
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await expect(recordAuditEventBestEffort(failureEvent)).resolves.toBe(true);
  });

  it("異常系: 保存失敗時はraw errorを出力せずfalseを返す", async () => {
    const databaseError = new Error("DATABASE_URL=secret@example.com");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(prisma.auditLog.create).mockRejectedValue(databaseError);

    await expect(recordAuditEventBestEffort(failureEvent)).resolves.toBe(false);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[audit] 監査ログの保存に失敗しました: action=LOGIN result=FAILURE",
    );
    expect(consoleErrorSpy.mock.calls.flat()).not.toContain(databaseError);

    consoleErrorSpy.mockRestore();
  });
});
