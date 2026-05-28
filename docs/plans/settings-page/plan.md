# プロフィール設定画面（/settings）実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、Hono API 連携設計含む）
> 対象実装者: ジュニア開発者（Sonnet）

## 概要

ログイン済みユーザー向けのプロフィール設定画面 `/settings` を実装する。対象機能は「ユーザー名変更」「パスワード変更」「アカウント削除」の 3 つで、画面実装だけでなく、それを支える `GET /users/me` `PATCH /users/me` `DELETE /users/me` の users API も同タスクで整備する。

現状は `frontend/src/routes/(app)/settings/+page.svelte` がスタブ、`backend/src/routes/users/index.ts` も未実装。さらに `backend/src/index.ts` の CORS 設定で `allowMethods` に `PATCH` が含まれていないため、フロントから `PATCH /users/me` を呼ぶ前にこの抜けを塞ぐ必要がある。

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**frontend/src/lib/api/config.ts**
- `API_BASE_URL: string` — `/api/v1` まで含む API ベース URL。各画面で `import.meta.env.VITE_API_BASE_URL` を直接読まない。

**frontend/src/lib/api/errors.ts**
- `class ApiError extends Error`
- `parseErrorBody(response: Response): Promise<ErrorBody>`
- `parseErrorResponse(response: Response, defaultMessage?: string): Promise<never>`
- エラーメッセージは `details[0].message` → `error` → `defaultMessage` の優先順で解決する。

**frontend/src/lib/stores/toast.svelte.ts**
- `toastStore.success(message: string): string`
- `toastStore.error(message: string): string`
- `toastStore.info(message: string): string`
- `toastStore.fromApiError(error: ApiError): string`

**frontend/src/lib/stores/auth.svelte.ts**
- `authStore.user: AuthUser | null`
- `authStore.accessToken: string | null`
- `authStore.isLoggedIn: boolean`
- `authStore.isInitializing: boolean`
- `authStore.login(user, accessToken): void`
- `authStore.logout(): Promise<void>`
- `authStore.refresh(): Promise<boolean>`
- `#saveToStorage()` 経由で `sessionStorage` を更新する private API がある。
- 「表示名だけ更新する公開メソッド」は未提供 → settings 実装と一緒に追加する。

**frontend/src/lib/validation/password.ts**
- `validatePassword(value: string): string | null`
- バックエンドの `strongPasswordSchema` と整合済み。

**frontend/src/routes/register/validation.ts**
- `validateUsername(value: string): string | null`（現状 route 配下）
- 公開シグネチャ・文言・既存テストは触らない方針。

**frontend/src/routes/reset-password/+page.svelte**
- `validateConfirmPasswordField(normalizedPassword, normalizedConfirmPassword)` 相当のローカル関数を持つ。
- settings 側で同等処理が必要になるため、再利用方針を別途決める（設計上の決定事項 6）。

**frontend/src/routes/(app)/+layout.svelte**
- 認証ガードは持たない。`/settings` 自身が未ログイン時リダイレクトを実装する必要がある。

**frontend/src/routes/(app)/settings/+page.svelte**
- 現状はスタブのみ。**全文書き換え**前提。

**frontend/src/lib/components/Header.svelte**
- `authStore.user?.username` を表示している。username 変更後はストア経由で即時更新する。

**backend/src/middleware/auth/index.ts**
- `authMiddleware` は `Authorization: Bearer <accessToken>` を必須にする。
- 認証失敗時のエラー文言は日本語。

**backend/src/routes/auth/index.ts**
- `strongPasswordSchema`（8 文字以上 / 大文字 / 小文字 / 数字 / 記号 / スペース禁止）が register・reset-password で共通利用されている。
- settings のパスワード変更も**同じ強度ルール**に揃える。
- `authRateLimit`（10 分 10 回）が定義済み。settings 側のパスワード変更・アカウント削除でも再利用する。

**backend/src/services/auth.service.ts**
- `normalizePassword(rawPassword)` で先頭/末尾スペースを除去する内部関数を持つ。settings のパスワード変更でも同じ正規化方針を採用する。

**backend/src/routes/users/index.ts**
- 現状は `// TODO: implement` のスタブ。本タスクで実装する。

**backend/src/index.ts**
- `app.route("/api/v1/auth", authRouter)` のみ mount 済み。`/api/v1/users` は未 mount。
- CORS 設定: `allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]` → **`PATCH` が欠落**しているため修正が必要。

**docs/plans/frontend-api-client/plan.md**
- 未完了（T1 のみ）。settings は**この計画に依存しない**。既存ページ（login / register / verify-email 等）と同じ「直 `fetch` + `parseErrorResponse`」パターンで実装する。

