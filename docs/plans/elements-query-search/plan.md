# GET /elements（keyword・category・period 検索）実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、Hono API 連携・検索状態設計）
> 対象実装者: Sonnet

## 概要

`docs/05_progress.md` フェーズ5「GET /elements（keyword・category・period 検索）」を完了する。既存 `/elements` 画面の検索 UI と整合する形で、`GET /api/v1/elements` に `q/category/period` クエリ検索を実装し、任意認証時の `masteryStatus` 付与も維持する。

この計画は前回案をレビューし、以下を改善した版である。

- API パラメータ名を既存仕様どおり `q` に固定し、タスク名の `keyword` 表記と混同しない
- URL query を `/elements` 画面の唯一の source of truth とし、二重 fetch / 二重 filter を避ける
- server-side filtering 後の API 結果をさらに `filterElements()` しない
- 番号の部分一致検索は raw SQL ではなく、1-118 の候補 ID 生成 + Prisma `id in` で実装する
- 検索中にフォームを過度に disable せず、フォーカスと `aria-live` を維持する
- 400 / 401 / 500 と frontend error handling の責務を明確化する
- backend helper、route、frontend API client、手動 A11Y 確認までテスト観点を分離する

スコープ外:

| 項目 | 帰属 |
|---|---|
| `GET /elements/:id` 実装 | フェーズ5 別タスク |
| `POST /game/sessions` による `UserStats.masteredCount` 更新 | フェーズ7 |
| 習得状態での検索・フィルター | 別タスク |
| 総件数 `totalCount` を返す API 拡張 | 別タスク |
| DB インデックス追加・全文検索導入 | データ量増加時の別タスク |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- フェーズ5に `GET /elements（keyword・category・period 検索）` が未実装として残っている。
- 設計決定1: `GET /elements` はログイン時に `masteryStatus: "unlearned" | "learning" | "mastered"` を付与する。

**`docs/04_api.md`**
- `GET /elements` は任意認証。
- Query params: `category?: string`, `period?: number`, `q?: string`。
- `q` は番号・記号・日本語名・英語名検索。
- Error: 401 / 500 が記載済み。query validation 実装後は 400 も明記する。

**`docs/08_conventions.md`**
- ルートハンドラーの入口では Zod で入力検証する。
- バックエンドのエラーレスポンスは日本語。
- Prisma ORM 経由で DB アクセスし、生 SQL / `$queryRaw` は原則使わない。
- ESM の import パスには `.js` 拡張子を付ける。
- `API_BASE_URL` は `frontend/src/lib/api/config.ts` で一元管理する。
- `response.ok` は JSON parse 前に判定する。
- Prettier `tabWidth: 2`。

**`docs/07_testing_flow.md`**
- Red -> Green -> Refactor の TDD。
- テストは対象ファイルと同じディレクトリへ配置する。
- DB スキーマ変更時のみ migration / Playwright 確認が必須。

**`backend/src/routes/elements/index.ts`**
- `elementsRouter.get("/", optionalAuthMiddleware, async (c) => ...)`
- 現状は `prisma.element.findMany({ orderBy: { id: "asc" } })` のみ。
- ログイン時は `getElementMasteryStatusMap(user.id, elements.map((element) => element.id))` で `masteryStatus` を付与する。
- 500 は `{ error: "サーバーエラーが発生しました" }`。

**`backend/src/routes/elements/elements.test.ts`**
- 未ログイン一覧取得。
- ログイン時 `masteryStatus` 付与。
- 不正 token 401。
- 予期しないエラー 500。

**`backend/src/middleware/auth/index.ts`**
- `optionalAuthMiddleware`。
- Authorization ヘッダーなしは匿名で通過。
- 不正な Bearer token は 401。
- 有効ユーザーのみ `c.set("user", { id, role })`。

**`backend/src/services/element-mastery.service.ts`**
- `getElementMasteryStatusMap(userId, elementIds): Promise<Map<number, ElementMasteryStatus>>`
- 表示対象元素 ID のみに対して回答履歴を集計する。

