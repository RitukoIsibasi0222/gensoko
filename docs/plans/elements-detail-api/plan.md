# GET /elements/:id 実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、Hono API 連携・既存 API 整合設計）
> レビュー観点: 既存コード整合、API 仕様整合、A11Y 影響、DB 負荷、テスト妥当性

## 概要

`docs/05_progress.md` フェーズ5「GET /elements/:id」を完了する。既存の `GET /elements` と同じ元素マスター情報を、指定された原子番号 1 件分だけ返す詳細 API を実装する。

本タスクでは `/elements` 画面の詳細モーダルは変更しない。既存モーダルは一覧取得済みデータを使い続け、今回追加する `getElement(id)` は将来の直接詳細取得・詳細ページ・外部導線に備えた API クライアントとして用意する。

### レビューで改善した点

- 単数 endpoint のレスポンスを `{ element: Element }` に固定し、一覧の `{ elements: Element[] }` と混同しないようにした。
- `GET /elements/:id` は `docs/04_api.md` の認証「なし」に合わせ、`optionalAuthMiddleware` と `masteryStatus` 付与をスコープ外にした。
- ID 範囲 `1..118` を重複定義せず、既存 `ELEMENT_ID_SEARCH_MIN/MAX` を再利用する方針にした。
- `400`（param validation）と `404`（valid ID だが未存在）を分離し、frontend の到達可能なエラーハンドリングと整合させた。
- DB は primary key の `findUnique` 1 回のみとし、一覧検索・習得状態集計より軽い実装にした。
- 画面変更なしでも API client を追加するため、将来 UI 実装時の A11Y 注意点を明記した。

### スコープ外

| 項目 | 帰属 |
|---|---|
| `/elements/[id]` 詳細ページ新規作成 | 別タスク |
| 既存詳細モーダルを `GET /elements/:id` 呼び出しへ置換 | 別タスク |
| `masteryStatus` 付き詳細取得 | 別タスク |
| DB スキーマ変更 | 不要 |
| 管理者・認証付き詳細 API | 不要 |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- フェーズ5に `GET /elements/:id` が未実装として残っている。
- `GET /elements（keyword・category・period 検索）` と `GET /elements のテスト` は完了済み。

**`docs/04_api.md`**
- ベース URL は `/api/v1`。
- `GET /elements/:id` は「元素詳細取得」、認証なし。
- エラーレスポンス共通形式は `{ "error": "メッセージ文字列" }`。
- 400 バリデーションエラー時のみ `details` を含める。
- 502/504 等では非 JSON の可能性があるため、frontend は `response.ok` を JSON parse 前に判定する。

**`docs/08_conventions.md`**
- ルートハンドラー入口で Zod 検証を行う。
- バックエンドのエラーメッセージは日本語。
- Prisma ORM 経由で DB アクセスする。
- ESM import は `.js` 拡張子を付ける。
- `API_BASE_URL` は `frontend/src/lib/api/config.ts` で一元管理する。
- 重複ロジックを避ける。
- Prettier `tabWidth: 2`。

**`docs/07_testing_flow.md`**
- Red -> Green -> Refactor の TDD。
- テストは対象ファイルと同じディレクトリに置く。
- 新しいエンドポイントは対応する `.test.ts` を作る。
- DB 構造変更時のみ migration / Playwright 確認が必須。

**`backend/src/routes/elements/index.ts`**
- `elementsRouter.get("/")` が実装済み。
- `GET /elements` は `zValidator("query", elementSearchQuerySchema)` と `optionalAuthMiddleware` を使う。
- 一覧取得は `prisma.element.findMany(...)`。
- ログイン時のみ `masteryStatus` を付与する。
- 500 は `{ error: "サーバーエラーが発生しました" }`。

**`backend/src/routes/elements/elements.test.ts`**
- `GET /elements` の一覧・検索・任意認証・400・401・500 をテスト済み。
- `GET /elements/:id` は別エンドポイントなので、新規 `element-detail.test.ts` に分ける。

**`backend/src/lib/elements/search.ts`**
- `ELEMENT_ID_SEARCH_MIN = 1`
- `ELEMENT_ID_SEARCH_MAX = 118`
- `elementSearchQuerySchema`
- `buildElementWhereInput(query)`
- `getElementIdsMatchingKeyword(keyword)`
- `GET /elements` 検索用の定数・正規化・where 生成を保持する。

