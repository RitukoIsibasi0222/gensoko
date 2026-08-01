export type CategoryStyle = {
  cardClass: string;
  badgeClass: string;
};

const FALLBACK_STYLE: CategoryStyle = {
  cardClass: 'border-category-fallback-border bg-category-fallback-surface',
  badgeClass: 'bg-category-fallback-badge text-category-fallback-text'
};

export const ELEMENT_CATEGORY_STYLE_MAP: Readonly<Record<string, CategoryStyle>> = {
  非金属: {
    cardClass: 'border-category-nonmetal-border bg-category-nonmetal-surface',
    badgeClass: 'bg-category-nonmetal-badge text-category-nonmetal-text'
  },
  希ガス: {
    cardClass: 'border-category-noble-gas-border bg-category-noble-gas-surface',
    badgeClass: 'bg-category-noble-gas-badge text-category-noble-gas-text'
  },
  アルカリ金属: {
    cardClass: 'border-category-alkali-metal-border bg-category-alkali-metal-surface',
    badgeClass: 'bg-category-alkali-metal-badge text-category-alkali-metal-text'
  },
  アルカリ土類金属: {
    cardClass: 'border-category-alkaline-earth-border bg-category-alkaline-earth-surface',
    badgeClass: 'bg-category-alkaline-earth-badge text-category-alkaline-earth-text'
  },
  遷移金属: {
    cardClass: 'border-category-transition-metal-border bg-category-transition-metal-surface',
    badgeClass: 'bg-category-transition-metal-badge text-category-transition-metal-text'
  },
  後遷移金属: {
    cardClass: 'border-category-post-transition-border bg-category-post-transition-surface',
    badgeClass: 'bg-category-post-transition-badge text-category-post-transition-text'
  },
  半金属: {
    cardClass: 'border-category-metalloid-border bg-category-metalloid-surface',
    badgeClass: 'bg-category-metalloid-badge text-category-metalloid-text'
  },
  ハロゲン: {
    cardClass: 'border-category-halogen-border bg-category-halogen-surface',
    badgeClass: 'bg-category-halogen-badge text-category-halogen-text'
  },
  ランタノイド: {
    cardClass: 'border-category-lanthanide-border bg-category-lanthanide-surface',
    badgeClass: 'bg-category-lanthanide-badge text-category-lanthanide-text'
  },
  アクチノイド: {
    cardClass: 'border-category-actinide-border bg-category-actinide-surface',
    badgeClass: 'bg-category-actinide-badge text-category-actinide-text'
  }
};

export function getElementCategoryStyle(category: string): CategoryStyle {
  return ELEMENT_CATEGORY_STYLE_MAP[category] ?? FALLBACK_STYLE;
}
