-- Game history and mastery aggregation indexes.
-- - game_sessions_userId_playedAt_id_idx supports per-user history and mastery scans.
-- - game_answers_sessionId_elementId_idx supports nested answer lookups by session and element.
-- - game_question_sets_expiresAt_idx supports future expired question-set cleanup.

CREATE INDEX "game_sessions_userId_playedAt_id_idx" ON "game_sessions"("userId", "playedAt", "id");

CREATE INDEX "game_answers_sessionId_elementId_idx" ON "game_answers"("sessionId", "elementId");

CREATE INDEX "game_question_sets_expiresAt_idx" ON "game_question_sets"("expiresAt");
