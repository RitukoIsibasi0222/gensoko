# パスワードリセット画面（/reset-password）実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes）
> 対象実装者: ジュニア開発者（Sonnet）

## 概要

パスワードリセットメール内のリンク（`/reset-password?token=xxxxx`）からアクセスしたユーザーが、新しいパスワードを入力して `POST /api/v1/auth/reset-password` を呼び出し、パスワードを再設定する画面を実装する。フェーズ3「UI モック（アカウント管理）」の一部。

成功時は同一画面内で完了メッセージに切り替え、`/login` への導線を提示する。バックエンドは成功時に全リフレッシュトークンを削除するため、フロントは認証状態を更新しない（リセット完了後は再ログインを促す）。

---

## 前提条件・依存関係

### 既存の実装（公開インターフェース・変更禁止）

**[frontend/src/lib/api/config.ts](../../../frontend/src/lib/api/config.ts)**
- `API_BASE_URL: string` — `/api/v1` まで含むベース URL。`import.meta.env.VITE_API_BASE_URL` を直接書かず、必ずここから import する

**[frontend/src/lib/api/errors.ts](../../../frontend/src/lib/api/errors.ts)**
- `class ApiError extends Error`
  - `constructor(status: number, message: string, body?: unknown | null)`
- `parseErrorBody(response: Response): Promise<ErrorBody>` — JSON パース失敗時は null を返す
- `parseErrorResponse(response: Response, defaultMessage?: string): Promise<never>` — `details[0].message` → `error` → `defaultMessage` の優先順で ApiError を throw

**[frontend/src/lib/stores/toast.svelte.ts](../../../frontend/src/lib/stores/toast.svelte.ts)**
- `toastStore.success(message: string): string`
- `toastStore.error(message: string): string`
- `toastStore.fromApiError(error: ApiError): string`

**[frontend/src/lib/stores/auth.svelte.ts](../../../frontend/src/lib/stores/auth.svelte.ts)**
- `authStore.isInitializing: boolean` — refresh トークン検証中は true
- `authStore.isLoggedIn: boolean`

**[frontend/src/routes/register/validation.ts](../../../frontend/src/routes/register/validation.ts)**
- `validatePassword(value: string): string | null` — trim 済みのパスワード文字列に対して空欄／スペース禁止／8文字以上／大文字／小文字／数字／記号 を順に検証する。**バックエンドの `strongPasswordSchema` と完全に同じルール・同じ文言**

> ※ reset-password でも同じパスワード強度ルールが必要。route 間 import（`reset-password` から `register/validation.ts` を直接参照）を避けるため、後述のとおり `validatePassword` の本体を `frontend/src/lib/validation/password.ts` に移動し、`register/validation.ts` は再エクスポートのみとする。**register 側の公開シグネチャ・文言は変更しない**ため、register/validation.test.ts は触らずに通る前提。

**バックエンド `POST /api/v1/auth/reset-password`**（[backend/src/routes/auth/index.ts](../../../backend/src/routes/auth/index.ts) / [backend/src/services/auth.service.ts](../../../backend/src/services/auth.service.ts)）
- 認証: 不要
- レート制限: あり（10分10回・forgot-password と共通の `authRateLimit`）
- リクエスト: `{ token: string, password: string }`
  - `token`: `/^[0-9a-f]{64}$/`（64文字 hex 固定）
  - `password`: `strongPasswordSchema` 準拠
- 成功（200）: `{ message: "パスワードをリセットしました" }`
  - サーバー側で全リフレッシュトークン削除済み（全デバイスから自動ログアウト）
- 400「バリデーションエラー」: token 形式不正 / パスワード強度不足（`details` あり）
- 400「トークンの有効期限が切れています」: 期限切れ
- 400「無効または期限切れのトークンです」: トランザクション内競合（並行リクエスト・期限切れの再判定）
- 404「無効なトークンです」: DB に存在しない
- 429: レート制限超過
- 500「サーバーエラーが発生しました」: 内部エラー

