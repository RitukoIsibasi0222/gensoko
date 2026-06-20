import { describe, expect, it } from 'vitest';
import { getMockGameQuestions } from './mock-questions';

function createChoiceIndexGenerator(indexes: readonly number[]): () => number {
  let currentIndex = 0;

  return () => {
    const choiceIndex = indexes[currentIndex % indexes.length];
    currentIndex += 1;

    return choiceIndex;
  };
}

describe('getMockGameQuestions', () => {
  it('デフォルト生成はSSR/CSRで一致する決定的な並びにする', () => {
    const firstQuestions = getMockGameQuestions('SYMBOL_TO_NAME_LV1');
    const secondQuestions = getMockGameQuestions('SYMBOL_TO_NAME_LV1');

    expect(firstQuestions).toEqual(secondQuestions);
  });

  it('デフォルト生成は問題番号と同じ順番の正解位置に固定しない', () => {
    const questions = getMockGameQuestions('SYMBOL_TO_NAME_LV1');
    const correctChoiceIndexes = questions.slice(0, 4).map((question) => {
      return question.choices.findIndex((choice) => choice.choiceId === question.correctChoiceId);
    });

    expect(correctChoiceIndexes).not.toEqual([0, 1, 2, 3]);
  });

  it('注入された正解位置に従って4択を生成する', () => {
    const questions = getMockGameQuestions(
      'SYMBOL_TO_NAME_LV1',
      createChoiceIndexGenerator([3, 2, 1, 0])
    );

    const correctChoiceIndexes = questions.slice(0, 4).map((question) => {
      return question.choices.findIndex((choice) => choice.choiceId === question.correctChoiceId);
    });

    expect(correctChoiceIndexes).toEqual([3, 2, 1, 0]);
  });

  it('正解位置が範囲外の場合はエラーにする', () => {
    expect(() => {
      getMockGameQuestions('SYMBOL_TO_NAME_LV1', () => 4);
    }).toThrow('選択肢を生成できません');
  });
});
