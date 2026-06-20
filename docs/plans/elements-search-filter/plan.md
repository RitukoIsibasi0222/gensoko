# 検索・フィルターUI（キーワード・分類・周期）実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、検索状態設計・API 連携・A11Y レビュー）
> 対象実装者: Codex

## 概要

`/elements` にキーワード検索、分類フィルター、周期フィルター、検索条件リセット、検索中・空状態・エラー状態を実装または再確認する。検索条件は URL クエリを source of truth とし、frontend の状態管理、API client、backend query validation の責務を分ける。

この計画は既存の `docs/plans/elements-search-filter/plan.md` と `docs/plans/elements-query-search/plan.md` をレビューし、現行コードに合わせて改善した版である。旧計画の「frontend 側で全件取得後に絞り込む」前提は、現行の server-side filtering 実装と矛盾するため採用しない。

### レビュー結果と改善方針

| 観点 | レビュー結果 | 改善方針 |
|---|---|---|
| 既存コード整合性 | 現行コードは `getElements({ filters, accessToken, signal })` と backend `zValidator("query")` に対応済み。旧計画は client-side filtering 前提が残っている | URL query と API query を一本化し、server-side filtering 後に `filterElements()` を二重適用しない |
| 仕様整合性 | `docs/04_api.md` は query 名を `q/category/period` と定義している。タスク名の `keyword` と混同しやすい | API パラメータ名は `q` に固定し、計画内でも `keyword` は UI 表現としてのみ扱う |
| A11Y | 検索中にフォームを全面 disabled にするとフォーカスが失われやすい。件数更新は読み上げ配慮が必要 | `aria-busy`, `aria-live="polite"`, label/select/input の対応、検索中も過度に操作不能にしない設計を明記する |
| DB 整合性・負荷 | 元素は 118 件で小さいが、将来件数増加に備えて raw SQL や総件数追加 query は避けたい | Prisma ORM のみ使用し、番号検索は 1..118 の ID 候補生成で対応。総件数 query は追加しない |
| テスト | UI helper と API client の責務が分かれているため、テストも分けるべき | backend helper / route、frontend helper / API client、手動 A11Y 確認を分離する |
| 進捗整合性 | `docs/05_progress.md` では検索・フィルターUI と GET /elements 検索が `[x]` | 実装前に現状確認し、再実装・改善タスクの場合は progress に別行を追加する |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- フェーズ4: `検索・フィルターUI（キーワード・分類・周期）` は現状 `[x]`
- フェーズ5: `GET /elements（keyword・category・period 検索）` は現状 `[x]`
- 再実装や改善として扱う場合は、既存完了行を戻さず、必要に応じて差分タスクを追記する

**`docs/04_api.md`**
- `GET /elements` は任意認証
- Query params:
  - `q?: string` - 番号・記号・日本語名・英語名のキーワード検索
  - `category?: string` - 分類フィルター
  - `period?: number` - 1〜7 の周期フィルター
- `q/category/period` は AND 条件
- `q` 内部は `id/symbol/nameJa/nameEn` の OR 条件
- `period` が 1〜7 の整数でない場合は 400
- ログイン時のみ `masteryStatus?: "unlearned" | "learning" | "mastered"` を付与する

**`backend/src/routes/elements/index.ts`**
- `elementsRouter.get("/")`
- `zValidator("query", elementSearchQuerySchema, ...)`
- `optionalAuthMiddleware`
- `buildElementWhereInput(query)`
- `prisma.element.findMany({ where, orderBy: { id: "asc" } })`
- 認証時は `getElementMasteryStatusMap(user.id, elements.map((element) => element.id))`
- 400: `{ error: "バリデーションエラー", details: result.error.issues }`
- 500: `{ error: "サーバーエラーが発生しました" }`

**`backend/src/lib/elements/search.ts`**
- `ElementSearchQuery`
- `elementSearchQuerySchema`
- `ELEMENT_ID_SEARCH_MIN = 1`
- `ELEMENT_ID_SEARCH_MAX = 118`
- `ELEMENT_PERIOD_OPTIONS = [1, 2, 3, 4, 5, 6, 7]`
- `getElementIdsMatchingKeyword(keyword)`
- `buildElementWhereInput(query)`