### 参照する既存実装パターン

- [frontend/src/routes/forgot-password/+page.svelte](../../../frontend/src/routes/forgot-password/+page.svelte) — `isSuccess` boolean による成功画面切替・正規化値の一度計算・`parseErrorResponse` 利用・既ログイン時リダイレクト
- [frontend/src/routes/register/+page.svelte](../../../frontend/src/routes/register/+page.svelte) — フィールド別エラー＋フォーム共通エラー併用パターン・パスワード入力欄の表示/非表示トグル・成功時に state クリア
- [frontend/src/routes/verify-email/+page.svelte](../../../frontend/src/routes/verify-email/+page.svelte) — `page.url.searchParams.get('token')` 取得 → `storedToken` 保持 → `replaceState` で URL から token 除去するパターン

### 重要な制約

- `import.meta.env.VITE_API_BASE_URL` を直接書かず、必ず `API_BASE_URL` を import する
- 正規化値（`password.trim()` / `confirmPassword.trim()`）は `handleSubmit` 冒頭で**一度だけ**計算し、validate と fetch の両方で同じ変数を使う
- **`response.ok` チェック → エラー時のみ `parseErrorResponse` 呼び出し**の順序を守る（JSON パース先行禁止）
- バックエンドの `details[0].message` / `error` を固定文言で上書きしない（`parseErrorResponse` がこの優先順を保証する）
- token は URL から取得後すぐに `replaceState` で query から除去する（URL 共有・履歴・サーバーログへの token 露出を最小化。verify-email と同一パターン）
- token が空・欠落の場合は API を呼ばずローカルでエラー画面に遷移する
- エラーメッセージはすべて日本語
- Svelte 5 Runes（`$state` / `$effect`）のみ使用。`export let` や `$:` は禁止
- Prettier 設定: `tabWidth: 2`
- 既存の [frontend/src/routes/reset-password/+page.svelte](../../../frontend/src/routes/reset-password/+page.svelte) は 2 行のスタブ。**全文書き換え**で実装する
- 成功後も `authStore.login()` は呼ばない（再ログインさせる）