**`backend/prisma/schema.prisma`**
- `Element`: `id`, `symbol`, `nameJa`, `nameEn`, `category`, `period`, `group`, `atomicWeight`, `etymology`。
- DB スキーマ変更は不要。

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL: string`。
- `VITE_API_BASE_URL` はここで一元管理済み。

**`frontend/src/lib/api/errors.ts`**
- `ApiError`
- `parseErrorBody(response): Promise<ErrorBody>`
- `parseErrorResponse(response, defaultMessage?): Promise<never>`
- `response.ok` 判定後に error body を読む既存方針。

**`frontend/src/lib/api/elements.ts`**
- `getElements(options?: GetElementsOptions): Promise<Element[]>`
- 現状 options は `accessToken?: string | null` のみ。
- Authorization はログイン時のみ付与。
- `isElementsResponse()` でレスポンス形式を実行時検証する。

**`frontend/src/lib/elements/search-filter.ts`**
- `ElementSearchFilters`: `{ q: string; category: string; period: number | null }`
- `ElementSearchFilterInput`
- `normalizeElementSearchFilters(input)`
- `readElementSearchFilters(searchParams)`
- `toElementSearchParams(filters)`
- `filterElements(elements, filters)`
- `hasActiveElementSearchFilters(filters)`
- category / period / trim の正規化は既に一箇所に集約済み。

**`frontend/src/lib/components/elements/ElementSearchFilters.svelte`**
- `filters`, `resultCount`, `totalCount`, `disabled`, `onApply`, `onReset`
- キーワード入力、分類 select、周期 select、検索、リセットを提供する。
- 件数表示は現状「全N件中 M件」前提。

**`frontend/src/routes/(app)/elements/+page.svelte`**
- URL query から `appliedFilters` を復元する。
- 現状は API で全件取得後、`filterElements(elements, appliedFilters)` でクライアント側絞り込み。
- 認証状態変化時に `getElements({ accessToken })` を再実行する。
- 詳細モーダル、検索 UI、習得状態バッジは既存動作維持が必要。

**`frontend/src/lib/stores/auth.svelte.ts`**
- `authStore.accessToken: string | null`
- `authStore.isLoggedIn: boolean`
- `authStore.isInitializing: boolean`

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.error(message)`
- `toastStore.fromApiError(error)`

### 重要な制約

- API query 名は既存 docs / frontend helper と合わせて `q`, `category`, `period` とする。
- 「keyword」はタスク名上の表現であり、実 API パラメータ名は `q` を維持する。
- `q` と `category` は trim 済み値を一度だけ計算して再利用する。
- `category` は trim 済み完全一致で DB 検索する。不明カテゴリは 400 にせず、結果 0 件を返す。
- `period` は 1-7 の整数のみ有効。不正値は 400。
- `q` の番号検索は既存 UI と同じく `String(id).includes(q)` 相当とする。
- Prisma ORM のみ使い、番号の部分一致のために raw SQL cast は使わない。
- ログイン時 `masteryStatus` は検索後の表示対象元素にだけ付与する。
- 不正 token 401、サーバーエラー 500 の既存挙動を維持する。
- `/elements` 画面の検索・リセット・URL query 復元・詳細モーダル・習得バッジを壊さない。
- `API_BASE_URL` を各ファイルで再定義しない。
- エラー文言は日本語に統一する。
- DB スキーマ変更は行わない。