**`backend/prisma/schema.prisma`**
- `Element` モデル:
  - `id: Int`
  - `symbol: String`
  - `nameJa: String`
  - `nameEn: String`
  - `category: String`
  - `period: Int`
  - `group: Int | null`
  - `atomicWeight: Float | null`
  - `etymology: String | null`

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL: string` — API ベース URL。`/api/v1` まで含む。

**`frontend/src/lib/api/errors.ts`**
- `ApiError`
- `parseErrorBody(response): Promise<ErrorBody>`
- `parseErrorResponse(response, defaultMessage?): Promise<never>`

**`frontend/src/lib/api/elements.ts`**
- `getElements(options?: GetElementsOptions): Promise<Element[]>`
- `isElement(value): value is Element` はファイル内 helper。
- `isElementsResponse(value): value is { elements: Element[] }`
- `buildElementsUrl(filters)` で URL を生成する。
- `response.ok` 判定後に `parseErrorResponse` を呼ぶ。

**`frontend/src/lib/api/elements.test.ts`**
- `getElements()` の正常系、Authorization、filters、AbortSignal、HTTP エラー、非 JSON エラー、レスポンス形式不正をテスト済み。

**`frontend/src/lib/elements/types.ts`**
- `ElementMasteryStatus`
- `Element`
- `masteryStatus?: ElementMasteryStatus`

**`frontend/src/routes/(app)/elements/+page.svelte`**
- 既存 `/elements` 画面は `getElements()` で一覧を取得する。
- 詳細モーダルは選択済み `Element` をそのまま表示する。
- 本タスクでは変更しない。

**`frontend/src/lib/components/elements/ElementDetailModal.svelte`**
- `element: Element | null`
- `onClose: () => void`
- 詳細項目は `buildElementDetailFields(element)` を使う。
- 本タスクでは変更しない。

**`frontend/src/lib/stores/auth.svelte.ts`**
- `authStore.accessToken`
- `authStore.isLoggedIn`
- `authStore.isInitializing`
- `GET /elements/:id` は認証なしのため直接利用しない。

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.error(message)`
- `toastStore.fromApiError(error)`
- 本タスクでは画面変更しないため直接利用しない。

### 重要な制約

- `GET /elements/:id` は認証なし。`optionalAuthMiddleware` は使わない。
- Authorization ヘッダーが付いていても、この endpoint では `masteryStatus` を付与しない。
- レスポンス形式は単数なので `{ element: Element }` とする。
- 存在しない ID は 404 `{ error: "元素が見つかりません" }`。
- ID が 1〜118 の整数でない場合は 400 `{ error: "バリデーションエラー", details: [...] }`。
- ID 範囲の 1 / 118 は既存定数を再利用し、同じ数値定義を複数箇所に増やさない。
- DB アクセスは `prisma.element.findUnique({ where: { id } })` を使う。
- 既存 `GET /elements` の検索・任意認証・`masteryStatus` 挙動を壊さない。
- frontend は `API_BASE_URL` を直接再定義しない。
- frontend は `response.ok` を JSON parse 前に判定し、`parseErrorResponse` を使う。
- `trim()` などの正規化値は schema / helper 内で一度だけ計算して使う。
- DB 変更なしのため migration / Prisma generate は不要。

## 対象ファイル一覧（変更種別つき）

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/lib/elements/detail.ts` | 新規 | `GET /elements/:id` の path param schema と ID 正規化を集約 |
| `backend/src/lib/elements/detail.test.ts` | 新規 | ID param の正規化・範囲検証テスト |
| `backend/src/routes/elements/index.ts` | 修正 | `GET /:id` を追加し、findUnique / 404 / 500 を実装 |
| `backend/src/routes/elements/element-detail.test.ts` | 新規 | `GET /elements/:id` の route テスト |
| `frontend/src/lib/api/elements.ts` | 修正 | `getElement(id, options?)` と単数レスポンス検証を追加 |
| `frontend/src/lib/api/elements.test.ts` | 修正 | `getElement()` の URL、AbortSignal、HTTP エラー、形式不正テストを追加 |
| `docs/04_api.md` | 修正 | `GET /elements/:id` の詳細仕様・ステータスコード・レスポンス例を追記 |
| `docs/05_progress.md` | 修正 | `GET /elements/:id` に計画書リンクを付与し、実装完了時に `[x]` へ更新 |
| `docs/plans/elements-detail-api/plan.md` | 新規 | 本計画書。実装完了時に実態に合わせて更新 |

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
      "message": "元素IDは1から118の整数で指定してください"
    }
  ]
}
```

