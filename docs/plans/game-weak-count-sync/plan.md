# ゲーム苦手件数実データ反映 実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、API 接続設計、状態管理、A11Y レビュー） + バックエンド API 連携レビュー

## 概要

`/game` のモード選択画面では現在、苦手元素数を UI モック用の固定値 `4件` として表示している。そのため `POST /game/sessions` によって `WeakElement` が増えても、モード選択画面の件数と苦手モードの開始可否に反映されない。

本計画では、`GET /weak` を実装してログインユーザーの実際の苦手リストを取得し、`/game` 画面の `weakCount` を固定値から API response に差し替える。`POST /game/sessions` の苦手更新処理自体は既存実装を維持し、本タスクでは「更新後の件数をフロントのモード選択画面へ反映する導線」を接続する。

## レビュー結果と改善方針

| 観点 | レビュー結果 | 改善方針 |
|---|---|---|
| 既存 UI | `frontend/src/routes/(app)/game/+page.svelte` は `PREVIEW_WEAK_ELEMENT_COUNT = MIN_WEAK_ELEMENTS_FOR_GAME - 1` を使っており、常に4件表示になる | 固定値を削除し、ログイン済みの場合は `GET /weak` の件数を `GameModeCard` の `weakCount` に渡す |
| 既存ゲーム API | `POST /game/sessions` は不正解・時間切れの元素を `WeakElement.upsert` している | `POST /game/sessions` の責務は変更しない。必要なら既存テストで回帰確認する |
| 苦手モードの backend guard | `GET /game/questions` は苦手モード時に `WeakElement` が5件未満なら 409 を返す | frontend guard は UX 補助として実データ化し、最終判定は backend guard に任せる |
| 苦手 API | `docs/04_api.md` には `GET /weak` / `DELETE /weak/:elementId` が定義済みだが、`backend/src/routes/weak/index.ts` と `backend/src/services/weak.service.ts` は TODO | 本タスクでは `GET /weak` のみを実装する。`DELETE /weak/:elementId` と `/weak` 一覧画面は後続フェーズに残す |
| 進捗管理 | `docs/05_progress.md` では `GET /weak + DELETE /weak/:elementId` がフェーズ9未実装。`/game` 画面自体はフェーズ6完了扱い | `GET /weak` を先行実装として分割するか、本計画に紐づく新タスクを追加する |
| エラー処理 | 既存 frontend API は `API_BASE_URL` と `parseErrorResponse()` を使っている | `frontend/src/lib/api/weak.ts` も同じ方針に統一する |
| 状態管理 | 苦手件数はログインユーザー・DB 状態に依存する | source of truth は backend の `WeakElement` とし、`/game` ページ local state で loading/error/count を保持する |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- フェーズ6: `ゲームモード選択画面 /game（モード一覧・苦手5問未満ガード表示）` は `[x]`。
- フェーズ7: `POST /game/sessions（questionSetId受信・正誤判定・スコア計算・苦手自動更新・consecutiveHit・masteredCount更新）` は `[x]`。
- フェーズ9: `GET /weak + DELETE /weak/:elementId` は `[ ]`。

**`docs/04_api.md`**
- `GET /weak` は認証必須。
- response は `{ weakElements: [...] }`。
- `GET /game/questions` は苦手モードで苦手元素数が不足すると 409 を返す。

**`backend/prisma/schema.prisma`**
- `WeakElement`: `id`, `userId`, `elementId`, `missCount`, `consecutiveHit`, `addedAt`, `updatedAt`。
- `WeakElement` は `Element` と relation を持つ。
- `@@unique([userId, elementId])` が定義済み。
- DB スキーマ変更は不要。

**`backend/src/services/game.service.ts`**
- `updateWeakElementsForSession(...)` は不正解・時間切れの元素を `weakElement.upsert` する。
- `getCandidateElements(userId, mode)` は苦手モード時に `WeakElement` を取得し、5件未満なら `InsufficientWeakElementsError` を throw する。

**`backend/src/routes/weak/index.ts`**
- 現状 `// TODO: implement`。