### 重要な制約

- `API_BASE_URL` は必ず `$lib/api/config` から参照する。各画面で `import.meta.env.VITE_API_BASE_URL` を直接読まない。
- 保護 API 呼び出しは `Authorization: Bearer <authStore.accessToken>` を付与する。
- 401 自動 refresh + リトライは settings ページ内に独自実装しない。401 を受けたら `authStore` の anonymous 状態に従って `/login` に逃がす（refresh ロジックは `authStore.initialize()` / 既存 `authStore.refresh()` 以外で増やさない）。
- 正規化値（`trim()` 済みの username / password 各種）は `handleSubmit*` 冒頭で**一度だけ**計算し、バリデーションと送信の両方で同じ変数を使う。
- バックエンドの `error` / `details[0].message` をフロント固定文言で上書きしない（`parseErrorResponse` を使う）。
- ユーザー名バリデーション・パスワード強度バリデーションは既存ルールを再利用し、重複定義しない。
- パスワード変更とアカウント削除は **`currentPassword` 必須**。
- パスワード変更・アカウント削除成功時はバックエンドで**全 refresh token を削除**し、`refreshToken` Cookie も `deleteCookie` で消す。
- パスワード変更・アカウント削除エンドポイントには `authRateLimit` を必ず適用する（currentPassword に対するブルートフォース対策）。
- `(app)` レイアウトには認証ガードがないため、`/settings` 自身で未ログイン時リダイレクトを実装する。
- エラーメッセージはすべて日本語で統一する。
- Svelte 5 Runes（`$state` / `$effect` / `$derived`）のみ使用。`export let` / `$:` は禁止。
- Prettier 設定: `tabWidth: 2`。

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/services/user.service.ts` | 新規 | users API のビジネスロジック（取得・ユーザー名変更・パスワード変更・アカウント削除） |
| `backend/src/routes/users/index.ts` | 修正（全文書換） | `GET /users/me` / `PATCH /users/me` / `DELETE /users/me` を実装 |
| `backend/src/routes/users/get-me.test.ts` | 新規 | `GET /users/me` のルートテスト |
| `backend/src/routes/users/update-me.test.ts` | 新規 | `PATCH /users/me`（ユーザー名変更・パスワード変更）のルートテスト |
| `backend/src/routes/users/delete-me.test.ts` | 新規 | `DELETE /users/me` のルートテスト |
| `backend/src/index.ts` | 修正 | (1) CORS `allowMethods` に `PATCH` を追加 (2) `usersRouter` を `/api/v1/users` に mount |
| `frontend/src/lib/validation/username.ts` | 新規 | 共通ユーザー名バリデーション（register・settings 共用） |
| `frontend/src/lib/validation/username.test.ts` | 新規 | `validateUsername` のユニットテスト（register 側からの移管） |
| `frontend/src/routes/register/validation.ts` | 修正 | `validateUsername` を `$lib/validation/username` から再エクスポートに切替（公開シグネチャ・文言は不変） |
| `frontend/src/lib/stores/auth.svelte.ts` | 修正 | ログイン状態を維持したまま `user` だけ同期する公開メソッド `updateUser(user)` を追加（sessionStorage 同期含む） |
| `frontend/src/routes/(app)/settings/validation.ts` | 新規 | settings 専用の純粋バリデーション関数 |
| `frontend/src/routes/(app)/settings/validation.test.ts` | 新規 | settings バリデーションのユニットテスト |
| `frontend/src/routes/(app)/settings/+page.svelte` | 修正（全文書換） | プロフィール取得・3 セクション UI・送信処理・成功/失敗導線 |
| `docs/05_progress.md` | 修正 | 該当タスクを `[ ]` → `[x]` に更新 |
| `docs/plans/settings-page/plan.md` | 修正 | 実装完了セクション追記 |

## API 仕様（この機能で使う範囲のみ）

### エラーレスポンス共通形式

```json
{ "error": "メッセージ文字列" }
```

バリデーションエラー時のみ `details` を含む。

### GET `/users/me`

| 項目 | 内容 |
|---|---|
| 認証 | 必須（`Authorization: Bearer`） |
| レート制限 | なし |
| リクエスト | なし |
| 200 | `{ "user": { "id": "cuid", "username": "taro123", "email": "taro@example.com", "role": "USER", "createdAt": "2026-05-01T00:00:00.000Z" } }` |
| 401 | `"認証が必要です"` / `"トークンが無効です"` / `"ユーザーが見つかりません"` |
| 403 | `"アカウントが停止されています"` / `"メールアドレスが確認されていません"` |
| 500 | `"サーバーエラーが発生しました"` |

### PATCH `/users/me`（ユーザー名変更）

| 項目 | 内容 |
|---|---|
| 認証 | 必須 |
| レート制限 | なし（パスワードを扱わないため） |
| リクエスト | `{ "username": "new_name_123" }` |
| 200 | `{ "message": "ユーザー名を変更しました", "user": { "id": "cuid", "username": "new_name_123", "role": "USER" } }` |
| 400 | `"バリデーションエラー"`（`details` あり） |
| 401 / 403 | 認証・認可エラー |
| 409 | `"このユーザー名は既に使用されています"` |
| 500 | `"サーバーエラーが発生しました"` |

### PATCH `/users/me`（パスワード変更）

| 項目 | 内容 |
|---|---|
| 認証 | 必須 |
| レート制限 | あり（`authRateLimit`） |
| リクエスト | `{ "currentPassword": "OldPass1!", "newPassword": "NewPass1!" }` |
| 200 | `{ "message": "パスワードを変更しました" }`（`Set-Cookie: refreshToken=; Max-Age=0; ...`） |
| 400 | `"バリデーションエラー"`（`details` あり） / `"現在のパスワードが正しくありません"` / `"新しいパスワードは現在のパスワードと異なるものにしてください"` |
| 401 / 403 | 認証・認可エラー（Bearer 起因のみ） |
| 429 | レート制限超過 |
| 500 | `"サーバーエラーが発生しました"` |

補足:
- `username` 用 payload と `currentPassword + newPassword` 用 payload は**排他**。混在は 400「バリデーションエラー」で弾く。
- 成功時は全 refresh token を削除し、`refreshToken` Cookie も `deleteCookie` で消す。
- **`"現在のパスワードが正しくありません"` は 400 で返す**（401 にすると Bearer 起因の認証エラーと混同し、フロント側で誤って refresh / logout に走るリスクがある）。

### DELETE `/users/me`

| 項目 | 内容 |
|---|---|
| 認証 | 必須 |
| レート制限 | あり（`authRateLimit`） |
| リクエスト | `{ "currentPassword": "Pass1234!" }`（`Content-Type: application/json` を明示） |
| 200 | `{ "message": "アカウントを削除しました" }`（`Set-Cookie: refreshToken=; Max-Age=0; ...`） |
| 400 | `"バリデーションエラー"` / `"現在のパスワードが正しくありません"` |
| 401 / 403 | 認証・認可エラー |
| 429 | レート制限超過 |
| 500 | `"サーバーエラーが発生しました"` |

補足:
- Prisma の `onDelete: Cascade` により `RefreshToken` / `EmailVerification` / `PasswordResetToken` / `WeakElement` / `GameSession` / `GameAnswer` / `GameQuestionSet` / `UserStats` が連鎖削除される（`schema.prisma` 参照）。
- 削除と同時に `refreshToken` Cookie を `deleteCookie` で消す。

### `credentials` 方針

- すべての `/users/me` 系呼び出しで `credentials: 'include'` を付与する。
- 理由: 成功時にバックエンドが送信する `Set-Cookie`（refresh Cookie 削除ヘッダー）を受信するため。

## 設計上の決定事項

### 1. settings 実装は backend users API とセットで進める
- 選択: `backend/src/routes/users/index.ts` と `backend/src/services/user.service.ts` を本計画に含める。
- 根拠: 現状の users ルートは未実装で、フロント画面だけ作っても要件を満たせない。

### 2. 保護 API 呼び出しは既存パターンに揃える（`frontend-api-client` に依存しない）
- 選択: 既存ページと同じく直 `fetch` + `parseErrorResponse` + `Authorization: Bearer authStore.accessToken` で実装する。
- 根拠: `docs/plans/frontend-api-client/plan.md` は未完了で着手見込みが立っていない。先に共通クライアントを完成させると settings が遅延する。settings 実装時点でのプロジェクトの「実態」に整合させる。
- 影響: 401 を受けたら `authStore.logout()` を呼んで `/login` に逃がすシンプルな処理にする。自動 refresh + retry は実装しない。

### 3. 画面は 3 つの独立フォームに分ける
- 選択: 「プロフィール（username）」「パスワード変更」「アカウント削除」を別セクション・別 submit 状態（`isProfileSubmitting` / `isPasswordSubmitting` / `isDeleting`）で管理する。
- 根拠: 1 セクションの送信が他セクションを不必要にロックしないようにし、エラー文言・成功 UX を分離するため。

### 4. 初期表示時に `GET /users/me` を実行して最新プロフィールを取得する
- 選択: `authStore.user?.username` のみを初期値に使わず、画面マウント後に API で最新状態を取り直す。
- 根拠: sessionStorage 由来の `authStore.user` は他端末変更とズレる可能性があるため。

### 5. ユーザー名バリデーションを `lib/validation` に移して共通化する
- 選択: `validateUsername` の本体を `frontend/src/lib/validation/username.ts` に移し、`frontend/src/routes/register/validation.ts` は `export { validateUsername } from '$lib/validation/username';` の再エクスポートに切替える。`register/validation.test.ts` の `validateUsername` 系テストは `frontend/src/lib/validation/username.test.ts` に移管する（register 側の email / password に関するテストは残す）。
- 根拠: settings から register route 配下を直接 import すると route-to-route 依存になる。`validatePassword` の移管前例（reset-password 計画）と同じ方針で揃える。

### 6. `validateConfirmPassword` は settings ローカルに置く（reset-password との共通化は今回スコープ外）
- 選択: `validateConfirmPassword(normalizedNewPassword, normalizedConfirmPassword)` を `frontend/src/routes/(app)/settings/validation.ts` に新規実装する。reset-password 側の同等関数とは中身が同じになることを許容する。
- 根拠: 共通化するなら reset-password 側も同時改修する必要があり、スコープが膨らむ。文言・引数形が完全一致するなら、後続タスクで `lib/validation/confirmPassword.ts` への抽出は容易。今回は重複ロジック解消より settings スコープ厳守を優先する（リスクとして「実装リスクと回避策」に記録）。

### 7. `PATCH /users/me` は 2 種類の payload を排他で受ける
- 選択: zod の `discriminatedUnion` 相当（`username` のみの object と `currentPassword + newPassword` の object の union）として検証し、両方が同時に来た場合・どちらにも当てはまらない場合は 400「バリデーションエラー」を返す。
- 根拠: UI が独立した 2 フォームのため、サーバー側でも 1 リクエスト 1 操作に限定して副作用を明確化する。

### 8. パスワード変更成功時は即ログアウトさせる
- 選択: バックエンドで全 refresh token を削除 + `refreshToken` Cookie を `deleteCookie` で消す。フロントは成功トースト後に `authStore.logout()` を呼び `goto('/login')` で遷移する。
- 根拠: 現在のセッションを半端に残すと「しばらく動くが次回 refresh で落ちる」不整合が起きる。

### 9. アカウント削除は currentPassword + 確認チェックで保護する
- 選択: API では `currentPassword` を必須にし、UI では「この操作は取り消せません」と明示する確認チェックボックスを `disabled` 解除条件にする。ネイティブ `confirm()` は使わない。
- 根拠: アクセストークンだけで即削除する設計より誤操作耐性が高い。既存 UI に共通 confirm dialog コンポーネントもないため、専用 UI で十分に意図表示できる。

### 10. ユーザー名変更後は authStore を即時同期する
- 選択: `authStore` に `updateUser(user: AuthUser): void` を新規追加し、PATCH レスポンスの `user` をそのまま反映する。内部で既存の `#saveToStorage()` を呼び `sessionStorage` も更新する。
- 根拠: ヘッダーの username 表示を即時更新でき、`login()` を流用して `accessToken` を上書きする副作用を避けられる。