### GET `/api/v1/elements/:id`

| 項目 | 内容 |
|---|---|
| 認証 | 不要 |
| Path params | `id`: 1〜118 の整数 |
| 200 | `{ "element": Element }` |
| 400 | ID が 1〜118 の整数でない |
| 404 | 指定 ID の元素が存在しない |
| 500 | サーバーエラー |

### Response 200

```json
{
  "element": {
    "id": 1,
    "symbol": "H",
    "nameJa": "水素",
    "nameEn": "Hydrogen",
    "category": "非金属",
    "period": 1,
    "group": 1,
    "atomicWeight": 1.008,
    "etymology": "ラテン語 hydrogenium に由来"
  }
}
```

### Element 型

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
};
```

`GET /elements/:id` では `masteryStatus` を返さない。習得状態が必要な画面は既存 `GET /elements` の任意認証レスポンス、または将来の認証付き詳細 API 拡張で扱う。

## 設計上の決定事項（判断理由つき）

1. **レスポンスは `{ element: Element }` にする**
   - 選択: 単数 endpoint は `element` フィールドで返す。
   - 根拠: 一覧の `{ elements: Element[] }` と責務が明確に分かれ、frontend のレスポンス検証も単純になる。

2. **認証なし endpoint として実装する**
   - 選択: `optionalAuthMiddleware` を使わない。
   - 根拠: `docs/04_api.md` の認証欄が「なし」。詳細表示に個人状態は不要で、公開学習データとして返せる。

3. **`masteryStatus` は返さない**
   - 選択: 詳細 API の `Element` は DB の元素マスター項目のみ。
   - 根拠: ログイン状態に依存しない API とし、既存 `GET /elements` の任意認証仕様と混同させない。

4. **ID validation は route 入口で Zod に集約する**
   - 選択: `backend/src/lib/elements/detail.ts` に `elementIdParamSchema` を置く。
   - 根拠: ルートを薄くし、正規化・範囲検証・エラーメッセージを 1 箇所で管理する。

5. **ID 範囲は既存定数を再利用する**
   - 選択: `ELEMENT_ID_SEARCH_MIN` / `ELEMENT_ID_SEARCH_MAX` を参照する。
   - 根拠: 1〜118 の定義を重複させず、将来の元素範囲変更時の修正漏れを防ぐ。

6. **存在しない元素は 404 にする**
   - 選択: `findUnique()` が `null` の場合 `{ error: "元素が見つかりません" }`。
   - 根拠: ID 形式は正しいがリソースが存在しない状態なので 400 ではなく 404 が妥当。

7. **DB 検索は `findUnique` を使う**
   - 選択: `prisma.element.findUnique({ where: { id } })`。
   - 根拠: `id` は primary key であり、詳細取得の意図に合う。raw SQL は不要。

8. **frontend API client は既存 `elements.ts` に追加する**
   - 選択: `getElements()` と同じファイルに `getElement()` を追加。
   - 根拠: 元素 API の呼び出し口を分散させず、`isElement()` のレスポンス検証を再利用できる。

9. **`isElement()` は公開しない**
   - 選択: ファイル内 helper のまま `isElementResponse()` から再利用する。
   - 根拠: 外部公開面を増やさず、実行時検証ロジックの重複だけを避ける。

10. **既存 `/elements` 画面は変更しない**
    - 選択: 詳細モーダルは一覧データ利用を継続。
    - 根拠: 既存 UI は動作済みで、クリックごとに追加 fetch すると UX とエラー状態が増える。

11. **frontend の `getElement(id)` は認証 token を受け取らない**
    - 選択: options は `signal?: AbortSignal` のみ。
    - 根拠: endpoint が認証なしで、Authorization を送る必要がない。

12. **`getElement()` の network error は既存 `getElements()` と同じく fetch の例外をそのまま投げる**
    - 選択: HTTP エラーのみ `parseErrorResponse` で `ApiError` 化。
    - 根拠: 既存 `getElements()` と挙動を揃え、呼び出し側の期待値を変えない。

## 公開インターフェース案（必要な場合）

### `backend/src/lib/elements/detail.ts`

```ts
import { z } from "zod";

export type ElementIdParam = {
  id: number;
};

export const elementIdParamSchema: z.ZodType<ElementIdParam>;
```

役割:
- path param `id` を受け取る。
- 前後空白を trim した文字列を整数へ変換する。
- 1〜118 の整数でなければ Zod issue を返す。
- route handler には正規化済み `number` だけを渡す。

### `frontend/src/lib/api/elements.ts`

```ts
export type GetElementOptions = {
  signal?: AbortSignal;
};

