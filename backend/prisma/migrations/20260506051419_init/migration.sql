-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('SYMBOL_TO_NAME_LV1', 'SYMBOL_TO_NAME_LV2', 'NAME_TO_SYMBOL_LV1', 'NAME_TO_SYMBOL_LV2', 'WEAK_SYMBOL_TO_NAME', 'WEAK_NAME_TO_SYMBOL');

-- CreateTable
CREATE TABLE "elements" (
    "id" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "nameJa" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "period" INTEGER NOT NULL,
    "group" INTEGER,
    "atomicWeight" DOUBLE PRECISION,

    CONSTRAINT "elements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "loginFailCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weak_elements" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "elementId" INTEGER NOT NULL,
    "missCount" INTEGER NOT NULL DEFAULT 1,
    "consecutiveHit" INTEGER NOT NULL DEFAULT 0,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weak_elements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "GameMode" NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "correctCount" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL DEFAULT 10,
    "maxStreak" INTEGER NOT NULL DEFAULT 0,
    "durationSec" INTEGER NOT NULL,
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_answers" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "elementId" INTEGER NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "answerTimeSec" INTEGER NOT NULL,

    CONSTRAINT "game_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_stats" (
    "userId" TEXT NOT NULL,
    "totalGames" INTEGER NOT NULL DEFAULT 0,
    "totalCorrect" INTEGER NOT NULL DEFAULT 0,
    "totalAnswered" INTEGER NOT NULL DEFAULT 0,
    "masteredCount" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "lastActiveDate" TIMESTAMP(3),
    "weeklyScore" INTEGER NOT NULL DEFAULT 0,
    "allTimeScore" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_stats_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "elements_symbol_key" ON "elements"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "weak_elements_userId_elementId_key" ON "weak_elements"("userId", "elementId");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weak_elements" ADD CONSTRAINT "weak_elements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weak_elements" ADD CONSTRAINT "weak_elements_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "elements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_answers" ADD CONSTRAINT "game_answers_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_answers" ADD CONSTRAINT "game_answers_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "elements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
