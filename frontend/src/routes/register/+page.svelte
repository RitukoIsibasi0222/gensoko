<script lang="ts">
  import { API_BASE_URL } from '$lib/api/config';
  import { ApiError } from '$lib/api/errors';
  import { toastStore } from '$lib/stores/toast.svelte';
  import { validateUsername, validateEmail, validatePassword } from './validation';

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

  // T6: $effect 実装・import 追加（goto, authStore）

  /**
   * フォーム送信ハンドラー（ユーザー登録処理）
   */
  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    // 多重送信防止: 送信中は早期リターン
    if (isSubmitting) {
      return;
    }

    // 正規化値を一度だけ計算し、バリデーションと送信の両方で共用する
    const normalizedUsername = username.trim();
    const normalizedEmail = email.trim();
    const normalizedPassword = password.trim();

    // フィールドごとにバリデーションを実行し、エラーを state にセットする
    usernameError = validateUsername(normalizedUsername);
    emailError = validateEmail(normalizedEmail);
    passwordError = validatePassword(normalizedPassword);

    if (usernameError || emailError || passwordError) {
      return;
    }

    // フォーム共通エラーをクリアして送信開始
    formError = null;
    isSubmitting = true;

    try {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: normalizedUsername,
          email: normalizedEmail,
          password: normalizedPassword
        })
      });

      // response.ok チェックを先に行う（JSON パース前に HTTP ステータスを確認）
      if (!response.ok) {
        let errorBody: { error?: string } | null = null;
        try {
          errorBody = await response.json();
        } catch {
          // JSON パース失敗時（502/504 等の非 JSON レスポンス）は null のまま
        }
        throw new ApiError(response.status, errorBody?.error || 'エラーが発生しました', errorBody);
      }

      // 登録成功: 成功フラグを立てて完了トーストを表示
      isSuccess = true;
      toastStore.success('確認メールを送信しました');
    } catch (error) {
      if (error instanceof ApiError) {
        formError = error.message;
      } else {
        formError = 'ネットワークエラーが発生しました。しばらく経ってから再試行してください';
      }
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="mx-auto max-w-md px-4 py-8">
  <h1 class="text-2xl font-bold text-gray-800">ユーザー登録</h1>

  {#if !isSuccess}
    <!-- T4 で完全な UI に置き換える -->
    <form class="mt-6 space-y-4" novalidate onsubmit={handleSubmit}>
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
