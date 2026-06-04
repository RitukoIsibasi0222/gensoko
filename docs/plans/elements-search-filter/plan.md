# 検索・フィルターUI（キーワード・分類・周期）実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、元素一覧 UI・検索状態設計）
> 対象実装者: Codex

## 概要

`docs/05_progress.md` フェーズ4「検索・フィルターUI（キーワード・分類・周期）」を完了する。既存の `/elements` ページに、キーワード検索、分類フィルター、周期フィルター、条件リセット、検索結果件数表示を追加する。

本タスクは **フェーズ4の UI モック範囲** として、既存の `GET /elements` で取得した元素一覧をフロントエンド側で絞り込む。フェーズ5で予定されている backend の `q/category/period` クエリ検索実装は本タスクでは行わないが、同じ条件定義を将来 API パラメータ化しやすい形で切り出す。

スコープ外:

| 項目 | 帰属 |
|---|---|
| backend `GET /elements` の query 検索実装 | フェーズ5 |
| `isMastered` 付与 | フェーズ5 |
| 習得状態バッジ表示 | フェーズ4 別タスク |
| GET `/elements/:id` 実装 | フェーズ5 |
| ダークモード対応 | フェーズ11 |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`frontend/src/routes/(app)/elements/+page.svelte`**
- `loadElements(showToast = false): Promise<void>` - 初回ロードと再読み込みで元素一覧を取得する
- `elements: Element[]` - API から取得した全元素一覧
- `isLoading: boolean` - 読み込み中状態
- `errorMessage: string | null` - API エラー表示
- `selectedElement: Element | null` - 詳細モーダル表示対象
- `openModal(element, event)` / `closeModal()` - 詳細モーダルの開閉とフォーカス復帰
- 現在は取得済み `elements` をそのまま全件表示している

**`frontend/src/lib/api/elements.ts`**
- `getElements(): Promise<Element[]>` - `GET ${API_BASE_URL}/elements` を呼び出し、`elements` 配列を返す
- `isElement(value: unknown): value is Element` - レスポンス要素の実行時検証
- `isElementsResponse(value: unknown): value is ElementsResponse` - API レスポンス形式の実行時検証

**`frontend/src/lib/elements/types.ts`**
- `Element` - `id, symbol, nameJa, nameEn, category, period, group, atomicWeight, etymology`

**`frontend/src/lib/elements/category-style.ts`**
- `ELEMENT_CATEGORY_STYLE_MAP: Readonly<Record<string, CategoryStyle>>` - 10分類のスタイル定義
- `getElementCategoryStyle(category: string): CategoryStyle` - 分類色の取得

**`frontend/src/lib/components/elements/ElementDetailModal.svelte`**
- `element: Element | null` - 表示対象元素
- `onClose: () => void` - モーダルを閉じるコールバック
- 検索後の一覧でも既存の詳細モーダルを継続利用する

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL: string` - API ベース URL。一覧 API 呼び出しで既存利用済み

**`frontend/src/lib/api/errors.ts`**
- `ApiError`
- `parseErrorResponse(response, defaultMessage?)`

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.error(message)`
- `toastStore.fromApiError(error)`

**`backend/src/routes/elements/index.ts`**
- 現状は `prisma.element.findMany({ orderBy: { id: "asc" } })` のみ
- `q/category/period` クエリは未実装

**`docs/04_api.md`**
- `GET /elements` の最終仕様として `category?: string`, `period?: number`, `q?: string` が記載済み

**`docs/01_features.md`**
- キーワード検索対象として「番号・記号・名前」が記載済み

**`backend/prisma/schema.prisma`**
- `Element` モデル: `id, symbol, nameJa, nameEn, category, period, group, atomicWeight, etymology`

### 重要な制約