**`backend/src/lib/elements/search.test.ts`**
- `q/category` の trim
- 空文字の未指定化
- `period` の 1〜7 検証
- 番号部分一致用 ID 候補生成
- Prisma `where` 生成

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL: string`
- `VITE_API_BASE_URL` の読み込みと開発環境警告を一元管理する

**`frontend/src/lib/api/errors.ts`**
- `ErrorBody`
- `parseErrorBody(response): Promise<ErrorBody>`
- `parseErrorResponse(response, defaultMessage?): Promise<never>`
- `ApiError`
- 非 JSON エラー時は `null` body と default message を使う

**`frontend/src/lib/api/elements.ts`**
- `GetElementsOptions`
  - `accessToken?: string | null`
  - `filters?: ElementSearchFilterInput`
  - `signal?: AbortSignal`
- `getElements(options?: GetElementsOptions): Promise<Element[]>`
- `filters` は `normalizeElementSearchFilters()` と `toElementSearchParams()` 経由で query string 化する
- `accessToken` がある場合のみ `Authorization: Bearer <token>` を送る
- レスポンス形式不正時は `ApiError(500, "元素一覧のレスポンス形式が不正です", data)`

**`frontend/src/lib/elements/types.ts`**
- `ElementMasteryStatus`
- `Element`
  - `id, symbol, nameJa, nameEn, category, period, group, atomicWeight, etymology, masteryStatus?`

**`frontend/src/lib/elements/category-style.ts`**
- `ELEMENT_CATEGORY_STYLE_MAP`
- `getElementCategoryStyle(category)`
- 分類 options はこの map を起点にする

**`frontend/src/lib/elements/search-filter.ts`**
- `ElementSearchFilters`
- `ElementSearchFilterInput`
- `ElementSearchFilterApplyHandler`
- `DEFAULT_ELEMENT_SEARCH_FILTERS`
- `ELEMENT_PERIOD_OPTIONS`
- `getElementCategoryOptions()`
- `normalizeElementSearchFilters(input)`
- `readElementSearchFilters(searchParams)`
- `toElementSearchParams(filters)`
- `hasActiveElementSearchFilters(filters)`
- `filterElements(elements, filters)` は helper として存在するが、server-side filtering 後の表示には二重適用しない

**`frontend/src/lib/components/elements/ElementSearchFilters.svelte`**
- `filters: ElementSearchFilters`
- `resultCount: number`
- `totalCount?: number`
- `isSearching?: boolean`
- `disabled?: boolean`
- `onApply: ElementSearchFilterApplyHandler`
- `onReset(): void`
- キーワード入力、分類 select、周期 select、検索ボタン、リセットボタン、件数表示を担当する

**`frontend/src/routes/(app)/elements/+page.svelte`**
- `page.url.searchParams` から検索条件を復元する
- `authStore.isInitializing` を待ってから API を呼ぶ
- `getElements({ accessToken, filters, signal })` を使う
- `AbortController` と request sequence で古いレスポンスの上書きを防ぐ
- `isInitialLoading`, `isSearching`, `errorMessage`, `elements`, `selectedElement` を持つ
- `ElementSearchFilters`, `ElementDetailModal`, `ElementMasteryBadge` を利用する

**`frontend/src/lib/stores/auth.svelte.ts`**
- `authStore.accessToken`
- `authStore.isLoggedIn`
- `authStore.isInitializing`

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.error(message)`
- `toastStore.fromApiError(error)`

### 重要な制約

- API query 名は `q`, `category`, `period` に統一する
- `API_BASE_URL` を page / component で再定義しない
- API error parsing は `$lib/api/errors.ts` を使う
- `response.ok` は JSON parse より先に判定する
- バックエンドの具体的な日本語エラーメッセージを frontend 固定文言で上書きしない
- 入力値の trim は正規化 helper で一度だけ行い、URL query・API パラメータ・表示に同じ正規化済み値を使う
- キーワード、分類、周期の状態管理を page と component に重複実装しない
- 分類 options は `ELEMENT_CATEGORY_STYLE_MAP` から導出し、分類名配列を別管理しない
- 周期 options は 1〜7 のみ
- URL query を source of truth とし、再読み込み・共有 URL・戻る操作で状態を復元できるようにする
- UI コンポーネントに API URL 組み立てやレスポンス変換を埋め込まない
- 検索結果 0 件と API 取得結果 0 件は文言を分ける
- `filterElements()` を残す場合でも、server-side filtering 後の表示には二重適用しない
- Svelte 5 Runes（`$state`, `$derived`, `$effect`, `$props`）を使う
- Prettier `tabWidth: 2` に従う
- DB スキーマ変更は行わない

