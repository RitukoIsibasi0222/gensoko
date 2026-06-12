<script lang="ts">
  import { onDestroy } from 'svelte';
  import GameModeCard from '$lib/components/game/GameModeCard.svelte';
  import { GAME_MODE_CONFIGS } from '$lib/game/modes';
  import type { GameMode } from '$lib/game/types';
  import { authStore } from '$lib/stores/auth.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';

  const PREVIEW_WEAK_ELEMENT_COUNT = 4;
  const START_NOTICE_RESET_MS = 1200;

  let startingMode = $state<GameMode | null>(null);
  let startResetTimer: ReturnType<typeof setTimeout> | null = null;

  function handleStart(mode: GameMode): void {
    if (startingMode !== null) {
      return;
    }

    if (startResetTimer !== null) {
      clearTimeout(startResetTimer);
    }

    startingMode = mode;
    toastStore.info('プレイ画面は後続タスクで実装します。');
    startResetTimer = setTimeout(() => {
      startingMode = null;
      startResetTimer = null;
    }, START_NOTICE_RESET_MS);
  }

  onDestroy(() => {
    if (startResetTimer !== null) {
      clearTimeout(startResetTimer);
    }
  });
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
            苦手モードは苦手元素が5件以上になると開始できます。
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
              isStarting={startingMode === config.mode}
              onStart={handleStart}
            />
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