- Svelte 5 Runes（`$state`, `$derived`, `$effect`, `$props`）を使用する
- `import.meta.env.VITE_API_BASE_URL` を新規に直接参照しない
- `API_BASE_URL` とエラー処理は既存の `$lib/api/*` に従う
- 検索・フィルター条件の正規化は一度だけ行い、同じ値を URL 反映・絞り込み・表示で再利用する
- 分類一覧は既存 `ELEMENT_CATEGORY_STYLE_MAP` を起点にし、分類名を重複定義しない
- 周期は seed と `Element.period` に合わせて `1` から `7` を扱う
- UI 文言・エラーメッセージは日本語に統一する
- API エラー時の既存 `loading / error / empty / success` 状態を壊さない
- カードクリックで詳細モーダルを開く既存挙動を維持する
- 118件程度のクライアント側絞り込みのため、仮想スクロールや複雑な検索ライブラリは導入しない
- Prettier `tabWidth: 2`

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/elements/search-filter.ts` | 新規 | 検索条件型、正規化、URL query 変換、絞り込み関数、分類・周期 options を集約 |
| `frontend/src/lib/elements/search-filter.test.ts` | 新規 | キーワード・分類・周期・URL query・リセット挙動のユニットテスト |
| `frontend/src/lib/components/elements/ElementSearchFilters.svelte` | 新規 | キーワード入力、分類 select、周期 select、検索ボタン、リセットボタン |
| `frontend/src/routes/(app)/elements/+page.svelte` | 修正 | URL query 復元、検索条件状態、絞り込み結果表示、空状態文言の調整 |
| `docs/04_api.md` | 修正 | `q` の検索対象を「番号・記号・日本語名・英語名」として明確化 |
| `docs/05_progress.md` | 修正 | 該当タスクを実装中、完了へ更新 |
| `docs/plans/elements-search-filter/plan.md` | 新規 | 本計画書。実装完了時に実態へ更新 |

## API 仕様（この機能で使う範囲のみ）

### エラーレスポンス共通形式

```json
{ "error": "メッセージ文字列" }
```

### 使用 API

| メソッド | パス | 認証 | このタスクでの呼び出し | レスポンス |
|---|---|---|---|---|
| GET | `/api/v1/elements` | 不要 | クエリなしで全件取得 | `{ "elements": Element[] }` |

### フェーズ5で確定する query 仕様

本タスクでは backend 検索を実装しないが、UI と docs は以下の仕様に合わせる。

| クエリ | 型 | 内容 |
|---|---|---|
| `q` | `string` | 番号・元素記号・日本語名・英語名のキーワード検索 |
| `category` | `string` | 分類フィルター |
| `period` | `number` | 周期フィルター（1-7） |

## 設計上の決定事項

1. **検索条件を URL クエリに反映する**
   - 選択: `q`, `category`, `period` を `/elements` の URL query に保持する
   - 根拠: 再読み込み・共有・戻る操作で検索状態を保てる。フェーズ5の API query 仕様にもそのまま接続できる

2. **初期表示時は URL クエリから検索条件を復元する**
   - 選択: `page.url.searchParams` を読み、`normalizeElementSearchFilters` で正規化して初期状態にする
   - 根拠: URL と画面状態のズレを防ぎ、不正な `period` などを一箇所で無害化できる

3. **キーワード入力の反映タイミングは検索ボタンまたは Enter にする**
   - 選択: 入力中は `draftKeyword` に保持し、submit 時に trim 済み `q` として適用する
   - 根拠: URL query を入力ごとに更新しないため履歴が荒れない。正規化値を一度だけ計算して再利用しやすい

4. **分類・周期は select 変更時に即時適用する**
   - 選択: `onchange` で正規化済み条件を更新し、URL query も `replaceState` で更新する
   - 根拠: select は明示的な選択操作であり、即時反映のほうがフィルターとして自然

5. **検索条件リセット時は API 再取得しない**
   - 選択: 取得済み `elements` に対する絞り込み条件だけを初期化する
   - 根拠: 本タスクはクライアント側絞り込みであり、再取得は不要。API エラー後の再読み込みボタンは既存のまま維持する

6. **API パラメータの組み立ては helper 層に集約する**
   - 選択: `search-filter.ts` に `toElementSearchParams` / `readElementSearchFilters` を置く
   - 根拠: フェーズ5で `getElements(filters)` に拡張する場合も UI 側ロジックを重複させずに流用できる

7. **正規化済み検索条件は `appliedFilters` として保持する**
   - 選択: `draftKeyword` と `appliedFilters.q` を分ける
   - 根拠: 入力途中の文字列と実際に適用済みの検索条件を混同しない

8. **エラー表示は既存の画面内表示を維持し、手動再読み込み時のみ toast を使う**
   - 選択: API エラーは既存 `errorMessage` セクション、再読み込み失敗時は既存 `toastStore.error`
   - 根拠: 検索条件変更はローカル操作なので toast は不要。API エラーの既存 UX を壊さない

9. **既存コンポーネントを再利用し、検索 UI は新規コンポーネントへ分離する**
   - 選択: `ElementDetailModal` と `getElementCategoryStyle` は再利用し、検索フォームのみ `ElementSearchFilters.svelte` として追加する
   - 根拠: `/elements/+page.svelte` の責務が増えすぎるのを防ぎ、検索 UI の見通しを保つ

10. **キーワード検索対象は番号・記号・日本語名・英語名にする**
    - 選択: `id`, `symbol`, `nameJa`, `nameEn` を対象にする
    - 根拠: `docs/01_features.md` の「番号・記号・名前」と整合し、英語名も既存 `Element` 型に含まれるため検索対象として自然

11. **URL 更新は `replaceState` を基本にする**
    - 選択: `goto(url, { replaceState: true, noScroll: true, keepFocus: true })` を使う
    - 根拠: 検索・フィルター操作でブラウザ履歴を過剰に増やさず、入力や選択後の操作感を保つ

12. **検索条件変更時にモーダルは閉じる**
    - 選択: `selectedElement = null` と `returnFocusEl = null` を条件適用処理で行う
    - 根拠: フィルター後に一覧から消えた元素の詳細だけが残る不整合を避ける

## 公開インターフェース案

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

export const DEFAULT_ELEMENT_SEARCH_FILTERS: ElementSearchFilters;

export const ELEMENT_PERIOD_OPTIONS: readonly number[];

export function getElementCategoryOptions(): string[];

export function normalizeElementSearchFilters(input: ElementSearchFilterInput): ElementSearchFilters;

export function filterElements(elements: readonly Element[], filters: ElementSearchFilters): Element[];

export function readElementSearchFilters(searchParams: URLSearchParams): ElementSearchFilters;

export function toElementSearchParams(filters: ElementSearchFilters): URLSearchParams;

export function hasActiveElementSearchFilters(filters: ElementSearchFilters): boolean;
```

