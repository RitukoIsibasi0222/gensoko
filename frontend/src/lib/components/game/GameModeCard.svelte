<script lang="ts">
  import { getGameModeStartAvailability } from '$lib/game/modes';
  import type { GameMode, GameModeConfig, GameModeStartHandler } from '$lib/game/types';

  type Props = {
    config: GameModeConfig;
    isLoggedIn: boolean;
    weakCount: number | null;
    startingMode?: GameMode | null;
    onStart: GameModeStartHandler;
  };

  let { config, isLoggedIn, weakCount, startingMode = null, onStart }: Props = $props();

  const availability = $derived(getGameModeStartAvailability(config.mode, weakCount));
  const isBusy = $derived(startingMode !== null);
  const isStartingThisMode = $derived(startingMode === config.mode);
  const canStart = $derived(isLoggedIn && availability.canStart && !isBusy);
  const guardMessage = $derived(
    isLoggedIn ? availability.guardMessage : 'ログインするとゲームを開始できます。'
  );
  const buttonLabel = $derived(
    isStartingThisMode ? '準備中です...' : isBusy ? '他のモードを準備中です' : 'このモードで始める'
  );

  function handleStart(): void {
    if (!canStart) {
      return;
    }

    onStart(config.mode);
  }
</script>

<div class="flex h-full flex-col rounded border border-gray-200 bg-white p-5 shadow-sm">
  <div class="flex flex-wrap gap-2">
    <span class="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
      {config.formatLabel}
    </span>
    <span class="rounded bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">
      {config.difficultyLabel}
    </span>
    <span class="rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
      {config.rangeLabel}
    </span>
  </div>

  <div class="mt-4 flex-1">
    <h3 class="text-lg font-bold text-gray-900">{config.title}</h3>
    <p class="mt-2 text-sm leading-6 text-gray-600">{config.description}</p>
  </div>

  {#if guardMessage}
    <p class="mt-4 text-sm text-gray-600">{guardMessage}</p>
  {/if}

  <div class="mt-5">
    {#if !isLoggedIn}
      <a
        href="/login"
        class="bg-brand hover:bg-brand-hover focus-visible:outline-brand inline-flex w-full items-center justify-center rounded px-4 py-2 text-sm font-semibold text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        ログインして始める
      </a>
    {:else}
      <button
        type="button"
        disabled={!canStart}
        onclick={handleStart}
        class="bg-brand hover:bg-brand-hover focus-visible:outline-brand inline-flex w-full items-center justify-center rounded px-4 py-2 text-sm font-semibold text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
      >
        {buttonLabel}
      </button>
    {/if}
  </div>
</div>
