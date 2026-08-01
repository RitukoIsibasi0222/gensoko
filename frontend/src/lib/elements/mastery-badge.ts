import type { ElementMasteryStatus } from '$lib/elements/types';

export type MasteryBadgeView = {
  label: string;
  className: string;
  ariaLabel: string;
};

const MASTERY_BADGE_VIEW_MAP: Readonly<Record<ElementMasteryStatus, MasteryBadgeView>> = {
  unlearned: {
    label: '未学習',
    className: 'bg-surface-subtle text-text-muted ring-border',
    ariaLabel: '習得状態: 未学習'
  },
  learning: {
    label: '学習中',
    className: 'bg-warning-surface-strong text-warning-text ring-warning-border',
    ariaLabel: '習得状態: 学習中'
  },
  mastered: {
    label: '習得',
    className: 'bg-success-surface-strong text-success-text ring-success-border',
    ariaLabel: '習得状態: 習得'
  }
};

export function getElementMasteryBadgeView(status: ElementMasteryStatus): MasteryBadgeView {
  return MASTERY_BADGE_VIEW_MAP[status];
}
