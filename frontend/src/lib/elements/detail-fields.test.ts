import { describe, expect, it } from 'vitest';
import type { Element } from '$lib/elements/types';
import { buildElementDetailFields } from '$lib/elements/detail-fields';

function createElement(overrides: Partial<Element> = {}): Element {
  return {
    id: 1,
    symbol: 'H',
    nameJa: '水素',
    nameEn: 'Hydrogen',
    category: '非金属',
    period: 1,
    group: 1,
    atomicWeight: 1.008,
    etymology: 'ギリシャ語のhydro-（水）に由来',
    ...overrides
  };
}

describe('buildElementDetailFields', () => {
  it('周期→族→原子量→由来の順で返す', () => {
    const fields = buildElementDetailFields(createElement());

    expect(fields).toEqual([
      { key: 'period', label: '周期', value: '1' },
      { key: 'group', label: '族', value: '1' },
      { key: 'atomicWeight', label: '原子量', value: '1.008' },
      { key: 'etymology', label: '由来', value: 'ギリシャ語のhydro-（水）に由来' }
    ]);
  });

  it('group が null のとき 未設定 を返す', () => {
    const fields = buildElementDetailFields(createElement({ group: null }));
    expect(fields.find((field) => field.key === 'group')?.value).toBe('未設定');
  });

  it('atomicWeight が null のとき 未設定 を返す', () => {
    const fields = buildElementDetailFields(createElement({ atomicWeight: null }));
    expect(fields.find((field) => field.key === 'atomicWeight')?.value).toBe('未設定');
  });

  it('etymology が null のとき 情報なし を返す', () => {
    const fields = buildElementDetailFields(createElement({ etymology: null }));
    expect(fields.find((field) => field.key === 'etymology')?.value).toBe('情報なし');
  });

  it('etymology が空白のみのとき 情報なし を返す', () => {
    const fields = buildElementDetailFields(createElement({ etymology: '   ' }));
    expect(fields.find((field) => field.key === 'etymology')?.value).toBe('情報なし');
  });
});