---

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/validation/password.ts` | 新規 | `validatePassword` 本体をここに移動（register/validation.ts と reset-password から共用） |
| [frontend/src/routes/register/validation.ts](../../../frontend/src/routes/register/validation.ts) | 修正 | `validatePassword` を `$lib/validation/password` から再エクスポートに切替（公開シグネチャ・文言は不変） |
| [frontend/src/routes/reset-password/+page.svelte](../../../frontend/src/routes/reset-password/+page.svelte) | 修正（全文書換） | URL token 取得・パスワードフォーム・確認欄・送信処理・成功画面・既ログイン時リダイレクト |
| [docs/05_progress.md](../../05_progress.md) | 修正 | 該当タスクを `[ ]` → `[x]` に更新 |
| docs/plans/reset-password-page/plan.md（本ファイル） | 修正 | 実装完了セクション追記 |

> **判断（共通化のスコープ）**: token 形式（64文字 hex）の事前バリデーションはフロントで持たない（バックエンドに委譲）。理由: 検証ロジックの二重管理を避けるため。同様の前例として、メール形式検証は簡易チェック止まりで RFC 準拠検証はバックエンドに委ねている。
>
> **判断（register 既存テスト）**: `validatePassword` は **同一文言・同一シグネチャのまま** `lib/validation/password.ts` に移動し、register/validation.ts は `export { validatePassword } from '$lib/validation/password';` の再エクスポートのみにする。register/validation.test.ts は import 経路が変わらず、テストもそのまま通る。**register/validation.test.ts は変更しない**。

---

## API 仕様（この機能で使う範囲のみ）

### エンドポイント

| メソッド | パス | 認証 | レート制限 |
|---|---|---|---|
| POST | `/auth/reset-password` | 不要 | 10分10回 |

### リクエスト

```json
{
  "token": "a1b2c3...（64文字hex）",
  "password": "NewPass1!"
}
```

### レスポンス

| ステータス | ボディ | 発生条件 |
|---|---|---|
| 200 | `{ "message": "パスワードをリセットしました" }` | 正常完了（全 RT もサーバー側で削除済み） |
| 400 | `{ "error": "バリデーションエラー", "details": [...] }` | token 形式不正 / パスワード強度不足 |
| 400 | `{ "error": "トークンの有効期限が切れています" }` | 期限切れ |
| 400 | `{ "error": "無効または期限切れのトークンです" }` | 並行リクエスト等で競合 |
| 404 | `{ "error": "無効なトークンです" }` | DB に存在しない |
| 429 | `{ "error": "..." }` | レート制限超過 |
| 500 | `{ "error": "サーバーエラーが発生しました" }` | 内部エラー |

### `credentials` 方針

- 認証不要・Cookie 不要なエンドポイントのため、`credentials` オプションは付与しない（forgot-password と同様）

---

## 設計上の決定事項

### 1. 既ログイン時はトップへリダイレクトする

- **選択**: `$effect` で `!authStore.isInitializing && authStore.isLoggedIn` を監視し `goto('/')`
- **根拠**: login / register / forgot-password と同一パターン。リセット導線はそもそも未ログイン前提

### 2. 状態管理は `isSuccess` boolean を採用する（status ユニオンではない）

- **選択**: `let isSuccess = $state(false)` でフォームと完了画面を切り替える。エラー表示は `fieldError`（password / confirmPassword）と `formError`（API / ネットワーク / token 欠落）を併用
- **根拠**:
  - verify-email と異なり「マウント直後の自動 API 呼び出し」がないため、`verifying` 状態は不要
  - forgot-password / register と同一パターンに揃えることでレビューしやすい
  - token 欠落時は `formError` にメッセージを入れて API を呼ばないだけで対応できる（独立した `status` を作る必要がない）

### 3. token は onMount 時に取得し URL から除去する（verify-email と同一パターン）

- **選択**: `onMount` 内で `page.url.searchParams.get('token')` を取得して `storedToken` 変数に保存し、直後に `replaceState` で URL から `token` を削除する
- **根拠**:
  - URL 共有・ブラウザ履歴・サーバーアクセスログへの token 漏えいリスクを低減
  - verify-email で採用済みの実績あるパターン
  - token はバックエンドに送るためコンポーネントスコープで保持する必要がある
- **token なし時の挙動**: API を呼ばずに `formError = 'リセットリンクが無効です。メール内のリンクから再度アクセスしてください。'` を表示し、送信ボタンを `disabled` にする

### 4. パスワード強度検証は共通関数を使い register と完全一致させる

- **選択**: `validatePassword` の本体を `$lib/validation/password.ts` に移動し、register と reset-password の双方から import する
- **根拠**:
  - バックエンドの `strongPasswordSchema` は両エンドポイントで共通。フロント側も 1 箇所で管理しないとルール乖離が発生する
  - reset-password 専用に同等ロジックを書くと「冗長な実装をしない」規約に反する
  - register 側は再エクスポートでシグネチャ・文言が完全に不変。既存テストは触らない

### 5. 確認用パスワード入力欄を設ける

- **選択**: `password` と `confirmPassword` の 2 フィールドを用意し、不一致時は「確認用パスワードが一致しません」を表示する
- **根拠**:
  - パスワードは `type="password"` でマスクされており、タイポに気づかず送信すると次回ログインで詰む
  - register ではメール認証で復帰可能だが、reset-password で間違えると再度メール申請が必要になり UX が悪化
  - 確認欄のバリデーションは `password.trim() === confirmPassword.trim()` で行い、submit 冒頭の正規化値を再利用する

### 6. エラー処理は `parseErrorResponse` を使う

- **選択**: `if (!response.ok) await parseErrorResponse(response)` パターン
- **根拠**:
  - 非 JSON エラー（502/504）も `parseErrorBody` 内で吸収される
  - `details[0].message` → `error` → デフォルトの優先順が一元化されており、固定文言で上書きするミスを防げる
  - forgot-password / register / verify-email と同一パターン

### 7. 成功後は同一画面で完了メッセージを表示し、自動遷移しない

- **選択**: `isSuccess = true` でフォームを完了画面に置き換え、「ログイン画面へ」ボタンを主導線にする。自動 `goto('/login')` は行わない
- **根拠**:
  - verify-email は「次にやるべき行動が自明（ログインする）」なので自動遷移が UX 向上に寄与するが、reset-password も同様にログインが次の行動である一方、**ユーザーが新しいパスワードを記憶する間（リセット直後）はメッセージを読み切らせたい**
  - 強制遷移を待たずにリンクで進めるシンプルな構造の方が、レビュー・テスト・保守すべてで負担が少ない
  - 成功時に `password` / `confirmPassword` を空文字に戻し、画面遷移しなくてもメモリ上に残らないようにする

### 8. 成功時に authStore を更新しない（再ログインを促す）

- **選択**: 成功時に `authStore.login()` を呼ばず、`/login` へのリンクのみ提示する
- **根拠**:
  - バックエンドが全 RT を削除しているため、たとえ accessToken を発行しても refresh が即失敗する
  - そもそも reset-password レスポンスには accessToken / user が含まれない
  - 新しいパスワードで明示的にログインさせる方がセキュリティ・ユーザー認知の両面で安全

### 9. ネットワークエラーは汎用文言にする

- **選択**: `fetch` が throw した場合は `formError = 'ネットワークエラーが発生しました。接続を確認してください'`
- **根拠**: login / register / forgot-password と統一パターン

---

## 公開インターフェース案

### `frontend/src/lib/validation/password.ts`（新規）

```typescript
/**
 * パスワード強度バリデーション（バックエンドの strongPasswordSchema に準拠）。
 * trim 済みの値を受け取る前提（先頭/末尾スペースは呼び出し元で除去）。
 * 文言は register・reset-password の両画面で同一になる。
 */
