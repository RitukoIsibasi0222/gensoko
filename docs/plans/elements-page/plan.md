# 元素一覧ページ /elements 実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、API連携設計含む）
> 対象実装者: Sonnet

## 1. タイトル

元素一覧ページ /elements（118枚カードグリッド・分類色分け）実装計画

## 2. 設計者ロール

シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、Hono API連携設計）

## 3. 概要

`docs/05_progress.md` フェーズ4「元素一覧ページ /elements（118枚カードグリッド・分類色分け）」を完了する。

本タスクのスコープは **「118元素のカードグリッド表示」と「分類色分け」のみ**。以下は別タスクで扱う。

| 別タスク | フェーズ |
|---|---|
| 元素詳細モーダル | フェーズ4 |
| 検索・フィルターUI | フェーズ4 |
| 習得状態バッジ | フェーズ4 |
| GET /elements の query 検索（q/category/period） | フェーズ5 |
| GET /elements の isMastered 付与 | フェーズ5 |
| GET /elements/:id | フェーズ5 |

### 3.1 フェーズ境界に関する判断

`backend/src/routes/elements/index.ts` は `// TODO: implement` で、`backend/src/index.ts` でも未マウント。
UI モックで 118 実データを表示するために、**本タスクで「最小限の GET /elements（引数なし・isMastered なし）」を同時に実装する**。

- top-page 計画の「ranking は backend 未実装のため空状態固定」とは異なる判断
- 元素 118件は public な学習データであり、空状態では UI 検証が成立しない
- 元素データは seed 済みのため、一覧返却のみを先に実装しても phase 5 の query / isMastered 実装と独立できる

## 4. 前提条件・依存関係

### 4.1 既存の実装（公開インターフェース）

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL: string` — API ベース URL

**`frontend/src/lib/api/errors.ts`**
- `class ApiError extends Error`
- `parseErrorBody(response: Response): Promise<ErrorBody>`
- `parseErrorResponse(response: Response, defaultMessage?: string): Promise<never>`

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.fromApiError(error: ApiError): string`
- `toastStore.error(message: string): string`

**`frontend/src/lib/stores/auth.svelte.ts`**
- `authStore.isInitializing: boolean`
- `authStore.isLoggedIn: boolean`
- 本タスクでは認証依存表示を持たないため直接利用は最小限。phase 5 の `isMastered` 表示で連携予定

**`frontend/src/routes/(app)/elements/+page.svelte`**
- 現状スタブ（2行）。全文書換が必要。

**`backend/src/routes/elements/index.ts`**
- 現状 TODO。

**`backend/src/index.ts`**
- elements ルーター未マウント。

**`backend/prisma/schema.prisma`**
- `Element` モデル: `id, symbol, nameJa, nameEn, category, period, group, atomicWeight, etymology`

**`docs/04_api.md`**
- `GET /elements` の最終仕様（q/category/period）を記載。

**`docs/08_conventions.md`**
- `API_BASE_URL` 一元管理、`response.ok` 先行判定、重複ロジック排除が必須。

**`docs/07_testing_flow.md`**
- Red → Green → Refactor の TDD 方針。

### 4.2 参照する既存実装パターン

- `frontend/src/routes/(app)/settings/+page.svelte`（loading/error/retry パターン）
- `frontend/src/routes/(app)/+page.ts`（`ssr=true`, `prerender=false`）
- `frontend/src/lib/home/content.ts`（ページ固有ロジックを lib 配下へ切り出すパターン）
- `frontend/src/routes/(app)/+layout.svelte`（(app) 配下の共通コンテナ構造）
- `frontend/src/lib/components/Header.svelte`（`/elements` への既存導線）

### 4.3 seed の分類一覧（10種）

`backend/prisma/seed.ts` から抽出した category:

- アクチノイド
- アルカリ金属
- アルカリ土類金属
- ハロゲン
- ランタノイド
- 希ガス
- 後遷移金属
- 遷移金属
- 半金属
- 非金属

未知カテゴリが将来追加されてもフォールバック色で描画可能にする。

### 4.4 重要な制約

- Svelte 5 Runes（`$state`, `$derived`）のみ使用
- `import.meta.env.VITE_API_BASE_URL` の直接参照禁止。`$lib/api/config` を使う
- `response.ok` を JSON パース前に必ず判定し、エラー時のみ `parseErrorResponse` を呼ぶ
- backend の import は ESM ルール（`.js` 拡張子必須）
- エラーメッセージは日本語で統一
- 本タスクではダークモード対応を行わない（phase 11 スコープ）
- 分類色ロジックは 1 箇所で管理し、重複定義しない
- Prettier `tabWidth: 2`

