-- 監査用途のソフト削除カラムを users に追加
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
