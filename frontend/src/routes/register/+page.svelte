<script lang="ts">
  // フォーム入力値
  let username = $state('');
  let email = $state('');
  let password = $state('');

  // フォーム送信中フラグ（送信中は true にしてボタンを無効化する）
  let isSubmitting = $state(false);

  // 送信成功フラグ（true になったらフォームを隠して完了メッセージを表示）
  let isSuccess = $state(false);

  // フィールドごとのバリデーションエラー
  let usernameError = $state<string | null>(null);
  let emailError = $state<string | null>(null);
  let passwordError = $state<string | null>(null);

  // フォーム共通エラー（API エラー・ネットワークエラー用）
  let formError = $state<string | null>(null);
  // T3: handleSubmit 実装・import 追加（API_BASE_URL, ApiError, toastStore, validateUsername/Email/Password）
  // T6: $effect 実装・import 追加（goto, authStore）
</script>

<div class="mx-auto max-w-md px-4 py-8">
  <h1 class="text-2xl font-bold text-gray-800">ユーザー登録</h1>

  {#if !isSuccess}
    <!-- T4 で完全な UI に置き換える -->
    <form class="mt-6 space-y-4" novalidate>
      {#if formError}
        <p class="text-sm text-red-600">{formError}</p>
      {/if}

      <input bind:value={username} type="text" placeholder="ユーザー名" />
      {#if usernameError}
        <p class="text-sm text-red-600">{usernameError}</p>
      {/if}

      <input bind:value={email} type="email" placeholder="メールアドレス" />
      {#if emailError}
        <p class="text-sm text-red-600">{emailError}</p>
      {/if}

      <input bind:value={password} type="password" placeholder="パスワード" />
      {#if passwordError}
        <p class="text-sm text-red-600">{passwordError}</p>
      {/if}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? '登録中...' : '登録'}
      </button>
    </form>
  {:else}
    <!-- T5: 成功画面 UI -->
  {/if}
  <!-- T7: ログイン画面への導線リンク -->
</div>
