<script lang="ts">
  import { goto } from '$app/navigation';
  import { ApiError } from '$lib/api/errors';
  import { getWeakElements } from '$lib/api/weak';
  import GameModeCard from '$lib/components/game/GameModeCard.svelte';
  import { MIN_WEAK_ELEMENTS_FOR_GAME } from '$lib/game/constants';
  import { GAME_MODE_CONFIGS } from '$lib/game/modes';
  import type { GameMode } from '$lib/game/types';
  import { authStore } from '$lib/stores/auth.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';

  type WeakLoadStatus = 'idle' | 'loading' | 'success' | 'error';

  let startingMode = $state<GameMode | null>(null);
  let weakCount = $state<number | null>(null);
  let weakLoadStatus = $state<WeakLoadStatus>('idle');
  let weakLoadError = $state<string | null>(null);

  let weakAbortController: AbortController | null = null;
  let activeWeakRequestKey: string | null = null;
  let loadedWeakRequestKey: string | null = null;

  const weakCountText = $derived.by(() => {
    if (weakLoadStatus === 'loading') {
      return '苦手元素: 確認中...';
    }

    if (weakLoadStatus === 'error') {
      return '苦手元素: 取得できません';
    }

    if (weakCount === null) {
      return '苦手元素: 未確認';
    }

    return '苦手元素: ' + weakCount + '件';
  });

  function clearWeakState(): void {
    weakAbortController?.abort();
    weakAbortController = null;
    activeWeakRequestKey = null;
    loadedWeakRequestKey = null;
    weakCount = null;
    weakLoadStatus = 'idle';
    weakLoadError = null;
  }

  async function loadWeakElements(accessToken: string, force = false): Promise<void> {
    const requestKey = accessToken;

    if (!force && (activeWeakRequestKey === requestKey || loadedWeakRequestKey === requestKey)) {
      return;
    }

    weakAbortController?.abort();
    const controller = new AbortController();
    weakAbortController = controller;
    activeWeakRequestKey = requestKey;

    if (force) {
      loadedWeakRequestKey = null;
    }

    weakCount = null;
    weakLoadStatus = 'loading';
    weakLoadError = null;

    try {
      const weakElements = await getWeakElements({
        accessToken,
        signal: controller.signal
      });

      if (controller.signal.aborted || activeWeakRequestKey !== requestKey) {
        return;
      }

      weakCount = weakElements.length;
      weakLoadStatus = 'success';
      weakLoadError = null;
      loadedWeakRequestKey = requestKey;
    } catch (error) {
      if (controller.signal.aborted || activeWeakRequestKey !== requestKey) {
        return;
      }

      weakCount = null;
      weakLoadStatus = 'error';
      loadedWeakRequestKey = null;

      if (error instanceof ApiError) {
        weakLoadError = error.message;
        toastStore.fromApiError(error);
      } else {
        weakLoadError = '苦手元素数を取得できませんでした';
        toastStore.error(weakLoadError);
      }
    } finally {
      if (activeWeakRequestKey === requestKey) {
        activeWeakRequestKey = null;
      }

      if (weakAbortController === controller) {
        weakAbortController = null;
      }
    }
  }

  function retryWeakElements(): void {
    if (!authStore.isLoggedIn || !authStore.accessToken) {
      return;
    }

    void loadWeakElements(authStore.accessToken, true);
  }

  $effect(() => {
    if (authStore.isInitializing) {
      return;
    }

    if (!authStore.isLoggedIn || !authStore.accessToken) {
      clearWeakState();
      return;
    }

    void loadWeakElements(authStore.accessToken);

    return () => {
      weakAbortController?.abort();
    };
  });

  async function handleStart(mode: GameMode): Promise<void> {
    if (startingMode !== null) {
      return;
    }

    startingMode = mode;
    try {
      await goto('/game/play?mode=' + mode);
    } catch {
      startingMode = null;
    }
  }
</script>

<div class="space-y-6">
  <section class="space-y-2">
    <p class="text-text-subtle text-sm font-semibold">4択クイズ</p>
    <h1 class="text-text text-2xl font-bold">ゲーム</h1>
    <p class="text-text-muted max-w-2xl text-sm leading-6">
      元素記号と名前を、初級・上級・苦手リストのモードから選んで練習できます。
    </p>
  </section>

  {#if authStore.isInitializing}
    <section
      class="border-border-muted bg-surface rounded border p-5"
      aria-busy="true"
      aria-live="polite"
    >
      <p class="text-text-muted text-sm">ログイン状態を確認しています...</p>
    </section>
  {:else if GAME_MODE_CONFIGS.length === 0}
    <section class="border-border-muted bg-surface rounded border p-5">
      <p class="text-text-muted text-sm">利用できるゲームモードがありません。</p>
    </section>
  {:else}
    <section class="space-y-4" aria-labelledby="game-mode-list-heading">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="game-mode-list-heading" class="text-text text-lg font-bold">モードを選択</h2>
          <p class="text-text-muted mt-1 text-sm">
            苦手モードは苦手元素が{MIN_WEAK_ELEMENTS_FOR_GAME}件以上になると開始できます。
          </p>
        </div>
        {#if authStore.isLoggedIn}
          <div class="text-text-muted space-y-2 text-sm" aria-live="polite">
            <p>{weakCountText}</p>
            {#if weakLoadStatus === 'error' && weakLoadError}
              <div
                class="border-danger-border bg-danger-surface text-danger-text space-y-2 rounded border p-3"
              >
                <p>{weakLoadError}</p>
                <button
                  type="button"
                  onclick={retryWeakElements}
                  class="border-danger-border-strong bg-surface text-danger-text hover:bg-danger-surface-strong focus-visible:outline-danger-border-strong rounded border px-3 py-1 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  再試行
                </button>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <ul role="list" class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {#each GAME_MODE_CONFIGS as config (config.mode)}
          <li>
            <GameModeCard
              {config}
              isLoggedIn={authStore.isLoggedIn}
              {weakCount}
              {startingMode}
              onStart={handleStart}
            />
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