export async function getElement(id: number, options?: GetElementOptions): Promise<Element>;
```

役割:
- `GET ${API_BASE_URL}/elements/${id}` を呼ぶ。
- HTTP エラーは `parseErrorResponse(response, "元素詳細の取得に失敗しました")` で処理する。
- 200 の JSON が `{ element: Element }` でない場合は `ApiError(500, "元素詳細のレスポンス形式が不正です", data)` を throw する。

## タスクリスト（表）

| タスクID | 何を | どのファイルで | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 進捗を実装中にする | `docs/05_progress.md` | `GET /elements/:id` が `[-]` になり、計画書リンクが付く | 中 |
| T2 | ID param helper の Red テストを書く | `backend/src/lib/elements/detail.test.ts` | valid ID / invalid ID / 範囲外 ID のテストが実装前に失敗する | 高 |
| T3 | ID param helper を実装する | `backend/src/lib/elements/detail.ts` | T2 が Green。ID 範囲定数の重複がない | 高 |
| T4 | 詳細 endpoint の Red テストを書く | `backend/src/routes/elements/element-detail.test.ts` | 200 / 400 / 404 / 500 が実装前に失敗する | 高 |
| T5 | `GET /elements/:id` を実装する | `backend/src/routes/elements/index.ts` | T4 が Green。`findUnique`、404、500、日本語エラーが確認できる | 高 |
| T6 | backend 品質チェックを行う | `backend/` | `npm run lint` / `npm run format:check` / `npm run test -- --run` が通る | 高 |
| T7 | frontend `getElement()` の Red テストを書く | `frontend/src/lib/api/elements.test.ts` | URL / signal / HTTP エラー / 非 JSON エラー / レスポンス形式不正のテストが実装前に失敗する | 高 |
| T8 | frontend `getElement()` を実装する | `frontend/src/lib/api/elements.ts` | T7 が Green。`isElement()` を再利用し、重複検証を増やさない | 高 |
| T9 | frontend 品質チェックを行う | `frontend/` | `npm run lint` / `npm run format` / `npm run check` / `npm run test:run` が通る | 高 |
| T10 | API 仕様書を更新する | `docs/04_api.md` | `GET /elements/:id` の 200 / 400 / 404 / 500 とレスポンス例が記載される | 高 |
| T11 | 手動確認を行う | 手動 | `GET /api/v1/elements/1`、`/119`、`/abc` の結果を確認し記録する | 高 |
| T12 | 完了ドキュメントを更新する | `docs/05_progress.md`, `docs/plans/elements-detail-api/plan.md` | 進捗が `[x]` になり、計画書に実装完了セクションが追記される | 中 |

## タスクリスト（チェックボックス）

- [x] T1: 進捗を実装中にする（`docs/05_progress.md`）
- [x] T2: ID param helper の Red テストを書く（`backend/src/lib/elements/detail.test.ts`）
- [x] T3: ID param helper を実装する（`backend/src/lib/elements/detail.ts`）
- [x] T4: 詳細 endpoint の Red テストを書く（`backend/src/routes/elements/element-detail.test.ts`）
- [x] T5: `GET /elements/:id` を実装する（`backend/src/routes/elements/index.ts`）
- [x] T6: backend 品質チェックを行う（`backend/`）
- [x] T7: frontend `getElement()` の Red テストを書く（`frontend/src/lib/api/elements.test.ts`）
- [x] T8: frontend `getElement()` を実装する（`frontend/src/lib/api/elements.ts`）
- [x] T9: frontend 品質チェックを行う（`frontend/`）
- [x] T10: API 仕様書を更新する（`docs/04_api.md`）
- [x] T11: 手動確認を行う（手動）
- [x] T12: 完了ドキュメントを更新する（`docs/05_progress.md`, `docs/plans/elements-detail-api/plan.md`）

## 技術的注意点

### Backend

- `zValidator("param", elementIdParamSchema, ...)` を route の入口に置く。
- validation 失敗時は既存 `GET /elements` と同じ形式で返す。

```ts
return c.json({ error: "バリデーションエラー", details: result.error.issues }, 400);
```

- `GET "/"` の既存 route は変更を最小にする。
- `GET "/:id"` は `GET "/"` の後に追加して問題ない。
- `findUnique()` に渡す `id` は `c.req.valid("param").id` の正規化済み number のみ。
- `catch` では DB エラー詳細を返さない。
- エラーメッセージは日本語で統一する。
- import path は `.js` 拡張子付きにする。

### Frontend

- `API_BASE_URL` は `$lib/api/config` から import する。
- `getElement()` の fetch options は既存 `getElements()` と同じくローカル型で定義し、lint の `no-undef` を避ける。
- `response.ok` を JSON parse 前に判定する。
- HTTP エラー時は `parseErrorResponse(response, "元素詳細の取得に失敗しました")` を使う。
- 200 レスポンスの JSON は `unknown` として受け、`isElementResponse()` で検証する。
- `isElement()` は既存の実行時検証を再利用する。
- `getElement()` には Authorization ヘッダーを付けない。
- 本タスクでは `/elements/+page.svelte`、`ElementDetailModal.svelte`、`auth.svelte.ts`、`toast.svelte.ts` を変更しない。

### A11Y

- 本タスクは API と client helper 追加が中心で、既存画面の DOM / focus / aria 属性は変更しない。
- そのため既存 `/elements` 画面のカードボタン、詳細モーダル、フォーカストラップ、Escape 閉鎖、スクロールロックは回帰対象として見る。
- 将来 `/elements/[id]` 詳細ページを作る場合は、ページタイトル、`h1`、戻る導線、読み込み中の `aria-busy`、404 時の見出しと復帰リンクを必須にする。
- 将来モーダルを `getElement()` 呼び出しへ置換する場合は、クリック後の loading/error 状態、フォーカス維持、`aria-live` によるエラー通知、再試行ボタンを別計画で設計する。

### DB・負荷

- `Element.id` は primary key なので `findUnique({ where: { id } })` は軽量。
- 1 リクエスト 1 クエリで、`GameSession` / `GameAnswer` の集計は行わない。
- 一覧 endpoint のような `findMany` や `masteryStatus` map 生成より負荷は小さい。
- 404 判定も `findUnique` 1 回で完結する。
- DB スキーマ・index 変更は不要。

### Docs

- `docs/04_api.md` の既存 `GET /elements/:id` 行に詳細仕様を追加する。
- `docs/05_progress.md` は実装開始時 `[-]`、完了時 `[x]` に更新する。
- 実装完了時は本計画書の「対象ファイル一覧」と実変更ファイルの差分を確認し、`## 実装完了` を追記する。