**`backend/src/services/weak.service.ts`**
- 現状 `// TODO: implement`。

**`backend/src/index.ts`**
- `/api/v1/auth`, `/api/v1/elements`, `/api/v1/game`, `/api/v1/users` は mount 済み。
- `/api/v1/weak` は未 mount。

**`frontend/src/routes/(app)/game/+page.svelte`**
- `PREVIEW_WEAK_ELEMENT_COUNT` を表示と `GameModeCard.weakCount` に渡している。
- `handleStart(mode)` は `/game/play?mode=...` に遷移する。

**`frontend/src/lib/components/game/GameModeCard.svelte`**
- props: `weakCount: number | null`。
- `getGameModeStartAvailability(config.mode, weakCount)` で開始可否と guard 文言を判定する。

**`frontend/src/lib/game/modes.ts`**
- `getGameModeGuardMessage(mode, weakCount)` は、苦手モードかつ `weakCount < MIN_WEAK_ELEMENTS_FOR_GAME` の場合に開始不可文言を返す。
- `weakCount === null` の場合は「苦手元素数を確認できないため、苦手モードを開始できません。」を返す。

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL` を一元管理する。

**`frontend/src/lib/api/errors.ts`**
- `parseErrorResponse(response, defaultMessage?)`。
- 非 JSON エラー時は `null` body と fallback message を使う。

**`frontend/src/lib/stores/auth.svelte.ts`**
- `authStore.isInitializing`
- `authStore.isLoggedIn`
- `authStore.accessToken`
- `authStore.user`

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.fromApiError(error)`
- `toastStore.error(message)`

### 重要な制約

- `POST /game/sessions` の苦手更新処理は本タスクで再設計しない。
- 苦手件数の source of truth は backend の `WeakElement` とする。
- `/game` は固定の preview 値を使わない。
- 未ログイン時は `GET /weak` を呼ばない。
- `authStore.isInitializing` 中は苦手件数取得を開始しない。
- API エラー時は `weakCount = null` とし、苦手モードは開始不可にする。
- backend のエラー文言は日本語に統一する。
- API base URL とエラー parse は `frontend/src/lib/api/config.ts` / `frontend/src/lib/api/errors.ts` を使い、各ファイルで再定義しない。
- `DELETE /weak/:elementId` と `/weak` 一覧画面は本タスクの対象外。
- DB スキーマ変更・migration は行わない。

### 確認事項

- 依頼の主対象は「`POST /game/sessions` 後に増えた苦手件数を `/game` のモード選択画面へ反映する導線」であり、`POST /game/sessions` の苦手追加処理そのものではない。
- 既存 `docs/plans/game-screens/plan.md` には「苦手5件相当は backend weak API 未実装のため実データ確認なし」と記録されている。本計画はその未接続部分を解消する。
- `docs/05_progress.md` の既存タスクは `GET /weak + DELETE /weak/:elementId` だが、本タスクでは `/game` の開放判定に必要な `GET /weak` のみを先行実装する。`DELETE` は後続の苦手リスト画面タスクで扱う。
- `GET /weak` response に `updatedAt` や `consecutiveHit` を含めるかは既存 `docs/04_api.md` では未定義。本タスクで画面表示に必要なのは件数のみだが、将来の `/weak` 画面と整合する形で必要最小限の公開フィールドを決める。

