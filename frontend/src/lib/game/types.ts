export type GameMode =
  | 'SYMBOL_TO_NAME_LV1'
  | 'SYMBOL_TO_NAME_LV2'
  | 'NAME_TO_SYMBOL_LV1'
  | 'NAME_TO_SYMBOL_LV2'
  | 'WEAK_SYMBOL_TO_NAME'
  | 'WEAK_NAME_TO_SYMBOL';

export type GameModeConfig = {
  mode: GameMode;
  title: string;
  description: string;
  formatLabel: string;
  difficultyLabel: string;
  rangeLabel: string;
  requiresWeakElements: boolean;
};

export type GameModeStartAvailability = {
  canStart: boolean;
  guardMessage: string | null;
};

export type GameModeStartHandler = (mode: GameMode) => void;

export type GameChoice = {
  choiceId: string;
  text: string;
};

export type GamePlayQuestion = {
  questionId: string;
  prompt: string;
  choices: readonly GameChoice[];
};

export type GameQuestionsResponse = {
  questionSetId: string;
  expiresAt: string;
  questions: readonly GameApiQuestion[];
};

export type GameApiQuestion = GamePlayQuestion;

export type GameSessionAnswerDraft = {
  questionId: string;
  chosenChoiceId: string | null;
  answerTimeSec: number;
};

export type MockGamePlayQuestion = GamePlayQuestion & {
  correctChoiceId: string;
};

export type GameAnswerDraft = {
  questionId: string;
  chosenChoiceId: string | null;
  answerTimeSec: number;
  isCorrect: boolean;
  timedOut: boolean;
};

export type GamePlayPhase = 'answering' | 'feedback' | 'completed';

export type GameChoiceHandler = (choiceId: string) => void;