## 対象ファイル一覧（変更種別つき）

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/elements/search-filter.ts` | 確認または修正 | 検索条件型、正規化、URL query 変換、分類・周期 options、active 判定を集約 |
| `frontend/src/lib/elements/search-filter.test.ts` | 確認または修正 | 正規化、空文字、分類、周期、URL query、複合条件のテスト |
| `frontend/src/lib/api/elements.ts` | 確認または修正 | `getElements({ filters, accessToken, signal })`、query string 組み立て、共通エラー処理 |
| `frontend/src/lib/api/elements.test.ts` | 確認または修正 | filters、trim、空条件省略、Authorization、AbortSignal、非 JSON エラー、レスポンス形式不正のテスト |
| `frontend/src/lib/components/elements/ElementSearchFilters.svelte` | 確認または修正 | キーワード入力、分類 select、周期 select、検索、リセット、件数表示、検索中表示 |
| `frontend/src/routes/(app)/elements/+page.svelte` | 確認または修正 | URL query 復元、検索条件適用、API 再取得、loading / empty / error、モーダル連携 |
| `backend/src/lib/elements/search.ts` | 確認または修正 | query validation、正規化、番号検索候補生成、Prisma where 組み立て |
| `backend/src/lib/elements/search.test.ts` | 確認または修正 | backend query schema と where 生成のテスト |
| `backend/src/routes/elements/index.ts` | 確認または修正 | `GET /elements` の query validation、検索条件適用、任意認証時の `masteryStatus` 維持 |
| `backend/src/routes/elements/elements.test.ts` | 確認または修正 | q/category/period、複合検索、400、401、500、masteryStatus のルートテスト |
| `docs/04_api.md` | 確認または修正 | 実装済み query 仕様、400、検索対象、trim 方針と整合 |
| `docs/05_progress.md` | 確認または修正 | 既存完了状態と差分タスクの扱いを整合 |
| `docs/plans/elements-search-filter/plan.md` | 修正 | 本計画、チェックボックス、実装完了記録を管理 |

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
| 502 / 504 | 非 JSON の可能性あり。frontend は `parseErrorResponse()` で安全に扱う |

### Query params

| クエリ | 型 | 正規化 | 検索内容 |
|---|---|---|---|
| `q` | string | `trim()`。空文字は未指定扱い | `id` 部分一致、`symbol` 部分一致、`nameJa` 部分一致、`nameEn` 部分一致 |
| `category` | string | `trim()`。空文字は未指定扱い | `category` 完全一致 |
| `period` | number | 空文字は未指定扱い | 1〜7 の整数完全一致 |

### 検索条件の組み合わせ

- `q`, `category`, `period` は AND 条件
- `q` 内部の `id`, `symbol`, `nameJa`, `nameEn` は OR 条件
- 返却順は `id` 昇順
- 検索結果 0 件でも 200 `{ "elements": [] }`
- ログイン時は検索後の要素だけに `masteryStatus` を付与する
- 不明な `category` は 400 ではなく 0 件になり得る

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

1. **検索条件を URL クエリに反映するか**
   - 選択: 反映する。`/elements?q=H&category=非金属&period=1` の形式にする
   - 根拠: 再読み込み、共有 URL、ブラウザ戻る操作で検索状態を復元できる。API query 仕様とも一致する

2. **初期表示時に検索条件をどこから復元するか**
   - 選択: `page.url.searchParams` から復元し、`readElementSearchFilters()` で正規化する
   - 根拠: URL を source of truth にすると、page state と API パラメータのズレを防げる

3. **キーワード入力の反映タイミング**
   - 選択: 入力中は `draftKeyword` に保持し、Enter または検索ボタンで適用する
   - 根拠: 入力ごとに URL 更新・API 再取得すると履歴や request が増えやすい。検索実行時に一度だけ trim した値を使える

4. **分類・周期の選択 UI**
   - 選択: `select` を使い、変更時に即時適用する
   - 根拠: 分類・周期は選択肢が固定で、select 変更は明示的な絞り込み操作として自然。ラベルと option によりモバイルでも扱いやすい

5. **検索条件リセット時に API 再取得するか**
   - 選択: URL query を空にし、初期条件で API を再取得する
   - 根拠: server-side filtering を使うため、リセット後の一覧も API の source に戻す必要がある

6. **API パラメータの組み立てをどの層で行うか**
   - 選択: `$lib/elements/search-filter.ts` の `toElementSearchParams()` と `$lib/api/elements.ts` の `getElements()` に集約する
   - 根拠: page / component に URL 組み立てを散らさず、API client とテストで責務を閉じられる

7. **正規化済みの検索条件をどこで保持するか**
   - 選択: `/elements/+page.svelte` の `appliedFilters` に保持する。入力途中のキーワードは `ElementSearchFilters.svelte` の `draftKeyword` にだけ置く
   - 根拠: 適用済み条件と入力中の値を分離できる。API パラメータには常に正規化済みの `appliedFilters` を使える

8. **エラー表示に toast を使うか、画面内表示にするか**
   - 選択: 通常の API エラーは画面内表示。手動の再読み込み失敗など補助通知のみ toast を使う
   - 根拠: 一覧取得エラーは画面全体の状態なので、画面内に再読み込み導線と一緒に表示するほうが分かりやすい

9. **既存コンポーネントを再利用するか、新規作成するか**
   - 選択: 検索 UI は `ElementSearchFilters.svelte` に分離し、カードグリッド・詳細モーダル・習得バッジは既存を再利用する
   - 根拠: page が API 状態管理、component が入力 UI という責務分担になり、API 仕様や変換ロジックを component に埋め込まずに済む

10. **server-side filtering 後に client-side filtering するか**
    - 選択: しない。API から返った `elements` をそのまま表示する
    - 根拠: 二重 filter による結果不一致を避ける。`filterElements()` は helper の互換性・ユニットテスト用途として残す場合のみ使う

11. **検索中の多重 request をどう扱うか**
    - 選択: `AbortController` と request sequence で前回 request を中断し、古いレスポンスを破棄する
    - 根拠: URL query、認証状態、検索条件が連続して変わった場合でも、最後の条件だけを画面に反映できる

12. **検索条件変更時のモーダル状態**
    - 選択: 検索条件を適用したら開いている詳細モーダルを閉じる
    - 根拠: 絞り込み後に一覧から消えた元素の詳細だけが残る不整合を避ける

13. **分類の unknown 値を frontend でどう扱うか**
    - 選択: frontend helper では未知分類を未指定扱いにする。backend API は不明分類を 400 にせず 0 件として扱う
    - 根拠: 画面 UI は既存分類 options のみ選択可能にし、URL 直打ちの未知分類でも UI が壊れないようにする

14. **DB 負荷をどう抑えるか**
    - 選択: DB スキーマ変更・全文検索・追加 index は行わない。番号検索は raw SQL cast ではなく 1..118 の ID 候補生成で対応する。総件数 query は追加しない
    - 根拠: 現在の元素データは 118 件で固定的。追加 query や raw SQL より、Prisma ORM 内で単純に保つほうが安全

15. **A11Y の優先事項**
    - 選択: label と form control を明示的に紐づけ、件数表示は `aria-live="polite"`、結果領域は検索中に `aria-busy` を使う。色だけで状態を伝えない
    - 根拠: キーボード操作、スクリーンリーダー、低視力ユーザーに対して検索結果更新が伝わるようにする

16. **`docs/05_progress.md` の扱い**
    - 選択: 既存 `[x]` は戻さない。再実装や追加レビューが実作業になる場合は別行を追記する
    - 根拠: 完了済みの履歴を壊さず、今回の改善が既存実装のレビュー計画であることを明確にする

## 公開インターフェース案（必要な場合）

### `frontend/src/lib/elements/search-filter.ts`

```ts
import type { Element } from '$lib/elements/types';

