-- CreateIndex
CREATE INDEX CONCURRENTLY "refresh_tokens_expiresAt_tokenHash_idx" ON "refresh_tokens"("expiresAt", "tokenHash");
