<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    getAdminStats,
    getAdminUserDetail,
    getAdminUsers,
    type AdminStats,
    type AdminUserDetail,
    type AdminUserListItem,
    type AdminUserRole,
    type AdminUserStatus,
    type AdminUsersQuery
  } from '$lib/api/admin';
  import { ApiError } from '$lib/api/errors';
  import { parseAdminListLocation, serializeAdminListLocation } from '$lib/admin/query';
  import AdminDialog from '$lib/components/admin/AdminDialog.svelte';
  import AdminStatsSection from '$lib/components/admin/AdminStatsSection.svelte';
  import AdminUserDetailComponent from '$lib/components/admin/AdminUserDetail.svelte';
  import AdminUserFilters from '$lib/components/admin/AdminUserFilters.svelte';
  import AdminUserList from '$lib/components/admin/AdminUserList.svelte';
  import { authStore } from '$lib/stores/auth.svelte';

  type AccessState =
    | 'checking'
    | 'authorizing'
    | 'authorized'
    | 'anonymous'
    | 'forbidden'
    | 'error';
  type AdminListAction = 'status' | 'role' | 'delete';
  /* eslint-disable no-unused-vars -- Svelte parserがcallback型の引数名を実変数として判定するため */
  type AuthenticatedRequest<T> = (latestAccessToken: string) => Promise<T>;
  /* eslint-enable no-unused-vars */

  const ADMIN_PAGE_LIMIT = 20;
  const CONNECTION_ERROR_MESSAGE =
    'ネットワークエラーが発生しました。接続を確認して再試行してください';

  let accessState = $state<AccessState>('checking');
  let authorizationError = $state<string | null>(null);
  let users = $state<AdminUserListItem[]>([]);
  let nextCursor = $state<string | null>(null);
  let isListLoading = $state(false);
  let listError = $state<string | null>(null);
  let activeQuery = $state<AdminUsersQuery>({});
  let searchDraft = $state('');

  let stats = $state<AdminStats | null>(null);
  let isStatsLoading = $state(false);
  let statsError = $state<string | null>(null);

  let isDetailOpen = $state(false);
  let selectedListUser = $state<AdminUserListItem | null>(null);
  let detail = $state<AdminUserDetail | null>(null);
  let isDetailLoading = $state(false);
  let detailError = $state<string | null>(null);
  let returnFocus = $state<HTMLElement | null>(null);
  let pageHeading = $state<HTMLElement>();
  let liveMessage = $state('');

  let listController: AbortController | null = null;
  let statsController: AbortController | null = null;
  let detailController: AbortController | null = null;
  let listGeneration = 0;
  let statsGeneration = 0;
  let detailGeneration = 0;
  let reauthPromise: Promise<string | null> | null = null;
  let lastInitialRequestKey: string | null = null;

  function isAbortError(error: unknown): boolean {
    return (
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof Error && error.name === 'AbortError')
    );
  }

  function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof ApiError) {
      return error.message || fallback;
    }
    return CONNECTION_ERROR_MESSAGE;
  }

  function abortAdminReads(): void {
    listController?.abort();
    statsController?.abort();
    detailController?.abort();
  }

  function managePageLifecycle(element: HTMLElement): { destroy: () => void } {
    void element;
    return { destroy: abortAdminReads };
  }

  function enterAnonymousState(): void {
    abortAdminReads();
    accessState = 'anonymous';
    authorizationError = null;
    users = [];
    stats = null;
    closeDetail();
  }

  function enterForbiddenState(message: string): void {
    abortAdminReads();
    accessState = 'forbidden';
    authorizationError = message;
    users = [];
    stats = null;
    closeDetail();
  }

  async function getRefreshedAccessToken(): Promise<string | null> {
    if (reauthPromise === null) {
      reauthPromise = (async () => {
        const refreshed = await authStore.refresh();
        if (!refreshed) {
          return null;
        }
        return authStore.accessToken;
      })().finally(() => {
        reauthPromise = null;
      });
    }
    return reauthPromise;
  }

  async function requestWithReauth<T>(
    accessToken: string,
    request: AuthenticatedRequest<T>
  ): Promise<T> {
    try {
      return await request(accessToken);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        throw error;
      }
    }

    const refreshedAccessToken = await getRefreshedAccessToken();
    if (refreshedAccessToken === null) {
      throw new ApiError(401, '認証が必要です');
    }
    return request(refreshedAccessToken);
  }

  function syncSuccessfulAdminRole(): void {
    const currentUser = authStore.user;
    if (currentUser !== null && currentUser.role !== 'ADMIN') {
      authStore.updateUser({ ...currentUser, role: 'ADMIN' });
    }
  }

  async function loadStats(accessToken: string): Promise<void> {
    statsController?.abort();
    const controller = new AbortController();
    const generation = ++statsGeneration;
    statsController = controller;
    isStatsLoading = true;
    statsError = null;

    try {
      const response = await requestWithReauth(accessToken, (latestAccessToken) =>
        getAdminStats({ accessToken: latestAccessToken, signal: controller.signal })
      );
      if (controller.signal.aborted || generation !== statsGeneration) {
        return;
      }
      stats = response;
    } catch (error) {
      if (controller.signal.aborted || generation !== statsGeneration || isAbortError(error)) {
        return;
      }
      if (error instanceof ApiError && error.status === 403) {
        enterForbiddenState(error.message);
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        enterAnonymousState();
        return;
      }
      statsError = getErrorMessage(error, '統計情報を表示できませんでした');
    } finally {
      if (generation === statsGeneration) {
        isStatsLoading = false;
      }
    }
  }

  async function authorizeAndLoadUsers(accessToken: string, query: AdminUsersQuery): Promise<void> {
    listController?.abort();
    statsController?.abort();
    detailController?.abort();
    const controller = new AbortController();
    const generation = ++listGeneration;
    listController = controller;
    accessState = 'authorizing';
    authorizationError = null;
    isListLoading = true;
    listError = null;
    activeQuery = query;

    try {
      const response = await requestWithReauth(accessToken, (latestAccessToken) =>
        getAdminUsers({
          accessToken: latestAccessToken,
          query: { limit: ADMIN_PAGE_LIMIT, ...query },
          signal: controller.signal
        })
      );
      if (controller.signal.aborted || generation !== listGeneration) {
        return;
      }

      users = response.users;
      nextCursor = response.nextCursor;
      accessState = 'authorized';
      syncSuccessfulAdminRole();
      const latestAccessToken = authStore.accessToken ?? accessToken;
      void loadStats(latestAccessToken);
    } catch (error) {
      if (controller.signal.aborted || generation !== listGeneration || isAbortError(error)) {
        return;
      }
      if (error instanceof ApiError && error.status === 403) {
        enterForbiddenState(error.message);
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        enterAnonymousState();
        return;
      }
      accessState = 'error';
      listError = getErrorMessage(error, 'ユーザー一覧を表示できませんでした');
    } finally {
      if (generation === listGeneration) {
        isListLoading = false;
      }
    }
  }

  async function loadDetail(user: AdminUserListItem, accessToken: string): Promise<void> {
    detailController?.abort();
    const controller = new AbortController();
    const generation = ++detailGeneration;
    detailController = controller;
    selectedListUser = user;
    detail = null;
    isDetailLoading = true;
    detailError = null;

    try {
      const response = await requestWithReauth(accessToken, (latestAccessToken) =>
        getAdminUserDetail({
          accessToken: latestAccessToken,
          userId: user.id,
          signal: controller.signal
        })
      );
      if (controller.signal.aborted || generation !== detailGeneration) {
        return;
      }
      detail = response.user;
    } catch (error) {
      if (controller.signal.aborted || generation !== detailGeneration || isAbortError(error)) {
        return;
      }
      if (error instanceof ApiError && error.status === 403) {
        enterForbiddenState(error.message);
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        enterAnonymousState();
        return;
      }
      detailError = getErrorMessage(error, 'ユーザー詳細を表示できませんでした');
    } finally {
      if (generation === detailGeneration) {
        isDetailLoading = false;
      }
    }
  }

  function openDetail(user: AdminUserListItem, trigger: HTMLElement): void {
    const accessToken = authStore.accessToken;
    if (accessToken === null) {
      enterAnonymousState();
      return;
    }
    returnFocus = trigger;
    isDetailOpen = true;
    void loadDetail(user, accessToken);
  }

  function closeDetail(): void {
    detailController?.abort();
    detailGeneration += 1;
    isDetailOpen = false;
    selectedListUser = null;
    detail = null;
    detailError = null;
    isDetailLoading = false;
  }

  function retryDetail(): void {
    const accessToken = authStore.accessToken;
    if (selectedListUser !== null && accessToken !== null) {
      void loadDetail(selectedListUser, accessToken);
    }
  }

  function retryStats(): void {
    const accessToken = authStore.accessToken;
    if (accessToken !== null) {
      void loadStats(accessToken);
    }
  }

  function retryAuthorization(): void {
    const accessToken = authStore.accessToken;
    if (accessToken !== null) {
      void authorizeAndLoadUsers(accessToken, activeQuery);
    } else {
      enterAnonymousState();
    }
  }

  function buildAdminUrl(searchParams: URLSearchParams): string {
    const queryString = searchParams.toString();
    return page.url.pathname + (queryString ? '?' + queryString : '');
  }

  function navigateList(input: {
    q?: string;
    role?: AdminUserRole;
    status?: AdminUserStatus;
    cursor?: string;
  }): void {
    const location = serializeAdminListLocation(input);
    void goto(buildAdminUrl(location.searchParams), {
      state: { ...page.state, adminUsers: location.pageState },
      keepFocus: true,
      noScroll: true
    });
  }

  function handleSearch(q: string | undefined): void {
    navigateList({
      q,
      role: activeQuery.role,
      status: activeQuery.status
    });
  }

  function handleRoleChange(role: AdminUserRole | undefined): void {
    navigateList({ q: activeQuery.q, role, status: activeQuery.status });
  }

  function handleStatusChange(status: AdminUserStatus | undefined): void {
    navigateList({ q: activeQuery.q, role: activeQuery.role, status });
  }

  function resetFilters(): void {
    navigateList({});
  }

  function loadNextPage(): void {
    if (nextCursor === null) {
      return;
    }
    navigateList({
      q: activeQuery.q,
      role: activeQuery.role,
      status: activeQuery.status,
      cursor: nextCursor
    });
  }

  function handlePendingAction(
    user: AdminUserListItem,
    action: AdminListAction,
    trigger: HTMLElement
  ): void {
    void user;
    void action;
    void trigger;
    liveMessage = '管理操作は次の実装段階で有効になります';
  }

  function handlePendingDetailAction(action: AdminListAction): void {
    void action;
    liveMessage = '管理操作は次の実装段階で有効になります';
  }

  $effect(() => {
    const isInitializing = authStore.isInitializing;
    const isLoggedIn = authStore.isLoggedIn;
    const accessToken = authStore.accessToken;
    const search = page.url.search;
    const adminPageState = page.state.adminUsers;

    if (isInitializing) {
      accessState = 'checking';
      return;
    }
    if (!isLoggedIn || accessToken === null) {
      enterAnonymousState();
      return;
    }
    if (reauthPromise !== null) {
      return;
    }

    const location = parseAdminListLocation(new URLSearchParams(search), adminPageState);
    searchDraft = location.searchDraft;
    const requestKey =
      accessToken +
      '|' +
      location.canonicalSearchParams.toString() +
      '|' +
      JSON.stringify(location.canonicalPageState);
    if (requestKey === lastInitialRequestKey) {
      return;
    }
    lastInitialRequestKey = requestKey;

    if (location.needsCanonicalization) {
      void goto(buildAdminUrl(location.canonicalSearchParams), {
        replaceState: true,
        state: { ...page.state, adminUsers: location.canonicalPageState },
        keepFocus: true,
        noScroll: true
      });
    }
    void authorizeAndLoadUsers(accessToken, location.query);
  });