export type ElementSearchFilters = {
  q: string;
  category: string;
  period: number | null;
};

export type ElementSearchFilterInput = {
  q?: string | null;
  category?: string | null;
  period?: string | number | null;
};

export type ElementSearchFilterApplyHandler = (filters: ElementSearchFilters) => void;

export const DEFAULT_ELEMENT_SEARCH_FILTERS: ElementSearchFilters;

export const ELEMENT_PERIOD_OPTIONS: readonly number[];

export function getElementCategoryOptions(): string[];

export function normalizeElementSearchFilters(input: ElementSearchFilterInput): ElementSearchFilters;

export function readElementSearchFilters(searchParams: URLSearchParams): ElementSearchFilters;

export function toElementSearchParams(filters: ElementSearchFilters): URLSearchParams;

export function hasActiveElementSearchFilters(filters: ElementSearchFilters): boolean;

export function filterElements(elements: readonly Element[], filters: ElementSearchFilters): Element[];
```

### `frontend/src/lib/api/elements.ts`

```ts
import type { ElementSearchFilterInput } from '$lib/elements/search-filter';
import type { Element } from '$lib/elements/types';

export type GetElementsOptions = {
  accessToken?: string | null;
  filters?: ElementSearchFilterInput;
  signal?: AbortSignal;
};

