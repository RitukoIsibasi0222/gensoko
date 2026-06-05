import type { ElementMasteryStatus } from '$lib/elements/types';

export type MasteryBadgeView = {
  label: string;
  className: string;
  ariaLabel: string;
};

const MASTERY_BADGE_VIEW_MAP: Readonly<Record<ElementMasteryStatus, MasteryBadgeView>> = {
  unlearned: {
    label: '未学習',
    className: 'bg-slate-100 text-slate-700 ring-slate-200',
    ariaLabel: '習得状態: 未学習'
  },
  learning: {
    label: '学習中',
    className: 'bg-amber-100 text-amber-800 ring-amber-200',
    ariaLabel: '習得状態: 学習中'
  },
  mastered: {
    label: '習得',
    className: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
    ariaLabel: '習得状態: 習得'
  }
};

export function getElementMasteryBadgeView(status: ElementMasteryStatus): MasteryBadgeView {
  return MASTERY_BADGE_VIEW_MAP[status];
}