## 対象ファイル一覧（変更種別つき）

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/lib/elements/search.ts` | 新規 | `GET /elements` query の Zod schema、正規化、Prisma where 組み立てを集約 |
| `backend/src/lib/elements/search.test.ts` | 新規 | query 正規化、period 検証、番号検索 ID 抽出、where 生成のユニットテスト |
| `backend/src/routes/elements/index.ts` | 修正 | `zValidator("query", ...)` と `where` 条件を追加 |
| `backend/src/routes/elements/elements.test.ts` | 修正 | q/category/period 検索、複合検索、400、masteryStatus 対象 ID のテストを追加 |
| `frontend/src/lib/api/elements.ts` | 修正 | `getElements({ filters, signal })` 対応、query string 付与 |
| `frontend/src/lib/api/elements.test.ts` | 修正 | filters 指定時の URL、trim、空条件省略、Authorization 併用、signal 伝搬テスト |
| `frontend/src/lib/components/elements/ElementSearchFilters.svelte` | 修正 | server-side filtering 時の件数表示と検索中状態の A11Y を調整 |
| `frontend/src/routes/(app)/elements/+page.svelte` | 修正 | URL query / 認証状態に応じて `GET /elements?q=...` を呼ぶ |
| `docs/04_api.md` | 修正 | query validation、400、番号部分一致、trim 方針を明記 |
| `docs/05_progress.md` | 修正 | 該当タスクの計画書リンクと完了状態を更新 |
| `docs/plans/elements-query-search/plan.md` | 新規 | 本計画書。実装完了時に実態へ更新 |

## API仕様（この機能で使う範囲のみ）

### エラーレスポンス共通形式

```json
{ "error": "メッセージ文字列" }
```

バリデーションエラー時:

```json
{
  "error": "バリデーションエラー",
  "details": [
    {
      "message": "周期は1から7の整数で指定してください"
    }
  ]
}
```

### GET `/api/v1/elements`

| 項目 | 内容 |
|---|---|
| 認証 | 任意。ログイン時のみ `Authorization: Bearer <accessToken>` |
| 200 | `{ "elements": Element[] }` |
| 400 | query validation error |
| 401 | Authorization ヘッダー形式不正・token 無効 |
| 500 | サーバーエラー |

### Query params

| クエリ | 型 | 正規化 | 検索内容 |
|---|---|---|---|
| `q` | string | `trim()`。空文字は未指定扱い | `id` 部分一致、`symbol` 部分一致、`nameJa` 部分一致、`nameEn` 部分一致 |
| `category` | string | `trim()`。空文字は未指定扱い | `category` 完全一致 |
| `period` | number | 空文字は未指定扱い | 1-7 の整数完全一致 |

未知の query key は無視する。既知 query の値だけを Zod で検証し、DB へ渡す値を限定する。

### 検索条件の組み合わせ

- `q`, `category`, `period` は AND 条件で組み合わせる。
- `q` 内部の `id/symbol/nameJa/nameEn` は OR 条件。
- 常に `id` 昇順で返す。
- ログイン時は検索後の `elements` にだけ `masteryStatus` を付与する。
- 検索結果が 0 件でも 200 `{ "elements": [] }` を返す。

### レスポンス要素

```ts
type Element = {
  id: number;
  symbol: string;
  nameJa: string;
  nameEn: string;
  category: string;
  period: number;
  group: number | null;
  atomicWeight: number | null;
  etymology: string | null;
  masteryStatus?: 'unlearned' | 'learning' | 'mastered';
};
```

## 設計上の決定事項（判断理由つき）

1. **API パラメータ名は `q` を維持する**
   - 選択: `keyword` ではなく `q`
   - 根拠: `docs/04_api.md` と既存 `frontend/src/lib/elements/search-filter.ts` が `q` で統一済み。

2. **query schema と Prisma where 生成は helper へ分離する**
   - 選択: `backend/src/lib/elements/search.ts`
   - 根拠: route を薄く保ち、正規化・検証・検索条件生成の重複を防ぐ。

3. **`category` は既知カテゴリ enum で弾かない**
   - 選択: 任意文字列として validation し、DB 完全一致で 0 件を返す
   - 根拠: API docs は `string` 仕様。backend に frontend の分類 style map を重複定義しない。

4. **`period` は 1-7 の整数だけ許可する**
   - 選択: `period=0`, `period=8`, `period=2.5`, `period=abc` は 400
   - 根拠: 元素周期として有効な範囲が固定で、型不整合を DB に渡さないため。

5. **番号検索は raw SQL を使わず ID 候補を事前生成する**
   - 選択: `1..118` の範囲から `String(id).includes(q)` に一致する ID 配列を作り、`id: { in: [...] }` にする
   - 根拠: 既存 UI の部分一致仕様を保ちつつ、`$queryRaw` を避ける。

6. **文字列検索は Prisma の `contains` を使う**
   - 選択: `symbol` / `nameEn` は大文字小文字を区別しない検索、`nameJa` は部分一致検索
   - 根拠: 既存 frontend の `symbol/nameEn` 小文字化検索と、日本語名の `includes` 検索に合わせる。

7. **検索後に `masteryStatus` を付与する**
   - 選択: `findMany(where)` の結果 ID だけを `getElementMasteryStatusMap()` に渡す
   - 根拠: 表示されない元素の集計を避け、既存の習得状態仕様を維持する。

8. **frontend API client も filters を受け取れるようにする**
   - 選択: `getElements({ accessToken, filters, signal })`
   - 根拠: `/elements` 画面と API のインターフェースを接続し、URL query と fetch URL を一致させる。

9. **URL query を `/elements` の source of truth にする**
   - 選択: `applyFilters()` は URL を更新し、`page.url.searchParams` から正規化済み条件を復元して fetch する
   - 根拠: 画面 state と URL のズレ、二重 fetch、戻る操作の不整合を避ける。

10. **server-side filtering 後に client-side filtering しない**
    - 選択: 表示対象は API から返った `elements` をそのまま使う
    - 根拠: API と UI の結果が二重条件でズレるリスクを避ける。既存 `filterElements()` は helper テスト資産として残す。

11. **検索中はフォームのフォーカスを壊さない**
    - 選択: 初期ロードでは検索フォーム非表示または disabled、検索更新中はフォームを操作可能に保ち、結果領域を `aria-busy` にする
    - 根拠: select / input の操作中に disabled へ切り替わるとフォーカスが失われやすく、A11Y と操作性が下がる。

12. **request race は AbortController で避ける**
    - 選択: `getElements` に `signal` を渡せるようにし、ページ側で前回 request を abort する
    - 根拠: 入力・select 変更・認証状態変化が近接したときに古い結果で上書きしない。

13. **件数表示は API response の範囲に合わせる**
    - 選択: `totalCount` を必須にせず、未指定時は「N件を表示しています」と表示する
    - 根拠: API response に総件数がないため、不正確な「全N件中」を表示しない。

14. **DB インデックス追加は行わない**
    - 選択: `schema.prisma` と migration は変更しない
    - 根拠: 元素マスターは 118 件固定規模で、`contains` 検索でも負荷は軽い。DB 構造変更のリスクを避ける。

## 公開インターフェース案（必要な場合）

### `backend/src/lib/elements/search.ts`

```ts
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