export function getElements(options?: GetElementsOptions): Promise<Element[]>;
```

### `frontend/src/lib/components/elements/ElementSearchFilters.svelte`

```ts
import type {
  ElementSearchFilterApplyHandler,
  ElementSearchFilters
} from '$lib/elements/search-filter';

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
| T1 | 既存仕様・既存実装を確認する | `AGENTS.md`, `docs/05_progress.md`, `docs/04_api.md`, `docs/08_conventions.md`, `docs/07_testing_flow.md`, 関連 plan | 対象が `/elements` の検索・フィルターUIであること、既存完了状態との差分が明確になる | 高 |
| T2 | 進捗状態の扱いを決める | `docs/05_progress.md` | 既存 `[x]` を維持するか、差分改善タスクを追記するかを決める | 中 |
| T3 | backend API の query validation と検索仕様を確認または修正する | `backend/src/lib/elements/search.ts`, `backend/src/routes/elements/index.ts` | `q/category/period` が API 仕様どおり正規化・検証・検索される | 高 |
| T4 | backend API テストを確認または追加する | `backend/src/lib/elements/search.test.ts`, `backend/src/routes/elements/elements.test.ts` | q/category/period、複合検索、400、401、500、masteryStatus のテストが通る | 高 |
| T5 | frontend 型定義と API client を確認または修正する | `frontend/src/lib/elements/types.ts`, `frontend/src/lib/api/elements.ts` | `getElements({ filters, accessToken, signal })` が query、認証、AbortSignal、共通エラー処理に対応する | 高 |
| T6 | frontend API client テストを確認または追加する | `frontend/src/lib/api/elements.test.ts` | filters の query 化、trim、空条件省略、Authorization、非 JSON エラー、レスポンス形式不正を検証する | 高 |
| T7 | validation / 検索条件 helper を確認または修正する | `frontend/src/lib/elements/search-filter.ts` | 正規化、URL query 変換、active 判定、分類・周期 options が一箇所に集約される | 高 |
| T8 | validation / 検索条件 helper テストを確認または追加する | `frontend/src/lib/elements/search-filter.test.ts` | 空白正規化、空文字未指定、未知分類、周期 1〜7、複合条件、URL query 復元を検証する | 高 |
| T9 | 検索条件の状態管理を確認または修正する | `frontend/src/routes/(app)/elements/+page.svelte` | URL query から `appliedFilters` を復元し、条件変更時に URL と API 再取得が一致する | 高 |
| T10 | キーワード検索 UI を確認または修正する | `frontend/src/lib/components/elements/ElementSearchFilters.svelte` | 入力、Enter、検索ボタンで trim 済み `q` が一度だけ計算され適用される | 高 |
| T11 | 分類フィルター UI を確認または修正する | 同上 | `ELEMENT_CATEGORY_STYLE_MAP` 起点の分類 options で絞り込みでき、分類名の重複定義がない | 高 |
| T12 | 周期フィルター UI を確認または修正する | 同上 | 1〜7 周期と未指定が選べ、API の `period` と一致する | 高 |
| T13 | 検索条件リセットを確認または修正する | `ElementSearchFilters.svelte`, `/elements/+page.svelte` | リセットで URL query が消え、初期条件で API 再取得され、入力欄も初期化される | 高 |
| T14 | ローディング・空状態・エラー状態を整える | `/elements/+page.svelte` | 初期ロード、検索中、API 0 件、検索結果 0 件、API エラーが区別して表示される | 高 |
| T15 | 詳細モーダル・習得バッジとの整合を確認する | `/elements/+page.svelte`, 関連 components | 検索後も詳細モーダルが動作し、検索条件変更時に不整合なモーダルが残らない | 中 |
| T16 | A11Y を確認する | `ElementSearchFilters.svelte`, `/elements/+page.svelte` | label、focus、aria-live、aria-busy、キーボード操作、色以外の状態表示を確認する | 高 |
| T17 | frontend テストを実行する | `frontend/` | `npm run test:run` が通る | 高 |
| T18 | frontend lint を実行する | `frontend/` | `npm run lint` が通る | 高 |
| T19 | frontend format を実行する | `frontend/` | `npm run format` を実行し、不要な差分がない | 高 |
| T20 | Svelte / TypeScript check を実行する | `frontend/` | `npm run check` が通る | 高 |
| T21 | backend テスト・lint・format check を実行する | `backend/` | backend を変更した場合、`npm run test -- --run`, `npm run lint`, `npm run format:check` が通る | 高 |
| T22 | 手動確認を行う | ブラウザ | PC / モバイル、URL query、再読み込み、リセット、0 件、エラー時の表示を確認する | 高 |
| T23 | API 仕様と進捗ドキュメントを更新する | `docs/04_api.md`, `docs/05_progress.md` | 実装と docs の query、ステータスコード、進捗が一致する | 中 |
| T24 | plan.md の実装完了更新を行う | `docs/plans/elements-search-filter/plan.md` | チェックボックス、対象ファイル一覧、計画からの変更点、実際の変更ファイルが実態と一致する | 中 |

