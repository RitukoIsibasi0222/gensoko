# パスワードリセット申請画面（/forgot-password）実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes）
> 対象実装者: ジュニア開発者（Sonnet）

## 概要

ユーザーが登録メールアドレスを入力して `POST /api/v1/auth/forgot-password` を呼び出し、パスワードリセットメールを申請する画面を実装する。フェーズ3「UI モック（アカウント管理）」の一部。

バックエンドは**列挙攻撃対策**として、登録済み・未登録・内部エラーいずれの場合でも基本 200 と固定メッセージを返す。フロントエンドもこの方針を壊さないよう、ユーザー存在有無を示唆する UI 差分を一切作らない。

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

**[frontend/src/lib/validation/email.ts](../../../frontend/src/lib/validation/email.ts)**
- `isValidEmailFormat(value: string): boolean` — `@` とドットを含むかの簡易チェック（trim 済みを想定）

**[frontend/src/lib/stores/toast.svelte.ts](../../../frontend/src/lib/stores/toast.svelte.ts)**
- `toastStore.success(message: string): string`
- `toastStore.error(message: string): string`
- `toastStore.fromApiError(error: ApiError): string`

**[frontend/src/lib/stores/auth.svelte.ts](../../../frontend/src/lib/stores/auth.svelte.ts)**
- `authStore.isInitializing: boolean` — refresh トークン検証中は true
- `authStore.isLoggedIn: boolean`

**バックエンド `POST /api/v1/auth/forgot-password`**（[backend/src/routes/auth/index.ts](../../../backend/src/routes/auth/index.ts)）
- 認証: 不要
- レート制限: あり（10分10回）
- リクエスト: `{ email: string }`
- 成功（200）: `{ message: "パスワードリセットメールを送信しました" }`
- バリデーションエラー（400）: `{ error: "バリデーションエラー", details: [...] }`（メール形式不正のみ）
- レート制限超過（429）: `{ error: "..." }`
- **列挙攻撃対策**: 未登録メール・サービス内部エラー（DB エラー等）も 200 を返す（テスト [backend/src/routes/auth/forgot-password.test.ts](../../../backend/src/routes/auth/forgot-password.test.ts) で保証）

### 参照する既存実装パターン

- [frontend/src/routes/login/+page.svelte](../../../frontend/src/routes/login/+page.svelte) — 正規化値の一度計算・`response.ok` 先行チェック・既ログイン時リダイレクト
- [frontend/src/routes/register/+page.svelte](../../../frontend/src/routes/register/+page.svelte) — 同一画面内で成功状態に切り替えるパターン・`parseErrorResponse` の利用方法
- [frontend/src/routes/verify-email/+page.svelte](../../../frontend/src/routes/verify-email/+page.svelte) — `ApiError` で fetch 例外を統一する処理

### 重要な制約

- `import.meta.env.VITE_API_BASE_URL` を直接書かず、必ず `API_BASE_URL` を import する
- 正規化値（`email.trim()`）は `handleSubmit` 冒頭で**一度だけ**計算し、validate と fetch の両方で同じ変数を使う
- **`response.ok` チェック → エラー時のみ `parseErrorResponse` 呼び出し**の順序を守る（JSON パース先行禁止）
- バックエンドが返す `details[0].message` / `error` を固定文言で上書きしない（`parseErrorResponse` を使えば自動で守られる）
- 列挙攻撃対策を壊さないため、フロントで「該当メールが見つかりません」等の表示・分岐を作らない
- エラーメッセージはすべて日本語
- Svelte 5 Runes（`$state` / `$effect`）のみ使用。`export let` や `$:` は禁止
- Prettier 設定: `tabWidth: 2`
- 既存の [frontend/src/routes/forgot-password/+page.svelte](../../../frontend/src/routes/forgot-password/+page.svelte) は 2 行のスタブ。**全文書き換え**で実装する

---

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| [frontend/src/routes/forgot-password/+page.svelte](../../../frontend/src/routes/forgot-password/+page.svelte) | 修正（全文書換） | 申請フォーム・成功画面・既ログイン時リダイレクト |
| [docs/05_progress.md](../../05_progress.md) | 修正 | 該当タスクを `[ ]` → `[x]` に更新 |
| docs/plans/forgot-password-page/plan.md（本ファイル） | 修正 | 実装完了セクション追記 |