### 11. settings ページ自身で未ログイン時ガードを持つ
- 選択: `$effect` で `!authStore.isInitializing && !authStore.isLoggedIn` を監視して `goto('/login')`。
- 根拠: `(app)` レイアウトは共通外枠のみで認証ガードを担っていない。register / login の「既ログイン時リダイレクト」と対称の実装になる。

### 12. 「現在のパスワードが正しくありません」は 400 で返す
- 選択: パスワード変更・アカウント削除いずれも、`currentPassword` 検証失敗時は 400 を返す。401 ではなく 400 にする。
- 根拠: 401 にすると将来 `frontend-api-client` 実装時に「401 → `authStore.refresh()` → リトライ」のフローに巻き込まれ、本来「ユーザー入力ミス」だったものが「セッション切れ」として誤処理される。Bearer 起因の認証エラー（401）と入力起因の認可エラー（400）を明確に分離する。

### 13. CORS の `allowMethods` に `PATCH` を追加する
- 選択: `backend/src/index.ts` の `cors({ allowMethods: [...] })` に `"PATCH"` を追加する。
- 根拠: 現状 `PATCH` がプリフライトで弾かれ、`PATCH /users/me` が動作しない。本タスクのフロント実装より先に修正する必要がある。

## 公開インターフェース案

