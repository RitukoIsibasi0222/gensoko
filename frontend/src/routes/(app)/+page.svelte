<script lang="ts">
  import AppOverviewSection from '$lib/components/home/AppOverviewSection.svelte';
  import HeroSection from '$lib/components/home/HeroSection.svelte';
  import RankingPreviewSection from '$lib/components/home/RankingPreviewSection.svelte';
  import {
    getPrimaryCta,
    getSecondaryCta,
    getTopPageAudience,
    HOME_HERO_DESCRIPTION,
    HOME_HERO_TITLE,
    HOME_OVERVIEW_ITEMS,
    HOME_RANKING_PREVIEW_INITIAL,
    selectRankingPreviewEntries
  } from '$lib/home/content';
  import { authStore } from '$lib/stores/auth.svelte';

  const rankingPreviewEntries = selectRankingPreviewEntries(HOME_RANKING_PREVIEW_INITIAL, 3);

  const audience = $derived(getTopPageAudience(authStore.isInitializing, authStore.isLoggedIn));
  const primaryCta = $derived(getPrimaryCta(audience));
  const secondaryCta = $derived(getSecondaryCta(audience));
</script>

<div class="space-y-8">
  <HeroSection
    title={HOME_HERO_TITLE}
    description={HOME_HERO_DESCRIPTION}
    {primaryCta}
    {secondaryCta}
  />

  <AppOverviewSection items={HOME_OVERVIEW_ITEMS} />

  <RankingPreviewSection entries={rankingPreviewEntries} />
</div>