export type ElementSearchQuery = {
  q?: string;
  category?: string;
  period?: number;
};

export const ELEMENT_ID_SEARCH_MIN = 1;
export const ELEMENT_ID_SEARCH_MAX = 118;
export const ELEMENT_PERIOD_OPTIONS: readonly number[];

export const elementSearchQuerySchema: z.ZodType<ElementSearchQuery>;

export function getElementIdsMatchingKeyword(keyword: string): number[];

export function buildElementWhereInput(
  query: ElementSearchQuery
): Prisma.ElementWhereInput | undefined;
```

### `frontend/src/lib/api/elements.ts`

```ts
import type { ElementSearchFilterInput } from '$lib/elements/search-filter';

export type GetElementsOptions = {
  accessToken?: string | null;
  filters?: ElementSearchFilterInput;
  signal?: AbortSignal;
};

export async function getElements(options?: GetElementsOptions): Promise<Element[]>;
```

### `frontend/src/lib/components/elements/ElementSearchFilters.svelte`

```ts
type Props = {
  filters: ElementSearchFilters;
  resultCount: number;
  totalCount?: number;
  isSearching?: boolean;
  disabled?: boolean;
  onApply: ElementSearchFilterApplyHandler;
  onReset(): void;
};
```

## タスクリスト（進捗管理）

| タスクID | 内容（何を） | ファイル（どこで） | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 進捗を実装中に更新する | `docs/05_progress.md` | `GET /elements（keyword・category・period 検索）` が `[-]` になる | 中 |
| T2 | backend 検索 helper の Red テストを作成する | `backend/src/lib/elements/search.test.ts` | 正規化、period validation、番号 ID 候補、where 生成のテストが失敗する | 高 |
| T3 | backend 検索 helper を実装する | `backend/src/lib/elements/search.ts` | T2 が Green。trim / period / where 生成が一箇所に集約される | 高 |
| T4 | `GET /elements` route の Red テストを追加する | `backend/src/routes/elements/elements.test.ts` | q/category/period/複合条件/400/masteryStatus 対象 ID のテストが失敗する | 高 |
| T5 | `GET /elements` に query validation と Prisma where を接続する | `backend/src/routes/elements/index.ts` | T4 が Green。既存の未ログイン・ログイン・401・500 テストも通る | 高 |
| T6 | frontend API client の Red テストを追加する | `frontend/src/lib/api/elements.test.ts` | filters 指定時 URL、空条件省略、Authorization 併用、signal 伝搬のテストが失敗する | 高 |
| T7 | `getElements` を filters / signal 対応にする | `frontend/src/lib/api/elements.ts` | T6 が Green。`API_BASE_URL` と `parseErrorResponse` 既存方針を維持する | 高 |
| T8 | 検索 UI の件数表示と検索中状態を調整する | `frontend/src/lib/components/elements/ElementSearchFilters.svelte` | `totalCount` なしでも自然な日本語表示になり、検索中の結果更新が `aria-live` で伝わる | 中 |
| T9 | `/elements` 画面を query 付き API 呼び出しへ接続する | `frontend/src/routes/(app)/elements/+page.svelte` | URL query / 認証状態変化で API 再取得し、モーダル・バッジ・リセットが維持される | 高 |
| T10 | API 仕様と進捗を更新する | `docs/04_api.md`, `docs/05_progress.md` | validation、400、検索仕様が docs と一致し、進捗が `[x]` になる | 中 |
| T11 | 計画書を実装実態に合わせて更新する | `docs/plans/elements-query-search/plan.md` | チェックボックス、実際の変更ファイル、計画からの変更点が記録される | 中 |
| T12 | backend 品質チェックを実行する | `backend/` | `npm run lint` / `npm run format:check` / `npm run test -- --run` が通る | 高 |
| T13 | frontend 品質チェックを実行する | `frontend/` | `npm run lint` / `npm run format` / `npm run check` / `npm run test:run` が通る | 高 |
| T14 | 手動確認を行う | ブラウザ / API | `/elements?q=H`, category, period, 複合検索、ログイン時 badge、リセット、エラー導線、キーボード操作を確認する | 高 |

- [x] T1: 進捗を実装中に更新する（`docs/05_progress.md`）
- [x] T2: backend 検索 helper の Red テストを作成する（`backend/src/lib/elements/search.test.ts`）
- [x] T3: backend 検索 helper を実装する（`backend/src/lib/elements/search.ts`）
- [x] T4: `GET /elements` route の Red テストを追加する（`backend/src/routes/elements/elements.test.ts`）
- [x] T5: `GET /elements` に query validation と Prisma where を接続する（`backend/src/routes/elements/index.ts`）
- [x] T6: frontend API client の Red テストを追加する（`frontend/src/lib/api/elements.test.ts`）
- [x] T7: `getElements` を filters / signal 対応にする（`frontend/src/lib/api/elements.ts`）
- [x] T8: 検索 UI の件数表示と検索中状態を調整する（`frontend/src/lib/components/elements/ElementSearchFilters.svelte`）
- [x] T9: `/elements` 画面を query 付き API 呼び出しへ接続する（`frontend/src/routes/(app)/elements/+page.svelte`）
- [x] T10: API 仕様と進捗を更新する（`docs/04_api.md`, `docs/05_progress.md`）
- [x] T11: 計画書を実装実態に合わせて更新する（`docs/plans/elements-query-search/plan.md`）
- [x] T12: backend 品質チェックを実行する（`backend/`）
- [x] T13: frontend 品質チェックを実行する（`frontend/`）
- [x] T14: 手動確認を行う（ブラウザ / API）

## 技術的注意点

- `zValidator("query", elementSearchQuerySchema, ...)` を使い、route handler に入る前に query を検証する。
- validation error は既存 auth/users route と同じく `{ error: "バリデーションエラー", details: result.error.issues }` を返す。
- `q` / `category` の trim は schema または helper の一箇所で行い、route handler 内で再計算しない。
- `period` は空文字なら未指定、値がある場合は整数かつ 1-7 の場合のみ有効にする。
- `period=abc`, `period=2.5`, `period=0`, `period=8` は 400 にする。
- `q` の番号検索は `1..118` の固定範囲から ID 候補を作る。raw SQL の `CAST(id AS TEXT)` は使わない。
- Prisma `where` は条件がある場合のみ付与する。条件なしでは既存と同じ `findMany({ orderBy: { id: "asc" } })` を維持する。
- `category` と `period` は `AND` 条件、`q` 内部は `OR` 条件にする。
- `symbol` / `nameEn` の `contains` は大文字小文字を区別しない検索にする。
- `nameJa` は日本語文字列の部分一致で検索する。
- 検索結果が 0 件でも 200 `{ elements: [] }` を返す。
- ログイン時 `masteryStatus` は検索結果 ID のみに対して取得する。
- `optionalAuthMiddleware` の 401 は route handler より前に返るため、query 実装で上書きしない。
- frontend の `getElements` は `response.ok` を JSON parse 前に必ず判定する。
- frontend で `filters` を URL 化するときは既存 `normalizeElementSearchFilters()` と `toElementSearchParams()` を使う。
- `/elements/+page.svelte` の request key は `auth state + accessToken + query string` で作り、同じ条件では再 fetch しない。
- `applyFilters()` は URL 更新を担当し、API fetch は URL 変更を監視する `$effect` 側へ寄せる。
- AbortError はユーザー表示用エラーにしない。
- 初期ロードと検索更新を分け、初期ロードは既存の読み込み表示、検索更新は既存結果を残しつつ `aria-busy` と件数文言で伝える。
- DB スキーマ変更なしのため migration / Prisma migrate deploy は不要。
- ただし API と画面導線に影響するため、ブラウザで `/elements` の主要導線を最低 1 本確認する。

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| query なし | `findMany({ orderBy: { id: "asc" } })` で全件取得する |
| `q=H` | `symbol/nameJa/nameEn/id` の OR 条件で検索する |
| `q=hydrogen` | 英語名を大文字小文字を区別せず検索できる |
| `q=水素` | 日本語名の部分一致で検索できる |
| `q=1` | `String(id).includes("1")` に一致する ID も検索対象になる |
| `category=非金属` | `category` 完全一致で検索する |
| `period=2` | `period: 2` で検索する |
| `q=炭&category=非金属&period=2` | すべての条件に一致する元素だけ返す |
| `q=+H+` | trim され、`H` と同じ検索になる |
| `category=+非金属+` | trim され、`非金属` と同じ検索になる |
| `period=` | 未指定扱いで 400 にならない |
| `period=0` | 400 `{ error: "バリデーションエラー" }` |
| `period=8` | 400 `{ error: "バリデーションエラー" }` |
| `period=2.5` | 400 `{ error: "バリデーションエラー" }` |
| `period=abc` | 400 `{ error: "バリデーションエラー" }` |
| 未知 query key | 無視され、既知 query の検索結果だけ返る |
| 不明 category | 200 `{ elements: [] }` |
| 検索結果 0 件 | 200 `{ elements: [] }` |
| ログイン時の検索 | 検索後の元素だけに `masteryStatus` が付与される |
| 不正 token | 401 `{ error: "トークンが無効です" }` |
| DB エラー | 500 `{ error: "サーバーエラーが発生しました" }` |
| frontend `getElements({ filters })` | URL に `?q=...&category=...&period=...` が付く |
| frontend 空 filters | query string が付かない |
| frontend accessToken + filters | Authorization と query が同時に反映される |
| frontend signal 指定 | fetch に AbortSignal が渡る |
| frontend HTTP 400 | `ApiError(400, ...)` として backend の日本語 error を保持する |
| frontend 非 JSON 502 | default message `元素一覧の取得に失敗しました` を使う |
| `/elements?q=H` 初期表示 | URL query から条件を復元し、API も query 付きで呼ぶ |
| `/elements` リセット | query が消え、API は query なしで呼ばれる |
| 検索後モーダル | 結果カードから詳細モーダルを開ける |
| ログイン後検索 | 検索結果カードに習得状態バッジが表示される |
| request 連打 | 古い request 結果で画面が上書きされない |

## A11Y 確認項目

| ケース | 期待結果 |
|---|---|
| キーワード入力で Enter | 検索が実行され、フォーカスが不自然に失われない |
| select 変更 | 結果が更新され、select 操作後のフォーカスが維持される |
| 検索結果件数 | `aria-live="polite"` で件数変更が伝わる |
| 検索中状態 | 結果領域に `aria-busy` が付き、画面上も検索中が分かる |
| 検索結果 0 件 | 条件不一致であることがテキストで伝わり、リセットボタンへ到達できる |
| キーボード操作 | Tab で検索フォーム、リセット、カード、モーダルへ自然に移動できる |
| モーダル連携 | 検索条件変更時に開いていたモーダルが閉じ、フォーカスが破綻しない |
| ボタン / select / input | 名前、ラベル、状態がスクリーンリーダーで判別できる |

## DB整合性・負荷

| 観点 | 判断 |
|---|---|
| スキーマ変更 | 不要。`Element` 既存フィールドのみで検索できる |
| migration | 不要 |
| index 追加 | 不要。元素マスターは 118 件固定規模で、文字列 `contains` の負荷は軽い |
| raw SQL | 使用しない |
| 検索順序 | `id` 昇順を維持 |
| `masteryStatus` 集計 | 検索結果の ID のみに限定し、不要な回答履歴集計を避ける |
| `q` 番号検索 | `1..118` の候補 ID を helper で生成し、DB には `id in [...]` として渡す |
| 将来の拡張 | 元素以外の大量データに広げる場合は trigram index / full text search を別途検討する |

## 実装リスクと回避策

| リスク | 内容 | 回避策 |
|---|---|---|
| 番号部分一致を raw SQL で実装してしまう | セキュリティ制約と Prisma ORM 方針に反する | `1..118` の ID 候補生成 + `id in` で実装する |
| query 正規化が frontend/backend でズレる | trim や period の扱いが変わる | backend helper と frontend helper それぞれをテストで固定し、docs に仕様を書く |
| `masteryStatus` が全元素分集計される | 検索時に不要な回答履歴を読む | 検索後の `elements.map(id)` だけ渡す |
| `/elements` 画面で古い request が勝つ | filter 変更が速いと前の結果で上書きされる | `AbortController` または request key で stale response を破棄する |
| 件数表示が不正確になる | API response に総件数がない | `totalCount` を任意化し、総件数なし文言に切り替える |
| 既存 client-side filter と二重 filtering になる | API 結果をさらに `filterElements` して不整合が起きる | 表示対象は API 結果をそのまま使い、helper は URL 正規化用途中心にする |
| 401 / 400 の優先順位が曖昧になる | 不正 token と不正 query が同時に来る | middleware 順序を維持し、任意認証の 401 を先に返す |
| 不明 category の扱いで UI と API がズレる | frontend は未知 category を未指定化、backend は 0 件 | 通常 UI では未知 category を送らない。直接 API は string 完全一致として docs に明記する |
| validation error が英語になる | Zod の default message が出る | schema に日本語 message を指定する |
| frontend API client の import 循環 | `api/elements.ts` が page/store を参照する | `api/elements.ts` は `$lib/elements/search-filter` の純 helper のみ import する |
| 検索中 disable でフォーカスが失われる | 入力・select 操作後に使いにくくなる | 初期ロードと検索更新を分け、検索更新ではフォームを基本 disable しない |

## 実装完了時の更新テンプレート

```markdown
## 実装完了
- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/elements-query-search
- PR: #N

