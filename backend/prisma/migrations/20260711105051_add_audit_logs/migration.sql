-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "result" "AuditResult" NOT NULL,
    "actorId" TEXT,
    "actorRole" "Role",
    "targetType" TEXT,
    "targetId" TEXT,
    "failureReason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_occurredAt_id_idx" ON "audit_logs"("occurredAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_occurredAt_idx" ON "audit_logs"("action", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_occurredAt_idx" ON "audit_logs"("targetType", "targetId", "occurredAt" DESC);
