-- This contract migration is intentionally excluded from prisma/migrations.
-- Apply only after the release gates documented in the account deletion plan are complete.
BEGIN;

-- Close the guard-to-DDL race before inspecting legacy rows.
LOCK TABLE "users" IN ACCESS EXCLUSIVE MODE;

DO $account_deletion_contract$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "users"
    WHERE "deletedAt" IS NOT NULL
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'account deletion contract guard failed';
  END IF;
END
$account_deletion_contract$;

DROP INDEX "users_deletedAt_id_idx";
ALTER TABLE "users" DROP COLUMN "deletedAt";

COMMIT;
