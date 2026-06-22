# GET /game/sessions（ゲーム履歴一覧）実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、API 契約設計、状態復元、A11Y レビュー）
> 対象実装者: Codex

## 概要

`docs/05_progress.md` フェーズ7の `GET /game/sessions（ゲーム履歴一覧）` を実装する。保存済み `GameSession` をログインユーザー本人に限定して新しい順に取得する backend API を追加し、frontend では API client と `/mypage` のゲーム履歴セクションから履歴一覧を表示できるようにする。

主対象はゲーム履歴一覧であり、個別結果詳細 `GET /game/sessions/:sessionId` と `/game/result?sessionId=...` の復元は既存実装を再利用する。`/mypage` 全体の統計グラフやランキング表示はフェーズ8の別タスクとして残す。

## レビュー結果と改善方針

| 観点 | レビュー結果 | 改善方針 |
|---|---|---|
| 依頼内容整合性 | 元依頼には `{{機能名}}`, `{{planディレクトリ名}}`, `{{API一覧}}`, 画面ルート例など未置換プレースホルダーが残っていた | 主対象は進捗表に実在する `GET /game/sessions（ゲーム履歴一覧）` に固定する。計画書パスは `docs/plans/game-session-history/plan.md` とする |
| 既存計画との整合性 | `docs/plans/{{planディレクトリ名}}/plan.md` は実在しない。類似計画 `game-result-session-restore` は詳細復元で、履歴一覧はスコープ外 | 新規計画として作成し、詳細取得計画との責務境界を明記する |
| 既存コードとの整合性 | `POST /game/sessions` と `GET /game/sessions/:sessionId` は実装済み。`GET /game/sessions` route と service は未実装 | 既存 `gameRouter`, `game.service.ts`, `frontend/src/lib/api/game.ts` の命名・エラー処理・runtime validation に合わせて追加する |
| 仕様 | `docs/04_api.md` には一覧エンドポイント名だけあり、query / response / error が未定義 | `limit`, `cursor`, `mode` を持つ cursor pagination の仕様を追加する。response は summary のみにする |
| A11Y | 履歴一覧では loading / empty / error / retry / unauthenticated の状態が必要 | 画面内 status を主表示にし、`aria-busy`, `aria-live`, `role="alert"` を使う。toast は追加読み込み失敗など補助通知に限定する |
| DB 整合性 | `GameSession` に `@@index([userId, playedAt, id])` があり、履歴一覧向け index は既に存在する | DB schema / migration は不要。`select` で summary フィールドのみ取得し、`answers` は include しない |
| DB 負荷 | 回答詳細まで include すると履歴一覧のたびに `GameAnswer` が増幅する。offset pagination は履歴増加時に重くなる | `take: limit + 1`, 最大50件、cursor lookup 1回、summary select のみで負荷を抑える |
| テスト | route だけでは userId 絞り込み、cursor、空状態、非 JSON frontend error が漏れる | backend service / route、frontend API client / helper、UI 状態、手動確認を分けてテストする |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- フェーズ7: `GET /game/sessions（ゲーム履歴一覧）` は未実装。
- フェーズ7: `GET /game/sessions/:sessionId（ゲーム結果詳細取得・/game/result 再読み込み復元）` は完了済み。
- フェーズ8: `/mypage` は未実装。今回作る場合はゲーム履歴セクションに限定し、統計グラフは後続タスクへ残す。

**`docs/04_api.md`**
- `GET /game/sessions` はゲーム API の一覧に存在するが、詳細仕様は未定義。
- ゲーム API は認証必須。
- エラー形式は `{ "error": "メッセージ文字列" }`。バリデーションエラー時は `details` を含める。

**`backend/prisma/schema.prisma`**
- `GameSession`: `id`, `userId`, `mode`, `totalScore`, `correctCount`, `totalCount`, `maxStreak`, `durationSec`, `playedAt`。
- `GameSession` には `@@index([userId, playedAt, id])` がある。
- `GameAnswer` は詳細表示用で、一覧 API では参照しない。

