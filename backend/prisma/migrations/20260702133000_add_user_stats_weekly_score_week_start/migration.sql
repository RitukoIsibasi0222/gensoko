-- Track which week the denormalized weekly score belongs to.
-- A NULL value means the row was created before this migration and should be normalized by the reset job.

ALTER TABLE "user_stats"
ADD COLUMN "weeklyScoreWeekStart" TIMESTAMP(3);

CREATE INDEX "user_stats_weeklyScoreWeekStart_weeklyScore_idx"
ON "user_stats"("weeklyScoreWeekStart", "weeklyScore" DESC);
