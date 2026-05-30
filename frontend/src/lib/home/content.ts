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

export const HOME_OVERVIEW_ITEMS: readonly {
  title: string;
  description: string;
}[] = [
  {
    title: '4択でテンポよく定着',
    description: '元素記号と名称を素早く往復しながら覚えられるよう、ゲーム形式で出題します。'
  },
  {
    title: '学習導線がシンプル',
    description: 'トップからゲーム開始まで迷わないよう、主要アクションを明確に配置します。'
  },
  {
    title: 'ランキングで継続しやすい',
    description: 'ランキング導線を常に見える位置に置き、学習のモチベーション維持を支えます。'
  }
];

export const HOME_RANKING_PREVIEW_INITIAL: readonly HomeRankingPreviewEntry[] = [];

export function getTopPageAudience(isInitializing: boolean, isLoggedIn: boolean): TopPageAudience {
  if (isInitializing) {
    return 'initializing';
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
    default:
      return {
        href: '#',
        label: '準備中...',
        description: '認証状態を確認しています。',
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

export function selectRankingPreviewEntries(
  entries: readonly HomeRankingPreviewEntry[],
  limit = DEFAULT_PREVIEW_LIMIT
): HomeRankingPreviewEntry[] {
  return entries.slice(0, normalizePreviewLimit(limit));
}
