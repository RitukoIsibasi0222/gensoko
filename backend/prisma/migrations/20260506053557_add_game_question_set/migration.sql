-- CreateTable
CREATE TABLE "game_question_sets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "GameMode" NOT NULL,
    "questions" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_question_sets_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "game_question_sets" ADD CONSTRAINT "game_question_sets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
