# frontend-api-client 実装計画

> 設計者ロール: シニアフロントエンドエンジニア

## 概要

全画面（ログイン・登録・ゲーム・苦手リスト等）から呼ばれる共通の fetch ラッパー `src/lib/api/client.ts` を実装する。native fetch の薄いラッパーとして、Bearer トークン自動注入・401 自動リトライ（単一フライト）・統一エラー型 `ApiError`・型安全なレスポンスを提供する。

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**src/lib/stores/auth.svelte.ts**

- `user: AuthUser | null` — ログイン中ユーザー
- `accessToken: string | null` — Bearer トークン
- `isLoggedIn: boolean` — `status === 'authenticated'` のとき true
- `isInitializing: boolean` — `status === 'initializing'` のとき true
- `login(user: AuthUser, accessToken: string): void`
- `logout(): Promise<void>` — fetch は store 内で完結（今回変更しない）
- `refresh(): Promise<boolean>` — fetch は store 内で完結、`AbortController` 内蔵
- `initialize(): Promise<void>`

型定義:

- `type AuthUser = { id: string; username: string; role: 'USER' | 'ADMIN' }`
- `type AuthStatus = 'initializing' | 'authenticated' | 'anonymous'`
- `type AuthState = { user: AuthUser | null; accessToken: string | null; status: AuthStatus }`

### 重要な制約

- `auth.svelte.ts` の fetch 呼び出し（`logout` / `refresh`）は一切変更しない
- `VITE_API_BASE_URL` は `auth.svelte.ts` でも参照しているため、`client.ts` でも同じ環境変数を独立して読む（store からは export しない）
- `auth.svelte.ts → client.ts` の import は禁止（循環依存防止）
- `client.ts → auth.svelte.ts` の import は許容（一方向）

## 対象ファイル一覧

| ファイル                       | 変更種別     | 内容                           |
| ------------------------------ | ------------ | ------------------------------ |
| `src/lib/api/client.ts`        | 新規         | API クライアント本体           |
| `src/lib/api/errors.ts`        | 新規         | `ApiError` クラス              |
| `src/lib/api/client.test.ts`   | 新規         | Vitest ユニットテスト          |

## API 仕様（関連エンドポイント）

### エラーレスポンス共通形式

    { "error": "メッセージ文字列" }

ステータスコード: 400 / 401 / 403 / 404 / 409 / 429 / 500

### 認証不要エンドポイント（Authorization ヘッダー不要）

