-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_tokenHash_idx" ON "refresh_tokens"("expiresAt", "tokenHash");
