<script lang="ts">
  import AppOverviewSection from '$lib/components/home/AppOverviewSection.svelte';
  import HeroSection from '$lib/components/home/HeroSection.svelte';
  import RankingPreviewSection from '$lib/components/home/RankingPreviewSection.svelte';
  import {
    getPrimaryCta,
    getSecondaryCta,
    getTopPageAudience,
    HOME_OVERVIEW_ITEMS,
    HOME_RANKING_PREVIEW_INITIAL,
    selectRankingPreviewEntries
  } from '$lib/home/content';
  import { authStore } from '$lib/stores/auth.svelte';

  const heroTitle = '元素を、遊んで覚える。';
  const heroDescription =
    'アプリ概要を確認してから、ゲーム学習に進めます。ランキング導線もここからすぐに辿れます。';

  const audience = $derived(getTopPageAudience(authStore.isInitializing, authStore.isLoggedIn));
  const primaryCta = $derived(getPrimaryCta(audience));
  const secondaryCta = $derived(getSecondaryCta(audience));
  const rankingPreviewEntries = $derived(
    selectRankingPreviewEntries(HOME_RANKING_PREVIEW_INITIAL, 3)
  );
</script>

<div class="space-y-8">
  <HeroSection title={heroTitle} description={heroDescription} {primaryCta} {secondaryCta} />

  <AppOverviewSection items={HOME_OVERVIEW_ITEMS} />

  <RankingPreviewSection entries={rankingPreviewEntries} />
</div>
