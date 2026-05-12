<script lang="ts">
  import { authStore } from '$lib/stores/auth.svelte';
</script>

<nav class="border-b border-gray-200 bg-white">
  <div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
    <!-- ロゴ -->
    <a href="/" class="text-brand text-xl font-bold">Gensoko</a>

    <!-- メインナビ -->
    <ul class="text-ink flex gap-6 text-sm font-medium">
      <li><a href="/elements" class="hover:text-brand">元素一覧</a></li>
      <li><a href="/game" class="hover:text-brand">ゲーム</a></li>
      <li><a href="/ranking" class="hover:text-brand">ランキング</a></li>
    </ul>

    <!-- 認証エリア：初期化完了後にログイン状態に応じて切り替え -->
    <div class="flex items-center gap-2 text-sm">
      {#if authStore.isInitializing}
        <!-- 初期化中は非表示（refresh 結果が出る前にフリッカーするのを防ぐ） -->
      {:else if authStore.isLoggedIn}
        <span class="text-gray-600">こんにちは、{authStore.user?.username} さん</span>
        <a href="/settings" class="hover:text-brand rounded px-3 py-1.5 text-gray-600">設定</a>
        <button
          onclick={() => authStore.logout()}
          class="hover:bg-brand-hover bg-brand rounded px-3 py-1.5 text-white"
        >
          ログアウト
        </button>
      {:else}
        <a href="/login" class="hover:text-brand rounded px-3 py-1.5 text-gray-600">ログイン</a>
        <a href="/register" class="bg-brand hover:bg-brand-hover rounded px-3 py-1.5 text-white">
          新規登録
        </a>
      {/if}
    </div>
  </div>
</nav>
