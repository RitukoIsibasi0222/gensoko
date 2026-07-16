<script lang="ts">
  import { tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { ApiError } from '$lib/api/errors';
  import {
    changeCurrentPassword,
    deleteCurrentUser,
    getCurrentUserProfile,
    updateCurrentUsername,
    type CurrentUserProfile
  } from '$lib/api/users';
  import { authStore } from '$lib/stores/auth.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';
  import { PASSWORD_BYTE_LIMIT_HINT, validatePassword } from '$lib/validation/password';
  import { validateUsername } from '$lib/validation/username';
  import {
    validateConfirmPassword,
    validateCurrentPassword,
    validateDeleteAcknowledgement
  } from './validation';

  const NETWORK_ERROR_MESSAGE = 'ネットワークエラーが発生しました。接続を確認してください';
  const AUTH_REQUIRED_MESSAGE = '認証情報が見つかりません。再ログインしてください。';
  const DELETE_RESULT_UNKNOWN_MESSAGE =
    '削除結果を確認できませんでした。再ログインしてアカウントの状態を確認してください。';

  let profile = $state<CurrentUserProfile | null>(null);
  let username = $state('');

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let currentPasswordInput = $state<HTMLInputElement>();
  let newPasswordInput = $state<HTMLInputElement>();
  let confirmPasswordInput = $state<HTMLInputElement>();

  let deleteCurrentPassword = $state('');
  let deleteAcknowledged = $state(false);
  let deleteCurrentPasswordInput = $state<HTMLInputElement>();
  let deleteAcknowledgementInput = $state<HTMLInputElement>();

  let isLoadingProfile = $state(false);
  let hasLoadedProfile = $state(false);
  let loadError = $state<string | null>(null);

  let isProfileSubmitting = $state(false);
  let isPasswordSubmitting = $state(false);
  let isDeleting = $state(false);

  let profileError = $state<string | null>(null);
  let passwordFormError = $state<string | null>(null);
  let currentPasswordError = $state<string | null>(null);
  let newPasswordError = $state<string | null>(null);
  let confirmPasswordError = $state<string | null>(null);
  let deleteCurrentPasswordError = $state<string | null>(null);
  let deleteAcknowledgementError = $state<string | null>(null);
  let deleteFormError = $state<string | null>(null);

  let deleteRequestAbortController: AbortController | null = null;
  let isPageDestroyed = false;

  $effect(() => {
    return () => {
      isPageDestroyed = true;
      deleteRequestAbortController?.abort();
    };
  });

  $effect(() => {
    if (!authStore.isInitializing && !authStore.isLoggedIn) {
      goto('/login');
    }
  });

  $effect(() => {
    if (
      !authStore.isInitializing &&
      authStore.isLoggedIn &&
      !hasLoadedProfile &&
      !isLoadingProfile
    ) {
      void loadProfile();
    }
  });

  type AuthRequiredErrorTarget = 'load' | 'profile' | 'password' | 'delete';

  function requireAccessToken(target: AuthRequiredErrorTarget): string | null {
    const accessToken = authStore.accessToken;
    if (accessToken) {
      return accessToken;
    }

    if (target === 'load') {
      loadError = AUTH_REQUIRED_MESSAGE;
      hasLoadedProfile = true;
    } else if (target === 'profile') {
      profileError = AUTH_REQUIRED_MESSAGE;
    } else if (target === 'password') {
      passwordFormError = AUTH_REQUIRED_MESSAGE;
    } else {
      deleteFormError = AUTH_REQUIRED_MESSAGE;
    }

    return null;
  }

  async function handleUnauthorized(error: ApiError): Promise<boolean> {
    if (error.status !== 401) {
      return false;
    }

    await authStore.logout();
    await goto('/login');
    return true;
  }

  function formatCreatedAt(isoDate: string): string {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }
    return date.toLocaleDateString('ja-JP');
  }

  function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
  }

  async function loadProfile(force = false): Promise<void> {
    if (isLoadingProfile) {
      return;
    }
    if (hasLoadedProfile && !force) {
      return;
    }

    const accessToken = requireAccessToken('load');
    if (!accessToken) {
      return;
    }

    isLoadingProfile = true;
    loadError = null;

    try {
      const user = await getCurrentUserProfile({ accessToken });
      profile = user;
      username = user.username;
      hasLoadedProfile = true;
    } catch (error) {
      if (error instanceof ApiError) {
        if (await handleUnauthorized(error)) {
          return;
        }
        loadError = error.message;
      } else {
        loadError = NETWORK_ERROR_MESSAGE;
      }
      hasLoadedProfile = true;
    } finally {
      isLoadingProfile = false;
    }
  }

  async function handleProfileSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (isProfileSubmitting || profile === null) {
      return;
    }

    const normalizedUsername = username.trim();

    profileError = validateUsername(normalizedUsername);
    if (profileError) {
      return;
    }

    if (normalizedUsername === profile.username) {
      profileError = '現在と同じユーザー名です';
      return;
    }

    const accessToken = requireAccessToken('profile');
    if (!accessToken) {
      return;
    }

    isProfileSubmitting = true;
    profileError = null;

    try {
      const data = await updateCurrentUsername({
        accessToken,
        username: normalizedUsername
      });
      authStore.updateUser({
        id: data.user.id,
        username: data.user.username,
        role: data.user.role
      });

      profile = { ...profile, username: data.user.username };
      username = data.user.username;
      toastStore.success('ユーザー名を変更しました');
    } catch (error) {
      if (error instanceof ApiError) {
        if (await handleUnauthorized(error)) {
          return;
        }
        profileError = error.message;
        toastStore.fromApiError(error);
      } else {
        profileError = NETWORK_ERROR_MESSAGE;
        toastStore.error(profileError);
      }
    } finally {
      isProfileSubmitting = false;
    }
  }

  async function handlePasswordSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (isPasswordSubmitting) {
      return;
    }

    const normalizedCurrentPassword = currentPassword.trim();
    const normalizedNewPassword = newPassword.trim();
    const normalizedConfirmPassword = confirmPassword.trim();

    passwordFormError = null;
    currentPasswordError = validateCurrentPassword(normalizedCurrentPassword);
    newPasswordError = validatePassword(normalizedNewPassword);
    if (!newPasswordError && normalizedCurrentPassword === normalizedNewPassword) {
      newPasswordError = '新しいパスワードは現在のパスワードと異なるものにしてください';
    }
    confirmPasswordError = validateConfirmPassword(
      normalizedNewPassword,
      normalizedConfirmPassword
    );
    if (currentPasswordError || newPasswordError || confirmPasswordError) {
      await tick();
      const firstInvalidInput = currentPasswordError
        ? currentPasswordInput
        : newPasswordError
          ? newPasswordInput
          : confirmPasswordInput;
      firstInvalidInput?.focus();
      return;
    }

    const accessToken = requireAccessToken('password');
    if (!accessToken) {
      return;
    }

    isPasswordSubmitting = true;

    try {
      await changeCurrentPassword({
        accessToken,
        currentPassword: normalizedCurrentPassword,
        newPassword: normalizedNewPassword
      });

      currentPassword = '';
      newPassword = '';
      confirmPassword = '';
      toastStore.success('パスワードを変更しました');
      await authStore.logout();
      await goto('/login');
    } catch (error) {
      if (error instanceof ApiError) {
        if (await handleUnauthorized(error)) {
          return;
        }
        passwordFormError = error.message;
        toastStore.fromApiError(error);
      } else {
        passwordFormError = NETWORK_ERROR_MESSAGE;
        toastStore.error(passwordFormError);
      }
    } finally {
      isPasswordSubmitting = false;
    }
  }

  async function handleDeleteSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (isDeleting) {
      return;
    }

    const normalizedCurrentPassword = deleteCurrentPassword.trim();

    deleteFormError = null;
    deleteCurrentPasswordError = validateCurrentPassword(normalizedCurrentPassword);
    deleteAcknowledgementError = validateDeleteAcknowledgement(deleteAcknowledged);
    if (deleteCurrentPasswordError || deleteAcknowledgementError) {
      await tick();
      const firstInvalidInput = deleteCurrentPasswordError
        ? deleteCurrentPasswordInput
        : deleteAcknowledgementInput;
      firstInvalidInput?.focus();
      return;
    }

    const accessToken = requireAccessToken('delete');
    if (!accessToken) {
      return;
    }

    const controller = new AbortController();
    deleteRequestAbortController = controller;
    isDeleting = true;

    try {
      await deleteCurrentUser({
        accessToken,
        currentPassword: normalizedCurrentPassword,
        signal: controller.signal
      });

      deleteCurrentPassword = '';
      deleteAcknowledged = false;
      toastStore.success('アカウントを削除しました');
      authStore.completeAccountDeletion();
      await goto('/');
    } catch (error) {
      if (isAbortError(error)) {
        if (!isPageDestroyed) {
          deleteFormError = DELETE_RESULT_UNKNOWN_MESSAGE;
        }
        return;
      }

      if (error instanceof ApiError) {
        if (await handleUnauthorized(error)) {
          return;
        }
        deleteFormError = error.message;
        toastStore.fromApiError(error);
      } else {
        deleteFormError = NETWORK_ERROR_MESSAGE;
        toastStore.error(deleteFormError);
      }
    } finally {
      if (deleteRequestAbortController === controller) {
        deleteRequestAbortController = null;
      }
      if (!isPageDestroyed) {
        isDeleting = false;
      }
    }
  }