```ts
// backend/src/services/user.service.ts

export class UserError extends Error {
  status: number; // 400 / 403 / 409 のいずれか（404 は 401 に寄せず 401 は middleware に任せる）
  constructor(status: number, message: string);
}

export type CurrentUserProfile = {
  id: string;
  username: string;
  email: string;
  role: 'USER' | 'ADMIN';
  createdAt: Date;
};

export async function getCurrentUserProfile(userId: string): Promise<CurrentUserProfile>;

export async function updateCurrentUsername(input: {
  userId: string;
  username: string;
}): Promise<{
  user: { id: string; username: string; role: 'USER' | 'ADMIN' };
}>;

export async function changeCurrentPassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void>;

export async function deleteCurrentUser(input: {
  userId: string;
  currentPassword: string;
}): Promise<void>;
```

```ts
// frontend/src/lib/stores/auth.svelte.ts に追加する公開メソッド

/**
 * ログイン状態を維持したまま user 情報だけ同期する。
 * accessToken / status は変更せず、user と sessionStorage のみ更新する。
 * 認証済み（status === 'authenticated'）のときのみ反映する。
 */
updateUser(user: AuthUser): void;
```

```ts
// frontend/src/lib/validation/username.ts

export function validateUsername(value: string): string | null;
```

```ts
// frontend/src/routes/(app)/settings/validation.ts

export function validateCurrentPassword(value: string): string | null;
export function validateConfirmPassword(
  normalizedNewPassword: string,
  normalizedConfirmPassword: string
): string | null;
export function validateDeleteAcknowledgement(checked: boolean): string | null;
```