## 5. 対象ファイル一覧（変更種別）

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/routes/elements/index.ts` | 修正 | GET /elements 実装（引数なし、id 昇順） |
| `backend/src/routes/elements/elements.test.ts` | 新規 | GET /elements ルートテスト（Prisma モック） |
| `backend/src/index.ts` | 修正 | elements ルーターを `/api/v1/elements` にマウント |
| `frontend/src/lib/elements/types.ts` | 新規 | Element 型定義 |
| `frontend/src/lib/elements/category-style.ts` | 新規 | 10分類＋フォールバックの色マップ |
| `frontend/src/lib/elements/category-style.test.ts` | 新規 | 色マップのユニットテスト |
| `frontend/src/lib/api/elements.ts` | 新規 | 元素一覧 API クライアント |
| `frontend/src/routes/(app)/elements/+page.svelte` | 修正（全文書換） | 4状態UI + カードグリッド表示 |
| `frontend/src/routes/(app)/elements/+page.ts` | 新規 | `ssr`, `prerender` を明示 |
| `docs/05_progress.md` | 修正 | 該当タスクを完了に更新 |
| `docs/plans/elements-page/plan.md` | 新規 | 本計画書 |

## 6. API仕様（この機能で使う範囲のみ）

### 6.1 エラーレスポンス共通形式

```json
{ "error": "メッセージ文字列" }
```

### 6.2 GET `/elements`

| 項目 | 内容 |
|---|---|
| 認証 | 不要（phase 5 で optional auth 追加予定） |
| クエリ | 本タスクでは未対応 |
| 200 | `{ "elements": Element[] }` |
| 500 | `{ "error": "サーバーエラーが発生しました" }` |

本タスクで画面表示に使う項目:
- `id`, `symbol`, `nameJa`, `category`

返却は将来拡張を見据えて Element の主要項目を含める:
- `nameEn`, `period`, `group`, `atomicWeight`, `etymology`

## 7. 設計上の決定事項（判断理由つき）

1. **本タスクで backend を最小実装する**
   - 選択: GET /elements を最小で実装
   - 根拠: UI モックで 118枚表示が必要なため

2. **query / isMastered は phase 5 に残す**
   - 選択: 本タスクでは未実装
   - 根拠: フェーズ境界の明確化

3. **`optionalAuthMiddleware` は本タスクで使わない**
   - 選択: 認証ミドルウェアを通さない
   - 根拠: isMastered を返さないため不要

4. **データ取得は `onMount` で 1 回だけ実行**
   - 選択: `$effect` で fetch しない
   - 根拠: 二重 fetch 防止

5. **UI は 4状態で管理する**
   - 選択: `loading / error / empty / success`
   - 根拠: 空配列時の UX を明示するため

6. **分類色マップを一元化する**
   - 選択: `category-style.ts` に集約
   - 根拠: 重複実装防止

7. **未知カテゴリはフォールバック色**
   - 選択: `gray` 系の中立色へ
   - 根拠: seed 変更に強くするため

8. **カードは本タスクでは非インタラクティブ**
   - 選択: クリック挙動・モーダルを実装しない
   - 根拠: 詳細モーダルは別タスク

9. **表示順は原子番号（id）昇順**
   - 選択: backend で orderBy
   - 根拠: 学習導線と期待値に一致

10. **エラー時に再読み込みボタンを置く**
    - 選択: `loadElements(true)` を再実行
    - 根拠: 既存 settings の UX と統一

## 8. 公開インターフェース案

```ts
// frontend/src/lib/elements/types.ts
export type Element = {
  id: number;
  symbol: string;
  nameJa: string;
  nameEn: string;
  category: string;
  period: number;
  group: number | null;
  atomicWeight: number | null;
  etymology: string | null;
};
```

```ts
// frontend/src/lib/elements/category-style.ts
export type CategoryStyle = {
  cardClass: string;
  badgeClass: string;
};

export const ELEMENT_CATEGORY_STYLE_MAP: Readonly<Record<string, CategoryStyle>>;
export function getElementCategoryStyle(category: string): CategoryStyle;
```

```ts
// frontend/src/lib/api/elements.ts
import type { Element } from '$lib/elements/types';

