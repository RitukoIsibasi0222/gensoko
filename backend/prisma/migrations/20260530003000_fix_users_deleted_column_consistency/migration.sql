-- users.deleted_at / users."deletedAt" の揺れを吸収して最終状態を統一する
DO $$
BEGIN
  -- 既存環境で両カラムが存在する場合は snake_case 側を削除する
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'deleted_at'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'deletedAt'
  ) THEN
    ALTER TABLE "users" DROP COLUMN "deleted_at";
  ELSIF EXISTS (
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
  ELSIF NOT EXISTS (
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
    ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);
  END IF;
END
$$;