## 対象ファイル一覧（変更種別つき）

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/services/weak.service.ts` | 修正 | ログインユーザーの苦手リスト取得 service を実装 |
| `backend/src/routes/weak/index.ts` | 修正 | `GET /weak` route、認証、エラー処理を実装 |
| `backend/src/routes/weak/weak.test.ts` | 新規 | `GET /weak` route テスト |
| `backend/src/services/weak.service.test.ts` | 新規 | 苦手リスト取得 service テスト |
| `backend/src/index.ts` | 修正 | `/api/v1/weak` router を mount |
| `frontend/src/lib/api/weak.ts` | 新規 | `getWeakElements()` API client、型、runtime validation |
| `frontend/src/lib/api/weak.test.ts` | 新規 | URL、Authorization、非 JSON、レスポンス validation テスト |
| `frontend/src/routes/(app)/game/+page.svelte` | 修正 | 固定4件表示を削除し、`GET /weak` の件数で表示・開始可否判定 |
| `frontend/src/lib/game/modes.test.ts` | 確認または修正 | 既存の5件境界テストを維持し、必要なら null/error ケースを補強 |
| `docs/04_api.md` | 確認または修正 | `GET /weak` の実装 response とエラー仕様が一致するよう更新 |
| `docs/05_progress.md` | 修正 | 本タスクを追加または `GET /weak` 先行実装として分割・完了更新 |
| `docs/plans/game-weak-count-sync/plan.md` | 新規 | 本計画。実装完了時に実態へ更新 |

## API 仕様（この機能で使う範囲のみ）

### エラーレスポンス共通形式

```json
{ "error": "メッセージ文字列" }
```

### GET `/api/v1/weak`

| 項目 | 内容 |
|---|---|
| 認証 | 必須。`Authorization: Bearer <accessToken>` |
| 成功 | 200 |
| 用途 | ログインユーザーの苦手リストを取得し、`/game` の苦手件数表示・苦手モード開始可否に使う |
| 副作用 | なし |

#### Response 200

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

#### Error

| ステータス | 条件 | body |
|---|---|---|
| 401 | 未ログイン・token 不正 | `{ "error": "認証が必要です" }` または `{ "error": "トークンが無効です" }` |
| 403 | 停止・メール未確認・ロック中 | 既存 auth middleware の日本語エラー |
| 429 | レート制限を適用する場合 | 既存 rateLimit の日本語エラー |
| 500 | 想定外エラー | `{ "error": "サーバーエラーが発生しました" }` |

### GET `/api/v1/game/questions`

本タスクでは実装変更しないが、苦手モード開始時の最終 guard として利用される。

| ステータス | 条件 |
|---|---|
| 409 | 苦手モードで `WeakElement` が5件未満 |

### POST `/api/v1/game/sessions`

本タスクでは request / response 仕様を変更しない。既存の副作用として不正解・時間切れの元素を `WeakElement` に upsert する。

## 設計上の決定事項（判断理由つき）

1. **苦手件数の source of truth**
   - 選択: backend の `WeakElement` を source of truth とし、`GET /weak` response の `weakElements.length` を `/game` 表示と `GameModeCard.weakCount` に使う。
   - 根拠: `POST /game/sessions` 後の永続状態と reload / 戻る操作後の表示を一致させるため。

2. **API 形状**
   - 選択: 新規の count 専用 API ではなく、既存仕様にある `GET /weak` を実装して使う。
   - 根拠: `docs/04_api.md` と `docs/05_progress.md` に既に `GET /weak` が定義されており、将来の `/weak` 一覧画面にも再利用できる。

3. **`DELETE /weak/:elementId` の扱い**
   - 選択: 本タスクでは実装しない。
   - 根拠: 今回の目的は `/game` の苦手件数反映と苦手モード開放であり、手動削除は `/weak` 画面の後続タスクに属する。

4. **フロントエンド状態の置き場所**
   - 選択: `/game/+page.svelte` の page local state に `weakCount`, `weakLoadStatus`, `weakLoadError` を持つ。グローバル store は作らない。
   - 根拠: 現時点で苦手件数を使う画面は `/game` のみ。将来 `/weak` 画面やヘッダー表示など複数画面で必要になった時点で store 化を検討する。

5. **初期表示時の復元**
   - 選択: `authStore.isInitializing` 完了後、ログイン済みかつ accessToken がある場合だけ `GET /weak` を実行する。
   - 根拠: 未ログイン時の不要な 401 を避け、認証状態の hydration / refresh 完了後に正しい token で取得するため。

6. **reload / 戻る操作時の挙動**
   - 選択: `/game` に入るたびに `GET /weak` から再取得する。戻る操作で SvelteKit が page state を再利用する場合も、認証 token ごとの request key で二重取得を抑止する。
   - 根拠: `POST /game/sessions` 後に `/game` へ戻ったとき、最新 DB 状態を反映する必要がある。

7. **API エラー時の UI**
   - 選択: 画面内に「苦手元素数を取得できませんでした」と再読み込みボタンを表示し、toast は補助にする。`weakCount = null` として苦手モードは開始不可にする。
   - 根拠: 苦手件数取得失敗は開始可否に影響するため、消える toast だけでは不十分。

8. **ローディング中の扱い**
   - 選択: 苦手件数 loading 中は `weakCount = null` として苦手モードを一時的に disabled にし、通常モードは開始可能にする。
   - 根拠: 通常モードは苦手件数に依存しない。苦手モードだけ誤開始を防ぐ。

9. **API パラメータの組み立て**
   - 選択: `frontend/src/lib/api/weak.ts` 内で `${API_BASE_URL}/weak` を組み立てる。
   - 根拠: page component に API URL や fetch options を埋め込まず、既存 `game.ts` / `elements.ts` と同じ責務分担にする。

10. **backend の並び順**
    - 選択: `updatedAt desc`, `addedAt desc` の順で返す。
    - 根拠: `game.service.ts` の苦手候補取得と揃え、最近間違えたものが先に来る自然な順序にする。

## 公開インターフェース案（必要な場合）

### Backend

```ts
export type WeakElementListItem = {
  elementId: number;
  symbol: string;
  nameJa: string;
  missCount: number;
  addedAt: Date;
};