### `frontend/src/lib/components/elements/ElementSearchFilters.svelte`

```ts
import type { ElementSearchFilters } from '$lib/elements/search-filter';

type Props = {
  filters: ElementSearchFilters;
  resultCount: number;
  totalCount: number;
  disabled?: boolean;
  onApply: (filters: ElementSearchFilters) => void;
  onReset: () => void;
};
```

## タスクリスト（進捗管理）

| タスクID | 内容（何を） | ファイル（どこで） | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 進捗を実装中に更新 | `docs/05_progress.md` | 該当タスクが `[ ]` から `[-]` になる | 中 |
| T2 | 検索条件 helper の Red テスト作成 | `frontend/src/lib/elements/search-filter.test.ts` | 正規化・絞り込み・URL query の期待値テストが先に失敗する | 高 |
| T3 | 検索条件 helper 実装 | `frontend/src/lib/elements/search-filter.ts` | T2 が Green になる。trim は一度だけ行う構造になる | 高 |
| T4 | 検索フォームコンポーネント作成 | `frontend/src/lib/components/elements/ElementSearchFilters.svelte` | キーワード入力、分類 select、周期 select、検索、リセットが表示される | 高 |
| T5 | `/elements` に検索状態と URL query 復元を追加 | `frontend/src/routes/(app)/elements/+page.svelte` | 初期表示時に URL query から条件が復元される | 高 |
| T6 | 絞り込み結果表示を既存カードグリッドへ接続 | 同上 | 条件に一致するカードのみ表示され、詳細モーダルも継続動作する | 高 |
| T7 | 空状態・件数表示・リセット導線を調整 | 同上 | 検索結果 0 件時と API 0 件時の文言が区別される | 高 |
| T8 | API 仕様ドキュメントを UI と整合 | `docs/04_api.md` | `q` の対象が番号・記号・日本語名・英語名として明記される | 中 |
| T9 | frontend 品質チェック | `frontend/` | `npm run lint` / `npm run format` / `npm run check` / `npm run test:run` が通る | 高 |
| T10 | 手動確認 | ブラウザ | PC・モバイル・キーボード操作で検索とモーダルが破綻しない | 高 |
| T11 | 進捗ドキュメント更新 | `docs/05_progress.md` | 該当タスクが `[-]` から `[x]` になる | 中 |
| T12 | 計画書の実装完了更新 | `docs/plans/elements-search-filter/plan.md` | チェックボックス、実際の変更ファイル、変更点が実態と一致する | 中 |