- [ ] T1: 既存仕様・既存実装を確認する
- [ ] T2: 進捗状態の扱いを決める
- [ ] T3: backend API の query validation と検索仕様を確認または修正する
- [ ] T4: backend API テストを確認または追加する
- [ ] T5: frontend 型定義と API client を確認または修正する
- [ ] T6: frontend API client テストを確認または追加する
- [ ] T7: validation / 検索条件 helper を確認または修正する
- [ ] T8: validation / 検索条件 helper テストを確認または追加する
- [ ] T9: 検索条件の状態管理を確認または修正する
- [ ] T10: キーワード検索 UI を確認または修正する
- [ ] T11: 分類フィルター UI を確認または修正する
- [ ] T12: 周期フィルター UI を確認または修正する
- [ ] T13: 検索条件リセットを確認または修正する
- [ ] T14: ローディング・空状態・エラー状態を整える
- [ ] T15: 詳細モーダル・習得バッジとの整合を確認する
- [ ] T16: A11Y を確認する
- [ ] T17: frontend テストを実行する
- [ ] T18: frontend lint を実行する
- [ ] T19: frontend format を実行する
- [ ] T20: Svelte / TypeScript check を実行する
- [ ] T21: backend テスト・lint・format check を実行する
- [ ] T22: 手動確認を行う
- [ ] T23: API 仕様と進捗ドキュメントを更新する
- [ ] T24: plan.md の実装完了更新を行う

## 技術的注意点