export function validatePassword(value: string): string | null;
```

### `frontend/src/routes/register/validation.ts`（修正）

```typescript
// validatePassword は $lib/validation/password に移動。register 側は再エクスポートのみ
export { validatePassword } from '$lib/validation/password';
export function validateUsername(value: string): string | null; // 既存
export function validateEmail(value: string): string | null;    // 既存
```

### `frontend/src/routes/reset-password/+page.svelte`（修正）

```typescript
// $state で管理する変数
let password: string;                    // 新しいパスワード
let confirmPassword: string;             // 確認用パスワード
let showPassword: boolean;               // 表示/非表示トグル
let isSubmitting: boolean;               // 送信中フラグ（多重送信防止）
let isSuccess: boolean;                  // 送信完了フラグ
let passwordError: string | null;        // パスワード入力エラー
let confirmPasswordError: string | null; // 確認入力エラー
let formError: string | null;            // API / ネットワーク / token 欠落エラー
let storedToken: string | null;          // URL から取得して保持する token
```

---

## タスクリスト（進捗管理）

| タスクID | 内容（何を） | ファイル（どこで） | 完了条件 | 依存 | 優先度 |
|---|---|---|---|---|---|
| T1 | `validatePassword` を `$lib/validation/password.ts` に移動 | `frontend/src/lib/validation/password.ts` | 関数本体（文言含む）を register/validation.ts からそのまま移動する | なし | 高 |
| T2 | `register/validation.ts` を再エクスポートに切替 | `frontend/src/routes/register/validation.ts` | `export { validatePassword } from '$lib/validation/password';` 化。`validateUsername` / `validateEmail` は変更しない | T1 | 高 |
| T3 | register の既存テストが通ることを確認 | `frontend/` | `npm run test:run` が通る（**テストファイルは変更しない**） | T2 | 高 |
| T4 | スクリプト骨組み・import 一式・`$state` 変数定義 | `frontend/src/routes/reset-password/+page.svelte` | スタブを置き換え、import と state 変数が出揃う | T1 | 高 |
| T5 | 既ログイン時リダイレクトの `$effect` 実装 | 同上 | 認証済み状態でアクセスすると `/` へ遷移する。初期化中は判定しない | T4 | 高 |
| T6 | `onMount` で token 取得・`replaceState` で URL から除去・`storedToken` 保持 | 同上 | token なし時は `formError` を立て、ある時は `storedToken` に格納されている | T4 | 高 |
| T7 | inline `validatePasswordField` / `validateConfirmPasswordField` 実装 | 同上 | 空欄・強度不足・不一致で日本語エラーを返す。`validatePassword` を再利用する | T4 | 高 |
| T8 | `handleSubmit` 実装（正規化値再利用・多重送信防止・fetch・`parseErrorResponse`） | 同上 | `normalizedPassword` / `normalizedConfirmPassword` を一度だけ計算し validate と fetch の両方で同じ変数を使う。token なし時は早期 return | T6, T7 | 高 |
| T9 | フォーム UI 実装（password / confirmPassword / 表示トグル / aria 属性） | 同上 | キーボード操作可能・aria-invalid / aria-describedby 付与・送信中はボタン disabled・token なし時もボタン disabled | T8 | 高 |
| T10 | 成功画面 UI 実装（`isSuccess` で切替・「ログイン画面へ」リンク） | 同上 | 成功時にフォームが隠れ、`password` / `confirmPassword` が空文字にクリアされる | T9 | 高 |
| T11 | トースト連携（成功時 success・失敗時 formError 表示） | 同上 | 成功時に `toastStore.success('パスワードをリセットしました')` が呼ばれる | T10 | 中 |
| T12 | lint / format / 型チェック | `frontend/` | `npm run lint` `npm run format` `npm run check` が全通過 | T11 | 高 |
| T13 | 既存テストが壊れていないことを確認 | `frontend/` | `npm run test:run` が全通過 | T12 | 高 |
| T14 | 手動疎通確認（Mailpit でメール受信 → リンク踏破 → リセット完了まで） | （手動） | テストケース一覧の全項目を確認しチェック | T13 | 高 |
| T15 | `docs/05_progress.md` のステータス更新 | `docs/05_progress.md` | 該当タスクが `[x]` になる | T14 | 中 |
| T16 | 本計画書に「実装完了」セクション追記 | 本ファイル | 計画書テンプレートに沿って完了情報を記録 | T15 | 中 |

- [ ] T1: `validatePassword` 移動
- [ ] T2: `register/validation.ts` 再エクスポート化
- [ ] T3: register 既存テスト通過確認
- [ ] T4: スクリプト骨組み・import・state 定義
- [ ] T5: 既ログイン時リダイレクト
- [ ] T6: `onMount` token 取得・URL 除去
- [ ] T7: フィールドバリデーション関数
- [ ] T8: `handleSubmit` 実装
- [ ] T9: フォーム UI
- [ ] T10: 成功画面 UI
- [ ] T11: トースト連携
- [ ] T12: lint / format / check
- [ ] T13: 既存テスト全通過確認
- [ ] T14: 手動疎通確認
- [ ] T15: `docs/05_progress.md` 更新
- [ ] T16: 計画書に実装完了セクション追記

---

## 技術的注意点

### 実装フロー（疑似コード）

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto, replaceState } from '$app/navigation';
  import { API_BASE_URL } from '$lib/api/config';
  import { ApiError, parseErrorResponse } from '$lib/api/errors';
  import { validatePassword } from '$lib/validation/password';
  import { authStore } from '$lib/stores/auth.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';

  let password = $state('');
  let confirmPassword = $state('');
  let showPassword = $state(false);
  let isSubmitting = $state(false);
  let isSuccess = $state(false);
  let passwordError = $state<string | null>(null);
  let confirmPasswordError = $state<string | null>(null);
  let formError = $state<string | null>(null);
  let storedToken = $state<string | null>(null);

  // 既ログイン時はトップへ
  $effect(() => {
    if (!authStore.isInitializing && authStore.isLoggedIn) {
      goto('/');
    }
  });

  // onMount で token を取り出し URL から除去（verify-email と同一パターン）
  onMount(() => {
    const rawToken = page.url.searchParams.get('token');
    if (!rawToken) {
      formError = 'リセットリンクが無効です。メール内のリンクから再度アクセスしてください。';
      return;
    }
    storedToken = rawToken;

    const cleanUrl = new URL(page.url);
    cleanUrl.searchParams.delete('token');
    replaceState(cleanUrl.pathname + cleanUrl.search + cleanUrl.hash, page.state);
  });

  /** trim 済みパスワードを受け取る */
  function validatePasswordField(value: string): string | null {
    return validatePassword(value); // register と同一文言の共通関数
  }

  /** trim 済みの password / confirmPassword を受け取り、一致判定する */
  function validateConfirmPasswordField(
    normalizedPassword: string,
    normalizedConfirmPassword: string
  ): string | null {
    if (!normalizedConfirmPassword) return '確認用パスワードを入力してください';
    if (normalizedPassword !== normalizedConfirmPassword) {
      return '確認用パスワードが一致しません';
    }
    return null;
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;          // 多重送信防止
    if (!storedToken) {                 // token なし時は API を呼ばない
      formError ??= 'リセットリンクが無効です。メール内のリンクから再度アクセスしてください。';
      return;
    }

    // 正規化値を一度だけ計算し、validate と fetch の両方で共用する
    const normalizedPassword = password.trim();
    const normalizedConfirmPassword = confirmPassword.trim();

    formError = null;
    passwordError = validatePasswordField(normalizedPassword);
    confirmPasswordError = validateConfirmPasswordField(
      normalizedPassword,
      normalizedConfirmPassword
    );
    if (passwordError || confirmPasswordError) return;

    isSubmitting = true;
    try {
      const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: storedToken, password: normalizedPassword })
      });

      if (!response.ok) {
        await parseErrorResponse(response);
      }

      // 成功: パスワードを state からクリアしてから成功表示に切り替える
      password = '';
      confirmPassword = '';
      showPassword = false;
      isSuccess = true;
      toastStore.success('パスワードをリセットしました');
    } catch (error) {
      if (error instanceof ApiError) {
        formError = error.message;
      } else {
        formError = 'ネットワークエラーが発生しました。接続を確認してください';
      }
    } finally {
      isSubmitting = false;
    }
  }
</script>
```