export async function getElements(): Promise<Element[]>;
```

## 9. タスクリスト（進捗管理）

| タスクID | 内容（何を） | ファイル（どこで） | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | GET /elements の Red テスト作成 | `backend/src/routes/elements/elements.test.ts` | 正常系・異常系が先に失敗する | 高 |
| T2 | GET /elements 実装 | `backend/src/routes/elements/index.ts` | T1 が Green になる | 高 |
| T3 | elements ルーターをマウント | `backend/src/index.ts` | `/api/v1/elements` が到達可能 | 高 |
| T4 | backend 品質チェック | `backend/` | lint / format:check / test が通る | 高 |
| T5 | Element 型定義作成 | `frontend/src/lib/elements/types.ts` | 型定義が集約される | 高 |
| T6 | 分類色マップ + テスト作成 | `frontend/src/lib/elements/category-style.ts` ほか | 10分類+未知カテゴリがテスト通過 | 高 |
| T7 | elements API クライアント作成 | `frontend/src/lib/api/elements.ts` | 共通エラーパターンで取得できる | 高 |
| T8 | ページ設定ファイル追加 | `frontend/src/routes/(app)/elements/+page.ts` | SSR/prerender 設定が明示される | 中 |
| T9 | /elements ページ状態管理実装 | `frontend/src/routes/(app)/elements/+page.svelte` | 4状態UIが排他的に表示される | 高 |
| T10 | 118カードグリッド + 分類色表示実装 | 同上 | id/symbol/nameJa/category が表示される | 高 |
| T11 | frontend 品質チェック | `frontend/` | lint / format / check / test:run が通る | 高 |
| T12 | 手動確認（PC/モバイル） | 手動 | 表示・色分け・レスポンシブ確認完了 | 高 |
| T13 | docs 更新 | `docs/05_progress.md` | 該当タスク完了に更新 | 中 |
| T14 | 実装完了記録追記 | `docs/plans/elements-page/plan.md` | 実装完了セクション追記 | 中 |

- [x] T1: GET /elements の Red テスト作成
- [x] T2: GET /elements 実装
- [x] T3: elements ルーターをマウント
- [x] T4: backend 品質チェック
- [x] T5: Element 型定義作成
- [x] T6: 分類色マップ + テスト作成
- [x] T7: elements API クライアント作成
- [x] T8: ページ設定ファイル追加
- [x] T9: /elements ページ状態管理実装
- [x] T10: 118カードグリッド + 分類色表示実装
- [x] T11: frontend 品質チェック
- [x] T12: 手動確認（PC/モバイル）
- [x] T13: docs 更新
- [x] T14: 実装完了記録追記

## 10. 技術的注意点

- backend では `prisma.element.findMany({ orderBy: { id: 'asc' } })` を使用
- 例外時は `500 + 日本語エラーメッセージ` を返す
- frontend は `onMount` で 1 回だけ取得
- エラー時は `parseErrorResponse` を利用し、文言上書きをしない
- 一覧は `<ul role="list">` と `<li>` で構造化
- 色だけに依存せず、分類名テキストを常に表示
- 118件描画では仮想スクロールは導入しない（過剰最適化しない）

## 11. テストケース一覧

| ケース | 期待結果 |
|---|---|
| GET /elements 正常系 | 200 で `{ elements: [...] }` を返す |
| GET /elements 異常系 | 500 で日本語 `error` を返す |
| 分類色マップ（10分類） | 既知カテゴリで定義済み色を返す |
| 分類色マップ（未知カテゴリ） | フォールバック色を返す |
| /elements 初期表示 | 読み込み中表示が出る |
| /elements 成功表示 | 118カードがグリッド表示される |
| /elements 空状態 | 「該当する元素がありません」が表示される |
| /elements エラー状態 | エラー文言と再読み込みボタンが表示される |
| モバイル表示 | 横スクロールなしで崩れない |
| 品質チェック | lint / format / test / check が通る |

## 12. 実装リスクと回避策

| リスク | 内容 | 回避策 |
|---|---|---|
| スコープ拡大 | 検索UIやモーダルを混ぜてしまう | スコープ外を明示し別タスク化 |
| 色定義の分散 | 画面ごとに色がズレる | `category-style.ts` へ一元化 |
| docs と実装のズレ | phase 5 仕様を先取りして混乱 | phase 4 は最小実装と明記 |
| fetch 二重実行 | `$effect` 依存で再実行される | `onMount` 固定 |
| 未知カテゴリ追加 | 色未定義でUI崩れ | フォールバック色を実装 |
| テスト粒度不整合 | seed 件数依存の不安定テスト | Prisma モック中心のユニットテスト |

## 実装完了
- 完了日: 2026-05-31
- 実装ブランチ: feature/phase4-elements-page
- PR: 未作成

### 計画からの変更点
- 追加の補助コンポーネント分割は行わず、`+page.svelte` 単体で4状態UIを実装した
- `docs/05_progress.md` の該当タスクを `[-]` から `[x]` に更新した

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/routes/elements/elements.test.ts` | 新規 | GET /elements の Red/Green テスト追加 |
| `backend/src/routes/elements/index.ts` | 修正 | GET /elements 実装（id 昇順） |
| `backend/src/index.ts` | 修正 | `/api/v1/elements` にルーターをマウント |
| `frontend/src/lib/elements/types.ts` | 新規 | Element 型定義を追加 |
| `frontend/src/lib/elements/category-style.ts` | 新規 | 分類色マップとフォールバック定義 |
| `frontend/src/lib/elements/category-style.test.ts` | 新規 | 分類色マップのユニットテスト |
| `frontend/src/lib/api/elements.ts` | 新規 | 元素一覧 API クライアント実装 |
| `frontend/src/routes/(app)/elements/+page.ts` | 新規 | SSR/prerender 設定を追加 |
| `frontend/src/routes/(app)/elements/+page.svelte` | 修正 | 4状態UI・118カード表示・再読み込み導線を実装 |
| `frontend/src/routes/(app)/+page.svelte` | 修正 | トップページの認証状態依存ロジックをリファクタリング |
| `frontend/src/lib/api/elements.test.ts` | 新規 | 元素一覧 API クライアントのユニットテスト |
| `docs/05_progress.md` | 修正 | フェーズ4 `/elements` タスクを完了に更新 |
