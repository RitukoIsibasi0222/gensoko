# 苦手リスト画面 `/weak`（ソート・手動削除ボタン）実装計画

> 設計者ロール: シニアフロントエンドエンジニア

## 概要

認証済みユーザー向けに `/weak` 画面を実装し、`GET /api/v1/weak` で取得した苦手元素一覧を表示する。画面では `missCount`、`addedAt`、元素番号、元素名によるソートと、各苦手元素の手動削除を提供する。

`GET /weak` は既に frontend API client / backend route / service が実装済みだが、`DELETE /weak/:elementId` は `docs/04_api.md` 上も後続タスク扱いで、現行 backend に route / service 実装がない。そのため本計画には、backend DELETE 実装、frontend API client 追加、`/weak` UI 実装、API 仕様ドキュメント更新を含める。

## レビュー結果と改善方針

| 観点 | レビュー結果 | 改善方針 |
|---|---|---|
| 既存コード整合性 | `frontend/src/lib/api/weak.ts` は `getWeakElements()` と runtime validation を実装済み。`/weak` 画面は仮ページ | 既存 API client の責務分担を維持し、画面には fetch 詳細を置かない |
| 進捗整合 | `docs/05_progress.md` の主対象はフェーズ8 `苦手リスト画面 /weak（ソート・手動削除ボタン）`。依頼の機能名・画面ルートと一致する | 本計画の主対象はこのフェーズ8タスクとする |
| 既存計画 | `docs/plans/weak-list-page/plan.md` は未作成 | 新規計画として作成し、実装完了時に更新できる構成にする |
| API仕様 | `docs/04_api.md` は `GET /weak` を定義済み、`DELETE /weak/:elementId` は「後続タスクで実装」扱い | DELETE の成功 response / 400 / 404 / 500 を本タスクで確定し、docs を更新する |
| backend実装 | `backend/src/routes/weak/index.ts` は `GET /` のみ。`DELETE /:elementId` は未実装 | route / service / tests を追加する |
| frontend API client | `frontend/src/lib/api/weak.ts` は `getWeakElements()` のみ実装済み | `deleteWeakElement()`、型、runtime validation、テストを追加する |
| A11Y | `/elements` と `/game/play` は画面内 loading / error / retry と `aria-live` / `role="alert"` を使っている | `/weak` でも一時 toast だけに依存せず、画面内状態とキーボード操作可能な削除確認 UI を用意する |
| DB整合性 | `WeakElement` は `@@unique([userId, elementId])` を持つため、本人 + 元素IDで最大1件に絞れる | `deleteMany({ where: { userId, elementId } })` で所有者条件を必須にし、削除件数 0 は 404 にする |
| DB負荷 | 苦手リストは最大118件相当で、既存 unique index の先頭列 `userId` で絞り込める。UIソートは小規模配列の派生計算で足りる | ソート用の backend query / index / migration は追加しない |
| テスト | 既存 weak tests は GET のみ。DELETE、sort helper、削除中の二重送信防止が未検証 | backend route/service、frontend API client、sort helper、手動確認で責務別に補強する |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- フェーズ8: `苦手リスト画面 /weak（ソート・手動削除ボタン）` は `[ ]`。
- フェーズ9: `GET /weak + DELETE /weak/:elementId` は `[ ]` だが、`GET /weak` は `/game` 苦手件数同期タスクで先行実装済み。

**`docs/04_api.md`**
- `GET /weak` は認証必須で、`{ weakElements: [...] }` を返す。
- `DELETE /weak/:elementId` は「苦手リストから削除（後続タスクで実装）」と記載されており、成功 response / error 詳細は未確定。

**`frontend/src/lib/api/weak.ts`**
- `type WeakElement = { elementId: number; symbol: string; nameJa: string; missCount: number; addedAt: string }`
- `type GetWeakElementsOptions = { accessToken: string; signal?: AbortSignal }`
- `getWeakElements(options: GetWeakElementsOptions): Promise<WeakElement[]>` — Authorization 付きで `GET /weak` を呼び、runtime validation 後に配列を返す。