## タスクリスト（進捗管理）

| タスクID | 内容（何を） | ファイル（どこで） | 完了条件 | 依存 | 優先度 |
|---|---|---|---|---|---|
| T1 | CORS `allowMethods` に `PATCH` を追加 | `backend/src/index.ts` | `OPTIONS /api/v1/users/me` への `PATCH` プリフライトが許可される | なし | 高 |
| T2 | `GET /users/me` の失敗テストを先に作成 | `backend/src/routes/users/get-me.test.ts` | 未認証 401 / 認証済み 200 / サービス例外 500 のケースが Red で失敗する | なし | 高 |
| T3 | `PATCH /users/me` の失敗テストを先に作成 | `backend/src/routes/users/update-me.test.ts` | ユーザー名変更（成功・重複 409・形式不正 400）/ パスワード変更（成功・誤 currentPassword 400・新旧同一 400・弱パスワード 400）/ payload 排他違反 400 が Red で失敗する | なし | 高 |
| T4 | `DELETE /users/me` の失敗テストを先に作成 | `backend/src/routes/users/delete-me.test.ts` | 誤 currentPassword 400 / 成功 200 / 未認証 401 のケースが Red で失敗する。`refreshToken` Cookie 削除ヘッダーも検証する | なし | 高 |
| T5 | users service を実装 | `backend/src/services/user.service.ts` | 取得 / ユーザー名変更 / パスワード変更 / 削除のロジックが Prisma 経由で動作し、`UserError` で日本語メッセージを返す。パスワード正規化は `normalizePassword` 相当を踏襲する | T2-T4 | 高 |
| T6 | users router を実装し app に mount | `backend/src/routes/users/index.ts`, `backend/src/index.ts` | `GET /api/v1/users/me` / `PATCH /api/v1/users/me` / `DELETE /api/v1/users/me` が動作する。PATCH パスワード変更・DELETE は `authRateLimit` を適用。成功時に `refreshToken` Cookie を削除する。T2-T4 が Green になる | T5, T1 | 高 |
| T7 | backend の lint / format / test を通す | `backend/` | `npm run lint` `npm run format:check` `npm run test -- --run` が全通過 | T6 | 高 |
| T8 | `validateUsername` を `$lib/validation/username.ts` に移動 | `frontend/src/lib/validation/username.ts` | 関数本体（文言含む）を register/validation.ts からそのまま移動。空欄・3 文字未満・21 文字以上・形式不正のテストを `username.test.ts` に移管する | なし | 高 |
| T9 | `register/validation.ts` を再エクスポートに切替 | `frontend/src/routes/register/validation.ts` | `export { validateUsername } from '$lib/validation/username';` 化。`validateEmail` / `validatePassword` は変更しない | T8 | 高 |
| T10 | register/validation.test.ts の `validateUsername` 系テストを移管 | `frontend/src/routes/register/validation.test.ts`, `frontend/src/lib/validation/username.test.ts` | `validateUsername` 系 describe を `username.test.ts` に移し、register 側からは削除。`npm run test:run` が全通過 | T9 | 高 |
| T11 | `authStore.updateUser()` を追加 | `frontend/src/lib/stores/auth.svelte.ts` | `status === 'authenticated'` 時のみ `user` を上書きし、`#saveToStorage()` 相当で sessionStorage も更新する。`accessToken` / `status` は変更しない | なし | 高 |
| T12 | settings 専用バリデーションを実装 | `frontend/src/routes/(app)/settings/validation.ts`, `frontend/src/routes/(app)/settings/validation.test.ts` | `validateCurrentPassword` / `validateConfirmPassword` / `validateDeleteAcknowledgement` が純粋関数として実装され、ユニットテストが全通過する | なし | 高 |
| T13 | settings ページの骨組み・初期ロード | `frontend/src/routes/(app)/settings/+page.svelte` | 未ログイン時 `/login` リダイレクト、`GET /users/me` での初期ロード、3 セクション分の `$state` 定義、`Authorization: Bearer` ヘッダー付与の共通化 | T11 | 高 |
| T14 | ユーザー名変更セクションを実装 | 同上 | `normalizedUsername` を一度だけ計算し validate と fetch の両方で使う。成功時に `authStore.updateUser()` を呼びローカル profile state も更新する。409 はバックエンド文言をそのまま表示 | T13, T9 | 高 |
| T15 | パスワード変更セクションを実装 | 同上 | `currentPassword` / `newPassword` / `confirmPassword` を submit 冒頭で 1 回ずつ trim し、それ以降は再計算しない。成功時に `toastStore.success(...)` → `authStore.logout()` → `goto('/login')`。400「現在のパスワードが正しくありません」をそのまま表示する | T13 | 高 |
| T16 | アカウント削除セクションを実装 | 同上 | 確認チェック未チェック時は送信ボタン disabled。送信時は `validateDeleteAcknowledgement` で再検証。成功時に `authStore.logout()` → `goto('/')` | T13 | 高 |
| T17 | frontend の lint / format / check / test を通す | `frontend/` | `npm run lint` `npm run format` `npm run check` `npm run test:run` が全通過 | T7, T14-T16 | 高 |
| T18 | 手動疎通確認 | 手動（http://localhost:5174 / mailpit 不要） | テストケース一覧の主要シナリオをローカル環境で確認しチェック | T17 | 高 |
| T19 | `docs/05_progress.md` のステータス更新 | `docs/05_progress.md` | 該当タスクが `[x]` になる | T18 | 中 |
| T20 | 本計画書に「実装完了」セクション追記 | 本ファイル | 計画書テンプレートに沿って完了情報を記録 | T19 | 中 |

