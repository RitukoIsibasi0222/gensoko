-- Persist the fields required to restore /game/result after reload.
-- Existing answers remain valid; nullable columns allow legacy sessions to use fallback display.

ALTER TABLE "game_answers"
  ADD COLUMN "questionIndex" INTEGER,
  ADD COLUMN "questionId" TEXT,
  ADD COLUMN "prompt" TEXT,
  ADD COLUMN "chosenChoiceId" TEXT,
  ADD COLUMN "correctAnswer" TEXT,
  ADD COLUMN "yourAnswer" TEXT,
  ADD COLUMN "score" INTEGER;

CREATE INDEX "game_answers_sessionId_questionIndex_idx" ON "game_answers"("sessionId", "questionIndex");
