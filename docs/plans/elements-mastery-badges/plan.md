# 習得状態バッジ表示（ログイン時のみ・未学習/学習中/習得）実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、Hono API連携・認証状態設計）
> 対象実装者: Sonnet

## 概要

`docs/05_progress.md` フェーズ4「習得状態バッジ表示（ログイン時のみ・未学習/学習中/習得）」を完了する。`/elements` の元素カードに、ログイン済みユーザーだけ習得状態バッジを表示する。

本タスクでは、既存 `GET /elements` を任意認証対応に拡張し、ログイン時のみ各元素へ `masteryStatus` を付与する。未ログイン時はバッジを表示せず、既存の一覧・検索・詳細モーダル挙動を維持する。

スコープ外:

| 項目 | 帰属 |
|---|---|
| `GET /elements` の backend query 検索実装 | フェーズ5 |
| `GET /elements/:id` 実装 | フェーズ5 |
| `POST /game/sessions` での `UserStats.masteredCount` 更新 | フェーズ7 |
| ゲーム画面・回答保存 UI | フェーズ6/7 |
| 習得状態による検索・フィルター | 別タスク |
| ダークモード対応 | フェーズ11 |

### レビューで改善した点

- `isMastered: boolean` では要件の「未学習/学習中/習得」を表現できないため、API・型・UI を `masteryStatus` 3値へ統一する。
- `optionalAuthMiddleware` を新たに使うため、停止・未認証・ロック中ユーザーをログイン扱いしない条件をテストで固定する。
- `authStore.isInitializing` 中に匿名 fetch しないよう、初回ロードと認証状態変化時の再取得条件を明確化する。
- 習得状態の文言・色・aria label は helper に集約し、カードや将来の詳細表示で重複定義しない。

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- 設計決定1: 習得済み判定は `GameAnswer` 集計方式。新テーブルは追加しない。
- フェーズ4に本タスクあり。
- フェーズ5に `GET /elements（keyword・category・period 検索・isMastered 付与【設計決定1】）` があるが、本計画では3状態要件に合わせて `masteryStatus` へ更新する。

**`docs/plans/elements-page/plan.md`**
- `/elements` の 118枚カードグリッド実装済み。
- 習得状態バッジは別タスクとしてスコープ外。
- `GET /elements` は最小実装済み。

**`docs/plans/elements-detail-modal/plan.md`**
- カードクリックで詳細モーダルを開く実装済み。
- 既存一覧データを詳細モーダルへ流用する方針。
- 本タスクでは詳細モーダルに習得状態を表示しない。

**`docs/plans/elements-search-filter/plan.md`**
- 検索・フィルターは frontend 側で実装済み。
- `GET /elements` の query 検索は未実装のままフェーズ5へ残す方針。
- `/elements/+page.svelte` は `elements` と `filteredElements` を分けて管理している。

**`docs/04_api.md`**
- `GET /elements` は現在 `elements: Element[]` を返す仕様。
- エラーレスポンス共通形式は `{ "error": "メッセージ文字列" }`。
- 502/504 等の非 JSON エラーに備え、frontend は `response.ok` を JSON parse 前に判定する。

**`docs/08_conventions.md`**
- `API_BASE_URL` は `frontend/src/lib/api/config.ts` で一元管理。
- 重複ロジック禁止。
- エラーメッセージは日本語。
- Prettier `tabWidth: 2`。

**`docs/07_testing_flow.md`**
- TDD: Red -> Green -> Refactor。
- テストは対象ファイルと同じディレクトリに置く。
- DB 構造変更時のみ migration / Playwright 確認が必須。

**`backend/src/routes/elements/index.ts`**
- `elementsRouter.get("/")`。
- `prisma.element.findMany({ orderBy: { id: "asc" } })`。
- 200: `{ elements }`。
- 500: `{ error: "サーバーエラーが発生しました" }`。

**`backend/src/middleware/auth/index.ts`**
- `optionalAuthMiddleware`。
- Authorization ヘッダーなしなら通過。
- 有効な Bearer token がある場合は `c.set("user", { id, role })`。
- 不正な Authorization / token は 401。
- 現状の任意認証は `lockedUntil` を user セット条件に含めていないため、本タスクでテストを追加して必須認証と整合させる。

**`backend/prisma/schema.prisma`**
- `Element` は `gameAnswers GameAnswer[]` を持つ。
- `GameAnswer` は `session GameSession` 経由でユーザーに紐づく。
- `GameAnswer` に `createdAt` はないため、回答順は `GameSession.playedAt` で判断する。
- DB スキーマ変更は不要。