- [ ] T1: CORS `allowMethods` に `PATCH` を追加
- [ ] T2: `GET /users/me` の失敗テストを先に作成
- [ ] T3: `PATCH /users/me` の失敗テストを先に作成
- [ ] T4: `DELETE /users/me` の失敗テストを先に作成
- [ ] T5: users service を実装
- [ ] T6: users router を実装し app に mount
- [ ] T7: backend の lint / format / test を通す
- [ ] T8: `validateUsername` を `$lib/validation/username.ts` に移動
- [ ] T9: `register/validation.ts` を再エクスポートに切替
- [ ] T10: register/validation.test.ts の `validateUsername` 系テストを移管
- [ ] T11: `authStore.updateUser()` を追加
- [ ] T12: settings 専用バリデーションを実装
- [ ] T13: settings ページの骨組み・初期ロード
- [ ] T14: ユーザー名変更セクションを実装
- [ ] T15: パスワード変更セクションを実装
- [ ] T16: アカウント削除セクションを実装
- [ ] T17: frontend の lint / format / check / test を通す
- [ ] T18: 手動疎通確認
- [ ] T19: `docs/05_progress.md` のステータス更新
- [ ] T20: 計画書に実装完了セクション追記

## 技術的注意点

- **CORS 修正の優先度**: `PATCH` を allowMethods に追加するまではフロントの PATCH 呼び出しが通らない。バックエンドのテスト Green と CORS 修正は frontend 着手前に完了させる。
- **`Authorization` ヘッダーの共通化**: settings ページ内で複数の `fetch` 呼び出しがあるため、`getAuthHeaders(): Record<string, string>` のローカルヘルパーを 1 つ用意して `Content-Type` と `Authorization: Bearer ${authStore.accessToken}` を 1 箇所で組み立てる。各 fetch でリテラルを重複させない（規約「冗長な実装をしない」遵守）。
- **正規化値の一度計算**: 各 `handleSubmit*` の冒頭で `normalizedUsername` / `normalizedCurrentPassword` / `normalizedNewPassword` / `normalizedConfirmPassword` を一度だけ計算し、validate と fetch の両方で再利用する。
- **`response.ok` 先行**: 既存ページと同じ「`if (!response.ok) await parseErrorResponse(response)`」順序を守る。JSON パース先行禁止。
- **401 の扱い**: 401 を受けた場合は `authStore.logout()` を呼んで `/login` に逃がす（自動 refresh + retry は実装しない）。`fetch` 例外は `ApiError(0, ...)` 相当の文言（`'ネットワークエラーが発生しました。接続を確認してください'`）で吸収する。
- **DELETE + JSON body**: `method: 'DELETE'`, `headers: { 'Content-Type': 'application/json' }`, `body: JSON.stringify({ currentPassword })` を明示する。Hono の `zValidator('json', ...)` は DELETE でも JSON body をパースできるが、テスト側でも `headers` と `body` を明示すること。
- **`refreshToken` Cookie 削除**: パスワード変更・アカウント削除成功時は、auth ルート同様に `deleteCookie(c, "refreshToken", { path: "/api/v1/auth" })` と `deleteCookie(c, "refreshToken", { path: "/api/v1/auth/refresh" })` の両 Path を消す（既存ロジックと整合）。
- **パスワード強度ルールの整合**: 新パスワードは backend 側で `strongPasswordSchema` を、frontend 側で `validatePassword` を使う。settings 用に同等ロジックを書き起こさない。
- **新旧パスワード同一チェック**: バックエンドで `currentPassword === newPassword` を弾く。フロント側でも `validateConfirmPassword` の前段に同様のローカル検証を入れて UX を改善する。
- **`authStore.updateUser()` の安全性**: `status !== 'authenticated'` 時は無視する。`accessToken === null` の状態で user だけ更新されると `isLoggedIn` の意味が崩れる。
- **autocomplete 属性**:
  - ユーザー名: `"username"`
  - 現在のパスワード: `"current-password"`
  - 新しいパスワード: `"new-password"`
  - 確認パスワード: `"new-password"`
