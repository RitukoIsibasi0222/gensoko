export type ElementMasteryStatus = 'unlearned' | 'learning' | 'mastered';

export type Element = {
  id: number;
  symbol: string;
  nameJa: string;
  nameEn: string;
  category: string;
  period: number;
  group: number | null;
  atomicWeight: number | null;
  etymology: string | null;
  masteryStatus?: ElementMasteryStatus;
};
