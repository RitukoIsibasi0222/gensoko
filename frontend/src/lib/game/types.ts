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