- [ ] T1: 進捗を実装中に更新（`docs/05_progress.md`）
- [ ] T2: 検索条件 helper の Red テスト作成（`frontend/src/lib/elements/search-filter.test.ts`）
- [ ] T3: 検索条件 helper 実装（`frontend/src/lib/elements/search-filter.ts`）
- [ ] T4: 検索フォームコンポーネント作成（`frontend/src/lib/components/elements/ElementSearchFilters.svelte`）
- [ ] T5: `/elements` に検索状態と URL query 復元を追加（`frontend/src/routes/(app)/elements/+page.svelte`）
- [ ] T6: 絞り込み結果表示を既存カードグリッドへ接続（同上）
- [ ] T7: 空状態・件数表示・リセット導線を調整（同上）
- [ ] T8: API 仕様ドキュメントを UI と整合（`docs/04_api.md`）
- [ ] T9: frontend 品質チェック（`frontend/`）
- [ ] T10: 手動確認（ブラウザ）
- [ ] T11: 進捗ドキュメント更新（`docs/05_progress.md`）
- [ ] T12: 計画書の実装完了更新（本ファイル）

## 技術的注意点

- `filterElements` は必ず正規化済み `ElementSearchFilters` を受け取り、関数内部で UI state を参照しない
- `q` は `normalizeElementSearchFilters` で `trim()` した値だけを検索に使う。submit handler 内で `keyword.trim()` を散らさない
- キーワード比較では `symbol` と `nameEn` は小文字化して比較する。`nameJa` はそのまま `includes` で比較する
- `id` 検索は `String(element.id).includes(q)` とし、`1` で 1, 10-19, 100-118 がヒットする仕様にする
- `category` は `ELEMENT_CATEGORY_STYLE_MAP` に存在する値だけを有効扱いにする。不正な URL query は未指定に戻す
- `period` は 1-7 の整数だけを有効扱いにする。不正値、空文字、小数は未指定に戻す
- URL 更新は `goto(url, { replaceState: true, noScroll: true, keepFocus: true })` を使い、検索操作のたびにスクロール位置を戻さない
- API エラー時は検索フォームを操作不能にし、再読み込み成功後に URL query の条件を再適用する
- `apiEmpty` と `searchEmpty` を分け、API の取得結果が 0 件なのか検索結果が 0 件なのかを混同しない
- 検索フォームはカードグリッドの外側に置き、カード内カードのような入れ子 UI にしない
- ボタンは `type="submit"` / `type="button"` を明示する
- select の初期 option は「すべての分類」「すべての周期」とする
- backend ファイルは本タスクでは変更しない。backend query 実装はフェーズ5で別計画にする

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| 初期表示で一覧が取得される | `getElements()` が呼ばれ、取得済み全件が表示される |
| キーワードで記号検索できる | `H` で該当する元素が表示される |
| キーワードで日本語名検索できる | `水素` で水素が表示される |
| キーワードで英語名検索できる | `hydrogen` で Hydrogen が表示される |
| キーワードで番号検索できる | `1` で `id` に 1 を含む元素が表示される |
| キーワード前後の空白が正規化される | `  H  ` が `H` と同じ結果になる |
| 空文字キーワードは未指定として扱われる | 空白のみの検索で `q` が URL に残らない |
| 分類で絞り込める | `非金属` 選択時に非金属のみ表示される |
| 周期で絞り込める | `2` 選択時に period 2 の元素のみ表示される |
| キーワード・分類・周期を組み合わせて絞り込める | すべての条件に一致する元素のみ表示される |
| 条件リセットで初期状態に戻る | `q/category/period` が消え、全件表示に戻る |
| URL query から条件が復元される | `/elements?q=H&period=1` で初期表示時から条件適用済みになる |
| 不正な URL query は無害化される | `period=abc` や未知 category は未指定扱いになる |
| API エラー時に既存規約に沿って表示される | 画面内エラーと再読み込みボタンが表示される |
| ローディング中に UI 破綻が起きない | 読み込み中は検索結果件数やカードが不自然に表示されない |
| 検索結果 0 件時の空状態が表示される | 「条件に一致する元素がありません」系の文言が表示される |
| 検索後も詳細モーダルが開ける | 絞り込み後のカードクリックで対象元素の詳細が表示される |
| 検索条件変更時にモーダルが閉じる | 一覧から消える可能性がある詳細表示が残らない |

