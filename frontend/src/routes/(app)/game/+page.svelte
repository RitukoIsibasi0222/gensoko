<script lang="ts">
  import { goto } from '$app/navigation';
  import GameModeCard from '$lib/components/game/GameModeCard.svelte';
  import { MIN_WEAK_ELEMENTS_FOR_GAME } from '$lib/game/constants';
  import { GAME_MODE_CONFIGS } from '$lib/game/modes';
  import type { GameMode } from '$lib/game/types';
  import { authStore } from '$lib/stores/auth.svelte';

  const PREVIEW_WEAK_ELEMENT_COUNT = MIN_WEAK_ELEMENTS_FOR_GAME - 1;

  let startingMode = $state<GameMode | null>(null);

  async function handleStart(mode: GameMode): Promise<void> {
    if (startingMode !== null) {
      return;
    }

    startingMode = mode;
    try {
      await goto(`/game/play?mode=${mode}`);
    } catch {
      startingMode = null;
    }
  }
</script>

<div class="space-y-6">
  <section class="space-y-2">
    <p class="text-sm font-semibold text-gray-500">4択クイズ</p>
    <h1 class="text-2xl font-bold text-gray-900">ゲーム</h1>
    <p class="max-w-2xl text-sm leading-6 text-gray-600">
      元素記号と名前を、初級・上級・苦手リストのモードから選んで練習できます。
    </p>
  </section>

  {#if authStore.isInitializing}
    <section
      class="rounded border border-gray-200 bg-white p-5"
      aria-busy="true"
      aria-live="polite"
    >
      <p class="text-sm text-gray-600">ログイン状態を確認しています...</p>
    </section>
  {:else if GAME_MODE_CONFIGS.length === 0}
    <section class="rounded border border-gray-200 bg-white p-5">
      <p class="text-sm text-gray-600">利用できるゲームモードがありません。</p>
    </section>
  {:else}
    <section class="space-y-4" aria-labelledby="game-mode-list-heading">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="game-mode-list-heading" class="text-lg font-bold text-gray-900">モードを選択</h2>
          <p class="mt-1 text-sm text-gray-600">
            苦手モードは苦手元素が{MIN_WEAK_ELEMENTS_FOR_GAME}件以上になると開始できます。
          </p>
        </div>
        {#if authStore.isLoggedIn}
          <p class="text-sm text-gray-600">苦手元素: {PREVIEW_WEAK_ELEMENT_COUNT}件</p>
        {/if}
      </div>

      <ul role="list" class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {#each GAME_MODE_CONFIGS as config (config.mode)}
          <li>
            <GameModeCard
              {config}
              isLoggedIn={authStore.isLoggedIn}
              weakCount={PREVIEW_WEAK_ELEMENT_COUNT}
              {startingMode}
              onStart={handleStart}
            />
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