### aria パターン（必須）

```svelte
<input
  id="password"
  type={showPassword ? 'text' : 'password'}
  bind:value={password}
  autocomplete="new-password"
  required
  aria-invalid={passwordError ? 'true' : undefined}
  aria-describedby={passwordError ? 'password-error' : undefined}
/>
{#if passwordError}
  <p id="password-error" class="mt-1 text-sm text-red-600">{passwordError}</p>
{/if}
```

### autocomplete 属性

| フィールド | autocomplete 値 |
|---|---|
| 新しいパスワード | `"new-password"` |
| 確認用パスワード | `"new-password"` |

> ※ register と同じ `new-password`。ブラウザのパスワードマネージャーに新しいパスワードとして保存させる。

### 完了画面の文言例

```
パスワードをリセットしました。
新しいパスワードでログインしてください。
```

> ※ 全デバイスから自動ログアウトしている点も「他の端末でもログインし直す必要があります」と併記すると親切。実装では一行にまとめる。

### ボタン disabled 条件

- `isSubmitting === true`（送信中）
- `storedToken === null`（token 欠落で送信できない）

---

## テストケース一覧（手動疎通確認）

| ケース | 期待結果 |
|---|---|
| `?token=...` 付きでアクセス | URL から `?token=...` が消える（履歴・ブックマーク漏えい防止）。`storedToken` に保持 |
| token なしでアクセス（`/reset-password` のみ） | `formError` にリンク無効メッセージ表示・送信ボタン disabled |
| password 空欄で送信 | `passwordError` に「パスワードを入力してください」表示・API 未送信 |
| confirmPassword 空欄で送信 | `confirmPasswordError` に「確認用パスワードを入力してください」表示・API 未送信 |
| 強度不足（7文字 / 大文字なし / 記号なし等） | register と同一文言で `passwordError` 表示・API 未送信 |
| password と confirmPassword 不一致 | `confirmPasswordError` に「確認用パスワードが一致しません」表示・API 未送信 |
| 正常入力 + 有効 token | 200 → 成功画面表示・成功トースト・state クリア・「ログイン画面へ」ボタン表示 |
| 期限切れ token | 400 → `formError` に「トークンの有効期限が切れています」表示 |
| 不正 token（DB に存在しない） | 404 → `formError` に「無効なトークンです」表示 |
| 並行リクエスト後の二度目 | 400 → `formError` に「無効または期限切れのトークンです」表示 |
| 11回連続送信（同 IP） | 429 → `formError` にバックエンド由来のメッセージ表示 |
| バックエンド停止状態で送信 | `formError` に「ネットワークエラーが発生しました。接続を確認してください」表示 |
| 送信ボタン連打 | API は 1 回のみ呼ばれる（`isSubmitting` ガード） |
| 既ログイン状態でアクセス | `/` にリダイレクトされる |
| 成功画面の「ログイン画面へ」リンク | `/login` へ遷移する |
| 成功後にリセットしたパスワードで `/login` ログイン | 成功する |
| 成功後に旧パスワードで `/login` ログイン | 失敗する（401） |
| 成功後にリセット前に取得していた他デバイスの refreshToken で `/auth/refresh` | 401（全 RT 削除済み） |
| キーボードのみで操作 | フォーカス移動・Enter 送信・エラー読み上げが機能 |
| 表示/非表示トグル | クリックで type が `password` ⇄ `text` 切替 |