## テストケース一覧

| 種別 | ケース | 期待結果 |
|---|---|---|
| backend helper | `id = "1"` | `{ id: 1 }` に正規化される |
| backend helper | `id = "118"` | `{ id: 118 }` に正規化される |
| backend helper | `id = "0"` | validation 失敗 |
| backend helper | `id = "119"` | validation 失敗 |
| backend helper | `id = "1.5"` | validation 失敗 |
| backend helper | `id = "abc"` | validation 失敗 |
| backend route | `GET /elements/1` | 200 `{ element }` を返す |
| backend route | `GET /elements/1` | `prisma.element.findUnique({ where: { id: 1 } })` が呼ばれる |
| backend route | `GET /elements/119` | 400。DB を参照しない |
| backend route | `GET /elements/abc` | 400。DB を参照しない |
| backend route | `GET /elements/118` で DB が null | 404 `{ error: "元素が見つかりません" }` |
| backend route | Prisma が throw | 500 `{ error: "サーバーエラーが発生しました" }` |
| backend route | Authorization なし | 200。認証不要で取得できる |
| backend route | Authorization あり | 認証処理は行わず、`masteryStatus` なしの 200 を返す |
| frontend API | `getElement(1)` | `${API_BASE_URL}/elements/1` に GET する |
| frontend API | `getElement(1, { signal })` | fetch option に signal が渡る |
| frontend API | 200 `{ element: VALID_ELEMENT }` | `Element` を返す |
| frontend API | 404 `{ error: "元素が見つかりません" }` | `ApiError(404, "元素が見つかりません")` を throw |
| frontend API | 502 非 JSON | default message `元素詳細の取得に失敗しました` の `ApiError` を throw |
| frontend API | 200 だが `element` 欠損 | `ApiError(500, "元素詳細のレスポンス形式が不正です")` を throw |
| frontend API | 200 だが必須フィールド欠損 | `ApiError(500, "元素詳細のレスポンス形式が不正です")` を throw |
| frontend API | fetch reject | 既存 `getElements()` と同様に元の例外を throw |

## 実装リスクと回避策

