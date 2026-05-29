-- users.deleted_at（過去マイグレーション）を users."deletedAt" に統一する
-- 既に renamed 済みの環境では no-op になるように条件分岐する
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'deleted_at'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'deletedAt'
  ) THEN
    ALTER TABLE "users" RENAME COLUMN "deleted_at" TO "deletedAt";
  END IF;
END
$$;