</script>

<div use:managePageLifecycle>
  {#if accessState === 'checking'}
    <section aria-busy="true" class="mx-auto max-w-4xl px-4 py-12 text-center">
      <p aria-live="polite" class="text-gray-600">ログイン状態を確認しています...</p>
    </section>
  {:else if accessState === 'anonymous'}
    <section class="mx-auto max-w-4xl px-4 py-12 text-center">
      <h1 class="text-ink text-2xl font-bold">ログインが必要です</h1>
      <p class="mt-3 text-gray-600">管理者ダッシュボードを利用するにはログインしてください。</p>
      <a
        href="/login"
        class="bg-brand hover:bg-brand-hover mt-6 inline-flex rounded-lg px-4 py-2 font-semibold text-white"
      >
        ログインへ
      </a>
    </section>
  {:else if accessState === 'forbidden'}
    <section class="mx-auto max-w-4xl px-4 py-12 text-center">
      <h1 class="text-ink text-2xl font-bold">管理者ダッシュボードを表示できません</h1>
      <p role="alert" class="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
        {authorizationError ?? '管理者権限が必要です'}
      </p>
      <a href="/" class="text-brand mt-6 inline-flex rounded-lg px-3 py-2 font-semibold">
        ホームへ戻る
      </a>
    </section>
  {:else if accessState === 'error'}
    <section class="mx-auto max-w-4xl px-4 py-12 text-center">
      <h1 class="text-ink text-2xl font-bold">管理者ダッシュボードを読み込めませんでした</h1>
      <p role="alert" class="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
        {listError ?? 'ユーザー一覧を表示できませんでした'}
      </p>
      <button
        type="button"
        class="bg-brand hover:bg-brand-hover mt-6 rounded-lg px-4 py-2 font-semibold text-white"
        onclick={retryAuthorization}
      >
        再読み込み
      </button>
    </section>
  {:else if accessState === 'authorizing'}
    <section aria-busy="true" class="mx-auto max-w-4xl px-4 py-12 text-center">
      <p aria-live="polite" class="text-gray-600">管理者権限とユーザー一覧を確認しています...</p>
    </section>
  {:else}
    <main class="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <p class="text-brand text-sm font-semibold">Administration</p>
        <h1 bind:this={pageHeading} tabindex="-1" class="text-ink mt-1 text-3xl font-bold">
          管理者ダッシュボード
        </h1>
        <p class="mt-2 text-gray-600">サービス統計とユーザーアカウントを管理します。</p>
      </header>

      <AdminStatsSection
        {stats}
        isLoading={isStatsLoading}
        errorMessage={statsError}
        onRetry={retryStats}
      />

      <AdminUserFilters
        {searchDraft}
        role={activeQuery.role}
        status={activeQuery.status}
        isLoading={isListLoading}
        onSearch={handleSearch}
        onRoleChange={handleRoleChange}
        onStatusChange={handleStatusChange}
        onReset={resetFilters}
      />

      <AdminUserList
        {users}
        currentUserId={authStore.user?.id}
        {nextCursor}
        isLoading={isListLoading}
        onViewDetail={openDetail}
        onAction={handlePendingAction}
        onLoadNext={loadNextPage}
        onResetFilters={resetFilters}
      />

      <AdminDialog
        open={isDetailOpen}
        title={selectedListUser ? selectedListUser.username + 'の詳細' : 'ユーザー詳細'}
        description="選択したユーザーのアカウント情報と学習状況"
        {returnFocus}
        fallbackFocus={pageHeading}
        onClose={closeDetail}
      >
        <AdminUserDetailComponent
          user={detail}
          isLoading={isDetailLoading}
          errorMessage={detailError}
          onRetry={retryDetail}
          onAction={handlePendingDetailAction}
        />
      </AdminDialog>
    </main>
  {/if}

  <p aria-live="polite" class="sr-only">{liveMessage}</p>
</div>
