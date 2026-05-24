# メール認証完了ページ（/verify-email）実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes）
> 対象実装者: ジュニア開発者（Sonnet）

## 概要

ユーザーが登録メール内のリンク（`/verify-email?token=xxxxx`）をクリックしてアクセスしたときに、URL クエリパラメータからトークンを取得し、自動的にバックエンドの `POST /api/v1/auth/verify-email` にトークンを送信してメール認証を完了させる UI モックを実装する。フェーズ3「UI モック（アカウント管理）」の一部。

---

## 前提条件・依存関係

### 既存の実装（公開インターフェース・変更禁止）

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL: string` — `/api/v1` まで含むベース URL。`import.meta.env.VITE_API_BASE_URL` の値

**`frontend/src/lib/api/errors.ts`**
- `class ApiError extends Error`
  - `constructor(status: number, message: string, body?: unknown | null)`
  - `status: number` — HTTP ステータスコード（または 0 はネットワークエラー）
  - `message: string` — 表示用エラーメッセージ
  - `body: unknown | null` — レスポンスボディ

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.success(message: string): string` — 成功トースト（緑・4秒）
- `toastStore.info(message: string): string` — 情報トースト（青・4秒）
- `toastStore.error(message: string): string` — エラートースト（赤・6秒）
- `toastStore.fromApiError(error: ApiError): string` — ApiError からエラートースト

**`frontend/src/lib/stores/auth.svelte.ts`**
- `authStore.isLoggedIn: boolean`
- `authStore.isInitializing: boolean`
- ※ このページは未ログインで開かれる前提のため、認証ガードは不要

**バックエンド `POST /api/v1/auth/verify-email`**
- 認証: 不要
- レート制限: なし
- リクエスト: `{ token: string }`（64文字hex想定だが、送信時はそのまま渡す）
- 成功（200）: `{ message: "メールアドレスを確認しました" }`
- 400「バリデーションエラー」: トークンが64文字hex形式でない
- 400「トークンの有効期限が切れています」: 期限切れ
- 400「既にメールアドレスは確認済みです」: 二重認証
- 404「無効なトークンです」: DB に存在しない
- 500「サーバーエラーが発生しました」: 内部エラー

### 重要な制約

- `lib/api/client.ts` は**未実装・計画中**のため使用禁止。`fetch` を直接呼ぶ（login・register と同じパターン）
- SvelteKit v2 の **`$app/state`** から `page` を import する（`$app/stores` は旧API、使用禁止）
- Svelte 5 **Runes モード**（`$state` / `$effect` / `$derived`）を使用。`export let` や `$:` は使用禁止
- 既存の `routes/verify-email/+page.svelte` はスタブ（2行）。新規作成ではなく**全文書き換え**で実装する
- Prettier 設定: `tabWidth: 2`（既存ファイルに準拠）
- エラーメッセージは**日本語に統一**