### 計画からの変更点
- なし

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/lib/elements/search.ts` | 新規 | GET /elements query helper |
| `backend/src/lib/elements/search.test.ts` | 新規 | query helper テスト |
| `backend/src/routes/elements/index.ts` | 修正 | query validation と Prisma where を追加 |
| `backend/src/routes/elements/elements.test.ts` | 修正 | 検索 route テストを追加 |
| `frontend/src/lib/api/elements.ts` | 修正 | filters / signal 対応 |
| `frontend/src/lib/api/elements.test.ts` | 修正 | query 付き API client テスト |
| `frontend/src/lib/components/elements/ElementSearchFilters.svelte` | 修正 | 件数表示と検索中状態を調整 |
| `frontend/src/routes/(app)/elements/+page.svelte` | 修正 | server-side filtering に接続 |
| `docs/04_api.md` | 修正 | 検索 query 仕様を更新 |
| `docs/05_progress.md` | 修正 | フェーズ5タスクを完了に更新 |

### 実行した確認
- `cd backend && npm run lint`
- `cd backend && npm run format:check`
- `cd backend && npm run test -- --run`
- `cd frontend && npm run lint`
- `cd frontend && npm run format`
- `cd frontend && npm run check`
- `cd frontend && npm run test:run`

### 手動確認
- `/elements` 初期表示
- `/elements?q=H`
- `/elements?category=非金属`
- `/elements?period=2`
- `/elements?q=炭&category=非金属&period=2`
- 条件リセット
- 検索結果 0 件
- ログイン時の習得状態バッジ
- 検索後の詳細モーダル
- キーボード操作と `aria-live` の確認
```

