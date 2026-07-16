-- Expand-only indexes for live account deletion and legacy soft-delete cleanup.
-- These indexes are compatible with the existing soft-delete application version.

CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

CREATE INDEX "email_verifications_userId_idx" ON "email_verifications"("userId");

CREATE INDEX "game_question_sets_userId_idx" ON "game_question_sets"("userId");

CREATE INDEX "users_deletedAt_id_idx" ON "users"("deletedAt", "id");