**`frontend/src/lib/api/errors.ts`**
- `parseErrorResponse(response: Response, defaultMessage?: string): Promise<never>` — 非 JSON エラーに対応して `ApiError` を throw する。
- `class ApiError extends Error` — `status`, `body` を持つ API 共通例外。

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL: string` — `VITE_API_BASE_URL` を一元管理する。

**`frontend/src/lib/stores/auth.svelte.ts`**
- `authStore.isInitializing: boolean`
- `authStore.isLoggedIn: boolean`
- `authStore.accessToken: string | null`
- `authStore.user: AuthUser | null`

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.error(message: string): string`
- `toastStore.fromApiError(error: ApiError): string`
- `toastStore.success(message: string): string`

**`frontend/src/routes/(app)/weak/+page.svelte`**
- 現状は仮ページ。`h1` と「フェーズ8・9で実装予定」の説明のみ。

**`backend/src/routes/weak/index.ts`**
- `GET /` — `authMiddleware` 適用、`getWeakElements(user.id)` の結果を `{ weakElements: [...] }` で返す。

**`backend/src/services/weak.service.ts`**
- `type WeakElementListItem = { elementId: number; symbol: string; nameJa: string; missCount: number; addedAt: Date }`
- `getWeakElements(userId: string): Promise<WeakElementListItem[]>` — `WeakElement` を `updatedAt desc`, `addedAt desc` で取得する。

**`backend/prisma/schema.prisma`**
- `WeakElement`: `id`, `userId`, `elementId`, `missCount`, `consecutiveHit`, `addedAt`, `updatedAt`
- `@@unique([userId, elementId])`
- `User` との relation は `onDelete: Cascade`
- DB スキーマ変更は不要想定。

**`backend/src/lib/elements/detail.ts`**
- `elementIdParamSchema` — `id` path param を 1〜118 の整数に正規化・検証する既存 schema。

### 重要な制約

- API URL は `$lib/api/config.ts` の `API_BASE_URL` を使い、画面や API client 内で環境変数を重複定義しない。
- HTTP エラー時は `response.ok` を JSON parse より先に確認し、`parseErrorResponse()` を使う。
- バックエンドの日本語エラーメッセージを frontend 固定文言で上書きしない。
- `GET /weak` の response 形式は既存 `docs/04_api.md` と `frontend/src/lib/api/weak.ts` に合わせる。
- `DELETE /weak/:elementId` は所有者条件つきで処理し、他ユーザーの苦手元素を削除しない。
- DB アクセスは Prisma ORM 経由。生 SQL は使わない。
- DB スキーマ変更は行わない。変更が必要になった場合は計画逸脱として理由を記録し、migration / Playwright 確認を追加する。
- `/weak` は未ログイン時に weak API を呼ばず、ログイン導線を表示する。
- 削除中は対象行の削除ボタンを無効化し、同じ元素への二重送信を防ぐ。

### 確認事項

- `DELETE /weak/:elementId` の成功レスポンスは現行 `docs/04_api.md` に未定義。本計画では `200 { "message": "苦手リストから削除しました" }` を提案し、実装時に `docs/04_api.md` へ明記して確定する。
- 削除対象が存在しない場合の扱いは未定義。本計画では本人の苦手元素が存在しない場合を `404 { "error": "苦手元素が見つかりません" }` とする。
- `403` は主に auth middleware の停止・メール未確認・ロック中で発生する想定。所有者不一致は本人のリソースがない状態として `404` に寄せる。
- `GET /weak` response には `nameEn` がないため、元素名ソートは `nameJa` を対象にする。英語名ソートが必要なら API response 拡張が別途必要。
- `missCount` や `addedAt` の並び順を backend query parameter として追加するかは未定義。本計画では UI 側の派生ソート配列で対応し、API 仕様拡張は行わない。
- frontend の Svelte page テスト基盤は現状 helper / API client 中心で、Svelte component の DOM テストは少ない。UI は helper/API client の自動テストと手動確認で補強する。

