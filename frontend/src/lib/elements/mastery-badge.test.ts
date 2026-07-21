import { describe, expect, it } from 'vitest';
import { getElementMasteryBadgeView } from '$lib/elements/mastery-badge';

describe('getElementMasteryBadgeView', () => {
  it('unlearned の表示設定を返す', () => {
    expect(getElementMasteryBadgeView('unlearned')).toEqual({
      label: '未学習',
      className: 'bg-surface-subtle text-text-muted ring-border',
      ariaLabel: '習得状態: 未学習'
    });
  });

  it('learning の表示設定を返す', () => {
    expect(getElementMasteryBadgeView('learning')).toEqual({
      label: '学習中',
      className: 'bg-warning-surface-strong text-warning-text ring-warning-border',
      ariaLabel: '習得状態: 学習中'
    });
  });

  it('mastered の表示設定を返す', () => {
    expect(getElementMasteryBadgeView('mastered')).toEqual({
      label: '習得',
      className: 'bg-success-surface-strong text-success-text ring-success-border',
      ariaLabel: '習得状態: 習得'
    });
  });
});
