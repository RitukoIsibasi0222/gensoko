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

<div class="border-border-muted bg-surface flex h-full flex-col rounded border p-5 shadow-sm">
  <div class="flex flex-wrap gap-2">
    <span class="bg-info-surface text-action rounded px-2 py-1 text-xs font-semibold">
      {config.formatLabel}
    </span>
    <span class="bg-surface-subtle text-text rounded px-2 py-1 text-xs font-semibold">
      {config.difficultyLabel}
    </span>
    <span class="bg-success-surface text-success-text rounded px-2 py-1 text-xs font-semibold">
      {config.rangeLabel}
    </span>
  </div>

  <div class="mt-4 flex-1">
    <h3 class="text-text text-lg font-bold">{config.title}</h3>
    <p class="text-text-muted mt-2 text-sm leading-6">{config.description}</p>
  </div>

  {#if guardMessage}
    <p class="text-text-muted mt-4 text-sm">{guardMessage}</p>
  {/if}

  <div class="mt-5">
    {#if !isLoggedIn}
      <a
        href="/login"
        class="bg-action hover:bg-action-hover focus-visible:outline-focus text-text-inverse inline-flex w-full items-center justify-center rounded px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        ログインして始める
      </a>
    {:else}
      <button
        type="button"
        disabled={!canStart}
        onclick={handleStart}
        class="bg-action hover:bg-action-hover focus-visible:outline-focus text-text-inverse disabled:bg-surface-disabled disabled:text-text-subtle inline-flex w-full items-center justify-center rounded px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed"
      >
        {buttonLabel}
      </button>
    {/if}
  </div>
</div>
