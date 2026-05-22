# ユーザー登録画面 `/register` 実装計画

> 設計者ロール: フロントエンドエンジニア

## 概要

SvelteKit + Svelte 5 + Tailwind CSS v4 を使用して、新規ユーザー登録画面（`/register`）を実装する。
ユーザーが「ユーザー名・メールアドレス・パスワード」を入力してフォームを送信すると、バックエンドが確認メールを送信し、同一画面上に完了メッセージを表示する。

---

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL: string` — API ベース URL（`/api/v1` まで含む）。各ファイルで `import.meta.env.VITE_API_BASE_URL` を直接書かず、必ずここから import する。

**`frontend/src/lib/api/errors.ts`**
- `class ApiError extends Error` — `constructor(status: number, message: string, body: unknown | null = null)`

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.success(message: string): string`
- `toastStore.error(message: string): string`
- `toastStore.fromApiError(error: ApiError): string`

**`frontend/src/lib/stores/auth.svelte.ts`**
- `authStore.isInitializing: boolean` — リフレッシュトークン検証中は true
- `authStore.isLoggedIn: boolean` — ログイン済みなら true

### 参照実装
`frontend/src/routes/login/+page.svelte` — 状態管理・fetch パターン・aria パターン・Tailwind クラスをすべてこのファイルに揃えること。

### 重要な制約
- `import.meta.env.VITE_API_BASE_URL` を直接書かない
- `email.trim()` 等の正規化を複数箇所で再計算しない（`handleSubmit` 冒頭で一度だけ計算）
- バックエンドの `data.error` を固定文言で上書きしない

---

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/validation/email.ts` | 新規 | 共通メールアドレス形式チェック関数（login/register で共用） |
| `frontend/src/routes/register/validation.ts` | 新規 | フィールドごとのバリデーション純粋関数 |
| `frontend/src/routes/register/validation.test.ts` | 新規 | バリデーション関数の自動テスト（Vitest） |
| `frontend/src/routes/register/+page.svelte` | 新規 | 登録フォーム・成功画面 |
| `frontend/src/routes/login/+page.svelte` | 修正 | password trim 修正（normalizePassword と整合）・コメント整合 |
| `docs/08_conventions.md` | 修正 | fetch パターン・trim 方針・バリデーション一貫性チェックリスト更新 |
| `docs/04_api.md` | 修正 | fetch パターンの記述を統一 |
| `.github/copilot-instructions.md` | 修正 | fetch パターン例を更新 |

---

## API 仕様

### エンドポイント

| メソッド | パス | 認証 | リクエスト | レスポンス |
|---|---|---|---|---|
| POST | `/auth/register` | 不要 | `{ username, email, password }` | 201: `{ message: "確認メールを送信しました" }` |

### エラーレスポンス

| ステータス | `error` の内容 |
|---|---|
| 400 | `"バリデーションエラー"`（`details` フィールドあり） |
| 409 | `"メールアドレスまたはユーザー名が既に使用されています"` |
| 429 | レート制限メッセージ |
| 500 | `"サーバーエラーが発生しました"` |

---

## 設計上の決定事項

1. **バリデーションを別ファイルに切り出す**
   - 選択: `validation.ts` に純粋関数として定義する
   - 根拠: `+page.svelte` の肥大化を防ぎ、将来テストを書きやすくする

2. **成功状態の表現方法**
   - 選択: `isSuccess = $state(false)` で同一画面内でフォームと完了メッセージを切り替える
   - 根拠: ページ遷移なしで UX がシンプル。別ルートへの遷移は `/verify-email` 実装後に検討

---

## 公開インターフェース案（`validation.ts`）

```typescript
// ユーザー名バリデーション（trim 済みの値を受け取る）
export function validateUsername(value: string): string | null

// メールアドレスバリデーション（trim 済みの値を受け取る）
export function validateEmail(value: string): string | null