- URL query、API query、page state の変換は `search-filter.ts` に寄せる
- `ElementSearchFilters.svelte` は入力 UI に集中し、API 呼び出しや URL 操作を持たない
- `/elements/+page.svelte` は URL query 復元、API 呼び出し、画面状態の責務を持つ
- `getElements()` は `filters` を受け取れるが、component から直接呼ばない
- `q` と `category` は trim 済みの値だけを API に渡す
- 空文字の `q`, `category`, `period` は query string に含めない
- `period` は frontend では不正値を未指定扱い、backend では API に届いた不正値を 400 とする
- API エラー時は `parseErrorResponse()` を使い、非 JSON の 502 / 504 でも画面が落ちないようにする
- `AbortController` を使う場合は abort error を通常エラーとして表示しない
- 認証状態が `initializing` の間は API を呼ばない
- ログイン状態が変わった場合、`masteryStatus` の有無が変わるため再取得する
- 検索中に既存結果がある場合は、画面を空にせず `aria-busy` と件数表示で更新中を示す
- 検索結果 0 件時はリセット導線を表示する
- API 取得自体が 0 件の場合と、検索条件による 0 件は文言を分ける
- 分類 select の options は既存分類スタイル定義から取得し、表示順をテストで固定する
- `filterElements()` を残す場合、server-side filtering と二重適用しない
- Tailwind class は既存 `/elements` ページの見た目に合わせる
- ボタン・select・input は mobile 幅で文字がはみ出さないようにする
- DB スキーマ変更は不要。`schema.prisma` や migration を変更した場合は別途 migration と Playwright 確認を必須にする

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| 初期表示で一覧が取得される | `/api/v1/elements` が呼ばれ、元素カードが表示される |
| 初期表示で URL query がある | `q`, `category`, `period` が復元され、対応する API query で取得される |
| キーワードで検索できる | `q` が query string に入り、該当元素だけ表示される |
| キーワード前後の空白が正規化される | `q= H ` は `q=H` として扱われる |
| 空文字キーワードは未指定として扱われる | `q` が query string に含まれない |
| 元素番号で検索できる | `q=1` で原子番号の文字列表現に `1` を含む元素が対象になる |
| 元素記号で検索できる | 大文字小文字を区別せず一致する |
| 日本語名で検索できる | `nameJa` 部分一致で検索できる |
| 英語名で検索できる | 大文字小文字を区別せず `nameEn` 部分一致で検索できる |
| 分類で絞り込める | `category` 完全一致で絞り込まれる |
| 周期で絞り込める | `period` 1〜7 の完全一致で絞り込まれる |
| キーワード・分類・周期を組み合わせて絞り込める | AND 条件の結果になる |
| 条件リセットで初期状態に戻る | URL query が消え、全件取得に戻る |
| API エラー時に既存規約に沿ってエラー表示される | 画面内に日本語エラーと再読み込み導線が表示される |
| 非 JSON エラー時に落ちない | `parseErrorResponse()` の default message で `ApiError` が扱われる |
| ローディング中に不自然な二重送信や UI 破綻が起きない | 古い request は abort され、最後の条件だけが反映される |
| 検索結果 0 件時の空状態が表示される | 「条件に一致する元素がありません」とリセット導線が表示される |
| API 取得結果 0 件時の空状態が表示される | 検索条件なしの空状態文言が表示される |
| URL クエリ利用時に再読み込み後に条件が復元される | reload 後も入力・select・結果が query と一致する |
| Authorization ありで検索できる | `accessToken` がある場合だけ Bearer token が送信される |
| ログイン時の `masteryStatus` が維持される | 検索後の表示要素に習得状態バッジが出る |
| 不正 token 時の 401 | バックエンドの日本語エラーが画面に表示される |
| 不正 period の 400 | バリデーションエラーとして扱われる |
| 詳細モーダル表示中に検索条件を変える | モーダルが閉じ、一覧と詳細対象の不整合が残らない |
| キーボード操作 | input, select, 検索, リセット, 元素カードへ自然にフォーカス移動できる |
| スクリーンリーダー向け件数更新 | 件数表示が `aria-live="polite"` で自然に通知される |

## 実装リスクと回避策

| リスク | 回避策 |
|---|---|
| URL query と page state がズレる | URL query を source of truth とし、`readElementSearchFilters()` で復元する |
| trim が複数箇所に散る | `normalizeElementSearchFilters()` に集約する |
| component に API 仕様が入り込む | `ElementSearchFilters.svelte` は `onApply` と `onReset` だけを呼ぶ |
| API query 組み立てが重複する | `toElementSearchParams()` と `getElements()` に集約する |
| server-side filtering と client-side filtering が二重適用される | 表示は API response をそのまま使う |
| 連続操作で古い API response が表示される | `AbortController` と request sequence で防ぐ |
| 検索中にフォーカスが失われる | 検索中もフォーム全体を過度に disabled にしない |
| 検索結果 0 件と API 0 件の文言が混ざる | `hasActiveFilters` で状態を分ける |
| backend と frontend の period validation がズレる | 1〜7 をテストで固定し、docs と API 実装を確認する |
| backend の具体的なエラーメッセージを frontend が上書きする | `ApiError.message` を優先して表示する |
| DB 負荷が不要に増える | 総件数 query や raw SQL を追加しない。検索後の表示対象 ID のみに `masteryStatus` を付与する |
| A11Y が検索中状態で崩れる | `aria-busy`, `aria-live`, focus 維持、label 紐づけを手動確認に含める |
| `docs/05_progress.md` の既存 `[x]` と計画が矛盾する | 既存完了行は戻さず、差分改善として扱う場合だけ新規行を追加する |