- **削除確認 UI**: 確認チェックボックスにチェックが入るまで「アカウントを削除する」ボタンを `disabled` にし、`aria-describedby` で警告文を読み上げ可能にする。
- **i18n 風の文言固定**: 成功トーストは `"ユーザー名を変更しました"` / `"パスワードを変更しました"` / `"アカウントを削除しました"` で固定。バックエンドの `message` をそのまま使わず、フロントで日本語固定にする（既存ページと同じ責務分担）。
- **エラートースト方針**: API エラー（4xx / 5xx）は `toastStore.fromApiError(error)` で表示し、フォーム内エラー（`formError`）にも同じ文言を出す。トーストとフォームのどちらも触らないと UX が劣化するため、両方を更新する。

## テストケース一覧

### バックエンド（Vitest + Prisma モック）

| ケース | エンドポイント | 期待結果 |
|---|---|---|
| 未認証 | GET /users/me | 401 `"認証が必要です"` |
| 認証済み・存在ユーザー | GET /users/me | 200、`user` に `id` `username` `email` `role` `createdAt` が含まれる |
| ユーザー名変更成功 | PATCH /users/me | 200、`user.username` が新しい値、DB 更新呼び出しあり |
| ユーザー名重複 | PATCH /users/me | 409 `"このユーザー名は既に使用されています"` |
| ユーザー名形式不正 | PATCH /users/me | 400 `"バリデーションエラー"` |
| 同じユーザー名で更新 | PATCH /users/me | 200（DB 副作用は実装方針に依存。仕様としては許容） |
| パスワード変更成功 | PATCH /users/me | 200、`refreshToken` Cookie 削除ヘッダー、`refreshToken.deleteMany` 呼び出しあり |
| 現在パスワード誤り | PATCH /users/me | 400 `"現在のパスワードが正しくありません"`、DB 更新なし |
| 新旧パスワード同一 | PATCH /users/me | 400 `"新しいパスワードは現在のパスワードと異なるものにしてください"` |
| 弱い新パスワード | PATCH /users/me | 400 `"バリデーションエラー"`（`strongPasswordSchema` 由来） |
| payload 排他違反（username と currentPassword を同送） | PATCH /users/me | 400 `"バリデーションエラー"` |
| アカウント削除成功 | DELETE /users/me | 200、`user.delete` 呼び出しあり、`refreshToken` Cookie 削除ヘッダーあり |
| 現在パスワード誤りでアカウント削除 | DELETE /users/me | 400 `"現在のパスワードが正しくありません"`、`user.delete` 未呼び出し |
| 未認証アカウント削除 | DELETE /users/me | 401 `"認証が必要です"` |
| レート制限超過（パスワード変更） | PATCH /users/me | 429 |
| レート制限超過（アカウント削除） | DELETE /users/me | 429 |

### フロントエンド（手動 + バリデーション unit テスト）