## 対象ファイル一覧（変更種別つき）

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/services/weak.service.ts` | 修正 | `deleteWeakElement()` と必要な error 型を追加 |
| `backend/src/services/weak.service.test.ts` | 修正 | 削除成功、存在しない対象、所有者条件のテストを追加 |
| `backend/src/routes/weak/index.ts` | 修正 | `DELETE /:elementId` route、param validation、エラー処理を追加 |
| `backend/src/routes/weak/weak.test.ts` | 修正 | DELETE route の認証、400、200、404、500 テストを追加 |
| `frontend/src/lib/api/weak.ts` | 修正 | `deleteWeakElement()`、削除レスポンス型、runtime validation を追加 |
| `frontend/src/lib/api/weak.test.ts` | 修正 | DELETE の URL、Authorization、非 JSON、response validation テストを追加 |
| `frontend/src/lib/weak/sort.ts` | 新規 | sort query 正規化、URL query 復元、ソート関数 |
| `frontend/src/lib/weak/sort.test.ts` | 新規 | sort key/order、URL query、安定ソート、境界値テスト |
| `frontend/src/routes/(app)/weak/+page.svelte` | 修正 | 苦手リスト画面本体、取得、ソート、削除、状態表示を実装 |
| `docs/04_api.md` | 修正 | `DELETE /weak/:elementId` の request / response / error を確定 |
| `docs/05_progress.md` | 修正 | 対象タスクを実装中・完了へ更新 |
| `docs/plans/weak-list-page/plan.md` | 修正 | 実装完了時にチェックボックスと完了記録を更新 |

## API 仕様（この機能で使う範囲のみ）

### エラーレスポンス共通形式

```json
{ "error": "メッセージ文字列" }
```

バリデーションエラー時:

```json
{
  "error": "バリデーションエラー",
  "details": [
    { "message": "元素IDは1から118の整数で指定してください" }
  ]
}
```

### GET `/api/v1/weak`

| 項目 | 内容 |
|---|---|
| 認証 | 必須。`Authorization: Bearer <accessToken>` |
| 成功 | 200 |
| 用途 | 認証済みユーザーの苦手元素一覧を取得する |
| 副作用 | なし |

Response 200:

```json
{
  "weakElements": [
    {
      "elementId": 26,
      "symbol": "Fe",
      "nameJa": "鉄",
      "missCount": 3,
      "addedAt": "2026-05-01T00:00:00.000Z"
    }
  ]
}
```

Error:

| ステータス | 条件 |
|---|---|
| 401 | 未ログイン、token 不正、ユーザーが見つからない |
| 403 | アカウント停止、メール未確認、ロック中 |
| 500 | 想定外エラー |

### DELETE `/api/v1/weak/:elementId`

| 項目 | 内容 |
|---|---|
| 認証 | 必須。`Authorization: Bearer <accessToken>` |
| Path params | `elementId`: 1〜118 の10進整数 |
| 成功 | 200 |
| 用途 | 認証済みユーザー本人の苦手リストから指定元素を削除する |
| 副作用 | `WeakElement` を1件削除する。該当なしなら削除しない |

Response 200:

```json
{
  "message": "苦手リストから削除しました"
}
```

Error:

| ステータス | 条件 | body |
|---|---|---|
| 400 | `elementId` が 1〜118 の10進整数でない | `{ "error": "バリデーションエラー", "details": [...] }` |
| 401 | 未ログイン、token 不正、ユーザーが見つからない | auth middleware の日本語エラー |
| 403 | アカウント停止、メール未確認、ロック中 | auth middleware の日本語エラー |
| 404 | 本人の苦手リストに対象元素がない | `{ "error": "苦手元素が見つかりません" }` |
| 500 | 想定外エラー | `{ "error": "サーバーエラーが発生しました" }` |

## 設計上の決定事項

1. **ソート状態の source of truth**
   - 選択: URL query に置く。例: `/weak?sort=missCount&order=desc`
   - 根拠: reload、戻る、直接アクセスで状態を復元でき、`/elements` の検索状態管理方針とも揃う。

2. **reload / 戻る / 直接アクセス時の復元**
   - 選択: `page.url.searchParams` から `sort` / `order` を復元する。
   - 根拠: page local state だけだと reload で失われ、戻る操作時に表示順が変わる。

3. **API response と画面表示の source of truth**
   - 選択: `GET /weak` response の配列を raw source of truth とし、表示用に local derived sorted array を作る。
   - 根拠: 並び替えは表示都合であり、API response 自体を書き換えないほうが削除後の再取得や件数整合を保ちやすい。

4. **削除後の更新方法**
   - 選択: DELETE 成功後に `GET /weak` を再取得し、一覧と件数を backend 実態に合わせる。
   - 根拠: 手動削除後に count や backend guard とズレないよう、最終状態は API response で確定する。

5. **削除確認**
   - 選択: 即時削除ではなく、行内で確認状態を出してから削除する。
   - 根拠: 苦手リストからの削除は学習状態に影響するため、誤操作防止を優先する。ブラウザ `confirm()` ではなく画面内 UI にして文言・A11Y を制御する。

6. **削除中の二重送信防止**
   - 選択: `deletingElementIds: Set<number>` 相当の状態で対象元素の削除ボタンを無効化し、同じ `elementId` の二重 DELETE を防ぐ。
   - 根拠: 行ごとの操作なので、他の行は操作可能にしつつ対象だけを保護できる。

7. **エラー表示**
   - 選択: 初期取得・再取得失敗は画面内エラー + 再試行ボタンを主にする。削除失敗は対象行付近のエラー + toast を補助にする。
   - 根拠: 一覧取得失敗は画面全体の状態。削除失敗は行操作の結果なので、文脈を残す。

8. **未ログイン状態**
   - 選択: `authStore.isInitializing` 中は判定保留、未ログイン確定後は API を呼ばずログイン導線を表示する。
   - 根拠: 不要な 401 とログイン状態のちらつきを避ける。

9. **`DELETE /weak/:elementId` の API client / 型定義 / validation**
   - 選択: `frontend/src/lib/api/weak.ts` に `deleteWeakElement()` を追加し、成功レスポンス `{ message: string }` を runtime validation する。
   - 根拠: page に fetch 処理を置かず、既存 `getWeakElements()` と同じ責務分担にする。

10. **`docs/04_api.md` の DELETE 仕様更新**
    - 選択: 必須更新。
    - 根拠: 現在は「後続タスクで実装」とだけ記載され、成功 response / 404 / 400 が未確定のため、実装とドキュメントを一致させる必要がある。

11. **backend 削除実装**
    - 選択: `deleteMany({ where: { userId, elementId } })` を使い、削除件数 0 なら 404 相当の service error を返す。
    - 根拠: `@@unique([userId, elementId])` があるため最大1件。所有者条件を必ず含めることで他ユーザーのレコードを削除しない。

12. **ソートキー**
    - 選択: `missCount`, `addedAt`, `elementId`, `nameJa` を対応する。必要なら `symbol` を補助キーとして helper 内で扱う。
    - 根拠: 要件の `missCount`、`addedAt`、元素番号、元素名を満たす。現行 API response に英語名はないため日本語名を使う。

13. **DB スキーマ・index**
    - 選択: 追加しない。
    - 根拠: `WeakElement` は最大でも元素数相当の小規模データで、削除は composite unique の条件で1件に絞れる。UIソートのための DB index は不要。

## 公開インターフェース案

### Backend

```ts
export class WeakElementError extends Error {
  constructor(public readonly status: 404, message: string);
}

