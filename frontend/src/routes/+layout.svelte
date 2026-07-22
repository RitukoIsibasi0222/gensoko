<script lang="ts">
  import { browser } from '$app/environment';
  import { tick } from 'svelte';
  import '../app.css';
  import favicon from '$lib/assets/favicon.svg';
  import { authStore } from '$lib/stores/auth.svelte';
  import { themeStore } from '$lib/stores/theme.svelte';
  import Toaster from '$lib/components/toast/Toaster.svelte';

  let { children } = $props();
  let unavailableAlert = $state<HTMLElement>();
  let isRetryingAuth = $state(false);

  $effect(() => {
    if (authStore.isUnavailable && unavailableAlert) {
      void tick().then(() => unavailableAlert?.focus());
    }
  });

  async function retryAuthentication(): Promise<void> {
    if (isRetryingAuth) return;
    isRetryingAuth = true;
    try {
      await authStore.retryInitialize();
    } finally {
      isRetryingAuth = false;
    }
  }

  // コンポーネント初期化時（初回レンダリング前）に呼び出す。
  // onMount はレンダリング後に実行されるため、ここで呼ばないと
  // 初回描画が status='anonymous' で行われてフリッカーが発生する。
  // void で呼ぶことで initialize() が同期的に status='initializing' を
  // セットしてから最初の描画が走るようにする。
  // browser ガードにより SSR 環境では実行しない。
  if (browser) {
    themeStore.initialize();
    void authStore.initialize();
  }
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

{#if authStore.isUnavailable}
  <main class="mx-auto max-w-xl px-4 py-12">
    <section
      bind:this={unavailableAlert}
      role="alert"
      tabindex="-1"
      class="border-danger-border bg-danger-surface text-danger-text rounded-md border p-6 outline-none"
    >
      <h1 class="text-xl font-bold">認証状態を確認できません</h1>
      <p class="mt-2 text-sm leading-6">
        通信障害の可能性があります。保護された操作は停止しています。接続を確認して再試行してください。
      </p>
      <button
        type="button"
        class="bg-action text-text-inverse focus:ring-focus mt-4 rounded-md px-4 py-2 focus:ring-2 focus:outline-none disabled:opacity-50"
        disabled={isRetryingAuth}
        onclick={retryAuthentication}
      >
        {isRetryingAuth ? '再試行中...' : '再試行'}
      </button>
    </section>
  </main>
{:else}
  {@render children()}
{/if}

<!-- トースト通知コンテナ -->
<Toaster />
