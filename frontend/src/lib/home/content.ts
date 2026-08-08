import type { RankingEntry } from '$lib/api/ranking';
import type { AuthStatus } from '$lib/stores/auth.svelte';

export type TopPageAudience = AuthStatus;

export type HomeRankingPreviewEntry = {
  rank: number;
  username: string;
  weeklyScore: number;
  totalGames: number;
};

export type TopPageCta = {
  href: string;
  label: string;
  description: string;
  disabled: boolean;
};

const DEFAULT_PREVIEW_LIMIT = 3;

export const HOME_HERO_TITLE = '元素を、遊んで覚える。';
export const HOME_HERO_DESCRIPTION = '遊んで覚えて、由来を知る。元素がもっと面白くなる。';

export const HOME_OVERVIEW_DESCRIPTION =
  'ゲーム形式の問題を通して、元素記号と名称を楽しく学べるアプリです。';

export const HOME_OVERVIEW_ITEMS: readonly {
  title: string;
  description: string;
}[] = [
  {
    title: '4択形式で気軽に学べる',
    description: '4つの選択肢から答えを選ぶシンプルな形式で、気軽に学習を始められます。'
  },
  {
    title: '繰り返し挑戦して身につく',
    description: '問題を繰り返し解くことで、元素記号と名称を少しずつ覚えられます。'
  },
  {
    title: 'ランキングで成果を確認できる',
    description: 'ゲームの結果をランキングで確認でき、次の挑戦や学習を続ける励みになります。'
  }
];

export const HOME_RANKING_PREVIEW_INITIAL: readonly HomeRankingPreviewEntry[] = [];

export function getTopPageAudience(
  isInitializing: boolean,
  isLoggedIn: boolean,
  isUnavailable = false
): TopPageAudience {
  if (isInitializing) {
    return 'initializing';
  }

  if (isUnavailable) {
    return 'unavailable';
  }

  return isLoggedIn ? 'authenticated' : 'anonymous';
}

export function getPrimaryCta(audience: TopPageAudience): TopPageCta {
  switch (audience) {
    case 'authenticated':
      return {
        href: '/game',
        label: 'ゲームを始める',
        description: '今日の学習をすぐに始めます。',
        disabled: false
      };
    case 'anonymous':
      return {
        href: '/register',
        label: '新規登録して始める',
        description: 'アカウント作成後にゲームへ進みます。',
        disabled: false
      };
    case 'initializing':
      return {
        href: '#',
        label: '準備中...',
        description: '認証状態を確認しています。',
        disabled: true
      };
    case 'unavailable':
      return {
        href: '#',
        label: '認証を確認できません',
        description: '認証サーバーへ接続できるまでお待ちください。',
        disabled: true
      };
  }
}

export function getSecondaryCta(audience: TopPageAudience): TopPageCta {
  const description =
    audience === 'authenticated'
      ? 'ゲーム前の復習として、元素一覧を確認できます。'
      : 'まずは118元素を一覧で確認できます。';

  return {
    href: '/elements',
    label: '元素一覧を見る',
    description,
    disabled: false
  };
}

function normalizePreviewLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_PREVIEW_LIMIT;
  }

  const floored = Math.floor(limit);
  if (floored < 0) {
    return 0;
  }

  return floored;
}

export function toHomeRankingPreviewEntries(
  entries: readonly RankingEntry[]
): HomeRankingPreviewEntry[] {
  return entries.map((entry) => ({
    rank: entry.rank,
    username: entry.username,
    weeklyScore: entry.score,
    totalGames: entry.totalGames
  }));
}
export function selectRankingPreviewEntries(
  entries: readonly HomeRankingPreviewEntry[],
  limit = DEFAULT_PREVIEW_LIMIT
): HomeRankingPreviewEntry[] {
  return entries.slice(0, normalizePreviewLimit(limit));
}