---

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/routes/verify-email/+page.svelte` | 修正（全文書換） | メール認証完了ページの実装 |
| `docs/05_progress.md` | 修正 | タスク完了マーク（`[ ]` → `[x]`） |

---

## 設計上の決定事項（実装前に確定済み）

### 1. 状態管理: 単一の `status` ユニオン文字列で管理する

- **選択**: `let status = $state<'verifying' | 'success' | 'error'>('verifying')` を採用
- **根拠**:
  - 3つの排他的な画面状態（ローディング/成功/失敗）を boolean 並列で持つと不整合状態（例: `isVerifying=true` かつ `isSuccess=true`）を許してしまう
  - 既存 `auth.svelte.ts` の `AuthStatus` ユニオン型と同じ設計思想で書ける（プロジェクト内一貫性）
  - `{#if status === 'verifying'}` 〜 `{:else if status === 'success'}` 〜 `{:else}` で UI を簡潔に分岐できる
- **初期値**: `'verifying'`（マウント直後に必ず処理が走るため、`'idle'` を挟む必要はない）

### 2. 「既に認証済み」（400 + 特定メッセージ）は success 扱いにする

- **選択**: バックエンドが `400 "既にメールアドレスは確認済みです"` を返した場合、`status = 'success'` に分岐
- **根拠**:
  - ユーザーの目的（メール認証を完了させる）は既に達成されている状態なので、エラー画面を見せると混乱する
  - 認証メールのリンクを誤って2回クリックしただけのケースが大半
  - 結果として `emailVerified = true` でゴール状態に到達している
- **判定方法**:
  - `error instanceof ApiError && error.status === 400 && error.message === '既にメールアドレスは確認済みです'` で判定
  - メッセージ文字列の完全一致で判定する（バックエンド `auth.service.ts` の文言と一致させる）
- **トースト**: `toastStore.success(...)` ではなく **`toastStore.info('既にメール認証が完了しています')`** を使う（事実と異なる表現を避ける）
- **成功本文表示**: 通常成功時は「メール認証が完了しました！」、既認証時は「既にメール認証が完了しています」とテキストを分けるため、`alreadyVerified: boolean` の状態も `$state` で別途持つ

### 3. トークン未指定時のガード: API 呼び出し前にローカルで弾く

- **選択**: `page.url.searchParams.get('token')` が `null` または空文字の場合、API を呼ばずに即 `status = 'error'`
- **根拠**:
  - 確実に失敗するリクエストを送信するのは帯域・サーバー負荷の無駄
  - ユーザーへの即時フィードバックで UX が向上
  - バックエンドが zod で再検証するため二重防御になる
- **やらないこと**: 64文字hex形式チェック（バックエンドの zod と二箇所管理になるため）。形式エラーは API レスポンスに任せる
- **エラーメッセージ**: `'認証リンクが無効です。メール内のリンクから再度アクセスしてください。'`

### 4. 自動遷移: 成功時 3 秒カウントダウン後に `/login` へ自動 `goto`

- **選択**: 成功（通常 / 既認証 両方）時に `setTimeout(() => goto('/login'), 3000)` で自動遷移
- **根拠**: ユーザー指定要件
- **クリーンアップ**: `onMount` の return 関数で `clearTimeout` を呼び、コンポーネントアンマウント時にタイマーをキャンセル（メモリリーク・遷移後の意図しない再 goto を防ぐ）
- **手動遷移ボタン**: 「今すぐログイン」ボタンも併設し、カウントダウンを待たずに進めるようにする
- **カウントダウン表示**: `let countdown = $state(3)` + `setInterval` で「3秒後に...」「2秒後に...」と表示

### 5. ネットワークエラーは `ApiError(0, ...)` にラップして UI を一元化

- **選択**: `fetch` 自体が例外を投げた場合は `catch` 内で `new ApiError(0, '通信に失敗しました。ネットワーク接続を確認してください。')` を生成して `status = 'error'` 経路に乗せる
- **根拠**:
  - UI 層で `ApiError` だけ扱えば済むようにする
  - `errors.ts` の JSDoc にも「`status: 0` はネットワークエラー」と明記されている設計と一致する

### 6. `$effect` ではなく `onMount` を使う

- **選択**: API 呼び出しのトリガーは `onMount` を使う
- **根拠**:
  - `$effect` は依存変数の変化で再実行されるため、二重 API 呼び出しのリスクがある
  - `onMount` はマウント時 1 回だけ実行されることが保証される
  - SSR では実行されない（ブラウザ専用）ため、`window` 依存や `fetch` の SSR 問題も自動的に回避できる

---

## 公開インターフェース案

このページはルートコンポーネントのみで、外部に export するインターフェースはない。
内部で使う型・状態のみ以下に記載：

```typescript
// 画面状態のユニオン型
type VerifyStatus = 'verifying' | 'success' | 'error';

// $state で管理する変数
let status: VerifyStatus;          // 現在の画面状態
let errorMessage: string | null;   // 失敗時のメッセージ（バックエンドからそのまま）
let alreadyVerified: boolean;      // success 時に「既に認証済み」だったかのフラグ
let countdown: number;             // 成功時の自動遷移までの残り秒数
```

---

## タスクリスト（進捗管理）

- [ ] T1: スタブを置き換え、`<script lang="ts">` ブロックを追加し、import 一式と `$state` 変数を定義
- [ ] T2: `onMount` 内に処理フローを実装（トークン取得 → ガード → fetch → 成功/失敗分岐）
- [ ] T3: 「既に認証済み」判定ロジックを実装（400 + 特定メッセージの判定）
- [ ] T4: 成功時のカウントダウン + `goto('/login')` + `clearTimeout`/`clearInterval` クリーンアップを実装
- [ ] T5: 3 状態 UI（verifying / success / error）を Tailwind で実装
- [ ] T6: アクセシビリティ属性（`role="status"` / `aria-live` / `role="alert"`）を追加
- [ ] T7: トースト通知の組み込み（成功・既認証・失敗の3パターン）
- [ ] T8: 動作確認（Mailpit でメール受信 → リンククリック → 成功/期限切れ/不正トークン/トークン無しの各パスを確認）
- [ ] T9: `docs/05_progress.md` の該当タスクを `[x]` に更新
- [ ] T10: 計画書（このファイル）に「実装完了」セクションを追記

| タスクID | 内容 | ファイル | 優先度 |
|---|---|---|---|
| T1 | script ブロック + 状態定義 | `frontend/src/routes/verify-email/+page.svelte` | 高 |
| T2 | onMount の API 呼び出しロジック | 同上 | 高 |
| T3 | 既認証判定ロジック | 同上 | 高 |
| T4 | カウントダウン + 自動遷移 | 同上 | 高 |
| T5 | 3 状態 UI 実装 | 同上 | 高 |
| T6 | アクセシビリティ属性 | 同上 | 中 |
| T7 | トースト組み込み | 同上 | 高 |
| T8 | 動作確認 | (手動) | 高 |
| T9 | 進捗ファイル更新 | `docs/05_progress.md` | 高 |
| T10 | 計画書の実装完了セクション追記 | このファイル | 高 |

---

## 実装フロー（疑似コード）

```typescript
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { API_BASE_URL } from '$lib/api/config';
  import { ApiError } from '$lib/api/errors';
  import { toastStore } from '$lib/stores/toast.svelte';

  type VerifyStatus = 'verifying' | 'success' | 'error';

  let status = $state<VerifyStatus>('verifying');
  let errorMessage = $state<string | null>(null);
  let alreadyVerified = $state(false);
  let countdown = $state(3);

  // 「既に認証済み」を判定する定数（バックエンドのメッセージと一致させる）
  const ALREADY_VERIFIED_MESSAGE = '既にメールアドレスは確認済みです';

  onMount(() => {
    let redirectTimerId: ReturnType<typeof setTimeout> | null = null;
    let countdownIntervalId: ReturnType<typeof setInterval> | null = null;

    async function verify() {
      // 1. トークン取得 + ガード
      const token = page.url.searchParams.get('token');
      if (!token) {
        status = 'error';
        errorMessage = '認証リンクが無効です。メール内のリンクから再度アクセスしてください。';
        return;
      }

      // 2. API 呼び出し（login/register と同じ fetch パターン）
      try {
        const response = await fetch(`${API_BASE_URL}/auth/verify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        if (!response.ok) {
          let errorBody: { error?: string; details?: { message: string }[] } | null = null;
          try {
            errorBody = await response.json();
          } catch {
            // 非 JSON レスポンス（502/504 等）
          }
          const message =
            errorBody?.details?.[0]?.message ?? errorBody?.error ?? 'エラーが発生しました';
          throw new ApiError(response.status, message, errorBody);
        }

        await response.json();

        // 3a. 通常成功
        status = 'success';
        alreadyVerified = false;
        toastStore.success('メール認証が完了しました！');
        startCountdownAndRedirect();
      } catch (error) {
        // ApiError でも fetch 例外でも一律 ApiError として扱う
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError(0, '通信に失敗しました。ネットワーク接続を確認してください。');

        // 3b. 「既に認証済み」は success として扱う
        if (apiError.status === 400 && apiError.message === ALREADY_VERIFIED_MESSAGE) {
          status = 'success';
          alreadyVerified = true;
          toastStore.info('既にメール認証が完了しています');
          startCountdownAndRedirect();
          return;
        }

        // 3c. それ以外はエラー
        status = 'error';
        errorMessage = apiError.message;
        toastStore.fromApiError(apiError);
      }
    }

    function startCountdownAndRedirect() {
      countdownIntervalId = setInterval(() => {
        countdown -= 1;
        if (countdown <= 0 && countdownIntervalId !== null) {
          clearInterval(countdownIntervalId);
          countdownIntervalId = null;
        }
      }, 1000);
      redirectTimerId = setTimeout(() => {
        goto('/login');
      }, 3000);
    }

    verify();

    // クリーンアップ
    return () => {
      if (redirectTimerId !== null) clearTimeout(redirectTimerId);
      if (countdownIntervalId !== null) clearInterval(countdownIntervalId);
    };
  });