## 実装完了
- 完了日: 2026-06-06
- 実装ブランチ: feature/phase5-elements-query-search
- PR: 未作成

### 計画からの変更点
- 手動 A11Y 確認でキーワード入力欄の Enter 検索が反映されないことを確認したため、`ElementSearchFilters.svelte` に Enter キー用 handler を追加した。
- `applyCurrentFilters()` を追加し、検索ボタンと Enter キーで同じ正規化済み条件を使うようにした。
- DB スキーマ変更は不要だったため、migration / Prisma migrate deploy は実施していない。

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/lib/elements/search.ts` | 新規 | GET /elements query schema、period 検証、番号検索 ID 候補生成、Prisma where 生成 |
| `backend/src/lib/elements/search.test.ts` | 新規 | query helper の Red/Green テスト |
| `backend/src/routes/elements/index.ts` | 修正 | `zValidator("query", ...)` と Prisma where を GET /elements に接続 |
| `backend/src/routes/elements/elements.test.ts` | 修正 | q/category/period 検索、400、検索結果 ID の `masteryStatus` 集計テストを追加 |
| `frontend/src/lib/api/elements.ts` | 修正 | `filters` / `signal` 対応と query string 生成 |
| `frontend/src/lib/api/elements.test.ts` | 修正 | filters、Authorization 併用、AbortSignal のテストを追加 |
| `frontend/src/lib/components/elements/ElementSearchFilters.svelte` | 修正 | 件数表示、検索中状態、Enter キー検索を追加 |
| `frontend/src/routes/(app)/elements/+page.svelte` | 修正 | URL query 基準の server-side filtering、request abort、`aria-busy` を追加 |
| `docs/04_api.md` | 修正 | GET /elements の検索仕様と 400 を明記 |
| `docs/05_progress.md` | 修正 | フェーズ5タスクを完了に更新 |
| `docs/plans/elements-query-search/plan.md` | 修正 | タスク完了チェックと実装完了記録を更新 |

### 実行した確認
- `cd backend && npm run test -- src/lib/elements/search.test.ts --run`（Red: `./search.js` 未作成）
- `cd backend && npm run test -- src/lib/elements/search.test.ts --run`（Green: 11 tests passed）
- `cd backend && npm run test -- src/routes/elements/elements.test.ts --run`（Red: query 未接続で 4 tests failed）
- `cd backend && npm run test -- src/routes/elements/elements.test.ts --run`（Green: 9 tests passed）
- `cd backend && npm run test -- src/lib/elements/search.test.ts src/routes/elements/elements.test.ts --run`（20 tests passed）
- `cd frontend && npm run test:run -- src/lib/api/elements.test.ts`（Red: 3 tests failed）
- `cd frontend && npm run test:run -- src/lib/api/elements.test.ts`（Green: 17 tests passed）
- `cd frontend && npm run test:run -- src/lib/api/elements.test.ts src/lib/elements/search-filter.test.ts`（39 tests passed）
- `cd backend && npm run format`
- `cd frontend && npm run format`
- `cd backend && npm run lint`
- `cd backend && npm run format:check`
- `cd frontend && npm run lint`
- `cd frontend && npm run check`
- `cd backend && npm run test -- --run`（17 files / 139 tests passed）
- `cd frontend && npm run test:run`（11 files / 134 tests passed）
- Enter キー対応後の再確認: `cd frontend && npm run format`, `npm run lint`, `npm run check`, `npm run test:run`（11 files / 134 tests passed）

### 手動確認
- `/elements` 初期表示で 118 件表示されることを確認
- キーワード `炭` の検索ボタン操作で `/elements?q=炭` になり 1 件表示されることを確認
- キーワード `酸` の Enter 操作で `/elements?q=酸` になり 1 件表示されることを確認
- 分類 `希ガス` で 7 件表示され、`category` query が付くことを確認
- 分類 `希ガス` + 周期 `1` で 1 件表示され、`period` query が付くことを確認
- キーワード `He` + 分類 `希ガス` + 周期 `1` の複合条件で 1 件表示されることを確認
- リセットで `/elements` に戻り 118 件表示されることを確認
- 検索後の元素カードから詳細モーダルが開くことを確認
- ブラウザの error log が空であることを確認