// パスワードバリデーション（trim 済みの値を受け取る。内部スペースのみ検知して弾く）
export function validatePassword(value: string): string | null
```

---

## タスクリスト（進捗管理）

| タスクID | 内容 | ファイル | 優先度 | 備考 |
|---|---|---|---|---|
| T1 | バリデーションヘルパー関数の作成 | `routes/register/validation.ts` | 高 | 純粋関数・バックエンドの strongPasswordSchema に準拠 |
| T2 | ページコンポーネントの骨組み（import・state 定義） | `routes/register/+page.svelte` | 高 | |
| T3 | `handleSubmit` 実装（正規化・バリデーション・fetch・エラー処理） | `routes/register/+page.svelte` | 高 | fetch パターンは login ページに倣う |
| T4 | フォーム UI（入力欄・aria・Tailwind） | `routes/register/+page.svelte` | 高 | |
| T5 | 成功画面 UI（isSuccess 切替・完了メッセージ） | `routes/register/+page.svelte` | 高 | |
| T6 | 既ログイン時のリダイレクト処理（`$effect`） | `routes/register/+page.svelte` | 中 | |
| T7 | ログイン画面への導線リンク追加 | `routes/register/+page.svelte` | 中 | |
| T8 | 動作確認（lint・format・型チェック・手動疎通） | - | 高 | |

- [x] T1: バリデーションヘルパー関数の作成（`routes/register/validation.ts`）
- [x] T2: ページコンポーネントの骨組み（`routes/register/+page.svelte`）
- [x] T3: `handleSubmit` 実装（`routes/register/+page.svelte`）
- [x] T4: フォーム UI 実装（`routes/register/+page.svelte`）
- [x] T5: 成功画面 UI 実装（`routes/register/+page.svelte`）
- [x] T6: 既ログイン時のリダイレクト処理（`routes/register/+page.svelte`）
- [x] T7: ログイン画面への導線リンク追加（`routes/register/+page.svelte`）
- [x] T8: 動作確認（lint・format・型チェック・手動疎通）

---

## 技術的注意点

### バリデーション制約（バックエンドの `strongPasswordSchema` に準拠）

| フィールド | 制約 |
|---|---|
| ユーザー名 | 必須、3〜20文字、`/^[a-zA-Z0-9_]+$/`（英数字とアンダースコアのみ） |
| メールアドレス | 必須、簡易形式チェック（`@` とドットを含む形式。バックエンドは `z.string().email()` でより厳密に検証） |
| パスワード | 必須、8文字以上、英大文字1以上、英小文字1以上、数字1以上、記号1以上、スペース禁止 |

### 状態変数（`+page.svelte` で定義する変数）

```typescript
let username = $state('');
let email = $state('');
let password = $state('');
let isSubmitting = $state(false);
let isSuccess = $state(false);
let usernameError = $state<string | null>(null);
let emailError = $state<string | null>(null);
let passwordError = $state<string | null>(null);
let formError = $state<string | null>(null);
```

### fetch パターン（必須）

```typescript
// response.ok チェック → エラー時のみ JSON パース（try-catch）→ ApiError スロー
if (!response.ok) {
  let errorBody: { error?: string; details?: { message: string }[] } | null = null;
  try {
    errorBody = await response.json();
  } catch { /* 非 JSON レスポンスは null のまま */ }
  const message = errorBody?.details?.[0]?.message ?? errorBody?.error ?? 'エラーが発生しました';
  throw new ApiError(response.status, message, errorBody);
}
```

### aria パターン（必須）

```html
<input
  id="username"
  aria-invalid={usernameError ? 'true' : undefined}
  aria-describedby={usernameError ? 'username-error' : undefined}
/>
{#if usernameError}
  <p id="username-error" class="mt-1 text-sm text-red-600">{usernameError}</p>
{/if}
```

### autocomplete 属性

| フィールド | autocomplete 値 |
|---|---|
| ユーザー名 | `"username"` |
| メールアドレス | `"email"` |
| パスワード | `"new-password"`（ログインの `current-password` とは異なる） |

---

## テストケース一覧（手動疎通確認）

| 確認項目 | 期待結果 |
|---|---|
| 空欄送信 | 各フィールドに「〜を入力してください」が赤文字で表示される |
| ユーザー名 2 文字 | 「ユーザー名は3文字以上にしてください」 |
| ユーザー名にハイフン | 「ユーザー名は英数字とアンダースコアのみ使用できます」 |
| 不正なメール形式 | 「有効なメールアドレスを入力してください」 |
| パスワード 7 文字 | 「パスワードは8文字以上にしてください」 |
| パスワードに大文字なし | 「パスワードには英大文字を1文字以上含めてください」 |
| 正常入力で送信 | 成功画面 + トースト「確認メールを送信しました」表示 |
| 同じメールアドレスで再登録 | `formError` に「メールアドレスまたはユーザー名が既に使用されています」 |
| Mailpit（http://localhost:8025） | 確認メールが届いている |
| 既ログイン状態でアクセス | `/` にリダイレクトされる |
| キーボードのみで操作 | 全要素にフォーカス可能、Enter で送信可能 |
| スクリーンリーダー | エラーが `aria-describedby` 経由で読み上げられる |