| ケース | 期待結果 |
|---|---|
| 未ログインで `/settings` にアクセス | `/login` にリダイレクトされる |
| `GET /users/me` 成功 | 現在の username と email が画面に表示される |
| `GET /users/me` が 401 | `authStore.logout()` が呼ばれ `/login` に遷移する |
| ユーザー名空欄送信 | 「ユーザー名を入力してください」が表示される |
| ユーザー名 2 文字 | 「ユーザー名は3文字以上にしてください」 |
| ユーザー名にハイフン | 「ユーザー名は英数字とアンダースコアのみ使用できます」 |
| ユーザー名変更成功 | 成功トースト、Header の username も即時更新、`authStore.user.username` が更新される |
| ユーザー名重複 | API の 409 メッセージがそのまま表示される |
| 現在パスワード空欄 | 「現在のパスワードを入力してください」 |
| 新しいパスワードが弱い | `validatePassword` と同じ日本語エラーが表示される |
| 確認用パスワード不一致 | 「確認用パスワードが一致しません」 |
| パスワード変更成功 | 成功トースト → `authStore.logout()` → `/login` |
| 現在パスワード誤りでパスワード変更 | 「現在のパスワードが正しくありません」表示、ログイン状態は維持 |
| 削除確認チェックなし | 送信ボタン disabled、submit しても確認メッセージが表示される |
| 現在パスワード誤りでアカウント削除 | 400 メッセージ表示、アカウントは残る |
| アカウント削除成功 | 成功トースト → `authStore.logout()` → `/` |
| キーボードのみで操作 | 全要素にフォーカス可能、Enter で送信可能 |
| スクリーンリーダー | エラーが `aria-describedby` 経由で読み上げられる |
| register 既存 validation テスト | `validateUsername` 移管後も既存の email / password テストが通り、`username.test.ts` も全通過する |

## 実装リスクと回避策

- **リスク: CORS 設定の修正漏れで PATCH が動かない**
  - 回避策: T1（CORS 修正）を最優先タスクにし、frontend 実装着手前に完了させる。手動疎通確認の最初のチェック項目に「PATCH プリフライトが 204 で返る」ことを含める。

- **リスク: 「現在のパスワードが正しくありません」を 401 にしてしまい、将来の自動 refresh + retry に巻き込まれる**
  - 回避策: 仕様として 400 を明示。ルートテストでも 401 を期待しないことを明確に書く。

- **リスク: `refreshToken` Cookie の path 不整合で削除が効かない**
  - 回避策: 既存 auth ルートと同じ `deleteCookie(... { path: "/api/v1/auth" })` と `{ path: "/api/v1/auth/refresh" }` の両 Path を消す。テストでも `Set-Cookie` ヘッダーに `Max-Age=0` が両 Path で出ることを確認する。

- **リスク: ユーザー名変更後に Header と settings 画面の表示がズレる**
  - 回避策: PATCH レスポンスで updated user を返し、`authStore.updateUser()` とローカル profile state を同時更新する。

- **リスク: パスワード変更成功後に accessToken が残って中途半端な操作ができる**
  - 回避策: 成功直後に `authStore.logout()` を必ず呼ぶ。`/login` 遷移より先にクライアント側 state をクリアする。

- **リスク: route-to-route import で validation の依存が崩れる**
  - 回避策: `validateUsername` を `lib/validation/username.ts` に移し、register 側は再エクスポートだけにする（`validatePassword` の前例と同じ方式）。

- **リスク: `validateConfirmPassword` が reset-password と重複し、文言ズレが発生する**
  - 回避策: 両画面の文言を `'確認用パスワードが一致しません'` で固定する手動チェックを「実装完了時の整合性チェック」に含める。後続リファクタで `lib/validation/confirmPassword.ts` への抽出を検討するタスクを `docs/05_progress.md` の補足に残す。

- **リスク: DELETE request body の取り扱いが想定外で壊れる**
  - 回避策: ルートテストで DELETE + JSON body を明示的に検証し、フロントも `Content-Type` と body を明示で送る。

- **リスク: レート制限の網羅漏れ（パスワード変更・アカウント削除がブルートフォース対象になる）**
  - 回避策: `authRateLimit` を PATCH パスワード変更パス・DELETE パスに適用することを T6 の完了条件に含め、ルートテストで 429 のケースを必須化する。

- **リスク: `authStore.updateUser()` が `accessToken: null` 状態で呼ばれて isLoggedIn の意味が崩れる**
  - 回避策: `status !== 'authenticated'` のときは no-op にする。実装と JSDoc にこの不変条件を明記し、authStore のテストにも no-op ケースを追加する。

- **リスク: users API 実装が後回しになって settings UI だけ先に進む**
  - 回避策: タスク順を「CORS 修正 → backend Red → backend Green → backend lint/test → frontend」に固定し、backend が緑になるまで frontend 実装に進まない。