> **判断**: バリデーションは単一フィールド（email）のみで、共通の `isValidEmailFormat` を再利用するだけのため、`validation.ts` への分離はしない。register は 3 フィールドあり再利用性が高いので分離している（パターンの違いは妥当）。

---

## API 仕様（この機能で使う範囲のみ）

### エンドポイント

| メソッド | パス | 認証 | レート制限 |
|---|---|---|---|
| POST | `/auth/forgot-password` | 不要 | 10分10回 |

### リクエスト

```json
{ "email": "taro@example.com" }
```

### レスポンス

| ステータス | ボディ | 発生条件 |
|---|---|---|
| 200 | `{ "message": "パスワードリセットメールを送信しました" }` | 登録済み / 未登録 / 内部エラー（列挙攻撃対策で同じ） |
| 400 | `{ "error": "バリデーションエラー", "details": [...] }` | メール形式不正 |
| 429 | `{ "error": "..." }` | レート制限超過 |

### `credentials` 方針

- 認証不要・Cookie 不要なエンドポイントのため、`credentials` オプションは付与しない（login と異なる）

---

## 設計上の決定事項

### 1. 既ログイン時はトップへリダイレクトする

- **選択**: `$effect` で `!authStore.isInitializing && authStore.isLoggedIn` を監視し `goto('/')`
- **根拠**:
  - [login/+page.svelte](../../../frontend/src/routes/login/+page.svelte) と [register/+page.svelte](../../../frontend/src/routes/register/+page.svelte) で採用済みの同一パターン
  - 認証済みユーザーがパスワード忘れ画面に滞在する導線は不自然
  - `isInitializing` チェック必須（初期化中の早期判定でリダイレクトループを起こさない）

### 2. 成功後は同一画面内で完了メッセージに切り替える（自動遷移しない）

- **選択**: `let isSuccess = $state(false)` でフォームと完了メッセージを切り替える。register と同じパターン
- **根拠**:
  - ユーザーは「メールを確認する」という次の行動が必要なため、画面を勝手に切り替えると不便
  - verify-email は「完了したら次はログイン」が自明だが、forgot-password は「メールを待つ」フェーズが入る
  - 完了画面には「ログイン画面へ戻る」リンクを併設する

### 3. バリデーションは inline で実装する（別ファイル化しない）

- **選択**: `+page.svelte` 内に `validateEmail(normalizedEmail)` 関数を定義
- **根拠**:
  - フィールドが email 1 つだけで、共通の `isValidEmailFormat` を呼ぶだけの薄いラッパー
  - register が `validation.ts` に分離しているのは 3 フィールドあり再利用性が高いため
  - 不要な分割は規約「コード品質制約: 同じロジックが複数箇所に現れた場合は切り出す」に反しない

### 4. エラー処理は `parseErrorResponse` を使う

- **選択**: `if (!response.ok) await parseErrorResponse(response)` パターン
- **根拠**:
  - verify-email / register と同じ統一パターン
  - 非 JSON エラー（502/504 等）も `parseErrorBody` 内で吸収される
  - `details[0].message` → `error` → デフォルトの優先順が一元化されており、固定文言で上書きするミスを防げる

### 5. 成功時のトースト文言は API レスポンスをそのまま使わず固定する

- **選択**: トースト本文は `"パスワードリセットメールを送信しました"` をフロント側で固定指定
- **根拠**:
  - バックエンドの message も同文だが、UI とバックエンドで意図せず文言がズレるとレビューで指摘される
  - register と同様、「成功時の表示文言はフロント責務」として明示する
  - **代わりに完了画面の本文 UI で「登録済みであればメールが届きます」と曖昧な表現にして列挙攻撃対策を担保する**

### 6. ネットワークエラーも汎用エラー表示にする

- **選択**: `fetch` が throw した場合は `formError = 'ネットワークエラーが発生しました。接続を確認してください'` を表示
- **根拠**:
  - login / register と統一パターン
  - `ApiError` 以外の例外は network 系のみ想定で十分

---

## 公開インターフェース案

このページはルートコンポーネントのみで、外部に export するインターフェースはない。
内部状態のみ以下に記載：

