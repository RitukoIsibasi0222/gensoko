-- Add indexes for ranking lookups.
-- These support Top50 ranking queries and myRank score counts.

CREATE INDEX "user_stats_weeklyScore_idx" ON "user_stats"("weeklyScore" DESC);

CREATE INDEX "user_stats_allTimeScore_idx" ON "user_stats"("allTimeScore" DESC);
