export type CategoryStyle = {
  cardClass: string;
  badgeClass: string;
};

const FALLBACK_STYLE: CategoryStyle = {
  cardClass: 'border-slate-200 bg-slate-50',
  badgeClass: 'bg-slate-200 text-slate-700'
};

export const ELEMENT_CATEGORY_STYLE_MAP: Readonly<Record<string, CategoryStyle>> = {
  非金属: {
    cardClass: 'border-emerald-200 bg-emerald-50',
    badgeClass: 'bg-emerald-200 text-emerald-800'
  },
  希ガス: {
    cardClass: 'border-sky-200 bg-sky-50',
    badgeClass: 'bg-sky-200 text-sky-800'
  },
  アルカリ金属: {
    cardClass: 'border-rose-200 bg-rose-50',
    badgeClass: 'bg-rose-200 text-rose-800'
  },
  アルカリ土類金属: {
    cardClass: 'border-orange-200 bg-orange-50',
    badgeClass: 'bg-orange-200 text-orange-800'
  },
  遷移金属: {
    cardClass: 'border-amber-200 bg-amber-50',
    badgeClass: 'bg-amber-200 text-amber-800'
  },
  後遷移金属: {
    cardClass: 'border-teal-200 bg-teal-50',
    badgeClass: 'bg-teal-200 text-teal-800'
  },
  半金属: {
    cardClass: 'border-lime-200 bg-lime-50',
    badgeClass: 'bg-lime-200 text-lime-800'
  },
  ハロゲン: {
    cardClass: 'border-fuchsia-200 bg-fuchsia-50',
    badgeClass: 'bg-fuchsia-200 text-fuchsia-800'
  },
  ランタノイド: {
    cardClass: 'border-violet-200 bg-violet-50',
    badgeClass: 'bg-violet-200 text-violet-800'
  },
  アクチノイド: {
    cardClass: 'border-indigo-200 bg-indigo-50',
    badgeClass: 'bg-indigo-200 text-indigo-800'
  }
};

export function getElementCategoryStyle(category: string): CategoryStyle {
  return ELEMENT_CATEGORY_STYLE_MAP[category] ?? FALLBACK_STYLE;
}