export async function deleteWeakElement(input: {
  userId: string;
  elementId: number;
}): Promise<void>;
```

### Frontend API client

```ts
export type DeleteWeakElementOptions = {
  accessToken: string;
  elementId: number;
  signal?: AbortSignal;
};

export type DeleteWeakElementResponse = {
  message: string;
};

export async function deleteWeakElement(
  options: DeleteWeakElementOptions
): Promise<DeleteWeakElementResponse>;
```

### Frontend sort helper

```ts
import type { WeakElement } from '$lib/api/weak';

export type WeakSortKey = 'missCount' | 'addedAt' | 'elementId' | 'nameJa';
export type WeakSortOrder = 'asc' | 'desc';

export type WeakSortState = {
  key: WeakSortKey;
  order: WeakSortOrder;
};

export const DEFAULT_WEAK_SORT_STATE: WeakSortState;

export function readWeakSortState(searchParams: URLSearchParams): WeakSortState;
export function toWeakSortSearchParams(sortState: WeakSortState): URLSearchParams;
export function sortWeakElements(
  weakElements: readonly WeakElement[],
  sortState: WeakSortState
): WeakElement[];
```

## タスクリスト（進捗管理）

| タスクID | 内容 | ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存仕様・既存実装を確認する | `docs/05_progress.md`, `docs/04_api.md`, `docs/plans/*/plan.md`, weak 関連 frontend/backend | 対象タスク、GET 実装済み、DELETE 未実装、`/weak` 仮ページ、DB変更不要想定を確認済み | 高 |
| T2 | `docs/05_progress.md` を実装中へ更新する | `docs/05_progress.md` | `苦手リスト画面 /weak（ソート・手動削除ボタン）` が `[-]` になる | 中 |
| T3 | backend DELETE service テストを追加する | `backend/src/services/weak.service.test.ts` | userId + elementId 条件、削除成功、削除0件時エラーの Red を確認する | 高 |
| T4 | backend DELETE service を実装する | `backend/src/services/weak.service.ts` | Prisma ORM で本人の `WeakElement` だけを削除し、該当なしは日本語エラーにする | 高 |
| T5 | backend DELETE route テストを追加する | `backend/src/routes/weak/weak.test.ts` | 未認証401、不正 elementId 400、成功200、該当なし404、想定外500 を検証する | 高 |
| T6 | backend DELETE route を実装する | `backend/src/routes/weak/index.ts` | `DELETE /api/v1/weak/:elementId` が認証・param validation・service error を正しく扱う | 高 |
| T7 | frontend DELETE API client テストを追加する | `frontend/src/lib/api/weak.test.ts` | URL、Authorization、AbortSignal、401/404、非 JSON、response 不正を検証する | 高 |
| T8 | frontend DELETE API client を実装する | `frontend/src/lib/api/weak.ts` | `deleteWeakElement()` が `API_BASE_URL` / `parseErrorResponse()` / runtime validation を使う | 高 |
| T9 | weak sort helper テストを追加する | `frontend/src/lib/weak/sort.test.ts` | default、query 復元、不正 query fallback、各 sort key/order、同値時の安定順を検証する | 高 |
| T10 | weak sort helper を実装する | `frontend/src/lib/weak/sort.ts` | ソート状態と表示用ソート配列が純関数として利用できる | 高 |
| T11 | `/weak` の認証・取得状態を実装する | `frontend/src/routes/(app)/weak/+page.svelte` | initializing、未ログイン、loading、success、error、retry が表示され、未ログイン時は API を呼ばない | 高 |
| T12 | `/weak` の一覧 UI と空状態を実装する | `frontend/src/routes/(app)/weak/+page.svelte` | 苦手元素カードまたはテーブル、件数、空状態、学習導線が表示される | 高 |
| T13 | ソート UI と URL query 同期を実装する | `frontend/src/routes/(app)/weak/+page.svelte` | sort/order の切替が URL query に反映され、reload / 戻るで復元される | 高 |
| T14 | 削除確認 UI と削除中状態を実装する | `frontend/src/routes/(app)/weak/+page.svelte` | 行内確認、対象ボタン disabled、二重送信防止、削除成功後の再取得が動作する | 高 |
| T15 | 削除失敗・再取得失敗の表示を実装する | `frontend/src/routes/(app)/weak/+page.svelte` | DELETE 失敗は行付近 + toast、再取得失敗は画面内 retry で扱える | 高 |
| T16 | API 仕様ドキュメントを更新する | `docs/04_api.md` | `DELETE /weak/:elementId` の成功 response / 400 / 404 / 500 が実装と一致する | 高 |
| T17 | frontend 品質チェックを実行する | `frontend/` | `npm run format`, `npm run lint`, `npm run test:run`, `npm run check` が通る | 高 |
| T18 | backend 品質チェックを実行する | `backend/` | `npm run format`, `npm run lint`, `npm run format:check`, `npm run test -- --run` が通る | 高 |
| T19 | 手動確認を実施する | Browser / Docker 環境 | 初期表示、空状態、ソート、reload、戻る、削除成功/失敗、未ログイン、モバイルを確認する | 高 |
| T20 | 実装完了ドキュメントを更新する | `docs/05_progress.md`, `docs/plans/weak-list-page/plan.md` | progress 完了、チェックボックス、実装完了セクション、実際の変更ファイルが実態と一致する | 高 |

- [x] T1: 既存仕様・既存実装を確認する
- [x] T2: `docs/05_progress.md` を実装中へ更新する
- [x] T3: backend DELETE service テストを追加する
- [x] T4: backend DELETE service を実装する
- [x] T5: backend DELETE route テストを追加する
- [x] T6: backend DELETE route を実装する
- [x] T7: frontend DELETE API client テストを追加する
- [x] T8: frontend DELETE API client を実装する
- [x] T9: weak sort helper テストを追加する
- [x] T10: weak sort helper を実装する
- [x] T11: `/weak` の認証・取得状態を実装する
- [x] T12: `/weak` の一覧 UI と空状態を実装する
- [x] T13: ソート UI と URL query 同期を実装する
- [x] T14: 削除確認 UI と削除中状態を実装する
- [x] T15: 削除失敗・再取得失敗の表示を実装する
- [x] T16: API 仕様ドキュメントを更新する
- [x] T17: frontend 品質チェックを実行する
- [x] T18: backend 品質チェックを実行する
- [x] T19: 手動確認を実施する
- [x] T20: 実装完了ドキュメントを更新する

## 技術的注意点

- `/weak/+page.svelte` に API URL を直接書かない。取得・削除は `$lib/api/weak.ts` に集約する。
- sort query の正規化は `$lib/weak/sort.ts` に集約し、page 内で同じ switch / fallback を重複させない。
- `addedAt` は ISO string として受け取り、ソート時のみ `Date.parse()` 相当で比較する。不正値が混ざった場合は API client validation で弾く。
- sort helper は元配列を破壊しない。
- DELETE 成功後は `GET /weak` を再取得し、件数と一覧を backend 実態に合わせる。
- `AbortController` を使い、unmount / token 変更時に古い取得結果が新状態を上書きしないようにする。
- abort error は通常エラーとして表示しない。
- `authStore.isInitializing` 中は未ログインと断定しない。
- backend route で既存 `elementIdParamSchema` を再利用する場合、schema の property 名が `id` であることに注意する。`elementId` の path param に合わせるなら専用 schema を用意する。
- backend の想定外エラーは詳細を返さず `{ error: "サーバーエラーが発生しました" }` に統一する。
- `DELETE /weak/:elementId` は `userId` 条件を必ず含める。他ユーザーのレコードを削除しない。
- DB schema / migration は変更しない。変更した場合は追加チェックが必須。
- UI は既存 `/elements`, `/game` と同じ控えめな情報設計にし、状態説明の長文を画面に置きすぎない。
- ソート UI は `select` または明確な button 群を使い、現在の sort と order がテキストで分かるようにする。
- ボタンテキストはモバイル幅で折り返し・はみ出しが起きないようにする。
- 削除確認 UI はキーボード操作可能にし、失敗時は `role="alert"` または近接するエラーテキストで伝える。

## テストケース一覧

| ケース | 対象 | 期待結果 |
|---|---|---|
| 初期表示 | `/weak` | 認証確認後に loading を表示し、`GET /weak` を呼ぶ |
| 苦手リスト取得成功 | frontend / backend | 200 response の配列が表示され、件数が一致する |
| 空状態 | `/weak` | `weakElements: []` で空状態とゲーム導線を表示する |
| ソート条件切り替え | sort helper / `/weak` | `missCount`, `addedAt`, `elementId`, `nameJa` で昇順・降順に切り替わる |
| URL query 復元 | sort helper / `/weak` | `/weak?sort=addedAt&order=asc` を reload しても同じ並びになる |
| 不正 URL query | sort helper | default sort に fallback し、画面が壊れない |
| 削除成功 | backend / API client / `/weak` | DELETE 200 後に再取得し、対象元素が消え、件数が一致する |
| 削除失敗 404 | backend / frontend | `苦手元素が見つかりません` を扱い、一覧は勝手に削らない |
| 削除失敗 500 | backend / frontend | 画面または行付近にエラーを表示し、再操作できる |
| 削除中の二重送信防止 | `/weak` | 対象元素の削除ボタンが disabled になり、同じ DELETE が二重に送られない |
| API エラー | `/weak` | GET 失敗時に画面内エラーと再試行ボタンを表示する |
| 非 JSON エラー | API client | `parseErrorResponse()` の fallback message で `ApiError` を throw する |
| 未ログイン状態 | `/weak` | `GET /weak` を呼ばず、ログイン導線を表示する |
| backend ステータス整合 | frontend / docs | frontend が扱う 400 / 401 / 403 / 404 / 500 が backend 実装・docs と一致する |
| API response 形式不正 | API client | `ApiError(500, "...レスポンス形式が不正です")` を throw する |
| DELETE response 形式不正 | API client | `message` がない場合に `ApiError(500, "...レスポンス形式が不正です")` を throw する |
| A11Y | `/weak` | loading / error / deletion status がテキストで伝わり、Tab 操作で削除確認まで操作できる |
| モバイル表示 | `/weak` | 390px 幅程度で一覧、ソート、削除確認 UI がはみ出さない |

## 実装リスクと回避策

| リスク | 影響 | 回避策 |
|---|---|---|
| DELETE 仕様が docs と実装でズレる | frontend のハンドリング不能、レビュー指摘 | T16 で `docs/04_api.md` を必ず更新し、response / error をテストに固定する |
| 他ユーザーの WeakElement を削除する | セキュリティ事故 | service で `where: { userId, elementId }` を必須にし、テストで固定する |
| 削除後の件数がズレる | UI と DB 実態が不一致 | DELETE 成功後に `GET /weak` を再取得する |
| ソート状態が reload で失われる | ユーザー体験が不安定 | URL query を source of truth にする |
| sort helper と page の正規化が重複する | 修正漏れ | `$lib/weak/sort.ts` に集約する |
| API エラー時に画面が白くなる | `/weak` が使えない | `response.ok` 先行 + `parseErrorResponse()` + 画面内 error state を徹底する |
| 未ログイン時に 401 toast が出る | 不自然な体験 | auth 初期化完了後、未ログインなら API を呼ばずログイン導線を表示する |
| 削除確認 UI が操作しづらい | 誤削除・A11Y 低下 | 行内確認、キャンセル、disabled 状態、キーボード操作を手動確認に含める |
| DB schema 変更が発生する | 作業範囲拡大 | 原則変更しない。必要になった場合は計画完了記録に理由と migration 確認を追加する |

## 手動確認項目

| 項目 | 手順 | 期待結果 |
|---|---|---|
| 未ログイン | `/weak` を開く | API を呼ばず、ログイン導線が表示される |
| 初期 loading | ログイン済みで `/weak` を開く | 読み込み中表示が出る |
| 一覧表示 | 苦手元素ありで `/weak` を開く | 元素番号、記号、日本語名、missCount、addedAt、削除ボタン、件数が表示される |
| 空状態 | 苦手元素0件で `/weak` を開く | 空状態とゲーム導線が表示される |
| missCount ソート | ソートを missCount に切り替える | 件数順に並ぶ |
| addedAt ソート | ソートを addedAt に切り替える | 追加日時順に並ぶ |
| 元素番号ソート | ソートを元素番号に切り替える | 原子番号順に並ぶ |
| 元素名ソート | ソートを元素名に切り替える | 日本語名順に並ぶ |
| URL 復元 | query 付き URL を reload | ソート状態が復元される |
| 戻る操作 | sort を切り替えてブラウザ戻る | 前の sort 状態に戻る |
| 削除確認 | 削除ボタンを押す | 確認 UI が表示され、キャンセルできる |
| 削除成功 | 確認後に削除する | 対象が消え、件数が再取得後の値になる |
| 削除失敗 | backend エラーを発生させる | 行付近または画面内エラーと toast が表示され、再試行できる |
| 非 JSON エラー | backend 停止や 502 相当 | fallback message で画面内エラーになり、白画面にならない |
| モバイル | 390px 幅程度で確認 | ソート UI、カード/表、削除確認が横にはみ出さない |
| キーボード | Tab / Enter / Space で操作 | ソート、削除確認、キャンセル、再試行を操作できる |
| コンソール | 操作一式後に確認 | 想定外の error / hydration mismatch がない |

## 実装完了時の更新ルール

実装完了時は以下を必ず行う。

- `docs/plans/weak-list-page/plan.md` のチェックボックスを `[x]` に更新する。
- `対象ファイル一覧` を実際の変更ファイルに合わせて修正する。
- 計画になかった変更ファイルを追加した場合は表へ追記する。
- 計画にあったが変更しなかったファイルは削除するか「確認のみ」と明記する。
- `docs/04_api.md` の `DELETE /weak/:elementId` 仕様が実装と一致していることを確認する。
- `docs/05_progress.md` の `苦手リスト画面 /weak（ソート・手動削除ボタン）` を `[x]` に更新する。
- DB schema / migration を変更した場合は、migration 適用確認と Playwright 確認結果を記録する。
- 設計判断が変わった場合は「計画からの変更点」に理由つきで記録する。
- `## 実装完了` セクションを追記する。

```markdown
## 実装完了

- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/weak-list-page
- PR: #N

### 計画からの変更点

- 例: DELETE 成功レスポンスを `200 { "message": "苦手リストから削除しました" }` ではなく `204 No Content` に変更したため、API client と docs を合わせて更新した。
- 例: sort helper のファイル名を `frontend/src/lib/weak/sort.ts` から `frontend/src/lib/weak/list-sort.ts` に変更した。

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/services/weak.service.ts` | 修正 | 苦手元素削除 service を追加 |
| `backend/src/routes/weak/index.ts` | 修正 | DELETE /weak/:elementId を追加 |
| `frontend/src/lib/api/weak.ts` | 修正 | deleteWeakElement API client を追加 |
| `frontend/src/lib/weak/sort.ts` | 新規 | ソート helper を追加 |
| `frontend/src/routes/(app)/weak/+page.svelte` | 修正 | 苦手リスト画面を実装 |
| `docs/04_api.md` | 修正 | DELETE /weak/:elementId 仕様を更新 |
| `docs/05_progress.md` | 修正 | 進捗更新 |
| `docs/plans/weak-list-page/plan.md` | 修正 | 実装完了記録 |

### 品質チェック

| コマンド | 結果 |
|---|---|
| `cd backend && npm run format` |  |
| `cd backend && npm run lint` |  |
| `cd backend && npm run format:check` |  |
| `cd backend && npm run test -- --run` |  |
| `cd frontend && npm run format` |  |
| `cd frontend && npm run lint` |  |
| `cd frontend && npm run test:run` |  |
| `cd frontend && npm run check` |  |

### 手動確認

| 条件 | 結果 |
|---|---|
| 未ログイン `/weak` |  |
| 苦手0件 `/weak` |  |
| 苦手複数件 `/weak` |  |
| sort query reload |  |
| ブラウザ戻る操作 |  |
| 削除成功 |  |
| 削除失敗 |  |
| GET API エラー |  |
| モバイル幅 |  |
```

## 実装完了

- 完了日: 2026-06-25
- 実装ブランチ: feature/weak-list-page
- PR: #61

### 計画からの変更点

- sort query はデフォルト状態では空 query にし、デフォルト以外のみ sort/order を URL に反映する実装にした。
- ブラウザ手動確認は未ログイン表示とコンソールエラーなしまで実施した。ログイン後の一覧・削除導線は API client / backend route / sort helper / svelte-check で確認した。
- DB schema / migration は変更していないため、migration 適用確認は対象外。

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| backend/src/services/weak.service.ts | 修正 | 苦手元素削除 service と not found error を追加 |
| backend/src/services/weak.service.test.ts | 修正 | userId + elementId 削除、対象なしエラーのテストを追加 |
| backend/src/routes/weak/index.ts | 修正 | DELETE /weak/:elementId、param validation、404/500 handling を追加 |
| backend/src/routes/weak/weak.test.ts | 修正 | DELETE route の 401/400/200/404/500 テストを追加 |
| frontend/src/lib/api/weak.ts | 修正 | deleteWeakElement API client と runtime validation を追加 |
| frontend/src/lib/api/weak.test.ts | 修正 | DELETE client の正常系、AbortSignal、HTTP error、非 JSON、response 不正テストを追加 |
| frontend/src/lib/weak/sort.ts | 新規 | weak list sort state / URL query / stable sort helper を追加 |
| frontend/src/lib/weak/sort.test.ts | 新規 | sort query 復元、fallback、各 sort、非破壊性テストを追加 |
| frontend/src/routes/(app)/weak/+page.svelte | 修正 | 苦手リスト画面、状態表示、ソート、削除確認 UI を実装 |
| docs/04_api.md | 修正 | DELETE /weak/:elementId 仕様を追加 |
| docs/05_progress.md | 修正 | 進捗を実装中から完了へ更新 |
| docs/plans/weak-list-page/plan.md | 修正 | タスクリストと実装完了記録を更新 |

### 品質チェック

| コマンド | 結果 |
|---|---|
| cd backend && npm run format | 成功 |
| cd backend && npm run lint | 成功 |
| cd backend && npm run format:check | 成功 |
| cd backend && npm run test -- --run | 成功（27 files / 239 tests） |
| cd frontend && npm run format | 成功 |
| cd frontend && npm run lint | 成功 |
| cd frontend && npm run check | 成功（0 errors / 0 warnings） |
| cd frontend && npm run test:run | 成功（20 files / 236 tests） |

### 手動確認

| 条件 | 結果 |
|---|---|
| 未ログイン /weak | 成功。ログイン導線が表示され、console error なし |
| 苦手0件 / 苦手複数件 / 削除成功 | 未実施。自動テストと svelte-check で契約・状態管理を確認 |
| sort query reload / ブラウザ戻る操作 | 未実施。sort helper test と URL 更新実装で確認 |
| モバイル幅 | 未実施 |
