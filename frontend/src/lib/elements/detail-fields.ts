import type { Element } from '$lib/elements/types';

export type ElementDetailFieldKey = 'period' | 'group' | 'atomicWeight' | 'etymology';

export type ElementDetailField = {
  key: ElementDetailFieldKey;
  label: string;
  value: string;
};

function formatNullableNumber(value: number | null): string {
  return value === null ? '未設定' : String(value);
}

function formatEtymology(value: string | null): string {
  if (value === null || value.trim() === '') {
    return '情報なし';
  }

  return value;
}

export function buildElementDetailFields(element: Element): ElementDetailField[] {
  return [
    { key: 'period', label: '周期', value: String(element.period) },
    { key: 'group', label: '族', value: formatNullableNumber(element.group) },
    {
      key: 'atomicWeight',
      label: '原子量',
      value: formatNullableNumber(element.atomicWeight)
    },
    { key: 'etymology', label: '由来', value: formatEtymology(element.etymology) }
  ];
}
