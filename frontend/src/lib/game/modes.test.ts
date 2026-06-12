import { describe, expect, it } from 'vitest';
import { MIN_WEAK_ELEMENTS_FOR_GAME } from '$lib/game/constants';
import {
  canStartGameMode,
  GAME_MODE_CONFIGS,
  getGameModeConfig,
  getGameModeGuardMessage,
  getGameModeStartAvailability,
  isWeakGameMode
} from '$lib/game/modes';
import type { GameMode } from '$lib/game/types';

const ALL_GAME_MODES: GameMode[] = [
  'SYMBOL_TO_NAME_LV1',
  'SYMBOL_TO_NAME_LV2',
  'NAME_TO_SYMBOL_LV1',
  'NAME_TO_SYMBOL_LV2',
  'WEAK_SYMBOL_TO_NAME',
  'WEAK_NAME_TO_SYMBOL'
];
const INSUFFICIENT_WEAK_COUNT = MIN_WEAK_ELEMENTS_FOR_GAME - 1;
const INSUFFICIENT_WEAK_GUARD_MESSAGE = `苦手モードを始めるには、苦手元素が${MIN_WEAK_ELEMENTS_FOR_GAME}件以上必要です。現在は${INSUFFICIENT_WEAK_COUNT}件です。`;

describe('GAME_MODE_CONFIGS', () => {
  it('6種類のゲームモードを重複なく定義している', () => {
    const modes = GAME_MODE_CONFIGS.map((config) => config.mode);

    expect(modes).toHaveLength(6);
    expect(new Set(modes).size).toBe(6);
    expect(modes).toEqual(ALL_GAME_MODES);
  });

  it('全モードにカード表示に必要な文言が定義されている', () => {
    for (const config of GAME_MODE_CONFIGS) {
      expect(config.title).not.toBe('');
      expect(config.description).not.toBe('');
      expect(config.formatLabel).not.toBe('');
      expect(config.difficultyLabel).not.toBe('');
      expect(config.rangeLabel).not.toBe('');
    }
  });
});

describe('getGameModeConfig', () => {
  it('指定したモードの設定を返す', () => {
    expect(getGameModeConfig('SYMBOL_TO_NAME_LV1')).toMatchObject({
      mode: 'SYMBOL_TO_NAME_LV1',
      formatLabel: '記号 → 名前',
      difficultyLabel: '初級',
      rangeLabel: '1〜20番'
    });
  });
});

describe('isWeakGameMode', () => {
  it('通常モードでは false を返す', () => {
    expect(isWeakGameMode('SYMBOL_TO_NAME_LV1')).toBe(false);
    expect(isWeakGameMode('NAME_TO_SYMBOL_LV2')).toBe(false);
  });

  it('苦手モードでは true を返す', () => {
    expect(isWeakGameMode('WEAK_SYMBOL_TO_NAME')).toBe(true);
    expect(isWeakGameMode('WEAK_NAME_TO_SYMBOL')).toBe(true);
  });
});

describe('canStartGameMode', () => {
  it('通常モードは weakCount に関係なく開始できる', () => {
    expect(canStartGameMode('SYMBOL_TO_NAME_LV1', null)).toBe(true);
    expect(canStartGameMode('SYMBOL_TO_NAME_LV1', 0)).toBe(true);
    expect(canStartGameMode('NAME_TO_SYMBOL_LV2', INSUFFICIENT_WEAK_COUNT)).toBe(true);
  });

  it('苦手モードは weakCount が null の場合は開始できない', () => {
    expect(canStartGameMode('WEAK_SYMBOL_TO_NAME', null)).toBe(false);
  });

  it('苦手モードは必要件数未満では開始できない', () => {
    expect(canStartGameMode('WEAK_SYMBOL_TO_NAME', INSUFFICIENT_WEAK_COUNT)).toBe(false);
  });

  it('苦手モードは必要件数以上なら開始できる', () => {
    expect(canStartGameMode('WEAK_SYMBOL_TO_NAME', MIN_WEAK_ELEMENTS_FOR_GAME)).toBe(true);
    expect(canStartGameMode('WEAK_NAME_TO_SYMBOL', MIN_WEAK_ELEMENTS_FOR_GAME + 1)).toBe(true);
  });
});

describe('getGameModeGuardMessage', () => {
  it('通常モードでは null を返す', () => {
    expect(getGameModeGuardMessage('SYMBOL_TO_NAME_LV1', null)).toBeNull();
  });

  it('苦手件数を確認できない場合は日本語のガード文言を返す', () => {
    expect(getGameModeGuardMessage('WEAK_SYMBOL_TO_NAME', null)).toBe(
      '苦手元素数を確認できないため、苦手モードを開始できません。'
    );
  });

  it('苦手件数が不足している場合は現在件数を含むガード文言を返す', () => {
    expect(getGameModeGuardMessage('WEAK_SYMBOL_TO_NAME', INSUFFICIENT_WEAK_COUNT)).toBe(
      INSUFFICIENT_WEAK_GUARD_MESSAGE
    );
  });

  it('苦手件数が足りている場合は null を返す', () => {
    expect(getGameModeGuardMessage('WEAK_SYMBOL_TO_NAME', MIN_WEAK_ELEMENTS_FOR_GAME)).toBeNull();
  });
});

describe('getGameModeStartAvailability', () => {
  it('開始可能な場合は canStart true と guardMessage null を返す', () => {
    expect(getGameModeStartAvailability('SYMBOL_TO_NAME_LV1', null)).toEqual({
      canStart: true,
      guardMessage: null
    });
  });

  it('開始不可の場合は canStart false と guardMessage を返す', () => {
    expect(getGameModeStartAvailability('WEAK_NAME_TO_SYMBOL', INSUFFICIENT_WEAK_COUNT)).toEqual({
      canStart: false,
      guardMessage: INSUFFICIENT_WEAK_GUARD_MESSAGE
    });
  });
});
