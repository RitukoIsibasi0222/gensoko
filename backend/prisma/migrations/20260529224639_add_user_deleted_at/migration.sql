-- 監査用途のソフト削除カラムを users に追加
ALTER TABLE "users"
ADD COLUMN "deleted_at" TIMESTAMP(3);