**`backend/src/routes/game/index.ts`**
- `gameRouter.get("/questions", ...)`。
- `gameRouter.get("/sessions/:sessionId", ...)`。
- `gameRouter.post("/sessions", ...)`。
- `authMiddleware` と `rateLimit()` の利用パターン。
- `zValidator()` 失敗時は `{ error: "バリデーションエラー", details: result.error.issues }`。
- 500 は `{ error: "サーバーエラーが発生しました" }`。

**`backend/src/services/game.service.ts`**
- `getGameSessionResult({ userId, sessionId }): Promise<SubmitGameSessionResult>`。
- `SubmitGameSessionResult`。
- `GameSessionNotFoundError`。
- `GameMode` は Prisma enum。

**`backend/src/types/index.ts`**
- `AppVariables`。
- `AuthUser`。
- `JwtPayload`。

**`backend/src/lib/prisma.ts`**
- Prisma v7 の `PrismaPg` adapter 付き singleton。

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL: string`。
- API ベース URL はここから import し、各ファイルで再定義しない。

**`frontend/src/lib/api/errors.ts`**
- `ApiError`。
- `parseErrorBody(response)`。
- `parseErrorResponse(response, defaultMessage?)`。
- `response.ok` を JSON parse 前に確認する既存方針。

**`frontend/src/lib/api/game.ts`**
- `getGameQuestions(options): Promise<GameQuestionsResponse>`。
- `submitGameSession(options): Promise<GameSessionResponse>`。
- `getGameSession(options): Promise<GameSessionResponse>`。
- `API_BASE_URL`, `ApiError`, `parseErrorResponse` を利用。
- `isGameMode()` / `isGameSessionResponse()` による runtime validation。

**`frontend/src/lib/game/types.ts`**
- `GameMode`。
- `GameSessionResponse`。
- `GameSessionResultItem`。

**`frontend/src/lib/game/modes.ts`**
- `GAME_MODE_CONFIGS`。
- `getGameModeConfig(mode)`。
- `GameMode` ごとの表示ラベル。

**`frontend/src/lib/stores/auth.svelte.ts`**
- `authStore.user`。
- `authStore.accessToken`。
- `authStore.isLoggedIn`。
- `authStore.isInitializing`。

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.error(message)`。
- `toastStore.fromApiError(error)`。

**`frontend/src/routes/(app)/game/result/+page.svelte`**
- `/game/result?sessionId=...` で詳細を表示・復元する。

### 重要な制約

- `GET /game/sessions` は認証必須。
- 他ユーザーの履歴は返さない。必ず `userId` で絞る。
- 一覧 API は回答詳細 `results` を返さない。詳細表示は既存 `GET /game/sessions/:sessionId` と `/game/result?sessionId=...` を使う。
- backend のエラーメッセージは日本語に統一する。
- API client は `frontend/src/lib/api/config.ts` と `frontend/src/lib/api/errors.ts` を使い、API base URL やエラー処理を重複定義しない。
- URL query、UI local state、API response の責務を分ける。
- `limit`, `cursor`, `mode` の正規化値は一度だけ計算して再利用する。
- DB schema 変更は予定しない。`schema.prisma` または migration を変更した場合のみ migration / Prisma / Playwright 追加確認を行う。
- 実装コードは Prettier `tabWidth: 2`、ESM import `.js` 拡張子を守る。

### 確認事項

- 元依頼の機能名・計画書ディレクトリ名・画面ルート・関連 API・要件・制約は未置換だったため、主対象を `GET /game/sessions（ゲーム履歴一覧）` として確定した。
- 画面ルートは `/mypage` を採用する。ただしこのタスクではゲーム履歴セクションだけを作り、正答率グラフ・サマリーカード全体はフェーズ8の「マイページ・統計画面」タスクへ残す。
- `docs/prs/*.md` にゲーム履歴一覧に直接関係する PR メモは見当たらない。
- `docs/04_api.md` は `GET /game/sessions` の詳細仕様が未定義のため、実装時に更新する。