</script>
```

---

## UI レイアウト構成（Tailwind）

```svelte
<div class="mx-auto max-w-md px-4 py-8">
  <h1 class="text-2xl font-bold text-gray-800">メール認証</h1>

  <div class="mt-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
    {#if status === 'verifying'}
      <div role="status" aria-live="polite" class="flex flex-col items-center gap-4 py-8">
        <!-- スピナー SVG -->
        <p class="text-gray-700">認証中です。しばらくお待ちください...</p>
      </div>
    {:else if status === 'success'}
      <div class="flex flex-col items-center gap-4 py-4 text-center">
        <!-- チェックマーク SVG（緑） -->
        <p class="text-lg font-medium text-gray-800">
          {alreadyVerified ? '既にメール認証が完了しています' : 'メール認証が完了しました！'}
        </p>
        <p class="text-sm text-gray-500">{countdown}秒後にログイン画面に移動します</p>
        <a
          href="/login"
          class="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
        >
          今すぐログイン
        </a>
      </div>
    {:else}
      <div role="alert" class="flex flex-col items-center gap-4 py-4 text-center">
        <!-- エラーアイコン SVG（赤） -->
        <p class="text-lg font-medium text-gray-800">認証に失敗しました</p>
        <p class="text-sm text-red-700">{errorMessage}</p>
        <div class="flex flex-col gap-2 sm:flex-row">
          <a
            href="/register"
            class="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
          >
            再度ユーザー登録する
          </a>
          <a
            href="/login"
            class="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
          >
            ログイン画面へ
          </a>
        </div>
      </div>
    {/if}
  </div>
</div>
```

※ スピナー・チェック・エラーの SVG はインラインで実装（外部依存追加禁止）。register ページのアイコン記述パターンに倣う。

---

## 技術的注意点（ジュニア開発者向け・必読）

1. **`$effect` を使わない**: API トリガーは必ず `onMount` を使う。`$effect` は再実行リスクあり
2. **`$app/state` を使う**: `$app/stores` は旧 API。SvelteKit v2 では `$app/state` の `page` を使う（**store ではなく runes 対応のオブジェクト**なので `$page` ではなく `page.url` のようにアクセス）
3. **クリーンアップを忘れない**: `setTimeout` / `setInterval` は `onMount` の return 関数で必ず `clearTimeout` / `clearInterval` する。これを忘れると、ユーザーが手動で `/login` に遷移した直後に再度 `goto('/login')` が走るバグになる
4. **既認証メッセージ文字列の完全一致**: バックエンド `auth.service.ts` line 326 の `"既にメールアドレスは確認済みです"` と完全一致させる。typo すると判定が機能しない
5. **`response.ok` チェックを JSON パースより先に**: 非 JSON レスポンス（502 等）が来た時の例外を防ぐ（login/register と同じパターン）
6. **正常系の JSON は await しても使わない**: `await response.json()` で受け取ったボディは使用しないが、ストリームを閉じるために await はする
7. **ネットワークエラーは `ApiError(0, ...)` にラップ**: try-catch 内で `error instanceof ApiError ? error : new ApiError(0, '...')` の三項演算で一元化する
8. **`countdown` の表示は 3→2→1**: 0 になったら `clearInterval` で止める。UI 上は「{countdown}秒後に」と表示するため、0 を表示しないように間隔と setTimeout のタイミングを合わせる
9. **インデント**: Prettier `tabWidth: 2` に従う（既存ファイル参照）
10. **Prettier フォーマット必須**: 実装後に `cd frontend && npm run format` を実行する

---

## テストケース一覧（動作確認用）

| ケース | URL | 期待結果 |
|---|---|---|
| 正常系: 有効なトークン | `/verify-email?token=<有効な64文字hex>` | success 画面 + 「メール認証が完了しました！」+ 3秒後 `/login` へ遷移 |
| 既認証: 同じトークンを2回使う | （2回目のクリック） | success 画面 + 「既にメール認証が完了しています」+ info トースト + `/login` 遷移 |
| 期限切れ | （24時間以上経過したトークン） | error 画面 + 「トークンの有効期限が切れています」+ `/register` リンク |
| 不正なトークン: 64文字hex | `/verify-email?token=<DBに存在しない64文字hex>` | error 画面 + 「無効なトークンです」+ `/register` リンク |
| 不正なトークン: 形式不正 | `/verify-email?token=abc` | error 画面 + 「トークンが不正です」（バリデーションエラーの details[0].message） |
| トークン無し | `/verify-email` | API 呼び出しなし、即 error 画面 + 「認証リンクが無効です...」 |
| 空トークン | `/verify-email?token=` | API 呼び出しなし、即 error 画面 + 「認証リンクが無効です...」 |
| サーバーエラー | （バックエンドを停止した状態） | error 画面 + 「通信に失敗しました...」 |
| 手動遷移ボタン | success 画面で「今すぐログイン」クリック | 即 `/login` 遷移、setTimeout は cleanup でキャンセル |

---

## レビュー観点（実装完了時のセルフチェック）

- [x] `$effect` を使っていない（`onMount` のみ）
- [x] `$app/stores` を import していない（`$app/state` のみ）
- [x] `setTimeout` / `setInterval` のクリーンアップが `onMount` の return で実装されている
- [x] 既認証メッセージ文字列（`"既にメールアドレスは確認済みです"`）がバックエンドと完全一致している
- [x] ネットワークエラーが `ApiError(0, ...)` にラップされている
- [x] 3 状態 UI が `{#if}/{:else if}/{:else}` で正しく分岐している
- [x] アクセシビリティ属性（`role="status"` / `aria-live` / `role="alert"`）が設定されている
- [x] Prettier フォーマット済み（`npm run format`）
- [x] ESLint エラーなし（`npm run lint`）
- [x] `docs/05_progress.md` のタスクが `[x]` に更新されている
- [x] このファイルに「実装完了」セクションが追記されている

---

## 実装完了

- 完了日: 2026-05-24
- 実装ブランチ: feature/phase3-verify-email-page

### 計画からの変更点

なし（計画書通りに実装）

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/routes/verify-email/+page.svelte` | 修正（全文書換） | メール認証完了ページの実装 |
| `docs/05_progress.md` | 修正 | `/register` 完了・`/verify-email` 完了マーク |
