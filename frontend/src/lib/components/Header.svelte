<script lang="ts">
  import { authStore } from '$lib/stores/auth.svelte';

  type NavItem = {
    href: string;
    label: string;
  };

  const primaryNavItems: NavItem[] = [
    { href: '/elements', label: '元素一覧' },
    { href: '/game', label: 'ゲーム' },
    { href: '/ranking', label: 'ランキング' }
  ];

  const authenticatedNavItems: NavItem[] = [
    { href: '/weak', label: '苦手' },
    { href: '/mypage', label: 'マイページ' }
  ];
  const adminNavItem: NavItem = { href: '/admin', label: '管理者' };

  let isMobileMenuOpen = $state(false);
  const showAuthenticatedNav = $derived(!authStore.isInitializing && authStore.isLoggedIn);
  const visibleAuthenticatedNavItems = $derived(
    showAuthenticatedNav
      ? authStore.user?.role === 'ADMIN'
        ? [...authenticatedNavItems, adminNavItem]
        : authenticatedNavItems
      : []
  );

  function closeMobileMenu(): void {
    isMobileMenuOpen = false;
  }

  function toggleMobileMenu(): void {
    isMobileMenuOpen = !isMobileMenuOpen;
  }

  function handleLogout(): void {
    closeMobileMenu();
    authStore.logout();
  }
</script>

<nav class="border-b border-gray-200 bg-white">
  <div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
    <!-- ロゴ -->
    <a href="/" class="text-brand text-xl font-bold" onclick={closeMobileMenu}>Gensoko</a>

    <button
      type="button"
      class="hover:text-brand inline-flex h-10 w-10 items-center justify-center rounded border border-gray-300 text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 md:hidden"
      aria-label="メニューを開閉"
      aria-controls="mobile-navigation"
      aria-expanded={isMobileMenuOpen}
      onclick={toggleMobileMenu}
    >
      <span class="sr-only">メニュー</span>
      <span class="relative block h-5 w-5" aria-hidden="true">
        <span
          class={isMobileMenuOpen
            ? 'absolute top-1/2 left-0 block h-0.5 w-5 -translate-y-1/2 rotate-45 rounded bg-current transition-transform duration-300 ease-out'
            : 'absolute top-1 left-0 block h-0.5 w-5 translate-y-0 rotate-0 rounded bg-current transition-transform duration-300 ease-out'}
        ></span>
        <span
          class={isMobileMenuOpen
            ? 'absolute top-1/2 left-0 block h-0.5 w-5 -translate-y-1/2 rounded bg-current opacity-0 transition-opacity duration-200 ease-out'
            : 'absolute top-1/2 left-0 block h-0.5 w-5 -translate-y-1/2 rounded bg-current opacity-100 transition-opacity duration-200 ease-out'}
        ></span>
        <span
          class={isMobileMenuOpen
            ? 'absolute top-1/2 left-0 block h-0.5 w-5 -translate-y-1/2 -rotate-45 rounded bg-current transition-transform duration-300 ease-out'
            : 'absolute bottom-1 left-0 block h-0.5 w-5 translate-y-0 rotate-0 rounded bg-current transition-transform duration-300 ease-out'}
        ></span>
      </span>
    </button>

    <!-- メインナビ -->
    <ul class="text-ink hidden gap-6 text-sm font-medium md:flex">
      {#each primaryNavItems as item (item.href)}
        <li><a href={item.href} class="hover:text-brand">{item.label}</a></li>
      {/each}
      {#each visibleAuthenticatedNavItems as item (item.href)}
        <li><a href={item.href} class="hover:text-brand">{item.label}</a></li>
      {/each}
    </ul>

    <!-- 認証エリア：初期化完了後にログイン状態に応じて切り替え -->
    <div class="hidden items-center gap-2 text-sm md:flex">
      {#if authStore.isInitializing}
        <!-- 初期化中は非表示（refresh 結果が出る前にフリッカーするのを防ぐ） -->
      {:else if authStore.isLoggedIn}
        <span class="text-gray-600">こんにちは、{authStore.user?.username} さん</span>
        <a href="/settings" class="hover:text-brand rounded px-3 py-1.5 text-gray-600">設定</a>
        <button
          type="button"
          onclick={handleLogout}
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

  <div
    id="mobile-navigation"
    aria-hidden={!isMobileMenuOpen}
    inert={!isMobileMenuOpen}
    class={isMobileMenuOpen
      ? 'grid grid-rows-[1fr] border-t border-gray-200 opacity-100 transition-[grid-template-rows,opacity] duration-300 ease-out md:hidden'
      : 'grid grid-rows-[0fr] border-t border-transparent opacity-0 transition-[grid-template-rows,opacity] duration-300 ease-out md:hidden'}
  >
    <div class="overflow-hidden">
      <div class="mx-auto max-w-5xl space-y-4 px-4 py-4">
        <ul class="text-ink grid gap-1 text-sm font-medium">
          {#each primaryNavItems as item (item.href)}
            <li>
              <a
                href={item.href}
                class="hover:text-brand block rounded px-3 py-2 hover:bg-gray-50"
                onclick={closeMobileMenu}
              >
                {item.label}
              </a>
            </li>
          {/each}
          {#each visibleAuthenticatedNavItems as item (item.href)}
            <li>
              <a
                href={item.href}
                class="hover:text-brand block rounded px-3 py-2 hover:bg-gray-50"
                onclick={closeMobileMenu}
              >
                {item.label}
              </a>
            </li>
          {/each}
        </ul>

        <div class="border-t border-gray-100 pt-4 text-sm">
          {#if authStore.isInitializing}
            <!-- 初期化中は非表示（refresh 結果が出る前にフリッカーするのを防ぐ） -->
          {:else if authStore.isLoggedIn}
            <p class="px-3 text-gray-600">こんにちは、{authStore.user?.username} さん</p>
            <div class="mt-3 grid gap-2">
              <a
                href="/settings"
                class="hover:text-brand block rounded px-3 py-2 text-gray-600 hover:bg-gray-50"
                onclick={closeMobileMenu}
              >
                設定
              </a>
              <button
                type="button"
                onclick={handleLogout}
                class="hover:bg-brand-hover bg-brand rounded px-3 py-2 text-left font-semibold text-white"
              >
                ログアウト
              </button>
            </div>
          {:else}
            <div class="grid gap-2">
              <a
                href="/login"
                class="hover:text-brand block rounded px-3 py-2 text-gray-600 hover:bg-gray-50"
                onclick={closeMobileMenu}
              >
                ログイン
              </a>
              <a
                href="/register"
                class="bg-brand hover:bg-brand-hover block rounded px-3 py-2 text-center font-semibold text-white"
                onclick={closeMobileMenu}
              >
                新規登録
              </a>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
</nav>