export async function getWeakElements(userId: string): Promise<WeakElementListItem[]>;
```

### Frontend

```ts
export type WeakElement = {
  elementId: number;
  symbol: string;
  nameJa: string;
  missCount: number;
  addedAt: string;
};

export type GetWeakElementsOptions = {
  accessToken: string;
  signal?: AbortSignal;
};

export async function getWeakElements(options: GetWeakElementsOptions): Promise<WeakElement[]>;
```

## タスクリスト（進捗管理）

| タスクID | 内容 | ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存仕様・既存実装を確認する | `docs/05_progress.md`, `docs/04_api.md`, `docs/plans/game-screens/plan.md`, game / weak 関連 backend/frontend | 固定4件表示、`POST /game/sessions` の weak upsert、`GET /weak` TODO、進捗上の位置づけを確認済み | 高 |
| T2 | 進捗タスクを整理する | `docs/05_progress.md` | `GET /weak` 先行実装と `/game` 苦手件数反映のタスクが追跡可能になる | 中 |
| T3 | backend service テストを先に追加する | `backend/src/services/weak.service.test.ts` | userId 絞り込み、element include、空配列、並び順を検証する Red が確認できる | 高 |
| T4 | backend service を実装する | `backend/src/services/weak.service.ts` | Prisma ORM でログインユーザーの `WeakElement` 一覧を取得し、公開フィールドに整形する | 高 |
| T5 | backend route テストを先に追加する | `backend/src/routes/weak/weak.test.ts` | 認証必須、200 response、500 fallback を検証する Red が確認できる | 高 |
| T6 | backend route と mount を実装する | `backend/src/routes/weak/index.ts`, `backend/src/index.ts` | `GET /api/v1/weak` が認証付きで利用でき、日本語エラーを返す | 高 |
| T7 | frontend API client テストを先に追加する | `frontend/src/lib/api/weak.test.ts` | Authorization、AbortSignal、HTTP error、非 JSON error、response validation を検証する Red が確認できる | 高 |
| T8 | frontend API client と型を実装する | `frontend/src/lib/api/weak.ts` | `getWeakElements()` が `API_BASE_URL` / `parseErrorResponse()` を使い、runtime validation を行う | 高 |
| T9 | `/game` の状態設計を実装する | `frontend/src/routes/(app)/game/+page.svelte` | 固定 `PREVIEW_WEAK_ELEMENT_COUNT` を削除し、auth 完了後に `GET /weak` を取得する | 高 |
| T10 | `/game` の UI 状態を実装する | `frontend/src/routes/(app)/game/+page.svelte`, `frontend/src/lib/components/game/GameModeCard.svelte` | loading / error / retry / 空状態 / 5件境界が画面上で分かる。既存カードの責務を崩さない | 高 |
| T11 | reload / 戻る / 二重取得を整える | `frontend/src/routes/(app)/game/+page.svelte` | AbortController と request key で古い取得結果の上書き・二重取得を防ぐ | 中 |
| T12 | フロント既存テストを補強する | `frontend/src/lib/game/modes.test.ts` または必要な helper test | `weakCount null / 4 / 5` の開始可否が維持される | 中 |
| T13 | API 仕様ドキュメントを確認・更新する | `docs/04_api.md` | `GET /weak` の response / error が実装と一致する。`DELETE` 未実装の扱いが明記される | 中 |
| T14 | plan.md を実装実態に合わせて更新する | `docs/plans/game-weak-count-sync/plan.md` | チェックボックス、対象ファイル、変更点、実装完了セクションが実態と一致する | 中 |
| T15 | 品質チェックを実行する | backend / frontend | backend lint / format:check / test、frontend lint / format / test:run / check が通る | 高 |
| T16 | 手動確認を実施する | browser / Docker 環境 | 苦手0件、4件、5件以上、API失敗、未ログインの `/game` 表示を確認する | 高 |

- [ ] T1: 既存仕様・既存実装を確認する（`docs/05_progress.md`, `docs/04_api.md`, `docs/plans/game-screens/plan.md`, game / weak 関連 backend/frontend）
- [ ] T2: 進捗タスクを整理する（`docs/05_progress.md`）
- [ ] T3: backend service テストを先に追加する（`backend/src/services/weak.service.test.ts`）
- [ ] T4: backend service を実装する（`backend/src/services/weak.service.ts`）
- [ ] T5: backend route テストを先に追加する（`backend/src/routes/weak/weak.test.ts`）
- [ ] T6: backend route と mount を実装する（`backend/src/routes/weak/index.ts`, `backend/src/index.ts`）
- [ ] T7: frontend API client テストを先に追加する（`frontend/src/lib/api/weak.test.ts`）
- [ ] T8: frontend API client と型を実装する（`frontend/src/lib/api/weak.ts`）
- [ ] T9: `/game` の状態設計を実装する（`frontend/src/routes/(app)/game/+page.svelte`）
- [ ] T10: `/game` の UI 状態を実装する（`frontend/src/routes/(app)/game/+page.svelte`, `frontend/src/lib/components/game/GameModeCard.svelte`）
- [ ] T11: reload / 戻る / 二重取得を整える（`frontend/src/routes/(app)/game/+page.svelte`）
- [ ] T12: フロント既存テストを補強する（`frontend/src/lib/game/modes.test.ts` または必要な helper test）
- [ ] T13: API 仕様ドキュメントを確認・更新する（`docs/04_api.md`）
- [ ] T14: plan.md を実装実態に合わせて更新する（`docs/plans/game-weak-count-sync/plan.md`）
- [ ] T15: 品質チェックを実行する（backend / frontend）
- [ ] T16: 手動確認を実施する（browser / Docker 環境）

## 技術的注意点

- `PREVIEW_WEAK_ELEMENT_COUNT` は削除し、固定4件表示を残さない。
- `GameModeCard` は引き続き `weakCount` を受け取って開始可否を判定する。API 取得ロジックを card に入れない。
- `/game` は未ログイン時に `GET /weak` を呼ばない。ログイン導線は既存挙動を維持する。
- `authStore.isInitializing` 中は API 取得を待つ。
- `accessToken` が `null` の場合は取得しない。
- `AbortController` を使い、unmount / logout / token 変更時に古い request を中断する。
- API エラー時は `weakCount = null` とし、苦手モードは開始不可にする。
- 通常モードは weak API の loading / error に影響されず開始可能にする。
- `getWeakElements()` は `response.ok` を JSON parse より先に確認し、非 JSON エラー時は `parseErrorResponse()` に任せる。
- runtime validation で `elementId`, `symbol`, `nameJa`, `missCount`, `addedAt` の型を確認する。
- backend は Prisma ORM のみを使い、生 SQL は使わない。
- backend の想定外エラーは詳細を返さず `{ error: "サーバーエラーが発生しました" }` に統一する。
- `docs/04_api.md` に `DELETE /weak/:elementId` が残っている場合、本タスクでは未実装であることを進捗または計画に明記する。
- DB 変更は不要。`schema.prisma` / migrations を変更した場合は計画逸脱として理由を実装完了セクションに記録する。

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| backend service: 苦手0件 | `[]` を返す |
| backend service: 苦手複数件 | `elementId`, `symbol`, `nameJa`, `missCount`, `addedAt` を返す |
| backend service: userId 絞り込み | 他ユーザーの `WeakElement` を返さない |
| backend service: 並び順 | `updatedAt desc`, `addedAt desc` の順で取得する |
| backend route: 未ログイン | 401 の日本語エラー |
| backend route: ログイン済み | 200 で `{ weakElements: [...] }` |
| backend route: 空状態 | 200 で `{ weakElements: [] }` |
| backend route: service 例外 | 500 で `{ error: "サーバーエラーが発生しました" }` |
| frontend API: 正常系 | `/weak` に Authorization 付き GET を送り、配列を返す |
| frontend API: AbortSignal | fetch options に `signal` を渡す |
| frontend API: 401 | backend の日本語 error を `ApiError` に保持する |
| frontend API: 非 JSON 502 | fallback message `苦手リストの取得に失敗しました` を使う |
| frontend API: response 不正 | `ApiError(500, "苦手リストのレスポンス形式が不正です")` を throw する |
| `/game` 初期表示: 未ログイン | `GET /weak` を呼ばず、ログイン導線を表示する |
| `/game` 初期表示: ログイン済み loading | 苦手件数取得中の表示が出る。苦手モードは一時的に開始不可 |
| `/game` 正常系: 苦手0件 | `苦手元素: 0件`、苦手モード disabled |
| `/game` 正常系: 苦手4件 | `苦手元素: 4件`、現在4件の guard 文言、苦手モード disabled |
| `/game` 正常系: 苦手5件 | `苦手元素: 5件`、苦手モード開始ボタン enabled |
| `/game` 正常系: 苦手6件以上 | 件数表示が実件数になり、苦手モード開始可能 |
| `/game` API エラー | 画面内エラーと再試行ボタンを表示し、苦手モードは開始不可 |
| `/game` 再試行 | 再試行ボタンで `GET /weak` を再実行し、成功時に件数を反映する |
| `/game` 二重取得防止 | 同じ token / 同じ状態で重複 fetch しない |
| `/game` logout / token 変更 | 古い fetch 結果が新しい状態を上書きしない |
| `/game` reload | reload 後も `GET /weak` から実件数を復元する |
| `/game` 戻る操作 | `/game/result` などから戻った際に最新件数を取得または再取得できる |
| frontend/backend 整合性 | frontend が扱う 401 / 403 / 429 / 500 が backend の実レスポンスと一致する |
| A11Y | loading / error が `aria-live` または画面内テキストで認識できる。disabled button の理由が表示される |

## 実装リスクと回避策

| リスク | 影響 | 回避策 |
|---|---|---|
| `GET /weak` と `/weak` 一覧画面の将来仕様がズレる | 後続実装で API 変更が必要になる | `docs/04_api.md` の既存 response に合わせ、一覧画面でも使えるフィールドにする |
| API エラー時に苦手モードが誤って enabled になる | 5件未満でも開始ボタンが押せる | error / loading 時は `weakCount = null` として苦手モード disabled にする |
| 古い fetch 結果が logout 後に表示される | 他ユーザー状態の表示混入 | AbortController と request key で token / user 変更時に破棄する |
| `POST /game/sessions` の weak 更新と画面反映の責務が混ざる | API 契約が肥大化する | `POST /game/sessions` は変更せず、`GET /weak` を source of truth にする |
| `DELETE /weak` まで実装範囲が広がる | タスクが肥大化する | 本計画では `GET /weak` のみに限定し、削除は後続タスクに明記する |
| `docs/05_progress.md` のフェーズ順とズレる | レビュー時に進捗が分かりづらい | `GET /weak` 先行実装として分割・理由を記録する |

## 手動確認項目

| 手順 | 期待結果 |
|---|---|
| 未ログインで `/game` を開く | weak API は呼ばれず、ログイン導線が表示される |
| ログイン済み・苦手0件で `/game` を開く | `苦手元素: 0件`、苦手モード disabled |
| ログイン済み・苦手4件で `/game` を開く | `苦手元素: 4件`、現在4件の guard 文言 |
| ログイン済み・苦手5件で `/game` を開く | `苦手元素: 5件`、苦手モード開始可能 |
| 通常モードで間違えて `POST /game/sessions` を完了し、`/game` に戻る | 苦手件数が増えた状態で表示される |
| 苦手5件以上で苦手モードを開始する | `/game/play?mode=WEAK_SYMBOL_TO_NAME` または `WEAK_NAME_TO_SYMBOL` に遷移し、`GET /game/questions` が成功する |
| weak API を意図的に失敗させる | 画面内エラーと再試行ボタンが表示され、苦手モードは開始不可 |
| 画面 reload | `GET /weak` から件数が復元される |
| PC 幅 / モバイル幅 | 件数表示、エラー表示、カードのボタン文言がはみ出さない |
| ブラウザ console | 想定外のエラーが出ない |

## 実装完了時の更新ルール

実装完了時は以下を必ず行う。

- `docs/plans/game-weak-count-sync/plan.md` のチェックボックスを完了状態に更新する。
- `対象ファイル一覧` を実際の変更ファイルに合わせて修正する。
- `docs/05_progress.md` に追加・分割したタスクを完了状態へ更新する。
- `docs/04_api.md` の `GET /weak` 仕様が実装と一致していることを確認し、必要なら更新する。
- `DELETE /weak/:elementId` を実装しなかった場合は、後続タスクとして残っていることを明記する。
- `## 実装完了` セクションを追記する。