## 対象ファイル一覧（変更種別つき）

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/services/game.service.ts` | 修正 | ゲーム履歴一覧取得 service、型、cursor validation error を追加 |
| `backend/src/routes/game/index.ts` | 修正 | `GET /sessions` route、query validation、認証、read 用 rate limit、error mapping を追加 |
| `backend/src/routes/game/session-history.test.ts` | 新規 | `GET /game/sessions` route テスト |
| `backend/src/services/game.service.test.ts` | 修正 | 履歴一覧 service テスト追加 |
| `frontend/src/lib/game/types.ts` | 修正 | 履歴一覧 summary / response / query 型を追加 |
| `frontend/src/lib/game/session-history.ts` | 新規 | query 正規化、表示 helper、next cursor helper |
| `frontend/src/lib/game/session-history.test.ts` | 新規 | 空文字・不正値・mode・limit・cursor 正規化テスト |
| `frontend/src/lib/api/game.ts` | 修正 | `getGameSessions()` API client と runtime validation を追加 |
| `frontend/src/lib/api/game.test.ts` | 修正 | 履歴一覧 API client テスト追加 |
| `frontend/src/routes/(app)/mypage/+page.ts` | 新規 | `ssr = true`, `prerender = false` を明示 |
| `frontend/src/routes/(app)/mypage/+page.svelte` | 新規 | ゲーム履歴一覧セクション、状態表示、詳細リンク、追加読み込み |
| `docs/04_api.md` | 修正 | `GET /game/sessions` の query / response / error を追加 |
| `docs/05_progress.md` | 修正 | 該当タスクに計画書リンク、実装中・完了マークを反映 |
| `docs/plans/game-session-history/plan.md` | 新規 | 本計画。実装完了時に実態へ更新 |

## API 仕様（この機能で使う範囲のみ）

### エラーレスポンス共通形式

```json
{ "error": "メッセージ文字列" }
```

バリデーションエラー時:

```json
{
  "error": "バリデーションエラー",
  "details": [{ "message": "取得件数が正しくありません" }]
}
```

### GET `/api/v1/game/sessions`

| 項目 | 内容 |
|---|---|
| 認証 | 必須。`Authorization: Bearer <accessToken>` |
| 成功 | 200 |
| 用途 | ログインユーザー本人のゲーム履歴一覧を新しい順に取得する |
| 副作用 | なし |
| rate limit | read 用 rate limit を適用。POST より緩く、過剰取得は抑える |
| 詳細取得 | 各 item の `sessionId` から `/game/result?sessionId=...` へ遷移する |

#### Query params

| パラメータ | 型 | 検証 | 既定値 |
|---|---|---|---|
| `limit` | number | 1〜50 の整数 | 20 |
| `cursor` | string | trim 後に空文字不可。前回レスポンスの `nextCursor` | なし |
| `mode` | `GameMode` | 6種類の enum のみ。未指定なら全モード | なし |

未知 query key は無視する。既知 query の値だけを Zod で検証する。

#### Pagination

- 並び順は `playedAt desc`, `id desc`。
- `take: limit + 1` で取得し、余剰1件がある場合だけ `nextCursor` を返す。
- `nextCursor` は最後に表示した session の `sessionId`。
- `cursor` 指定時は、まず `userId + cursor` で cursor session を `select: { id, playedAt }` 取得する。
- cursor session が存在しない、または他ユーザー所有の場合は 400 `{ "error": "バリデーションエラー", "details": [...] }` とする。
- cursor session 取得後、次の条件で続きのみ取得する。
  - `playedAt < cursor.playedAt`
  - または `playedAt = cursor.playedAt AND id < cursor.id`

#### Response 200

```json
{
  "sessions": [
    {
      "sessionId": "clx_game_session_id",
      "mode": "SYMBOL_TO_NAME_LV1",
      "correctCount": 8,
      "totalCount": 10,
      "totalScore": 800,
      "maxStreak": 5,
      "durationSec": 72,
      "playedAt": "2026-06-20T12:35:00.000Z"
    }
  ],
  "nextCursor": "clx_next_session_id"
}
```

`nextCursor` は次ページがない場合 `null`。

#### Error

| ステータス | 条件 | body |
|---|---|---|
| 400 | `limit` / `cursor` / `mode` が不正 | `{ "error": "バリデーションエラー", "details": [...] }` |
| 401 | 未ログイン・token 不正・ユーザーなし | 既存 auth middleware の日本語エラー |
| 403 | 停止・メール未確認・ロック中 | 既存 auth middleware の日本語エラー |
| 429 | レート制限 | 既存 rateLimit の日本語エラー |
| 500 | 想定外エラー | `{ "error": "サーバーエラーが発生しました" }` |

## 設計上の決定事項（判断理由つき）

1. **状態の source of truth**
   - 選択: 履歴一覧の表示内容は `GET /game/sessions` の response を source of truth にする。
   - 根拠: 履歴は保存済み DB データであり、frontend 側で再計算・永続化する必要がない。

2. **URL query の責務**
   - 選択: `mode`, `cursor`, `limit` の復元にだけ使う。取得済み `sessions` 本体は URL に持たない。
   - 根拠: reload / 戻る操作で一覧条件を復元しつつ、表示データは API と同期できる。

3. **初期表示時の復元元**
   - 選択: `authStore.isInitializing` 完了後、URL query を正規化して API fetch する。
   - 根拠: 初期化中に未ログイン扱いすると表示フリッカーが出るため。

4. **ユーザー入力の反映タイミング**
   - 選択: mode filter は select 変更時に即時反映、ページングは「さらに表示」ボタンで反映する。
   - 根拠: 検索文字入力がないため debounce は不要。ページングはユーザー操作を明確にできる。

5. **API パラメータの組み立て層**
   - 選択: `frontend/src/lib/game/session-history.ts` で query を正規化し、`frontend/src/lib/api/game.ts` が URLSearchParams を組み立てる。
   - 根拠: UI コンポーネントに API 仕様や trim ルールを埋め込まない。

6. **正規化済み値の保持**
   - 選択: page component の effect 先頭で正規化済み query object を一度だけ作り、validation / fetch / URL 更新に再利用する。
   - 根拠: `trim()` や数値変換のズレを防ぐ。

7. **エラー表示**
   - 選択: 初回取得失敗は画面内表示 + 再試行ボタン、追加読み込み失敗は画面内表示 + toast を併用する。
   - 根拠: 履歴一覧全体が見えないエラーは画面内の永続表示が必要。追加読み込みは既存一覧を残しつつ通知する。

8. **既存コンポーネント再利用**
   - 選択: `getGameModeConfig()` を再利用し、履歴カードは `/mypage` 内の小さな markup から始める。
   - 根拠: 既存 `GameModeCard` は開始導線用で履歴 summary とは責務が違う。

9. **詳細遷移**
   - 選択: 履歴 item は `/game/result?sessionId={sessionId}` に遷移する。
   - 根拠: 既存結果復元 API と画面を再利用できる。

10. **reload / 戻る / 直接アクセス**
    - 選択: URL query から条件を復元し、API を再取得する。store には履歴一覧を保存しない。
    - 根拠: 一覧は軽量 summary で、store 永続化より API 再取得の方が整合性が高い。

11. **pagination 方式**
    - 選択: offset ではなく cursor pagination を使う。
    - 根拠: 履歴件数が増えても後方ページ取得の負荷を抑えられ、`@@index([userId, playedAt, id])` を活かせる。

## 公開インターフェース案（必要な場合）

```ts
// backend/src/services/game.service.ts
export type GameSessionHistoryItem = {
  sessionId: string;
  mode: GameMode;
  correctCount: number;
  totalCount: number;
  totalScore: number;
  maxStreak: number;
  durationSec: number;
  playedAt: Date;
};