**`frontend/src/lib/api/elements.ts`**
- `getElements(): Promise<Element[]>`。
- `credentials: 'include'`。
- 現状 Authorization ヘッダーは送らない。
- `isElement()` / `isElementsResponse()` でレスポンス形式を実行時検証。

**`frontend/src/lib/elements/types.ts`**
- `Element` 型は `id, symbol, nameJa, nameEn, category, period, group, atomicWeight, etymology`。

**`frontend/src/routes/(app)/elements/+page.svelte`**
- `loadElements(showToast = false): Promise<void>`。
- `elements: Element[]`。
- `filteredElements = filterElements(elements, appliedFilters)`。
- `selectedElement: Element | null`。
- カードは `<button>` で、クリック時に `openModal(element, event)`。
- 検索・フィルター・詳細モーダルは既存動作維持。

**`frontend/src/lib/stores/auth.svelte.ts`**
- `authStore.accessToken: string | null`。
- `authStore.isLoggedIn: boolean`。
- `authStore.isInitializing: boolean`。
- `initialize()` は root layout で呼ばれる。

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL: string`。

**`frontend/src/lib/api/errors.ts`**
- `ApiError`。
- `parseErrorBody(response): Promise<ErrorBody>`。
- `parseErrorResponse(response, defaultMessage?): Promise<never>`。

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.error(message)`。
- `toastStore.fromApiError(error)`。

### 重要な制約