---

## 実装時のリスクと回避策

1. **リスク: token を URL に残してログ・履歴に漏えいする**
   - **回避策**: `onMount` で取得直後に `replaceState` で URL から除去する。verify-email と同一パターンを踏襲する

2. **リスク: `register` と `reset-password` でパスワード強度ルールが乖離する**
   - **回避策**: `validatePassword` 本体を `$lib/validation/password.ts` に移動して 1 箇所で管理する。register/validation.ts は再エクスポートのみとし、シグネチャ・文言を不変にして既存テストへの影響をゼロにする

3. **リスク: `normalizedPassword` / `normalizedConfirmPassword` を validate と fetch でそれぞれ再計算してしまう**
   - **回避策**: 疑似コードのとおり `handleSubmit` 冒頭で 1 度だけ計算し、validate・一致判定・fetch の 3 か所で同じ変数を使う。レビュー時に `.trim()` 出現回数が 2（password, confirmPassword 各 1 回）か確認

4. **リスク: `response.json()` を先に呼んでしまい、非 JSON エラー（502/504）で例外化する**
   - **回避策**: `parseErrorResponse` を使う（`response.ok` 先行・JSON パース try-catch が組み込み済み）

5. **リスク: 多重送信ガード忘れで API が複数回叩かれる**
   - **回避策**: `handleSubmit` 冒頭の `if (isSubmitting) return;` と、ボタンの `disabled={isSubmitting || !storedToken}` を両方付ける

6. **リスク: 成功時に password が state に残り、ブラウザの devtools 等から読み取れる**
   - **回避策**: `isSuccess = true` の直前に `password = ''` と `confirmPassword = ''` と `showPassword = false` を実行する

7. **リスク: 成功時に accessToken を発行してフロントを認証済みにしてしまう**
   - **回避策**: バックエンドは accessToken を返さない仕様。フロントは `authStore.login()` を呼ばず、`/login` リンクのみを提示する

8. **リスク: token なし時に送信ボタンが押せて 400 になる**
   - **回避策**: `storedToken === null` のときボタンを `disabled` にし、`handleSubmit` 内でも早期 return する（二重ガード）