export type GetGameSessionHistoryParams = {
  userId: string;
  limit: number;
  cursor?: string;
  mode?: GameMode;
};

export type GetGameSessionHistoryResult = {
  sessions: GameSessionHistoryItem[];
  nextCursor: string | null;
};

export class GameSessionHistoryCursorError extends Error {
  constructor();
}

export function getGameSessionHistory(
  params: GetGameSessionHistoryParams
): Promise<GetGameSessionHistoryResult>;
```

```ts
// frontend/src/lib/game/types.ts
export type GameSessionHistoryItem = {
  sessionId: string;
  mode: GameMode;
  correctCount: number;
  totalCount: number;
  totalScore: number;
  maxStreak: number;
  durationSec: number;
  playedAt: string;
};

export type GameSessionsResponse = {
  sessions: readonly GameSessionHistoryItem[];
  nextCursor: string | null;
};
```

```ts
// frontend/src/lib/api/game.ts
export type GetGameSessionsOptions = {
  accessToken: string;
  limit?: number;
  cursor?: string | null;
  mode?: GameMode | null;
  signal?: AbortSignal;
};

export function getGameSessions(options: GetGameSessionsOptions): Promise<GameSessionsResponse>;
```

## タスクリスト（進捗管理）

| タスクID | 内容 | ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存仕様・既存実装の最終確認 | `docs/04_api.md`, `docs/05_progress.md`, game 関連ファイル | 未置換プレースホルダー、画面ルート、既存 API との差分が plan に反映済み | 高 |
| T2 | backend 履歴一覧 service 型と取得処理を追加 | `backend/src/services/game.service.ts` | userId 絞り込み、新着順、limit+1、cursor、mode filter、nextCursor を実装 | 高 |
| T3 | backend route と query validation を追加 | `backend/src/routes/game/index.ts` | `GET /sessions` が `/sessions/:sessionId` と衝突せず、400/401/403/429/500 が日本語で返る | 高 |
| T4 | backend route / service テストを追加 | `backend/src/routes/game/session-history.test.ts`, `backend/src/services/game.service.test.ts` | 正常系、未認証、validation、空状態、cursor、他ユーザー除外を検証 | 高 |
| T5 | frontend 型定義と query helper を追加 | `frontend/src/lib/game/types.ts`, `frontend/src/lib/game/session-history.ts` | response 型、query 正規化、表示 helper が UI から再利用可能 | 高 |
| T6 | frontend API client を追加 | `frontend/src/lib/api/game.ts` | `getGameSessions()` が Authorization、credentials、signal、非 JSON エラー、runtime validation に対応 | 高 |
| T7 | frontend API / helper テストを追加 | `frontend/src/lib/api/game.test.ts`, `frontend/src/lib/game/session-history.test.ts` | URL、空 query 省略、mode/limit/cursor、API エラー、レスポンス不正を検証 | 高 |
| T8 | `/mypage` のゲーム履歴セクションを実装 | `frontend/src/routes/(app)/mypage/+page.svelte`, `+page.ts` | 初期表示、履歴カード、詳細リンク、mode filter、さらに表示が動作 | 高 |
| T9 | loading / empty / error / retry / unauthenticated 状態を実装 | `frontend/src/routes/(app)/mypage/+page.svelte` | 初期化中、未ログイン、空履歴、取得失敗、追加取得失敗、再試行導線を表示 | 高 |
| T10 | reload / 戻る操作 / URL query 復元を実装 | `frontend/src/routes/(app)/mypage/+page.svelte` | `mode`, `cursor`, `limit` が reload 後に復元され、二重取得を防ぐ | 中 |
| T11 | `docs/04_api.md` 更新要否確認と更新 | `docs/04_api.md` | `GET /game/sessions` の詳細仕様が実装と一致 | 高 |
| T12 | 品質チェック実行 | backend / frontend | lint、format、test、frontend check が通過 | 高 |
| T13 | 手動確認 | ブラウザ / API | ログイン後の履歴一覧、空状態、詳細遷移、未ログイン、API エラー時の表示を確認 | 高 |
| T14 | 実装完了更新 | `docs/05_progress.md`, `docs/plans/game-session-history/plan.md` | チェックボックス、対象ファイル一覧、実装完了セクションが実態と一致 | 高 |

- [ ] T1: 既存仕様・既存実装の最終確認（`docs/04_api.md`, `docs/05_progress.md`, game 関連ファイル）
- [ ] T2: backend 履歴一覧 service 型と取得処理を追加（`backend/src/services/game.service.ts`）
- [ ] T3: backend route と query validation を追加（`backend/src/routes/game/index.ts`）
- [ ] T4: backend route / service テストを追加（`backend/src/routes/game/session-history.test.ts`, `backend/src/services/game.service.test.ts`）
- [ ] T5: frontend 型定義と query helper を追加（`frontend/src/lib/game/types.ts`, `frontend/src/lib/game/session-history.ts`）
- [ ] T6: frontend API client を追加（`frontend/src/lib/api/game.ts`）
- [ ] T7: frontend API / helper テストを追加（`frontend/src/lib/api/game.test.ts`, `frontend/src/lib/game/session-history.test.ts`）
- [ ] T8: `/mypage` のゲーム履歴セクションを実装（`frontend/src/routes/(app)/mypage/+page.svelte`, `+page.ts`）
- [ ] T9: loading / empty / error / retry / unauthenticated 状態を実装（`frontend/src/routes/(app)/mypage/+page.svelte`）
- [ ] T10: reload / 戻る操作 / URL query 復元を実装（`frontend/src/routes/(app)/mypage/+page.svelte`）
- [ ] T11: `docs/04_api.md` 更新要否確認と更新
- [ ] T12: lint / format / test / frontend check
- [ ] T13: 手動確認
- [ ] T14: `docs/05_progress.md` と plan.md の実装完了更新

## 技術的注意点

- `GET /sessions` は exact path、`GET /sessions/:sessionId` は param path として分かれる。可読性のため route は一覧、詳細、作成の順で近くに置く。
- query validation は route 入口で Zod を使う。
- `limit` は `Number` 変換後に 1〜50 の整数だけ許可する。空文字は未指定扱い。
- cursor は session id として扱う。frontend helper は trim 後の空文字を null に正規化して API へ送らない。backend は direct API で空文字 cursor が送られた場合に 400 とする。
- Prisma は `where: { userId, ...(mode ? { mode } : {}) }` で必ずユーザー本人に限定する。
- cursor session 取得も `where: { id: cursor, userId }` にする。
- 一覧 API では `answers` を include しない。
- frontend は `response.ok` を JSON parse 前にチェックし、`parseErrorResponse()` を使う。
- 非 JSON エラー時は `ゲーム履歴の取得に失敗しました` を fallback にする。
- API response runtime validation では `sessions` 配列と `nextCursor: string | null` を厳密に確認する。
- UI は API response の `playedAt` を `Intl.DateTimeFormat("ja-JP", ...)` で表示し、無効 date は元文字列を fallback 表示する。
- API 仕様やステータスコードが変わった場合は `docs/04_api.md` を必ず更新する。
- DB 変更は予定しない。変更した場合は `npx prisma migrate deploy` と Playwright 確認を追加する。

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| backend route: 未認証 | 401 `{ "error": "認証が必要です" }`、service は呼ばれない |
| backend route: query 不正 | 400 `{ "error": "バリデーションエラー", "details": [...] }` |
| backend route: 正常系 | 200。`playedAt` は ISO string に変換される |
| backend route: cursor 不正 | 400。日本語エラーで返る |
| backend route: service 例外 | 500 `{ "error": "サーバーエラーが発生しました" }` |
| backend service: 履歴あり | userId で絞り、新しい順、summary fields のみ返す |
| backend service: 空状態 | `{ sessions: [], nextCursor: null }` |
| backend service: limit+1 | 余剰1件があると `nextCursor` を返し、返却 `sessions` は limit 件 |
| backend service: cursor | cursor session より古い履歴だけ返す |
| backend service: mode filter | 指定 mode の履歴だけ返す |
| backend service: 他ユーザー除外 | 他ユーザーの session は返さず、他ユーザー cursor も 400 |
| frontend API: 正常系 | URL query と Authorization を付けて `GameSessionsResponse` を返す |
| frontend API: 空 query | `mode`, `cursor` が null / undefined / 空文字なら URL から省略される |
| frontend API: API エラー JSON | backend の日本語 `error` を `ApiError.message` に保持する |
| frontend API: 非 JSON エラー | fallback `ゲーム履歴の取得に失敗しました` を使う |
| frontend API: レスポンス不正 | `ApiError(500, "ゲーム履歴のレスポンス形式が不正です")` を throw |
| helper: limit 正規化 | 空文字は既定値、範囲外・小数・非数値は不正として扱う |
| helper: cursor 正規化 | trim 済み値を一度だけ使い、空文字は null に正規化して API query から省略する |
| helper: mode 正規化 | `GAME_MODE_CONFIGS` に存在する値のみ採用 |
| UI: 初期表示ログイン確認中 | API を呼ばず、確認中表示になる |
| UI: ログイン済み | `GET /game/sessions?limit=20` を呼び、履歴が新しい順に表示される |
| UI: 履歴あり | mode label、スコア、正解数、正答率、最大連続正解、プレイ日時、詳細リンクが表示される |
| UI: 追加読み込み | loading 中は二重クリックで二重取得しない |
| UI: 空状態 | 履歴がない旨とゲーム開始導線を表示する |
| UI: 未ログイン | API を呼ばず、ログイン導線を表示する |
| UI: URL query reload | `?mode=SYMBOL_TO_NAME_LV1&limit=10` で reload して同条件で取得する |
| UI: 戻る操作 | filter 変更後に browser back で前の query 条件へ戻り、再取得される |
| A11Y | loading は `aria-busy`、エラーは `role="alert"`、状態変化は `aria-live` で通知される |
| 詳細遷移 | 履歴 item から `/game/result?sessionId=...` へ遷移し、既存詳細画面で復元できる |

## 実装リスクと回避策

| リスク | 回避策 |
|---|---|
| 一覧 route と詳細 route の仕様が混ざる | 一覧は summary のみ、詳細は results ありと明記し、型も分ける |
| cursor pagination が不安定 | `playedAt desc, id desc` で order を固定し、cursor session を lookup して比較条件を作る |
| DB 負荷が高くなる | `answers` を include せず、summary `select` のみ、limit 最大50、cursor pagination にする |
| `/mypage` の全体スコープが膨らむ | このタスクではゲーム履歴セクションだけ。統計グラフ・サマリーカードは別タスクに残す |
| API エラー文言を上書きする | `parseErrorResponse()` を使い、backend の `error` / `details[0].message` を優先する |
| DB migration 不要なのに schema を触る | `GameSession` 既存 index を利用し、schema 変更が必要か T1 で再確認する |

## 手動確認項目

| 項目 | 手順 | 期待結果 |
|---|---|---|
| ログイン後履歴表示 | ログインして `/mypage` へ移動 | 履歴一覧が表示される |
| 空状態 | 履歴のないユーザーで表示 | 空状態とゲーム開始導線が表示される |
| 詳細遷移 | 履歴 item をクリック | `/game/result?sessionId=...` で詳細が表示される |
| mode filter | モードを選択 | URL query と一覧が更新される |
| reload | query 付き URL を再読み込み | 同じ条件で再取得される |
| 戻る操作 | filter 変更後に戻る | 前の条件と一覧に戻る |
| API エラー | backend 停止または fetch mock で 502 相当 | 非 JSON fallback と再試行導線が表示される |
| 未ログイン | logout 後に直接アクセス | API を呼ばずログイン導線が表示される |
| レスポンシブ | PC / mobile 幅で確認 | テキストがはみ出さず、履歴カードが読みやすい |
| A11Y | keyboard 操作 | filter、さらに表示、詳細リンク、再試行が keyboard で操作できる |

## 実装完了時の更新ルール

実装完了時は以下を必ず確認して plan.md を更新する。

- [ ] 対象ファイル一覧が実際の変更ファイルと一致している
- [ ] 変更種別（新規 / 修正 / 削除）が実態と一致している
- [ ] 完了したタスクに `- [x]` が付いている
- [ ] 設計から変更した判断が `## 実装完了` に記録されている
- [ ] `docs/04_api.md` の `GET /game/sessions` 仕様が実装と一致している
- [ ] `docs/05_progress.md` の `GET /game/sessions（ゲーム履歴一覧）` が完了へ更新されている
- [ ] lint / format / test / 手動確認結果が実装報告に含まれている

実装完了セクションのテンプレート:

```markdown
## 実装完了
- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/xxx
- PR: #N

### 計画からの変更点
- `frontend/src/routes/(app)/mypage/+page.svelte` ではなく別ルートにした、など

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/services/game.service.ts` | 修正 | ゲーム履歴一覧取得 service を追加 |
```