- Svelte 5 Runes（`$state`, `$derived`, `$effect`, `$props`）を使う。
- 未ログイン時は `masteryStatus` を表示しない。
- ログイン時のみ Authorization ヘッダーを付けて `GET /elements` を呼ぶ。
- `authStore.isInitializing` 中に匿名扱いで先に fetch しない。
- `import.meta.env.VITE_API_BASE_URL` を直接参照しない。
- `response.ok` を JSON parse 前に必ず判定する。
- バックエンドのエラー文言は日本語。
- Prisma ORM 経由で集計し、生 SQL / `$queryRaw` は使わない。
- DB スキーマ変更はしない。
- 既存の検索・フィルター・詳細モーダル挙動を壊さない。
- 習得状態の表示文言・色・aria label は helper で一元管理する。
- `trim()` 等の正規化値は一度だけ計算して再利用する方針を維持する。

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/services/element-mastery.service.ts` | 新規 | `GameSession` / `GameAnswer` から元素ごとの習得状態を集計 |
| `backend/src/services/element-mastery.service.test.ts` | 新規 | 未学習・学習中・習得の集計テスト |
| `backend/src/middleware/auth/index.ts` | 修正 | `optionalAuthMiddleware` の user セット条件をロック状態まで含めて整合 |
| `backend/src/middleware/auth/auth.test.ts` | 修正 | 任意認証で停止・未認証・ロック中ユーザーを匿名扱いにするテストを追加 |
| `backend/src/routes/elements/index.ts` | 修正 | `optionalAuthMiddleware` 適用、ログイン時のみ `masteryStatus` 付与 |
| `backend/src/routes/elements/elements.test.ts` | 修正 | 未ログイン・ログイン・不正トークン・500 のルートテスト追加 |
| `frontend/src/lib/elements/types.ts` | 修正 | `ElementMasteryStatus` と `Element.masteryStatus?` を追加 |
| `frontend/src/lib/api/elements.ts` | 修正 | `getElements({ accessToken })` 対応、Authorization ヘッダー付与、レスポンス検証更新 |
| `frontend/src/lib/api/elements.test.ts` | 修正 | Authorization 有無、`masteryStatus` 検証、形式不正テスト追加 |
| `frontend/src/lib/elements/mastery-badge.ts` | 新規 | 習得状態バッジのラベル・style・aria label を一元管理 |
| `frontend/src/lib/elements/mastery-badge.test.ts` | 新規 | 3状態の helper テスト |
| `frontend/src/lib/components/elements/ElementMasteryBadge.svelte` | 新規 | バッジ表示コンポーネント |
| `frontend/src/routes/(app)/elements/+page.svelte` | 修正 | 認証初期化後に fetch、ログイン時のみバッジ表示、認証状態変化時に再取得 |
| `docs/04_api.md` | 修正 | `GET /elements` のログイン時 `masteryStatus` 付与仕様を追記 |
| `docs/05_progress.md` | 修正 | 該当タスクとフェーズ5の `isMastered` 表記を実態に合わせて更新 |
| `docs/plans/elements-mastery-badges/plan.md` | 新規 | 本計画書。実装完了時に実態へ更新 |

## API仕様（この機能で使う範囲のみ）

### エラーレスポンス共通形式

```json
{ "error": "メッセージ文字列" }
```

### GET `/api/v1/elements`

| 項目 | 内容 |
|---|---|
| 認証 | 任意。未ログインでも 200 |
| Header | ログイン時のみ `Authorization: Bearer <accessToken>` |
| Query | 本タスクでは未実装。既存どおり frontend 側で検索・フィルター |
| 200 未ログイン | `{ "elements": Element[] }`。`masteryStatus` は含めない |
| 200 ログイン | `{ "elements": ElementWithMastery[] }`。各元素に `masteryStatus` を付与 |
| 401 | Authorization ヘッダー形式が不正、または token が無効 |
| 500 | `{ "error": "サーバーエラーが発生しました" }` |

### ログイン時レスポンス例

```json
{
  "elements": [
    {
      "id": 1,
      "symbol": "H",
      "nameJa": "水素",
      "nameEn": "Hydrogen",
      "category": "非金属",
      "period": 1,
      "group": 1,
      "atomicWeight": 1.008,
      "etymology": null,
      "masteryStatus": "mastered"
    }
  ]
}
```

### `masteryStatus`

| 値 | 表示 | 判定 |
|---|---|---|
| `unlearned` | 未学習 | 対象ユーザーの回答履歴がない |
| `learning` | 学習中 | 回答履歴はあるが、直近2回連続正解ではない |
| `mastered` | 習得 | 対象元素の直近2回の回答がどちらも正解 |

## 設計上の決定事項

1. **API は `isMastered` boolean ではなく `masteryStatus` 3値を返す**
   - 選択: `unlearned | learning | mastered`
   - 根拠: 要件が「未学習/学習中/習得」の3段階であり、boolean では `unlearned` と `learning` を区別できないため。

2. **未ログイン時は `masteryStatus` を返さない**
   - 選択: `masteryStatus?: ElementMasteryStatus`
   - 根拠: 「ログイン時のみ」表示を API 形状でも表現でき、未ログイン UI が誤ってバッジを表示しないため。

3. **習得判定は `GameSession.playedAt` の新しい順で集計する**
   - 選択: ユーザーの `GameSession` を `playedAt desc` で取得し、各 session の `answers` を走査する。
   - 根拠: `GameAnswer` に `createdAt` がないため、回答順は親 `GameSession.playedAt` で判断する必要がある。生 SQL を避け、Prisma ORM に統一する。

4. **集計 service を route から分離する**
   - 選択: `backend/src/services/element-mastery.service.ts`
   - 根拠: route を薄く保ち、集計ロジックを単体テスト可能にするため。

5. **`UserStats.masteredCount` は本タスクで更新しない**
   - 選択: GET は表示用集計のみ。
   - 根拠: `masteredCount` 更新は `POST /game/sessions` 側の責務。GET で副作用を持たせないため。

6. **`optionalAuthMiddleware` の user セット条件を必須認証と整合させる**
   - 選択: 停止・メール未認証・ロック中ユーザーは `user` をセットせず匿名扱いにする。不正 token は既存どおり 401。
   - 根拠: ユーザー固有の習得状態を返すため、ロック中ユーザーをログイン扱いにしない安全側の挙動が必要。

7. **frontend は認証初期化完了後に `GET /elements` を呼ぶ**
   - 選択: `authStore.isInitializing` 中は fetch しない。
   - 根拠: 初回に匿名レスポンスを取得してからログインバッジを再取得するちらつきを避けるため。

8. **API クライアントは `accessToken` を引数で受ける**
   - 選択: `getElements({ accessToken })`
   - 根拠: API 層が `authStore` に直接依存しないため、テストしやすく循環依存を避けられる。

9. **Authorization ヘッダーは token がある場合だけ付ける**
   - 選択: `accessToken ? { Authorization: \`Bearer ${accessToken}\` } : {}`。
   - 根拠: 未ログイン時に不正な Bearer を送らず、`optionalAuthMiddleware` の 401 を避けるため。

10. **バッジの文言・色は helper で一元管理する**
    - 選択: `mastery-badge.ts`
    - 根拠: カード内・将来の詳細モーダル等で再利用しても表示定義が重複しないため。

11. **バッジは元素カード内の分類バッジとは別の視覚要素として置く**
    - 選択: カード下部に分類バッジと習得バッジを折り返し可能な flex 配置で並べる。
    - 根拠: 長い分類名と習得状態が重なったり、カード幅を押し広げたりするのを防ぐため。

12. **検索・フィルターは `masteryStatus` を条件に含めない**
    - 選択: 表示のみ。
    - 根拠: 要件はバッジ表示であり、習得状態フィルターは別タスク化したほうが安全。

13. **認証状態が変わったら一覧を再取得する**
    - 選択: `/elements` 表示中に login/logout/refresh で token 状態が変わった場合は `loadElements()` を再実行する。
    - 根拠: ログイン後はバッジ表示、ログアウト後はバッジ非表示へ自然に切り替えるため。

14. **詳細モーダルには本タスクで習得状態を出さない**
    - 選択: バッジ表示対象はカードのみ。
    - 根拠: 要件の対象画面は `/elements` の一覧カードであり、詳細モーダルまで広げると表示・a11y・テスト範囲が増えるため。

## 公開インターフェース案

### `frontend/src/lib/elements/types.ts`

```ts
export type ElementMasteryStatus = 'unlearned' | 'learning' | 'mastered';

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
  masteryStatus?: ElementMasteryStatus;
};
```

### `frontend/src/lib/api/elements.ts`

```ts
export type GetElementsOptions = {
  accessToken?: string | null;
};

export async function getElements(options?: GetElementsOptions): Promise<Element[]>;
```

### `frontend/src/lib/elements/mastery-badge.ts`

```ts
import type { ElementMasteryStatus } from '$lib/elements/types';

export type MasteryBadgeView = {
  label: string;
  className: string;
  ariaLabel: string;
};

export function getElementMasteryBadgeView(status: ElementMasteryStatus): MasteryBadgeView;
```

### `frontend/src/lib/components/elements/ElementMasteryBadge.svelte`

```ts
type Props = {
  status: import('$lib/elements/types').ElementMasteryStatus;
};
```

### `backend/src/services/element-mastery.service.ts`

```ts
export type ElementMasteryStatus = "unlearned" | "learning" | "mastered";

export async function getElementMasteryStatusMap(
  userId: string,
): Promise<Map<number, ElementMasteryStatus>>;
```

## タスクリスト（進捗管理）

| タスクID | 内容（何を） | ファイル（どこで） | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 進捗を実装中に更新し、既存計画書との差分を確認 | `docs/05_progress.md`, `docs/plans/*/plan.md` | 該当タスクが `[ ]` -> `[-]` になり、スコープ外が明確 | 中 |
| T2 | backend 習得状態集計 service の Red テスト作成 | `backend/src/services/element-mastery.service.test.ts` | 未学習・学習中・習得・複数元素混在のテストが実装前に失敗する | 高 |
| T3 | backend 習得状態集計 service 実装 | `backend/src/services/element-mastery.service.ts` | T2 が Green。Prisma ORM のみで集計し、生 SQL を使わない | 高 |
| T4 | 任意認証の安全側挙動を Red テストで固定 | `backend/src/middleware/auth/auth.test.ts` | 停止・未認証・ロック中ユーザーが optional auth で匿名扱いになるテストが先に失敗する | 高 |
| T5 | `optionalAuthMiddleware` の user セット条件を修正 | `backend/src/middleware/auth/index.ts` | T4 が Green。不正 token は引き続き 401 | 高 |
| T6 | `GET /elements` 任意認証・`masteryStatus` 付与の Red テスト追加 | `backend/src/routes/elements/elements.test.ts` | 未ログイン時は付与なし、ログイン時は付与あり、不正 token は 401 のテストが先に失敗する | 高 |
| T7 | `GET /elements` を任意認証対応に修正 | `backend/src/routes/elements/index.ts` | T6 が Green。既存未ログイン 200 と 500 エラーが維持される | 高 |
| T8 | frontend 型・API client の Red テスト追加 | `frontend/src/lib/api/elements.test.ts`, `frontend/src/lib/elements/types.ts` | `masteryStatus` 検証、Authorization 有無、形式不正のテストが先に失敗する | 高 |
| T9 | frontend 型・API client 実装 | `frontend/src/lib/elements/types.ts`, `frontend/src/lib/api/elements.ts` | `getElements({ accessToken })` が token ありのみ Authorization を送る。既存エラー処理を維持 | 高 |
| T10 | バッジ helper/component の Red テスト作成 | `frontend/src/lib/elements/mastery-badge.test.ts` | 3状態の label/class/aria label テストが実装前に失敗する | 高 |
| T11 | バッジ helper/component 実装 | `frontend/src/lib/elements/mastery-badge.ts`, `frontend/src/lib/components/elements/ElementMasteryBadge.svelte` | 3状態が日本語表示され、style 定義が helper に集約される | 高 |
| T12 | `/elements` ページに認証連携とバッジ表示を統合 | `frontend/src/routes/(app)/elements/+page.svelte` | 認証初期化後に fetch、ログイン時のみバッジ表示、検索・詳細モーダルが維持される | 高 |
| T13 | API・進捗・計画書を実態に合わせて更新 | `docs/04_api.md`, `docs/05_progress.md`, `docs/plans/elements-mastery-badges/plan.md` | API 仕様が `masteryStatus` 3値に更新され、該当タスクが `[x]` になる | 中 |
| T14 | backend 品質チェック | `backend/` | `npm run lint` / `npm run format:check` / `npm run test -- --run` が通る | 高 |
| T15 | frontend 品質チェック | `frontend/` | `npm run lint` / `npm run format` / `npm run check` / `npm run test:run` が通る | 高 |
| T16 | 手動確認 | ブラウザ | 未ログイン・ログイン・ログアウト後・検索後・モーダル開閉で表示崩れがない | 高 |

- [ ] T1: 進捗を実装中に更新し、既存計画書との差分を確認
- [ ] T2: backend 習得状態集計 service の Red テスト作成
- [ ] T3: backend 習得状態集計 service 実装
- [ ] T4: 任意認証の安全側挙動を Red テストで固定
- [ ] T5: `optionalAuthMiddleware` の user セット条件を修正
- [ ] T6: `GET /elements` 任意認証・`masteryStatus` 付与の Red テスト追加
- [ ] T7: `GET /elements` を任意認証対応に修正
- [ ] T8: frontend 型・API client の Red テスト追加
- [ ] T9: frontend 型・API client 実装
- [ ] T10: バッジ helper/component の Red テスト作成
- [ ] T11: バッジ helper/component 実装
- [ ] T12: `/elements` ページに認証連携とバッジ表示を統合
- [ ] T13: API・進捗・計画書を実態に合わせて更新
- [ ] T14: backend 品質チェック
- [ ] T15: frontend 品質チェック
- [ ] T16: 手動確認

## 技術的注意点

### backend 集計方針

- `GameAnswer` に `createdAt` がないため、`GameSession.playedAt desc` で新しい回答から走査する。
- 各元素について最大2件の回答だけ保持する。
- 回答0件: `unlearned`。
- 回答1件以上、かつ直近2件が両方正解ではない: `learning`。
- 直近2件が両方正解: `mastered`。
- 同一元素の回答が1件だけ正解でも `mastered` にはしない。
- `UserStats.masteredCount` の更新はしない。
- 取得対象は `userId` に紐づく `GameSession` と `answers.elementId/isCorrect` のみ。不要なユーザー情報や元素情報は select しない。

### frontend fetch 方針

- `authStore.isInitializing` が `false` になるまで `loadElements()` しない。
- `authStore.isLoggedIn && authStore.accessToken !== null` のときだけ token を渡す。
- token がない場合は Authorization ヘッダー自体を作らない。
- `getElements()` 内では `response.ok` を JSON parse 前に判定する。
- レスポンス検証では `masteryStatus` が未定義、または3値のいずれかの場合のみ有効とする。
- unknown な `masteryStatus` は `ApiError(500, '元素一覧のレスポンス形式が不正です')` とする。
- `isRequesting` による二重 fetch 防止は既存のまま維持する。

### UI 方針

- 未ログイン時: 習得状態バッジ領域を描画しない。
- ログイン時: すべてのカードに `未学習` / `学習中` / `習得` のいずれかを表示する。
- バッジ文言は `ElementMasteryBadge` 内で直接分岐せず、`getElementMasteryBadgeView()` を使う。
- カードクリックの `aria-label` は既存の詳細モーダル用文言を維持する。
- バッジはボタン内に入るため、追加のクリックハンドラーを持たせない。
- 長い分類名と並べても折り返せるよう `flex flex-wrap gap-2` 等で配置する。
- 表示色は分類色と競合しにくい中立寄りの配色にする。

### ドキュメント方針

- `docs/04_api.md` の `GET /elements` に、任意認証と `masteryStatus` を追記する。
- `docs/05_progress.md` のフェーズ5に残っている `isMastered` 表記は、今回の判断に合わせて `masteryStatus` へ更新する。
- 実装完了時は本 plan の対象ファイル一覧・タスクリスト・実装完了セクションを実態に合わせる。

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| backend service: 回答履歴なし | `unlearned` |
| backend service: 直近1回正解のみ | `learning` |
| backend service: 直近1回不正解のみ | `learning` |
| backend service: 直近2回連続正解 | `mastered` |
| backend service: 直近2回が正解・不正解 | `learning` |
| backend service: 古い2連続正解があっても直近が不正解 | `learning` |
| optional auth: Authorization なし | 200 で通過し、`user` は未セット |
| optional auth: 有効 token + active/verified/unlocked | `user` がセットされる |
| optional auth: 停止済みユーザー | 200 で通過し、`user` は未セット |
| optional auth: メール未認証ユーザー | 200 で通過し、`user` は未セット |
| optional auth: ロック中ユーザー | 200 で通過し、`user` は未セット |
| optional auth: 不正 token | 401、日本語エラー |
| backend route: 未ログイン `GET /elements` | 200、`masteryStatus` なし |
| backend route: ログイン `GET /elements` | 200、各元素に `masteryStatus` あり |
| backend route: 不正 Authorization | 401、日本語エラー |
| backend route: Prisma 例外 | 500、`サーバーエラーが発生しました` |
| frontend API: token なし | Authorization ヘッダーを送らない |
| frontend API: token あり | `Authorization: Bearer <token>` を送る |
| frontend API: `masteryStatus` なし | 正常レスポンスとして受け取る |
| frontend API: `masteryStatus: mastered` | 正常レスポンスとして受け取る |
| frontend API: 不明な `masteryStatus` | `ApiError(500)` |
| frontend helper: `unlearned` | `未学習` 表示設定を返す |
| frontend helper: `learning` | `学習中` 表示設定を返す |
| frontend helper: `mastered` | `習得` 表示設定を返す |
| 手動: 未ログインで `/elements` | バッジ非表示、一覧・検索・モーダルは動作 |
| 手動: ログイン済みで `/elements` | 全カードに3状態バッジ表示 |
| 手動: 検索・フィルター後 | 絞り込み後のカードにもバッジ表示 |
| 手動: カードクリック | 詳細モーダルが従来どおり開閉 |
| 手動: ログアウト後 | バッジが非表示になり、一覧表示は維持 |

## 実装リスクと回避策

| リスク | 回避策 |
|---|---|
| `isMastered` と `masteryStatus` の仕様が混在する | `docs/04_api.md` と `docs/05_progress.md` を同時に更新し、3状態へ統一する |
| 認証初期化前に匿名 fetch してバッジが一瞬出ない | `authStore.isInitializing` が終わってから初回 fetch する |
| ログイン/ログアウト後に一覧が古い状態のまま残る | 認証状態・token の変化を見て `loadElements()` を再実行する |
| ロック中ユーザーに習得状態を返してしまう | `optionalAuthMiddleware` の user セット条件を必須認証と揃え、テストで固定する |
| 集計で N+1 クエリになる | `GameSession` と `answers` を必要項目だけ select し、メモリ上で 118元素分を集計する |
| `GameAnswer` の順序判定が不安定 | `GameSession.playedAt desc` を基準にし、同一セッション内で同じ元素が重複しない前提をテスト名・コメントで明示する |
| 未ログイン時に不正な Authorization を送って 401 になる | token がある場合だけ Authorization ヘッダーを生成する |
| バッジ追加でカード内テキストが重なる | 分類バッジと習得バッジを `flex-wrap` で配置し、モバイル幅で手動確認する |
| API レスポンス形式不正が UI に混入する | `isElement()` で `masteryStatus` の3値を実行時検証する |
| 既存検索・詳細モーダルが壊れる | `/elements/+page.svelte` の変更をバッジ表示と fetch 条件に限定し、既存 helper を変更しない |

## 実装完了時に追記する内容

実装完了時は以下を本ファイル末尾へ追記する。

```markdown
## 実装完了
- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/xxx
- PR: #N

### 計画からの変更点
- なし

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/routes/(app)/elements/+page.svelte` | 修正 | 習得状態バッジ表示 |
```
