import { MIN_WEAK_ELEMENTS_FOR_GAME } from '$lib/game/constants';
import type { GameMode, GameModeConfig, GameModeStartAvailability } from '$lib/game/types';

export const GAME_MODE_CONFIGS: readonly GameModeConfig[] = [
  {
    mode: 'SYMBOL_TO_NAME_LV1',
    title: '記号から名前',
    description: '元素記号を見て、日本語名を選びます。',
    formatLabel: '記号 → 名前',
    difficultyLabel: '初級',
    rangeLabel: '1〜20番',
    requiresWeakElements: false
  },
  {
    mode: 'SYMBOL_TO_NAME_LV2',
    title: '記号から名前',
    description: '元素記号を見て、日本語名を選びます。',
    formatLabel: '記号 → 名前',
    difficultyLabel: '上級',
    rangeLabel: '21〜118番',
    requiresWeakElements: false
  },
  {
    mode: 'NAME_TO_SYMBOL_LV1',
    title: '名前から記号',
    description: '日本語名を見て、元素記号を選びます。',
    formatLabel: '名前 → 記号',
    difficultyLabel: '初級',
    rangeLabel: '1〜20番',
    requiresWeakElements: false
  },
  {
    mode: 'NAME_TO_SYMBOL_LV2',
    title: '名前から記号',
    description: '日本語名を見て、元素記号を選びます。',
    formatLabel: '名前 → 記号',
    difficultyLabel: '上級',
    rangeLabel: '21〜118番',
    requiresWeakElements: false
  },
  {
    mode: 'WEAK_SYMBOL_TO_NAME',
    title: '苦手: 記号から名前',
    description: '苦手リストの元素記号を見て、日本語名を選びます。',
    formatLabel: '記号 → 名前',
    difficultyLabel: '苦手',
    rangeLabel: '苦手リスト',
    requiresWeakElements: true
  },
  {
    mode: 'WEAK_NAME_TO_SYMBOL',
    title: '苦手: 名前から記号',
    description: '苦手リストの日本語名を見て、元素記号を選びます。',
    formatLabel: '名前 → 記号',
    difficultyLabel: '苦手',
    rangeLabel: '苦手リスト',
    requiresWeakElements: true
  }
];

export function getGameModeConfig(mode: GameMode): GameModeConfig {
  const config = GAME_MODE_CONFIGS.find((item) => item.mode === mode);
  if (config === undefined) {
    throw new Error(`未定義のゲームモードです: ${mode}`);
  }

  return config;
}

export function isWeakGameMode(mode: GameMode): boolean {
  return getGameModeConfig(mode).requiresWeakElements;
}

export function canStartGameMode(mode: GameMode, weakCount: number | null): boolean {
  return getGameModeGuardMessage(mode, weakCount) === null;
}

export function getGameModeGuardMessage(mode: GameMode, weakCount: number | null): string | null {
  if (!isWeakGameMode(mode)) {
    return null;
  }

  if (weakCount === null) {
    return '苦手元素数を確認できないため、苦手モードを開始できません。';
  }

  if (weakCount < MIN_WEAK_ELEMENTS_FOR_GAME) {
    return `苦手モードを始めるには、苦手元素が${MIN_WEAK_ELEMENTS_FOR_GAME}件以上必要です。現在は${weakCount}件です。`;
  }

  return null;
}

export function getGameModeStartAvailability(
  mode: GameMode,
  weakCount: number | null
): GameModeStartAvailability {
  const guardMessage = getGameModeGuardMessage(mode, weakCount);

  return {
    canStart: guardMessage === null,
    guardMessage
  };
}