- `POST /api/v1/auth/login` → `{ accessToken: string, user: { id, username, role } }`
- `POST /api/v1/auth/register` → `{ message: string }`
- `POST /api/v1/auth/verify-email`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`

### 認証必要エンドポイント（Authorization: Bearer TOKEN）

- `GET /api/v1/game/questions?mode=...`
- `POST /api/v1/game/sessions`
- `GET /api/v1/weak` / `DELETE /api/v1/weak/:elementId`
- `GET/PATCH/DELETE /api/v1/users/me`
- `POST /api/v1/auth/logout`

## 設計上の決定事項

### 1. `client.ts` と `auth.svelte.ts` の依存関係

- **選択**: `client.ts` が `auth.svelte.ts` を直接 import する（一方向依存）
- **根拠**:
  - 制約「`auth.svelte.ts → client.ts` の import 禁止」を守れば循環は発生しない
  - 依存注入（DI）にすると毎呼び出しで store を渡す必要が出て呼び出し側が冗長になる
  - 共通の singleton store なので DI のメリット（差し替え可能性）はテスト時にしか活きない → テストは `vi.mock('$lib/stores/auth.svelte.ts')` で十分対応可能

### 2. Bearer トークンの注入方法

- **選択**: `client.ts` 内で `authStore.accessToken` を参照して自動付与（オプション `auth: false` で無効化可能）
- **根拠**:
  - 呼び出し側が毎回 token を渡すと忘れ・取り違いが発生する
  - 認証不要エンドポイント（login / register 等）は `auth: false` で明示的にスキップ
  - デフォルトは `auth: true`（認証付き）でセキュアバイデフォルト

### 3. 401 リトライの実装フロー

- **選択**: 同一タブ内の単一フライト保証あり。**複数タブ間競合は今回スコープ外**
- **根拠**:
  - 同一タブ内で複数並行リクエストが 401 を返した場合に refresh を 1 回に集約する（refresh 中の Promise を共有）
  - これは `client.ts` 内のモジュールレベル変数 `let refreshPromise: Promise<boolean> | null` で実現
  - 複数タブ間競合（タブ A でログアウト → タブ B で継続呼び出し）は `BroadcastChannel` 等が必要で別タスクに分離
- **フロー**:
  1. 認証付きリクエストを送信
  2. 401 を受信したら `refreshPromise` をチェック
     - 進行中なら待つ
     - なければ `authStore.refresh()` を呼んで `refreshPromise` にセット
  3. refresh 成功 → 同じリクエストを 1 回だけリトライ（`__retried` フラグで無限ループ防止）
  4. refresh 失敗 → `authStore.logout()` を呼び `ApiError(401, ...)` を throw

### 4. エラー型の設計

- **選択**: `ApiError` クラス（`Error` 継承）
- **根拠**:
  - `instanceof ApiError` で UI 層が判別しやすい
  - `status` / `message` / `body`（生のレスポンス body）をプロパティで持てる
  - discriminated union は型レベルで強力だが、native fetch では try-catch との相性が悪く呼び出し側のボイラープレートが増える
  - ネットワークエラー（fetch 自体が throw）は `ApiError(0, "network error")` に正規化して呼び出し側の分岐を単純化
- **`ApiError.message` 決定ロジック**:
  - レスポンス body が `{ error: string }` 形式 → その文字列を使う
  - そうでない / パース失敗 → HTTP ステータス文言（例: `"HTTP 500"`）を使う
  - 生 body は常に `ApiError.body` に保持し、UI 層が詳細判断できるようにする

### 5. `credentials: 'include'` の付与範囲

- **選択**: 全リクエストに一律で付与
- **根拠**:
  - 認証必要エンドポイントは将来 Cookie ベース要素が増える可能性がある
  - 認証不要エンドポイントでも Cookie が送られても害はない（バックエンドが無視する）
  - 個別判定するより一律にしたほうがバグが減る
  - CORS は既に `FRONTEND_URL` 制約済みで安全

### 6. `VITE_API_BASE_URL` の共通化

- **選択**: 今回はしない（`auth.svelte.ts` を変更したくない制約のため）。`client.ts` でも独立に `import.meta.env.VITE_API_BASE_URL` を読む
- **根拠**: 次タスクで `src/lib/env.ts` に切り出して両者から参照させる

### 7. GET の `body` 許容

- **選択**: GET は `body` 不可（型レベルで弾く）。`apiGet` のオプション型から `body` を除外
- **根拠**: RFC 7231 準拠

## 公開インターフェース案

実装コードは書かない。型シグネチャと役割説明のみ。

    // src/lib/api/errors.ts

    /** API レスポンスのエラーを表す共通例外 */
    export class ApiError extends Error {
      readonly status: number;   // HTTP ステータス（0 = ネットワークエラー）
      readonly body: unknown;    // バックエンドが返した JSON body（パース失敗時は null）
      constructor(status: number, message: string, body?: unknown);
    }

    // src/lib/api/client.ts

    /** リクエストオプション */
    export type ApiRequestOptions = {
      method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      body?: unknown;               // 渡すと JSON.stringify される
      headers?: Record<string, string>;
      auth?: boolean;               // デフォルト true。false で Bearer 付与しない
      signal?: AbortSignal;         // 呼び出し側からのキャンセル
    };

    /**
     * 共通 fetch ラッパー。
     * - JSON シリアライズ・Content-Type 自動設定
     * - auth=true なら Bearer トークン自動注入
     * - 401 で 1 回だけ refresh→リトライ（同一タブ内単一フライト）
     * - エラーは ApiError に正規化
     * - 2xx のレスポンスを T として返す（204/空 body は null）
     */
    export function apiFetch<T = unknown>(
      path: string,                 // '/auth/login' のようにベース URL を含まないパス
      options?: ApiRequestOptions,
    ): Promise<T>;

    /** 便宜関数（薄いショートカット） */
    export function apiGet<T>(
      path: string,
      options?: Omit<ApiRequestOptions, 'method' | 'body'>,
    ): Promise<T>;
    export function apiPost<T>(
      path: string,
      body?: unknown,
      options?: Omit<ApiRequestOptions, 'method' | 'body'>,
    ): Promise<T>;
    export function apiPatch<T>(
      path: string,
      body?: unknown,
      options?: Omit<ApiRequestOptions, 'method' | 'body'>,
    ): Promise<T>;
    export function apiDelete<T>(
      path: string,
      options?: Omit<ApiRequestOptions, 'method' | 'body'>,
    ): Promise<T>;

## 技術的注意点

- **SSR 対応**: `typeof window === 'undefined'` で Bearer 注入・refresh をスキップ。SSR 時に認証付き呼び出しが来た場合は dev 環境で `console.warn` を出して `auth: false` 相当で処理を続行
- **環境変数**: `import.meta.env.VITE_API_BASE_URL` を `auth.svelte.ts` と同様に読む。dev 環境で未設定なら `console.warn`
- **無限ループ防止**: リトライしたリクエストには `__retried` 内部フラグを立て、2 回目の 401 では即 throw
- **204 / Content-Length 0**: `res.json()` が失敗するため、`status === 204` または `Content-Length === '0'` のとき `null as T` を返す
- **AbortSignal**: 呼び出し側 `signal` をそのまま fetch に伝搬。リトライ時も同じ signal を再利用
- **Tree-shaking**: `client.ts` は副作用なしの純関数群で実装（コンポーネント・`+page.ts` どちらからも使える）

## タスクリスト（進捗管理）

| タスクID | 内容                                                                  | ファイル                       | 優先度 | 備考                          |
| -------- | --------------------------------------------------------------------- | ------------------------------ | ------ | ----------------------------- |
| T1       | `ApiError` クラスを実装                                               | `src/lib/api/errors.ts`        | 高     | status / message / body       |
| T2       | `ApiRequestOptions` 型と内部ヘルパー型を定義                          | `src/lib/api/client.ts`        | 高     | 公開型のみ export             |
| T3       | `apiFetch<T>` 本体（JSON・Content-Type・credentials・Bearer 注入）    | `src/lib/api/client.ts`        | 高     | `auth` フラグで Bearer 切替   |
| T4       | エラー正規化（`!res.ok` → ApiError、fetch throw → ApiError(0, ...)）  | `src/lib/api/client.ts`        | 高     | body の JSON パース失敗時 null |
| T5       | 401 自動リトライ（単一フライト・`__retried` 無限ループ防止）          | `src/lib/api/client.ts`        | 高     | refresh 失敗で logout         |
| T6       | 204 / Content-Length 0 のハンドリング                                 | `src/lib/api/client.ts`        | 中     | `null as T` を返す            |
| T7       | SSR ガード（window 未定義時は `auth: false` 相当で動作）              | `src/lib/api/client.ts`        | 中     | warning log                   |
| T8       | 便宜関数 `apiGet / apiPost / apiPatch / apiDelete`                    | `src/lib/api/client.ts`        | 中     | apiFetch の薄いラッパー       |
| T9       | テスト: 正常系（200 で T を返す）                                     | `src/lib/api/client.test.ts`   | 高     | fetch mock                    |
| T10      | テスト: Bearer 自動注入 / `auth: false` 時に未注入                    | `src/lib/api/client.test.ts`   | 高     | authStore mock                |
| T11      | テスト: 400/404/500 → ApiError                                        | `src/lib/api/client.test.ts`   | 高     |                               |
| T12      | テスト: ネットワークエラー → ApiError(0)                              | `src/lib/api/client.test.ts`   | 高     | `fetch.mockRejectedValue`     |
| T13      | テスト: 401 → refresh 成功 → リトライ成功                             | `src/lib/api/client.test.ts`   | 高     |                               |
| T14      | テスト: 401 → refresh 失敗 → logout が呼ばれて ApiError(401) throw     | `src/lib/api/client.test.ts`   | 高     |                               |
| T15      | テスト: 401 並行 2 リクエスト → refresh が 1 回だけ呼ばれる           | `src/lib/api/client.test.ts`   | 高     | 単一フライト検証              |
| T16      | テスト: 204 レスポンス → null を返す                                  | `src/lib/api/client.test.ts`   | 中     |                               |
| T17      | テスト: AbortSignal が伝搬されてキャンセル可能                        | `src/lib/api/client.test.ts`   | 中     |                               |

進捗チェックリスト:

- [x] T1: `ApiError` 実装
- [ ] T2: 公開型定義
- [ ] T3: `apiFetch` 本体
- [ ] T4: エラー正規化
- [ ] T5: 401 自動リトライ
- [ ] T6: 204 ハンドリング
- [ ] T7: SSR ガード
- [ ] T8: 便宜関数
- [ ] T9: テスト 正常系
- [ ] T10: テスト Bearer 注入
- [ ] T11: テスト ApiError 変換
- [ ] T12: テスト ネットワークエラー
- [ ] T13: テスト 401 リトライ成功
- [ ] T14: テスト 401 リトライ失敗
- [ ] T15: テスト 単一フライト
- [ ] T16: テスト 204
- [ ] T17: テスト AbortSignal

## テストケース一覧

| ケース                                       | 期待結果                                                            |
| -------------------------------------------- | ------------------------------------------------------------------- |
| 認証付き GET 正常系                          | 200 OK・T 型で返る・Authorization ヘッダー付与                      |
| `auth: false` で Authorization 未付与        | ヘッダーに Authorization が無い                                     |
| POST に body を渡す                          | `Content-Type: application/json`・body が `JSON.stringify` される   |
| 400 エラー                                   | `ApiError(400, "message", body)` が throw                           |
| 401 → refresh 成功 → リトライ                | 同一リクエスト 2 回・2 回目で 200・最終的に T 型で返る              |
| 401 → refresh 失敗                           | `authStore.logout()` が呼ばれて `ApiError(401)` が throw            |
| 401 並行リクエスト 2 本                      | refresh は 1 回だけ呼ばれる                                          |
| ネットワークエラー（fetch reject）           | `ApiError(0, "network error")`                                      |
| 204 No Content                               | `null` が返る                                                       |
| AbortSignal を渡してキャンセル               | fetch が AbortError で reject される                                |

## 設計のスコープ外（次以降のタスク）

- 複数タブ間での refresh 競合制御（`BroadcastChannel`）
- リクエスト/レスポンスの Zod スキーマ検証（型キャストのみ）
- リトライ回数の指数バックオフ（429 対応など）
- 進行中リクエストの一括キャンセル機構
- `VITE_API_BASE_URL` の `src/lib/env.ts` への切り出し
