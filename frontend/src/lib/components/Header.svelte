<script lang="ts">
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
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

<nav class="border-border-muted bg-surface border-b">
  <div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
    <!-- ロゴ -->
    <a href="/" class="text-brand text-xl font-bold" onclick={closeMobileMenu}>Gensoko</a>

    <button
      type="button"
      class="hover:text-brand border-border text-text hover:bg-surface-muted focus-visible:outline-focus inline-flex h-10 w-10 items-center justify-center rounded border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 md:hidden"
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
    <ul class="text-text hidden gap-6 text-sm font-medium md:flex">
      {#each primaryNavItems as item (item.href)}
        <li><a href={item.href} class="hover:text-brand">{item.label}</a></li>
      {/each}
      {#each visibleAuthenticatedNavItems as item (item.href)}
        <li><a href={item.href} class="hover:text-brand">{item.label}</a></li>
      {/each}
    </ul>

    <!-- 認証エリア：初期化完了後にログイン状態に応じて切り替え -->
    <div class="hidden items-center gap-2 text-sm md:flex">
      <ThemeToggle />
      {#if authStore.isInitializing}
        <!-- 初期化中は非表示（refresh 結果が出る前にフリッカーするのを防ぐ） -->
      {:else if authStore.isLoggedIn}
        <span class="text-text-muted leading-tight" data-user-greeting>
          <span class="block">こんにちは</span>
          <span class="block">{authStore.user?.username}さん</span>
        </span>
        <a href="/settings" class="hover:text-brand text-text-muted rounded px-3 py-1.5">設定</a>
        <button
          type="button"
          onclick={handleLogout}
          class="hover:bg-action-hover bg-action text-text-inverse rounded px-3 py-1.5"
        >
          ログアウト
        </button>
      {:else}
        <a href="/login" class="hover:text-brand text-text-muted rounded px-3 py-1.5">ログイン</a>
        <a
          href="/register"
          class="bg-action hover:bg-action-hover text-text-inverse rounded px-3 py-1.5"
        >
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
      ? 'border-border-muted grid grid-rows-[1fr] border-t opacity-100 transition-[grid-template-rows,opacity] duration-300 ease-out md:hidden'
      : 'grid grid-rows-[0fr] border-t border-transparent opacity-0 transition-[grid-template-rows,opacity] duration-300 ease-out md:hidden'}
  >
    <div class="overflow-hidden">
      <div class="mx-auto max-w-5xl space-y-4 px-4 py-4">
        <ThemeToggle />
        <ul class="text-text grid gap-1 text-sm font-medium">
          {#each primaryNavItems as item (item.href)}
            <li>
              <a
                href={item.href}
                class="hover:text-brand hover:bg-surface-muted block rounded px-3 py-2"
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
                class="hover:text-brand hover:bg-surface-muted block rounded px-3 py-2"
                onclick={closeMobileMenu}
              >
                {item.label}
              </a>
            </li>
          {/each}
        </ul>

        <div class="border-border-muted border-t pt-4 text-sm">
          {#if authStore.isInitializing}
            <!-- 初期化中は非表示（refresh 結果が出る前にフリッカーするのを防ぐ） -->
          {:else if authStore.isLoggedIn}
            <p class="text-text-muted px-3 leading-tight" data-user-greeting>
              <span class="block">こんにちは</span>
              <span class="block">{authStore.user?.username}さん</span>
            </p>
            <div class="mt-3 grid gap-2">
              <a
                href="/settings"
                class="hover:text-brand text-text-muted hover:bg-surface-muted block rounded px-3 py-2"
                onclick={closeMobileMenu}
              >
                設定
              </a>
              <button
                type="button"
                onclick={handleLogout}
                class="hover:bg-action-hover bg-action text-text-inverse rounded px-3 py-2 text-left font-semibold"
              >
                ログアウト
              </button>
            </div>
          {:else}
            <div class="grid gap-2">
              <a
                href="/login"
                class="hover:text-brand text-text-muted hover:bg-surface-muted block rounded px-3 py-2"
                onclick={closeMobileMenu}
              >
                ログイン
              </a>
              <a
                href="/register"
                class="bg-action hover:bg-action-hover text-text-inverse block rounded px-3 py-2 text-center font-semibold"
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