</script>

<div class="mx-auto max-w-3xl space-y-8">
  <section>
    <h1 class="text-2xl font-bold text-gray-800">プロフィール設定</h1>
    <p class="mt-2 text-sm text-gray-600">
      ユーザー名変更・パスワード変更・アカウント削除を行えます。
    </p>
  </section>

  {#if isLoadingProfile}
    <section class="rounded-lg border border-gray-200 bg-white p-6">
      <p class="text-sm text-gray-600">プロフィール情報を読み込み中です...</p>
    </section>
  {:else if loadError}
    <section class="rounded-lg border border-red-200 bg-red-50 p-6">
      <p class="text-sm text-red-700">{loadError}</p>
      <button
        type="button"
        onclick={() => loadProfile(true)}
        class="mt-4 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
      >
        再読み込み
      </button>
    </section>
  {:else if profile}
    <section class="rounded-lg border border-gray-200 bg-white p-6">
      <h2 class="text-lg font-semibold text-gray-800">現在のプロフィール</h2>
      <dl class="mt-4 grid gap-3 text-sm text-gray-700 md:grid-cols-2">
        <div>
          <dt class="text-gray-500">ユーザーID</dt>
          <dd class="break-all">{profile.id}</dd>
        </div>
        <div>
          <dt class="text-gray-500">メールアドレス</dt>
          <dd>{profile.email}</dd>
        </div>
        <div>
          <dt class="text-gray-500">ユーザー名</dt>
          <dd>{profile.username}</dd>
        </div>
        <div>
          <dt class="text-gray-500">登録日</dt>
          <dd>{formatCreatedAt(profile.createdAt)}</dd>
        </div>
      </dl>
    </section>

    <section class="rounded-lg border border-gray-200 bg-white p-6">
      <h2 class="text-lg font-semibold text-gray-800">ユーザー名変更</h2>
      <form class="mt-4 space-y-4" novalidate onsubmit={handleProfileSubmit}>
        {#if profileError}
          <div
            id="profile-error"
            role="alert"
            class="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {profileError}
          </div>
        {/if}

        <div>
          <label for="username" class="block text-sm font-medium text-gray-700"
            >新しいユーザー名</label
          >
          <input
            id="username"
            type="text"
            bind:value={username}
            autocomplete="username"
            aria-invalid={profileError ? 'true' : undefined}
            aria-describedby={profileError ? 'profile-error' : undefined}
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={isProfileSubmitting}
          class="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isProfileSubmitting ? '更新中...' : 'ユーザー名を更新する'}
        </button>
      </form>
    </section>

    <section class="rounded-lg border border-gray-200 bg-white p-6">
      <h2 class="text-lg font-semibold text-gray-800">パスワード変更</h2>
      <p class="mt-1 text-sm text-gray-600">
        変更後はセキュリティのため再ログインが必要になります。
      </p>

      <form class="mt-4 space-y-4" novalidate onsubmit={handlePasswordSubmit}>
        {#if passwordFormError}
          <div
            id="password-form-error"
            role="alert"
            class="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {passwordFormError}
          </div>
        {/if}

        <div>
          <label for="current-password" class="block text-sm font-medium text-gray-700"
            >現在のパスワード</label
          >
          <input
            id="current-password"
            type="password"
            bind:value={currentPassword}
            bind:this={currentPasswordInput}
            autocomplete="current-password"
            aria-invalid={currentPasswordError ? 'true' : undefined}
            aria-describedby={currentPasswordError ? 'current-password-error' : undefined}
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
          {#if currentPasswordError}
            <p id="current-password-error" class="mt-1 text-sm text-red-600">
              {currentPasswordError}
            </p>
          {/if}
        </div>

        <div>
          <label for="new-password" class="block text-sm font-medium text-gray-700"
            >新しいパスワード</label
          >
          <input
            id="new-password"
            type="password"
            bind:value={newPassword}
            bind:this={newPasswordInput}
            autocomplete="new-password"
            aria-invalid={newPasswordError ? 'true' : undefined}
            aria-describedby={newPasswordError
              ? 'new-password-hint new-password-error'
              : 'new-password-hint'}
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
          <p id="new-password-hint" class="mt-1 text-sm text-gray-600">
            {PASSWORD_BYTE_LIMIT_HINT}
          </p>
          {#if newPasswordError}
            <p id="new-password-error" class="mt-1 text-sm text-red-600">
              {newPasswordError}
            </p>
          {/if}
        </div>

        <div>
          <label for="confirm-password" class="block text-sm font-medium text-gray-700"
            >新しいパスワード（確認）</label
          >
          <input
            id="confirm-password"
            type="password"
            bind:value={confirmPassword}
            bind:this={confirmPasswordInput}
            autocomplete="new-password"
            aria-invalid={confirmPasswordError ? 'true' : undefined}
            aria-describedby={confirmPasswordError ? 'confirm-password-error' : undefined}
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
          {#if confirmPasswordError}
            <p id="confirm-password-error" class="mt-1 text-sm text-red-600">
              {confirmPasswordError}
            </p>
          {/if}
        </div>

        <button
          type="submit"
          disabled={isPasswordSubmitting}
          class="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPasswordSubmitting ? '更新中...' : 'パスワードを変更する'}
        </button>
      </form>
    </section>

    <section class="rounded-lg border border-red-200 bg-red-50 p-6">
      <h2 class="text-lg font-semibold text-red-800">アカウント削除</h2>
      <p id="delete-warning" class="mt-1 text-sm text-red-700">
        この操作は取り消せません。プロフィール情報・認証情報・学習データを稼働DBから物理削除します。
      </p>

      <form class="mt-4 space-y-4" novalidate aria-busy={isDeleting} onsubmit={handleDeleteSubmit}>
        {#if deleteFormError}
          <div
            id="delete-form-error"
            role="alert"
            class="rounded-md border border-red-300 bg-white px-4 py-3 text-sm text-red-800"
          >
            {deleteFormError}
          </div>
        {/if}

        <div>
          <label for="delete-current-password" class="block text-sm font-medium text-red-900"
            >現在のパスワード</label
          >
          <input
            id="delete-current-password"
            type="password"
            bind:value={deleteCurrentPassword}
            bind:this={deleteCurrentPasswordInput}
            autocomplete="current-password"
            aria-invalid={deleteCurrentPasswordError ? 'true' : undefined}
            aria-describedby={deleteCurrentPasswordError
              ? 'delete-current-password-error'
              : undefined}
            class="mt-1 w-full rounded-md border border-red-300 bg-white px-3 py-2 focus:border-red-500 focus:ring-1 focus:ring-red-500 focus:outline-none"
          />
          {#if deleteCurrentPasswordError}
            <p id="delete-current-password-error" class="mt-1 text-sm text-red-700">
              {deleteCurrentPasswordError}
            </p>
          {/if}
        </div>

        <label class="flex items-start gap-2 text-sm text-red-900">
          <input
            type="checkbox"
            bind:checked={deleteAcknowledged}
            bind:this={deleteAcknowledgementInput}
            aria-invalid={deleteAcknowledgementError ? 'true' : undefined}
            aria-describedby={deleteAcknowledgementError
              ? 'delete-warning delete-acknowledgement-error'
              : 'delete-warning'}
            class="mt-0.5 h-4 w-4 rounded border-red-300 text-red-600 focus:ring-red-500"
          />
          <span>上記の内容を確認し、アカウントを削除することに同意します。</span>
        </label>
        {#if deleteAcknowledgementError}
          <p id="delete-acknowledgement-error" class="text-sm text-red-700">
            {deleteAcknowledgementError}
          </p>
        {/if}

        <button
          type="submit"
          disabled={isDeleting}
          class="rounded-md bg-red-600 px-4 py-2 text-white hover:bg-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isDeleting ? '削除中...' : 'アカウントを削除する'}
        </button>
      </form>
    </section>
  {/if}
</div>
