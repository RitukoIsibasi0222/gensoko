import { describe, expect, it } from 'vitest';
import { getElementMasteryBadgeView } from '$lib/elements/mastery-badge';

describe('getElementMasteryBadgeView', () => {
  it('unlearned の表示設定を返す', () => {
    expect(getElementMasteryBadgeView('unlearned')).toEqual({
      label: '未学習',
      className: 'bg-slate-100 text-slate-700 ring-slate-200',
      ariaLabel: '習得状態: 未学習'
    });
  });

  it('learning の表示設定を返す', () => {
    expect(getElementMasteryBadgeView('learning')).toEqual({
      label: '学習中',
      className: 'bg-amber-100 text-amber-800 ring-amber-200',
      ariaLabel: '習得状態: 学習中'
    });
  });

  it('mastered の表示設定を返す', () => {
    expect(getElementMasteryBadgeView('mastered')).toEqual({
      label: '習得',
      className: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
      ariaLabel: '習得状態: 習得'
    });
  });
});
