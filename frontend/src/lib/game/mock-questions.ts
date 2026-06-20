import { GAME_QUESTION_COUNT } from '$lib/game/constants';
import type { GameMode, MockGamePlayQuestion } from '$lib/game/types';

const GAME_CHOICE_COUNT = 4;

type MockElement = {
  id: number;
  symbol: string;
  nameJa: string;
};

const LV1_ELEMENTS: readonly MockElement[] = [
  { id: 1, symbol: 'H', nameJa: '水素' },
  { id: 2, symbol: 'He', nameJa: 'ヘリウム' },
  { id: 3, symbol: 'Li', nameJa: 'リチウム' },
  { id: 4, symbol: 'Be', nameJa: 'ベリリウム' },
  { id: 5, symbol: 'B', nameJa: 'ホウ素' },
  { id: 6, symbol: 'C', nameJa: '炭素' },
  { id: 7, symbol: 'N', nameJa: '窒素' },
  { id: 8, symbol: 'O', nameJa: '酸素' },
  { id: 9, symbol: 'F', nameJa: 'フッ素' },
  { id: 10, symbol: 'Ne', nameJa: 'ネオン' }
];

const LV2_ELEMENTS: readonly MockElement[] = [
  { id: 21, symbol: 'Sc', nameJa: 'スカンジウム' },
  { id: 22, symbol: 'Ti', nameJa: 'チタン' },
  { id: 23, symbol: 'V', nameJa: 'バナジウム' },
  { id: 24, symbol: 'Cr', nameJa: 'クロム' },
  { id: 25, symbol: 'Mn', nameJa: 'マンガン' },
  { id: 26, symbol: 'Fe', nameJa: '鉄' },
  { id: 27, symbol: 'Co', nameJa: 'コバルト' },
  { id: 28, symbol: 'Ni', nameJa: 'ニッケル' },
  { id: 29, symbol: 'Cu', nameJa: '銅' },
  { id: 30, symbol: 'Zn', nameJa: '亜鉛' }
];

const WEAK_ELEMENTS: readonly MockElement[] = [
  { id: 26, symbol: 'Fe', nameJa: '鉄' },
  { id: 29, symbol: 'Cu', nameJa: '銅' },
  { id: 47, symbol: 'Ag', nameJa: '銀' },
  { id: 50, symbol: 'Sn', nameJa: 'スズ' },
  { id: 53, symbol: 'I', nameJa: 'ヨウ素' },
  { id: 56, symbol: 'Ba', nameJa: 'バリウム' },
  { id: 74, symbol: 'W', nameJa: 'タングステン' },
  { id: 78, symbol: 'Pt', nameJa: '白金' },
  { id: 79, symbol: 'Au', nameJa: '金' },
  { id: 80, symbol: 'Hg', nameJa: '水銀' }
];

function getModeElements(mode: GameMode): readonly MockElement[] {
  if (mode === 'SYMBOL_TO_NAME_LV1' || mode === 'NAME_TO_SYMBOL_LV1') {
    return LV1_ELEMENTS;
  }

  if (mode === 'WEAK_SYMBOL_TO_NAME' || mode === 'WEAK_NAME_TO_SYMBOL') {
    return WEAK_ELEMENTS;
  }

  return LV2_ELEMENTS;
}

function isNameToSymbolMode(mode: GameMode): boolean {
  return (
    mode === 'NAME_TO_SYMBOL_LV1' || mode === 'NAME_TO_SYMBOL_LV2' || mode === 'WEAK_NAME_TO_SYMBOL'
  );
}

function getChoices(
  elements: readonly MockElement[],
  correctElement: MockElement,
  answerWithSymbol: boolean,
  correctPosition: number
) {
  if (
    !Number.isInteger(correctPosition) ||
    correctPosition < 0 ||
    correctPosition >= GAME_CHOICE_COUNT
  ) {
    throw new Error('選択肢を生成できません');
  }

  const distractors = elements.filter((element) => element.id !== correctElement.id).slice(0, 3);
  const choices = [...distractors];
  choices.splice(correctPosition, 0, correctElement);

  return choices.map((element) => ({
    choiceId: String(element.id),
    text: answerWithSymbol ? element.symbol : element.nameJa
  }));
}

function getRandomChoiceIndex(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);

  return values[0] % GAME_CHOICE_COUNT;
}

export function getMockGameQuestions(
  mode: GameMode,
  choiceIndexGenerator = getRandomChoiceIndex
): readonly MockGamePlayQuestion[] {
  const elements = getModeElements(mode);
  const answerWithSymbol = isNameToSymbolMode(mode);

  return elements.slice(0, GAME_QUESTION_COUNT).map((element) => ({
    questionId: `${mode}-${element.id}`,
    prompt: answerWithSymbol ? element.nameJa : element.symbol,
    correctChoiceId: String(element.id),
    choices: getChoices(elements, element, answerWithSymbol, choiceIndexGenerator())
  }));
}
