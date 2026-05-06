/*
  Warnings:

  - The primary key for the `refresh_tokens` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `refresh_tokens` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_pkey",
DROP COLUMN "id";

-- CreateTable
CREATE TABLE "email_verifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_verifications_tokenHash_key" ON "email_verifications"("tokenHash");

-- AddForeignKey
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