| リスク | 影響 | 回避策 |
|---|---|---|
| ID 範囲 1〜118 を複数箇所で定義してズレる | 検索と詳細で valid ID が不一致になる | 既存 `ELEMENT_ID_SEARCH_MIN/MAX` を再利用する |
| `GET /elements/:id` に `optionalAuthMiddleware` を付けてしまう | 不正 token で 401 になり、認証なし仕様と矛盾する | route に認証 middleware を付けない。テストで Authorization なし 200 を固定する |
| 404 と 400 が混ざる | frontend のハンドリング・docs と不整合になる | path param validation 失敗は 400、`findUnique()` null は 404 に分ける |
| レスポンス形式を `{ elements: [element] }` にしてしまう | 単数取得 API として使いにくい | `{ element }` に固定し、docs と tests で明示する |
| frontend で JSON parse を先に行う | 502/504 非 JSON で意図しない例外になる | `response.ok` 判定後に `parseErrorResponse`、正常時だけ `response.json()` |
| `isElement()` をコピーして重複する | 一覧と詳細で検証条件がズレる | `frontend/src/lib/api/elements.ts` 内の既存 helper を再利用する |
| 既存 `/elements` ページに余計な fetch を追加する | モーダル表示が遅くなり、エラー状態が増える | 本タスクではページ・モーダルを変更しない |
| docs 更新漏れ | 実装者・レビュアーが仕様を追えない | T10 / T12 で `docs/04_api.md`、`docs/05_progress.md`、本計画書を更新する |

## 実装完了

- 完了日: 2026-06-06
- 実装ブランチ: feature/elements-detail-api
- PR: #45

### 計画からの変更点

- `getElement()` の HTTP エラーテストは、同じ `Response` body を複数回読まないよう、1 回の呼び出しで `status` と `message` を検証する形に調整した。
- 画面 DOM の変更は行っていないため、A11Y は既存 `/elements` 画面の回帰確認対象として扱った。

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/lib/elements/detail.ts` | 新規 | `GET /elements/:id` の path param schema と ID 正規化を追加 |
| `backend/src/lib/elements/detail.test.ts` | 新規 | ID param の正規化・範囲検証テストを追加 |
| `backend/src/routes/elements/index.ts` | 修正 | `GET /:id` を追加し、findUnique / 404 / 500 を実装 |
| `backend/src/routes/elements/element-detail.test.ts` | 新規 | `GET /elements/:id` の route テストを追加 |
| `frontend/src/lib/api/elements.ts` | 修正 | `getElement(id, options?)` と単数レスポンス検証を追加 |
| `frontend/src/lib/api/elements.test.ts` | 修正 | `getElement()` の URL、AbortSignal、HTTP エラー、形式不正テストを追加 |
| `docs/04_api.md` | 修正 | `GET /elements/:id` の詳細仕様・ステータスコード・レスポンス例を追記 |
| `docs/05_progress.md` | 修正 | `GET /elements/:id` を完了に更新 |
| `docs/plans/elements-detail-api/plan.md` | 修正 | タスクリスト完了化と実装完了セクションを追記 |

### 確認結果

| 確認 | 結果 |
|---|---|
| Red: `backend/src/lib/elements/detail.test.ts` | 実装前に `detail.js` 未存在で失敗 |
| Red: `backend/src/routes/elements/element-detail.test.ts` | 実装前に 404 で失敗 |
| Green: backend 対象テスト | `detail.test.ts` 4 tests、`element-detail.test.ts` 6 tests、既存 `elements.test.ts` 9 tests passed |
| Red: `frontend/src/lib/api/elements.test.ts` | 実装前に `getElement is not a function` で失敗 |
| Green: frontend 対象テスト | `elements.test.ts` 25 tests passed |
| backend lint | `npm run lint` passed |
| backend format check | `npm run format:check` passed |
| backend test | `npm run test -- --run` 19 files / 149 tests passed |
| frontend lint | `npm run lint` passed |
| frontend check | `npm run check` 0 errors / 0 warnings |
| frontend test | `npm run test:run` 11 files / 142 tests passed |
| 手動確認: `GET /api/v1/elements/1` | 200 OK / `{ element: ... }` |
| 手動確認: `GET /api/v1/elements/119` | 400 Bad Request / バリデーションエラー |
| 手動確認: `GET /api/v1/elements/abc` | 400 Bad Request / バリデーションエラー |
| DB 変更 | なし。migration / Prisma generate 不要 |
