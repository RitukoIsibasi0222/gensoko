<script lang="ts">
  import { browser } from '$app/environment';
  import '../app.css';
  import favicon from '$lib/assets/favicon.svg';
  import { authStore } from '$lib/stores/auth.svelte';

  let { children } = $props();

  // コンポーネント初期化時（初回レンダリング前）に呼び出す。
  // onMount はレンダリング後に実行されるため、ここで呼ばないと
  // 初回描画が status='anonymous' で行われてフリッカーが発生する。
  // void で呼ぶことで initialize() が同期的に status='initializing' を
  // セットしてから最初の描画が走るようにする。
  // browser ガードにより SSR 環境では実行しない。
  if (browser) {
    void authStore.initialize();
  }
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