```typescript
// $state で管理する変数
let email: string;                       // 入力中のメールアドレス
let isSubmitting: boolean;               // 送信中フラグ（多重送信防止）
let isSuccess: boolean;                  // 送信完了フラグ
let emailError: string | null;           // メール入力エラー
let formError: string | null;            // API エラー・ネットワークエラー
```

---

## タスクリスト（進捗管理）

| タスクID | 内容（何を） | ファイル（どこで） | 完了条件 | 依存 | 優先度 |
|---|---|---|---|---|---|
| T1 | スクリプト骨組み・import 一式・`$state` 変数定義 | `frontend/src/routes/forgot-password/+page.svelte` | スタブを置き換え、import と state 変数が出揃う | なし | 高 |
| T2 | 既ログイン時リダイレクトの `$effect` 実装 | 同上 | 認証済み状態でアクセスすると `/` へ遷移する | T1 | 高 |
| T3 | inline `validateEmail` 関数の実装 | 同上 | 空欄と形式不正で日本語エラーを返し、`isValidEmailFormat` を利用する | T1 | 高 |
| T4 | `handleSubmit` 実装（正規化値再利用・多重送信防止・fetch・`parseErrorResponse`） | 同上 | `normalizedEmail` を一度だけ計算し validate と fetch の両方で同じ変数を使う。`isSubmitting` ガードあり。エラー時のみ body 解析 | T3 | 高 |
| T5 | フォーム UI 実装（label / input / button / aria 属性） | 同上 | キーボード操作可能・aria-invalid / aria-describedby 付与・送信中はボタン disabled | T4 | 高 |
| T6 | 成功画面 UI 実装（`isSuccess` で切り替え・「ログイン画面へ」リンク） | 同上 | 成功時にフォームが隠れ、列挙攻撃対策に配慮した曖昧文言で完了表示される | T5 | 高 |
| T7 | トースト連携（成功時 success・失敗時 formError 表示） | 同上 | 成功時に `toastStore.success('パスワードリセットメールを送信しました')` が呼ばれる | T6 | 中 |
| T8 | lint / format / 型チェック | `frontend/` | `npm run lint` `npm run format` `npm run check` が全通過 | T7 | 高 |
| T9 | 既存テストが壊れていないことを確認 | `frontend/` | `npm run test:run` が全通過 | T8 | 高 |
| T10 | 手動疎通確認（Mailpit でメール受信まで） | （手動） | テストケース一覧の全項目を確認しチェック | T9 | 高 |
| T11 | `docs/05_progress.md` のステータス更新 | `docs/05_progress.md` | 該当タスクが `[x]` になる | T10 | 中 |
| T12 | 本計画書に「実装完了」セクション追記 | 本ファイル | 計画書テンプレートに沿って完了情報を記録 | T11 | 中 |

- [ ] T1: スクリプト骨組み・import・state 定義
- [ ] T2: 既ログイン時リダイレクト
- [ ] T3: `validateEmail` 関数
- [ ] T4: `handleSubmit` 実装
- [ ] T5: フォーム UI
- [ ] T6: 成功画面 UI
- [ ] T7: トースト連携
- [ ] T8: lint / format / check
- [ ] T9: 既存テスト全通過確認
- [ ] T10: 手動疎通確認（Mailpit 含む）
- [ ] T11: `docs/05_progress.md` 更新
- [ ] T12: 計画書に実装完了セクション追記

---

## 技術的注意点

### 実装フロー（疑似コード）

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { API_BASE_URL } from '$lib/api/config';
  import { ApiError, parseErrorResponse } from '$lib/api/errors';
  import { isValidEmailFormat } from '$lib/validation/email';
  import { authStore } from '$lib/stores/auth.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';

  let email = $state('');
  let isSubmitting = $state(false);
  let isSuccess = $state(false);
  let emailError = $state<string | null>(null);
  let formError = $state<string | null>(null);

  // 既ログイン時はトップへ
  $effect(() => {
    if (!authStore.isInitializing && authStore.isLoggedIn) {
      goto('/');
    }
  });

  /** trim 済みメールアドレスを受け取る */
  function validateEmail(value: string): string | null {
    if (!value) return 'メールアドレスを入力してください';
    if (!isValidEmailFormat(value)) return '有効なメールアドレスを入力してください';
    return null;
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return; // 多重送信防止

    // 正規化値を一度だけ計算し、validate と fetch で共用する
    const normalizedEmail = email.trim();

    formError = null;
    emailError = validateEmail(normalizedEmail);
    if (emailError) return;

    isSubmitting = true;
    try {
      const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail })
      });

      // response.ok チェック → エラー時のみ body 解析
      if (!response.ok) {
        await parseErrorResponse(response);
      }

      isSuccess = true;
      toastStore.success('パスワードリセットメールを送信しました');
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
  id="email"
  type="email"
  bind:value={email}
  autocomplete="email"
  required
  aria-invalid={emailError ? 'true' : undefined}
  aria-describedby={emailError ? 'email-error' : undefined}