## 実装リスクと回避策

| リスク | 内容 | 回避策 |
|---|---|---|
| フェーズ5の backend 検索まで混ぜる | UI タスクの範囲を超えて backend 実装が膨らむ | 本タスクは取得済み一覧のクライアント絞り込みに限定する |
| URL query と画面状態がズレる | 入力中の値と適用済み条件が混同される | `draftKeyword` と `appliedFilters` を分ける |
| trim の重複 | submit、URL 変換、filter で別々に trim して挙動がズレる | `normalizeElementSearchFilters` に集約する |
| 分類 options の重複 | style map と select options が別管理になる | `ELEMENT_CATEGORY_STYLE_MAP` から options を生成する |
| 空状態の混同 | API が空なのか検索結果が空なのかわからなくなる | `apiEmpty` と `searchEmpty` を分けて判定する |
| 既存モーダルの破損 | 絞り込み後に `selectedElement` が不整合になる | 絞り込み条件変更時に `selectedElement = null` にする |
| URL 更新で履歴が増えすぎる | select 変更や検索で戻る履歴が細かくなる | `replaceState` を使う |
| テストが DOM に寄りすぎる | Svelte コンポーネントテストが重くなる | 検索ロジックは helper のユニットテストで固定する |

## 手動確認項目

- [ ] `/elements` 初期表示で全件表示される
- [ ] キーワード検索で記号・番号・日本語名・英語名を検索できる
- [ ] キーワード前後の空白が結果に影響しない
- [ ] 分類 select で絞り込める
- [ ] 周期 select で絞り込める
- [ ] キーワード・分類・周期を同時に指定できる
- [ ] リセットで URL query と UI が初期状態に戻る
- [ ] URL query 付きで再読み込みして条件が復元される
- [ ] 検索結果 0 件時の空状態が自然に表示される
- [ ] 絞り込み後のカードから詳細モーダルを開閉できる
- [ ] 検索条件変更時に開いていたモーダルが閉じる
- [ ] PC 幅でフォームとグリッドが崩れない
- [ ] モバイル幅でフォーム、ボタン、select の文字がはみ出さない
- [ ] Tab / Enter 操作で検索フォームとカード操作ができる
- [ ] API エラー時の再読み込み導線が既存通り動く

## 実装完了時の更新ルール

実装完了時は以下を必ず行う。

- `docs/05_progress.md` の「検索・フィルターUI（キーワード・分類・周期）」を `[x]` に更新する
- 本計画書のタスクリストを `[x]` に更新する
- 対象ファイル一覧を実際の変更ファイルと一致させる
- 計画から変更した判断があれば `## 実装完了` に記録する
- 実行した確認コマンドと手動確認結果を記録する

```markdown
## 実装完了
- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/phase4-elements-search-filter
- PR: #N

### 計画からの変更点
- なし

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/elements/search-filter.ts` | 新規 | 検索条件 helper |
| `frontend/src/lib/elements/search-filter.test.ts` | 新規 | 検索条件 helper のユニットテスト |
| `frontend/src/lib/components/elements/ElementSearchFilters.svelte` | 新規 | 検索・フィルター UI |
| `frontend/src/routes/(app)/elements/+page.svelte` | 修正 | 検索状態と絞り込み結果表示を追加 |
| `docs/04_api.md` | 修正 | `q` の検索対象を明確化 |
| `docs/05_progress.md` | 修正 | フェーズ4タスクを完了に更新 |

### 実行した確認
- `npm run lint`
- `npm run format`
- `npm run check`
- `npm run test:run`

### 手動確認
- PC / モバイル / キーボード操作で検索・フィルター・リセット・詳細モーダルを確認
```