### 実装完了セクションのテンプレート

```markdown
## 実装完了

- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/game-weak-count-sync
- PR: #N

### 計画からの変更点

- 例: `GET /weak` response に `updatedAt` を追加しない方針にした。今回の `/game` では件数のみ必要であり、既存 `docs/04_api.md` の公開フィールドに合わせたため。
- 例: `DELETE /weak/:elementId` は計画通り対象外とし、フェーズ9の後続タスクに残した。

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/services/weak.service.ts` | 修正 | 苦手リスト取得 service を実装 |
| `backend/src/routes/weak/index.ts` | 修正 | `GET /weak` route を実装 |
| `backend/src/index.ts` | 修正 | weak router を mount |
| `frontend/src/lib/api/weak.ts` | 新規 | weak API client を追加 |
| `frontend/src/routes/(app)/game/+page.svelte` | 修正 | 苦手件数を実データから表示 |

### 品質チェック

| コマンド | 結果 |
|---|---|
| `cd backend && npm run lint` |  |
| `cd backend && npm run format:check` |  |
| `cd backend && npm run test -- --run` |  |
| `cd frontend && npm run lint` |  |
| `cd frontend && npm run format` |  |
| `cd frontend && npm run test:run` |  |
| `cd frontend && npm run check` |  |

### 手動確認

| 条件 | 結果 |
|---|---|
| 未ログイン `/game` |  |
| 苦手0件 `/game` |  |
| 苦手4件 `/game` |  |
| 苦手5件 `/game` |  |
| `POST /game/sessions` 後に `/game` へ戻る |  |
| weak API エラー時 |  |
| モバイル幅 |  |
```