## 手動確認項目

| 項目 | 手順 | 期待結果 |
|---|---|---|
| 初期表示 | `/elements` を開く | 元素一覧が表示される |
| キーワード検索 | `H` を入力して検索 | URL に `q=H` が入り、結果が更新される |
| trim 確認 | `  H  ` を入力して検索 | URL と API query は `H` として扱われる |
| 空文字検索 | 空白だけ入力して検索 | `q` が URL から消える |
| 分類フィルター | 分類 select で `非金属` を選ぶ | `category=非金属` が URL に入り結果が更新される |
| 周期フィルター | 周期 select で `2周期` を選ぶ | `period=2` が URL に入り結果が更新される |
| 複合条件 | q, category, period を同時に指定 | AND 条件の結果になる |
| リセット | リセットボタンを押す | URL query、input、select、結果が初期状態に戻る |
| 再読み込み復元 | query 付き URL で reload | 条件と結果が復元される |
| 0 件表示 | 一致しない条件にする | 0 件文言とリセット導線が表示される |
| API エラー | backend 停止またはエラーを発生させる | 画面内にエラーと再読み込みボタンが表示される |
| 検索中表示 | network を遅くして検索 | 既存結果を保ちつつ検索中表示になる |
| 認証あり | ログイン状態で検索 | Authorization が送られ、習得状態バッジが維持される |
| モーダル連携 | 詳細モーダルを開いて検索条件を変更 | モーダルが閉じる |
| モバイル表示 | 幅 375px 程度で確認 | input、select、ボタン、件数表示がはみ出さない |
| キーボード操作 | Tab / Enter で操作 | 検索・リセット・カード選択が操作できる |
| スクリーンリーダー配慮 | 件数表示と検索中表示を確認 | `aria-live` と `aria-busy` が過剰な読み上げにならない |

## 実装完了時の更新ルール

実装完了時は以下を必ず確認し、`docs/plans/elements-search-filter/plan.md` を実態に合わせて更新する。

- 対象ファイル一覧が実際の変更ファイルと一致していること
- 計画になかった変更ファイルを追加した場合は表に追記すること
- 計画にあったが変更しなかったファイルは、削除するか「確認のみ」と明記すること
- 完了したタスクのチェックボックスを `[x]` にすること
- API 仕様・ステータスコード・エラーメッセージが変わった場合は `docs/04_api.md` を更新すること
- `docs/05_progress.md` の該当タスクを実態に合わせて更新すること
- 実装中に設計判断を変えた場合は「計画からの変更点」に理由つきで記録すること
- DB スキーマや migration を変更した場合は、migration 適用確認と Playwright 確認結果を記録すること

```markdown
## 実装完了
- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/elements-search-filter
- PR: #N

### 計画からの変更点
- 例: server-side filtering を採用したため、表示時の `filterElements()` 二重適用は行わない方針にした

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/elements/search-filter.ts` | 修正 | 検索条件の正規化と URL query 変換 |
| `frontend/src/lib/components/elements/ElementSearchFilters.svelte` | 修正 | 検索・分類・周期・リセット UI |
| `frontend/src/routes/(app)/elements/+page.svelte` | 修正 | URL query 復元と API 再取得 |
```

## 確認事項

- 依頼文冒頭には `/game/result` の記載があったが、機能名・品質要件・タスクリスト要件は「検索・フィルターUI（キーワード・分類・周期）」を指している。この plan は `/elements` の検索・フィルターUIを対象にする。
- `/game/result` の実装計画を扱う場合は、`docs/plans/game-screens/plan.md` に別セクションとして作成する。