/>
{#if emailError}
  <p id="email-error" class="mt-1 text-sm text-red-600">{emailError}</p>
{/if}
```

### 完了画面の文言例（列挙攻撃対策に配慮）

```
ご入力のメールアドレスが登録されている場合、パスワードリセット用のメールをお送りしました。
メールが届かない場合は、入力内容をご確認のうえ再度お試しください。
```

> ※ 「メールを送信しました」と断言すると未登録時に矛盾する可能性があるため、「登録されている場合」という条件付き表現にする。

### autocomplete 属性

| フィールド | autocomplete 値 |
|---|---|
| メールアドレス | `"email"` |

---

## テストケース一覧（手動疎通確認）

| ケース | 期待結果 |
|---|---|
| 空欄送信 | `emailError` に「メールアドレスを入力してください」が表示。API は呼ばれない |
| `@` なし | `emailError` に「有効なメールアドレスを入力してください」。API は呼ばれない |
| 登録済みメールで送信 | 200 受信 → 成功画面表示 + 成功トースト + Mailpit にメール到達 |
| 未登録メールで送信 | 200 受信 → 成功画面表示 + 成功トースト（**登録済みと完全に同じ UI**）/ Mailpit にメールは来ない |
| 11回連続送信（同 IP） | 11回目で 429 → `formError` にバックエンド由来のメッセージ表示 |
| バックエンド停止状態で送信 | `formError` に「ネットワークエラーが発生しました。接続を確認してください」表示 |
| 送信ボタン連打 | API は1回のみ呼ばれる（isSubmitting ガード） |
| 既ログイン状態でアクセス | `/` にリダイレクトされる |
| 完了画面から「ログイン画面へ」リンク | `/login` へ遷移する |
| キーボードのみで操作 | フォーカス移動・Enter 送信・エラー読み上げが機能 |
| Mailpit（http://localhost:8025） | パスワードリセットメールが届き、`/reset-password?token=...` リンクが含まれる |

---

## 実装時のリスクと回避策

1. **リスク: ユーザー存在有無を示唆する UI 差分を作ってしまう**
   - 例: 成功トーストの文言を「○○宛に送信しました」とメールアドレスを含めると、未登録時の挙動と矛盾しやすい
   - **回避策**: 成功表示は固定文言・固定 UI とし、レビュー時にこの観点を必ず確認する。完了画面の本文は「登録されている場合」という条件付き表現にする

2. **リスク: `response.json()` を先に呼んでしまい、非 JSON エラー（502/504）で例外化する**
   - **回避策**: `parseErrorResponse` を使う（`response.ok` 先行チェック・JSON パース try-catch が組み込み済み）。`if (!response.ok) await parseErrorResponse(response);` のテンプレートから外れない

3. **リスク: `normalizedEmail` を validate と fetch でそれぞれ再計算してしまう**
   - **回避策**: 疑似コードのとおり `handleSubmit` 冒頭で `const normalizedEmail = email.trim()` を一度だけ定義し、両方で同じ変数を使う。レビュー時に `.trim()` の出現回数が 1 か確認

4. **リスク: 多重送信ガード忘れで API が複数回叩かれる**
   - **回避策**: `handleSubmit` 冒頭の `if (isSubmitting) return;` と、ボタンの `disabled={isSubmitting}` を両方付ける。テストケース「送信ボタン連打」で確認

5. **リスク: バックエンドエラー文言を固定文言で上書きしてしまう**
   - **回避策**: `parseErrorResponse` を使う（`details[0].message ?? error ?? defaultMessage` の優先順で自動処理）。`catch` ブロックでは `error.message` をそのまま `formError` に入れるだけにする
