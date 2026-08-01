# ゲーム結果画面セッション復元 実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、API 契約設計、状態復元、A11Y レビュー）
> 対象実装者: Codex

## 概要

`/game/result` は現在 `POST /game/sessions` のレスポンスを同一タブ内の一時 store から表示しているため、再読み込み・直接アクセス・別タブ復元では結果を表示できない。本計画では保存済み `GameSession` から結果詳細を取得する `GET /game/sessions/:sessionId` を追加し、`/game/result?sessionId=...` が store 空状態でも API から復元できるようにする。

主対象は `/game/result` の結果復元であり、ゲーム履歴一覧 UI や `GET /game/sessions` 一覧 API はこの計画では実装しない。

### レビュー結果と改善方針

| 観点 | レビュー結果 | 改善方針 |
|---|---|---|
| 依頼内容整合性 | 依頼テンプレートに `{{機能名}}` など未置換プレースホルダーが残っていた | 直前文脈の「`/game/result` reload / store 空状態の復元」を主対象に固定し、確認事項に明記する |
| 既存コード整合性 | `/game/result` は `gameSessionResultStore.matches(sessionId, userId)` が true の場合だけ表示できる。`/game/play` 直後遷移は動くが reload で消える | store を高速パスとして残し、store miss 時だけ `GET /game/sessions/:sessionId` で復元する |
| 仕様整合性 | `docs/04_api.md` には `GET /game/sessions` 履歴一覧のみあり、単一結果詳細 API は未定義 | `/game/result` 復元用途として `GET /game/sessions/:sessionId` を新設する。履歴一覧とは契約を分ける |
| DB 整合性 | 現在の `GameAnswer` は `questionId`, `prompt`, `chosenChoiceId`, `correctAnswer`, `yourAnswer`, `score`, 表示順を保持していないため、保存済み行から結果画面を完全復元できない | `GameAnswer` に表示復元用の nullable カラムを追加し、今後作成される回答では必ず保存する。既存行は fallback 表示に留める |
| DB 負荷 | 復元時に回答ごとに元素を個別取得すると N+1 になりやすい | `GameSession.findFirst({ include: { answers: { include: { element: true } } } })` の 1 query で取得し、`@@index([sessionId, questionIndex])` で並び替えを軽くする |
| セキュリティ | URL の `sessionId` を直接指定できるため、所有者チェックを誤ると他ユーザーの結果が漏れる | `sessionId` と `userId` の両方で検索し、存在しない・他ユーザー所有はいずれも 404 にする |
| A11Y | 現状の store 空状態は即時エラー表示のみで、取得中・再試行・未ログインの区別がない | `authStore.isInitializing`、取得中、取得失敗、404、未ログイン、sessionId なしを画面内状態として分け、`aria-busy` / `aria-live` を使う |
| テスト | 現在は `submitGameSession()` と result store のテストが中心 | backend service / route、frontend API client、sessionId 正規化 helper、結果画面状態、手動 reload 導線までテスト観点を追加する |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- フェーズ6: `ゲーム結果画面 /game/result` は `[x]`。
- フェーズ7: `GET /game/sessions（ゲーム履歴一覧）` は `[ ]`。
- フェーズ7: `GET /game/sessions/:sessionId（ゲーム結果詳細取得・/game/result 再読み込み復元）` は `[ ]` として本計画書を紐づける。
- フェーズ7: `ゲーム API のテスト` は `[ ]`。

**`docs/04_api.md`**
- `POST /game/sessions` は `GameSessionResponse` 相当を 201 で返す。
- `GET /game/sessions` は履歴一覧としてエンドポイント表に存在するが、詳細仕様は未定義。
- `GET /game/sessions/:sessionId` は未定義。

**`backend/prisma/schema.prisma`**
- `GameSession`: `id`, `userId`, `mode`, `totalScore`, `correctCount`, `totalCount`, `maxStreak`, `durationSec`, `playedAt`。
- `GameAnswer`: `id`, `sessionId`, `elementId`, `isCorrect`, `answerTimeSec`。
- `GameAnswer` には現在、結果画面表示に必要な `questionId`, `prompt`, `chosenChoiceId`, `correctAnswer`, `yourAnswer`, `score`, 表示順が不足している。
- `GameSession` には `@@index([userId, playedAt, id])` があり、履歴一覧向け index は追加済み。

**`backend/src/routes/game/index.ts`**
- `GET /questions`。
- `POST /sessions`。
- `gameQuestionsQuerySchema` / `gameSessionBodySchema`。
- `authMiddleware` と `rateLimit()` の利用パターン。
- 500 は `{ error: "サーバーエラーが発生しました" }`。

**`backend/src/services/game.service.ts`**
- `submitGameSession(params): Promise<SubmitGameSessionResult>`。
- `SubmitGameSessionResult` は `/game/result` 表示に必要な `results` を持つ。
- `GameSessionResultItem`: `questionId`, `elementId`, `prompt`, `chosenChoiceId`, `isCorrect`, `correctAnswer`, `yourAnswer`, `answerTimeSec`, `score`。
- `submitGameSession()` は現在 `GameAnswer.createMany()` で `sessionId`, `elementId`, `isCorrect`, `answerTimeSec` を保存する。

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
- `isGameSessionResponse(value)` で runtime validation を実施。

**`frontend/src/lib/game/types.ts`**
- `GameMode`。
- `GameSessionResponse`。
- `GameSessionResultItem`。

**`frontend/src/lib/stores/auth.svelte.ts`**
- `authStore.user`。
- `authStore.accessToken`。
- `authStore.isLoggedIn`。
- `authStore.isInitializing`。

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.error(message)`。
- `toastStore.fromApiError(error)`。

**`frontend/src/lib/stores/game-session-result.svelte.ts`**
- `result: GameSessionResponse | null`。
- `set(result, userId): void`。
- `matches(sessionId, userId): boolean`。
- `clear(): void`。

**`frontend/src/routes/(app)/game/play/+page.svelte`**
- 全問完了後に `submitGameSession()` を呼ぶ。
- 成功時に `gameSessionResultStore.set(result, userId)`。
- `/game/result?sessionId=...` に遷移する。

**`frontend/src/routes/(app)/game/result/+page.svelte`**
- `page.url.searchParams.get("sessionId")`。
- `authStore.user?.id`。
- store が一致しない場合は「結果を表示できません」を表示する。
- スコア、正解数、正答率、最大連続正解、回答詳細、復習ポイントを表示する。

### 重要な制約

- `localStorage` にゲーム結果詳細や token を保存しない。
- 結果詳細の最終 source of truth は backend の保存済み `GameSession` / `GameAnswer` とする。
- frontend は正誤・スコア・連続正解を再計算しない。
- 他ユーザーの `sessionId` は 404 とし、存在有無を漏らさない。
- バックエンドのエラーメッセージは日本語に統一する。
- API ベース URL とエラー処理は既存の `$lib/api/config` / `$lib/api/errors` を使う。
- `sessionId` は URL query から取得し、trim は一度だけ行う。
- DB アクセスは Prisma ORM 経由。生 SQL は使わない。
- DB 構造変更があるため migration、Prisma validate、migrate deploy、主要導線のブラウザ確認を実施する。
- `GET /game/sessions` 履歴一覧 API と履歴 UI は本計画では実装しない。

### 確認事項

- 依頼テンプレートの `{{機能名}}`, `{{docs/05_progress.md 上のタスク名}}`, `{{API一覧}}` は未置換。主対象は「`/game/result` の reload / 直接アクセス復元」とする。
- 既存 `docs/plans/game-screens/plan.md` は `POST /game/sessions` と `/game/result` 初回表示の計画・実装完了記録を含むが、reload 復元はスコープ外として記録されている。
- `docs/05_progress.md` の既存タスク名は `GET /game/sessions（ゲーム履歴一覧）` だが、`/game/result` 復元には単一詳細 API が必要。本計画では履歴一覧と分離して `GET /game/sessions/:sessionId（ゲーム結果詳細取得・/game/result 再読み込み復元）` を主対象にする。
- 既存 `GameAnswer` 行は `chosenChoiceId` や `yourAnswer` を保存していないため、過去データの完全復元はできない。新規保存分から完全復元し、既存分は fallback 表示にする。
- `questionId` は過去の `GameQuestionSet` 内 ID であり、グローバル一意ではない。復元レスポンスでは `GameAnswer.questionId` として返すが、DB 制約で unique にはしない。

## 対象ファイル一覧（変更種別つき）

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `.gitignore` | 修正 | backend build 出力 `backend/dist/` を管理対象外にする |
| `backend/prisma/schema.prisma` | 修正 | `GameAnswer` に結果復元用フィールドと index を追加 |
| `backend/prisma/migrations/{timestamp}_add_game_answer_result_fields/migration.sql` | 新規 | 結果復元用 nullable カラムと index を追加 |
| `backend/src/services/game.service.ts` | 修正 | `submitGameSession()` で復元用フィールドを保存し、`getGameSessionResult()` を追加 |
| `backend/src/routes/game/index.ts` | 修正 | `GET /sessions/:sessionId` route、param validation、認証、rate limit、error mapping を追加 |
| `backend/src/routes/game/session-detail.test.ts` | 新規 | 単一結果取得 route テスト |
| `backend/src/routes/game/questions.test.ts` | 修正 | `game.service.ts` の追加 export に合わせて mock を更新 |
| `backend/src/routes/game/sessions.test.ts` | 修正 | `game.service.ts` の追加 export に合わせて mock を更新 |
| `backend/src/services/game.service.test.ts` | 修正 | 結果詳細取得、保存フィールド、legacy fallback の service テスト追加 |
| `frontend/src/lib/game/types.ts` | 確認（変更なし） | 既存 `GameSessionResponse` / `GameSessionResultItem` を GET 詳細にも再利用できることを確認 |
| `frontend/src/lib/game/session-result.ts` | 新規 | `sessionId` 正規化と result 表示 helper を切り出し |
| `frontend/src/lib/game/session-result.test.ts` | 新規 | `sessionId` 正規化、空 / null / undefined の扱いテスト |
| `frontend/src/lib/api/game.ts` | 修正 | `getGameSession()` API client と runtime validation を追加 |
| `frontend/src/lib/api/game.test.ts` | 修正 | `getGameSession()` の URL、Authorization、error、非 JSON、validation テスト |
| `frontend/src/lib/stores/game-session-result.svelte.ts` | 確認（変更なし） | API 復元後も既存 `set()` / `matches()` を再利用できることを確認 |
| `frontend/src/lib/stores/game-session-result.svelte.test.ts` | 確認（変更なし） | 既存の userId + sessionId 照合テストを維持 |
| `frontend/src/routes/(app)/game/result/+page.svelte` | 修正 | store miss 時の API 復元、loading / error / retry / 未ログイン / 404 状態を追加 |
| `frontend/src/routes/(app)/game/result/+page.ts` | 確認（変更なし） | `ssr = true`, `prerender = false` を維持 |
| `docs/04_api.md` | 修正 | `GET /game/sessions/:sessionId` 仕様を追加 |
| `docs/05_progress.md` | 修正 | 詳細取得・結果復元タスクを追加または分割し、完了へ更新 |
| `docs/plans/game-result-session-restore/plan.md` | 修正 | 本計画。実装完了時に実態へ更新 |

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
    { "message": "セッションIDが正しくありません" }
  ]
}
```

### GET `/api/v1/game/sessions/:sessionId`

| 項目 | 内容 |
|---|---|
| 認証 | 必須。`Authorization: Bearer <accessToken>` |
| 成功 | 200 |
| 用途 | 保存済みゲーム結果を取得し、`/game/result` の reload / 直接アクセス時に復元する |
| 副作用 | なし |
| 所有者チェック | `userId` と `sessionId` で絞り込む |
| rate limit | 適用する |

#### Path params

| パラメータ | 型 | 検証 |
|---|---|---|
| `sessionId` | string | trim 後に空文字不可 |

#### Response 200

`POST /game/sessions` の 201 response と同じ表示用形式を返す。

```json
{
  "sessionId": "clx_game_session_id",
  "mode": "SYMBOL_TO_NAME_LV1",
  "correctCount": 8,
  "totalCount": 10,
  "totalScore": 800,
  "maxStreak": 5,
  "durationSec": 72,
  "playedAt": "2026-06-20T12:35:00.000Z",
  "results": [
    {
      "questionId": "q1",
      "elementId": 1,
      "prompt": "H",
      "chosenChoiceId": "1",
      "isCorrect": true,
      "correctAnswer": "水素",
      "yourAnswer": "水素",
      "answerTimeSec": 5,
      "score": 100
    }
  ]
}
```

#### Error

| ステータス | 条件 | body |
|---|---|---|
| 400 | `sessionId` が空文字等 | `{ "error": "バリデーションエラー", "details": [...] }` |
| 401 | 未ログイン・token 不正 | `{ "error": "認証が必要です" }` または `{ "error": "トークンが無効です" }` |
| 403 | 停止・メール未確認・ロック中 | 既存 auth middleware の日本語エラー |
| 404 | session が存在しない、または他ユーザー所有 | `{ "error": "ゲーム結果が見つかりません" }` |
| 429 | レート制限 | 既存 rateLimit の日本語エラー |
| 500 | 想定外エラー | `{ "error": "サーバーエラーが発生しました" }` |

### POST `/api/v1/game/sessions`

この機能では既存 request / response 仕様を維持しつつ、保存時に復元用フィールドも `GameAnswer` に永続化する。

## 設計上の決定事項（判断理由つき）

1. **結果画面の source of truth**
   - 選択: backend の `GET /game/sessions/:sessionId` response を最終 source of truth にする。store は直後遷移の高速パスとして使う。
   - 根拠: reload / 直接アクセスでは store が消えるため、永続化済みデータから復元する必要がある。

2. **初期表示時の復元元**
   - 選択: `sessionId` query と `authStore` を使う。store 一致なら即表示、store miss かつログイン済みなら API fetch。
   - 根拠: URL が結果の識別子を持つため、戻る・共有・reload に強い。userId 照合は store 漏洩防止に必要。

3. **API 形状**
   - 選択: `GET /game/sessions/:sessionId` を追加する。
   - 根拠: 履歴一覧 `GET /game/sessions` はリスト表示向けで、1セッションの回答詳細を復元するには詳細取得 API が自然。

4. **DB 永続化の粒度**
   - 選択: `GameAnswer` に `questionIndex`, `questionId`, `prompt`, `chosenChoiceId`, `correctAnswer`, `yourAnswer`, `score` を追加する。
   - 根拠: `GameSession` と `GameAnswer` の正規化構造を維持しつつ、結果画面表示に必要な値を後から再構築できる。`score` も保存しておくことで将来の採点ロジック変更後も過去セッションの表示が変わらない。

5. **既存セッションの扱い**
   - 選択: nullable カラムで migration し、既存行は `Element` と `GameSession.mode` から可能な範囲で fallback 表示する。
   - 根拠: 既存データを壊さず deploy できる。完全復元は新規保存分から保証する。

6. **DB 負荷**
   - 選択: 詳細取得は session 1件と answers 最大10件を include で取得する。回答順は `questionIndex` 昇順、legacy は `id` 昇順 fallback。
   - 根拠: 1セッション単位なのでデータ量は小さい。`@@index([sessionId, questionIndex])` を追加すれば履歴増加後も軽い。

7. **エラー表示**
   - 選択: `/game/result` は画面内エラーを主、toast は使わないか補助に限定する。
   - 根拠: reload 直後の復元失敗はページの主状態であり、toast だけでは再試行導線が弱い。

8. **reload / 直接アクセス時の挙動**
   - 選択: `sessionId` あり + ログイン済みなら復元 fetch。未ログインならログイン導線。404 は「結果が見つかりません」。`sessionId` なしはゲーム導線。
   - 根拠: 状態ごとの原因をユーザーに明確に伝えられる。

9. **多重取得防止**
   - 選択: `requestKey = sessionId + accessToken` と `AbortController` で古い fetch を中断し、同じ key の二重取得を避ける。
   - 根拠: auth refresh や URL 変化で `$effect` が複数回動いても古いレスポンスが最新表示を上書きしない。

10. **API パラメータ組み立て**
    - 選択: URL path 組み立ては `$lib/api/game.ts` に集約し、page は normalized `sessionId` を渡すだけにする。
    - 根拠: API URL や encoding を UI に埋め込まない。

## 公開インターフェース案（必要な場合）

```ts
// backend/src/services/game.service.ts

export class GameSessionNotFoundError extends Error {
  constructor();
}

export type GetGameSessionResultParams = {
  userId: string;
  sessionId: string;
};

export async function getGameSessionResult(
  params: GetGameSessionResultParams
): Promise<SubmitGameSessionResult>;
```

```ts
// frontend/src/lib/api/game.ts

export type GetGameSessionOptions = {
  sessionId: string;
  accessToken: string;
  signal?: AbortSignal;
};

export async function getGameSession(options: GetGameSessionOptions): Promise<GameSessionResponse>;
```

```ts
// frontend/src/lib/game/session-result.ts

export function normalizeGameSessionIdParam(value: string | null | undefined): string | null;
```

## タスクリスト（表）

| タスクID | 内容 | 対象ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存仕様・既存実装の最終確認 | `docs/04_api.md`, `docs/05_progress.md`, `docs/plans/game-screens/plan.md`, game 関連実装 | 現行の store 限定表示、未実装 API、DB 不足フィールドを確認し記録する | 高 |
| T2 | API 仕様を確定する | `docs/04_api.md` | `GET /game/sessions/:sessionId` の request / response / error を追記する | 高 |
| T3 | DB schema と migration を追加する | `backend/prisma/schema.prisma`, `backend/prisma/migrations/.../migration.sql` | `GameAnswer` に復元用 nullable フィールドと index が追加される | 高 |
| T4 | backend service テストを先に追加する | `backend/src/services/game.service.test.ts` | 取得成功、404、所有者違い、legacy fallback、保存フィールドの Red を確認する | 高 |
| T5 | backend service を実装する | `backend/src/services/game.service.ts` | `submitGameSession()` が復元用フィールドを保存し、`getGameSessionResult()` が表示用 response を返す | 高 |
| T6 | backend route テストを追加する | `backend/src/routes/game/session-detail.test.ts` | 401、400、200、404、500 の Red / Green を確認する | 高 |
| T7 | backend route を実装する | `backend/src/routes/game/index.ts` | `GET /sessions/:sessionId` が認証・validation・rate limit・error mapping 付きで動作する | 高 |
| T8 | frontend 型・helper テストを追加する | `frontend/src/lib/game/session-result.test.ts`, `frontend/src/lib/game/types.ts` | `sessionId` の trim、空文字 / null / undefined の扱いがテストされる | 高 |
| T9 | frontend helper を実装する | `frontend/src/lib/game/session-result.ts` | `normalizeGameSessionIdParam()` が URL query 用の正規化を一箇所で行う | 高 |
| T10 | frontend API client テストを追加する | `frontend/src/lib/api/game.test.ts` | `getGameSession()` の URL encode、Authorization、signal、401 / 404 / 非 JSON / 不正 response を検証する | 高 |
| T11 | frontend API client を実装する | `frontend/src/lib/api/game.ts` | `getGameSession()` が `API_BASE_URL` と `parseErrorResponse()` を使い、runtime validation を通す | 高 |
| T12 | `/game/result` の復元状態設計を実装する | `frontend/src/routes/(app)/game/result/+page.svelte` | store hit、API loading、API success、error、retry、未ログイン、sessionId なしを分岐できる | 高 |
| T13 | store 連携を確認・必要なら拡張する | `frontend/src/lib/stores/game-session-result.svelte.ts`, `.test.ts` | API 復元後も `set(result, userId)` で同じ表示経路に統一される | 中 |
| T14 | reload / 戻る操作の扱いを調整する | `frontend/src/routes/(app)/game/result/+page.svelte` | reload で API 復元、戻るで store / API どちらでも表示、古い fetch の abort ができる | 高 |
| T15 | loading / empty / error UI を磨く | `frontend/src/routes/(app)/game/result/+page.svelte` | `aria-busy`, `aria-live`, retry button、ゲーム / ホーム導線が揃う | 中 |
| T16 | `docs/05_progress.md` の更新を反映する | `docs/05_progress.md` | 詳細取得・結果復元タスクを実装中 / 完了更新できる | 中 |
| T17 | format を実行する | backend / frontend | `cd backend && npm run format`, `cd frontend && npm run format` が成功する | 中 |
| T18 | lint / format check を実行する | backend / frontend | `cd backend && npm run lint`, `cd backend && npm run format:check`, `cd frontend && npm run lint` が成功する | 高 |
| T19 | test / check を実行する | backend / frontend | backend 全テスト、frontend `test:run`, frontend `check` が成功する | 高 |
| T20 | DB 変更確認を実行する | backend / Docker | `npx prisma validate` と `prisma migrate deploy` が成功する | 高 |
| T21 | 手動確認を実行する | `/game/play`, `/game/result` | 投稿直後表示、reload 復元、直接アクセス、404、未ログイン、モバイル表示を確認する | 高 |
| T22 | 実装完了更新を行う | `docs/plans/game-result-session-restore/plan.md`, `docs/05_progress.md` | チェックボックスを `[x]` にし、`## 実装完了` に変更点・実ファイル・確認結果を記録する | 中 |

## タスクリスト（チェックボックス）

- [x] T1: 既存仕様・既存実装の最終確認
- [x] T2: API 仕様を確定する
- [x] T3: DB schema と migration を追加する
- [x] T4: backend service テストを先に追加する
- [x] T5: backend service を実装する
- [x] T6: backend route テストを追加する
- [x] T7: backend route を実装する
- [x] T8: frontend 型・helper テストを追加する
- [x] T9: frontend helper を実装する
- [x] T10: frontend API client テストを追加する
- [x] T11: frontend API client を実装する
- [x] T12: `/game/result` の復元状態設計を実装する
- [x] T13: store 連携を確認・必要なら拡張する
- [x] T14: reload / 戻る操作の扱いを調整する
- [x] T15: loading / empty / error UI を磨く
- [x] T16: `docs/05_progress.md` の更新を反映する
- [x] T17: format を実行する
- [x] T18: lint / format check を実行する
- [x] T19: test / check を実行する
- [x] T20: DB 変更確認を実行する
- [x] T21: 手動確認を実行する
- [x] T22: 実装完了更新を行う

## 技術的注意点

- `GameAnswer` の新規フィールドは既存データ保護のため nullable から始める。
- 新規 `submitGameSession()` 保存分は `questionIndex`, `questionId`, `prompt`, `chosenChoiceId`, `correctAnswer`, `yourAnswer`, `score` を必ず保存する。
- `questionIndex` は `results.map((result, index) => ...)` の index を保存し、復元時の表示順に使う。
- `GET /game/sessions/:sessionId` は `findFirst({ where: { id: sessionId, userId } })` で所有者チェックを行う。
- 404 は存在しない session と他ユーザー session で同じ `"ゲーム結果が見つかりません"` にする。
- `playedAt` は route で ISO string に変換し、frontend 型と一致させる。
- `chosenChoiceId: null` は時間切れ・未回答表示として扱う。
- legacy row で `yourAnswer` がない場合は `null` を返し、UI は `未回答` と表示する。
- legacy row で `prompt` / `correctAnswer` がない場合は `mode` と `element` から可能な範囲で復元する。
- legacy row で `score` がない場合のみ `isCorrect ? 100 : 0` で fallback する。新規保存分は DB の `score` を使う。
- API client は `response.ok` を JSON parse より前に確認する。
- 非 JSON エラーは `parseErrorResponse()` の default message を使う。
- `/game/result` は `authStore.isInitializing` 中に fetch しない。
- `sessionId` 正規化は helper で一度だけ行い、page 内で `trim()` を複数回書かない。
- `requestKey` と `AbortController` で二重取得・古いレスポンス上書きを防ぐ。
- DB schema / migration 変更があるため、`prisma validate`, `migrate deploy`, 主要導線のブラウザ確認を必須にする。

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| 初期表示: store hit | API fetch せず既存 result を表示する |
| 初期表示: store miss + sessionId あり | `GET /game/sessions/:sessionId` を呼び、成功時に result を表示する |
| 初期表示: sessionId なし | API fetch せず「結果を表示できません」とゲーム導線を表示する |
| 未ログイン状態 | API fetch せずログイン導線を表示する |
| auth initializing | loading / 確認中表示になり、未ログイン断定をしない |
| 正常系 API | 200 response を `GameSessionResponse` として表示できる |
| API 404 | 「ゲーム結果が見つかりません」を画面内表示し、ゲームへ戻る導線を出す |
| API 401 | バックエンドの日本語エラーを画面内表示する |
| API 403 | アカウント状態の日本語エラーを画面内表示する |
| 非 JSON エラー | default message で安全に `ApiError` 化される |
| response 形式不正 | `ApiError(500, "ゲーム結果のレスポンス形式が不正です")` |
| sessionId trim | 前後空白は除去され、空文字は null 扱い |
| null / undefined sessionId | null 扱いで fetch しない |
| 二重取得防止 | 同じ requestKey では重複 fetch しない |
| Abort | URL / token 変更時に古い fetch が表示を上書きしない |
| reload 復元 | `/game/result?sessionId=...` reload 後に API から復元される |
| 直接アクセス | store 空でもログイン済みなら API から復元される |
| 戻る操作 | result 表示が store または API で維持される |
| backend route 未認証 | 401 `{ error: "認証が必要です" }` |
| backend route 空 sessionId | 400 `{ error: "バリデーションエラー", details: [...] }` |
| backend route 他ユーザー session | 404 `{ error: "ゲーム結果が見つかりません" }` |
| backend service 表示順 | `questionIndex` 昇順で results が返る |
| backend service legacy fallback | 不足フィールドがある既存行でもクラッシュしない |
| DB 保存 | `POST /game/sessions` 後の `GameAnswer` に復元用フィールドが保存される |
| A11Y | loading に `aria-busy`、更新メッセージに `aria-live`、retry button が keyboard 操作可能 |

## 実装リスクと回避策

| リスク | 影響 | 回避策 |
|---|---|---|
| 既存 `GameAnswer` に表示情報が足りない | reload 後に回答詳細を完全復元できない | 復元用カラムを追加し、新規保存時に必ず埋める。既存行は fallback 表示 |
| 他ユーザー結果が見える | 個人情報漏洩 | `userId` で絞り込み、他ユーザーと不存在を同じ 404 にする |
| DB migration が既存行で失敗する | deploy 不可 | nullable カラム追加で始め、required 化は別タスクにする |
| `/game/result` の `$effect` が多重 fetch する | API 負荷、表示ちらつき | requestKey と AbortController で制御する |
| store と API response が競合する | 古い結果表示 | store hit は userId + sessionId 一致時のみ。API success 後は store を上書き |
| 旧セッションの score fallback が将来仕様とずれる | 過去データの表示不一致 | `score` が null のときのみ固定100点 fallback。新規保存分は DB の `score` を使う |
| API 仕様が履歴一覧と混ざる | 実装担当が迷う | `GET /game/sessions/:sessionId` は詳細、`GET /game/sessions` は履歴一覧として分離する |
| DB 変更の確認漏れ | 本番不具合 | migration deploy、Prisma validate、ブラウザ導線確認をタスク化する |

## 手動確認項目

| 項目 | 確認内容 |
|---|---|
| 投稿直後 | `/game/play` 完了後、`/game/result?sessionId=...` に遷移して結果が表示される |
| reload | 結果画面で reload しても API から復元される |
| 直接アクセス | store 空の状態で `/game/result?sessionId=...` を開いて復元される |
| sessionId なし | `/game/result` でゲームへ戻る導線が表示される |
| 不存在 sessionId | 404 相当の画面内エラーと導線が表示される |
| 未ログイン | ログイン導線が表示され、API を呼ばない |
| 別ユーザー | 他ユーザー sessionId が 404 扱いになる |
| API 失敗 | 再試行ボタンで再 fetch できる |
| PC 幅 | スコアカード、回答詳細、復習ポイントが崩れない |
| モバイル 390px | 横スクロールやテキストはみ出しがない |
| キーボード操作 | retry / もう一度 / ホーム導線へ Tab で移動できる |
| コンソール | 不要な error log や hydration mismatch が出ない |

## 実装完了時の更新ルール

実装完了時は以下を必ず行う。

- `docs/05_progress.md` の `GET /game/sessions/:sessionId（ゲーム結果詳細取得・/game/result 再読み込み復元）` を `[x]` に更新する。
- `docs/plans/game-result-session-restore/plan.md` の該当チェックボックスを `[x]` に更新する。
- 計画時と実装時で変更ファイルが異なった場合、対象ファイル一覧を実態に合わせて更新する。
- API 仕様やステータスコードが変わった場合、`docs/04_api.md` を実装に合わせて更新する。
- DB schema / migration を変更した場合、migration 適用確認とフロント主要導線確認の結果を記録する。
- 設計判断が変わった場合、`## 実装完了` の「計画からの変更点」に記録する。
- 実行した lint / format / test / check / 手動確認を `## 実装完了` に記録する。

実装完了セクションのテンプレート:

```markdown
## 実装完了

- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/game-result-session-restore
- PR: #N

### 計画からの変更点

- なし

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/prisma/schema.prisma` | 修正 | GameAnswer に結果復元用フィールドを追加 |
| `backend/src/services/game.service.ts` | 修正 | 結果詳細取得 service を追加 |
| `frontend/src/routes/(app)/game/result/+page.svelte` | 修正 | store 空状態から API 復元する表示へ変更 |

### 実行した確認

| 種別 | コマンド / 手順 | 結果 |
|---|---|---|
| format | `cd backend && npm run format` | 未実行 / 成功 |
| format | `cd frontend && npm run format` | 未実行 / 成功 |
| lint | `cd backend && npm run lint` | 未実行 / 成功 |
| lint | `cd frontend && npm run lint` | 未実行 / 成功 |
| format check | `cd backend && npm run format:check` | 未実行 / 成功 |
| prisma | `cd backend && npx prisma validate` | 未実行 / 成功 |
| migration | `docker compose exec -T hono npx prisma migrate deploy` | 未実行 / 成功 |
| test | `cd backend && npm run test -- --run` | 未実行 / 成功 |
| test | `cd frontend && npm run test:run` | 未実行 / 成功 |
| check | `cd frontend && npm run check` | 未実行 / 成功 |
| 手動確認 | `/game/play` -> `/game/result` -> reload | 未実行 / 成功 |

### 手動確認

| 条件 | 結果 |
|---|---|
| 投稿直後の結果表示 | 未実行 / OK |
| reload 復元 | 未実行 / OK |
| 直接アクセス復元 | 未実行 / OK |
| 不存在 sessionId | 未実行 / OK |
| 未ログイン | 未実行 / OK |
| PC 幅 | 未実行 / OK |
| モバイル幅 390px | 未実行 / OK |
```

## 実装完了

- 完了日: 2026-06-20
- 実装ブランチ: feature/game-result-session-restore
- PR: [#54](https://github.com/RitukoIsibasi0222/gensoko/pull/54)

### 計画からの変更点

- `frontend/src/lib/game/types.ts` は新規 alias を追加せず、既存の `GameSessionResponse` / `GameSessionResultItem` を `GET /game/sessions/:sessionId` でも再利用した。
- `frontend/src/lib/stores/game-session-result.svelte.ts` は変更せず、既存の `set(result, userId)` / `matches(sessionId, userId)` で store hit と API 復元後の表示経路を統一した。
- `backend/src/routes/game/questions.test.ts` と `backend/src/routes/game/sessions.test.ts` は、`game.service.ts` の追加 export に合わせて mock を更新した。
- `backend/dist/` が build 出力として作成されたため、`.gitignore` に追加した。
- Docker 手動確認時、DB migration 適用後も Hono コンテナ内の Prisma Client が古いままだと詳細取得が 500 になることを確認した。`docker compose exec -T hono npx prisma generate` と `docker compose restart hono` 後に復元導線が成功したため、DB 変更を伴うローカル確認では Prisma Client 再生成を明示的に行う。

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `.gitignore` | 修正 | `backend/dist/` を管理対象外に追加 |
| `backend/prisma/schema.prisma` | 修正 | `GameAnswer` に結果復元用 nullable フィールドと `@@index([sessionId, questionIndex])` を追加 |
| `backend/prisma/migrations/20260620210000_add_game_answer_result_fields/migration.sql` | 新規 | 結果復元用カラムと index を追加 |
| `backend/src/services/game.service.ts` | 修正 | `submitGameSession()` の復元用フィールド保存と `getGameSessionResult()` を追加 |
| `backend/src/services/game.service.test.ts` | 修正 | 保存フィールド、詳細取得、404、legacy fallback の service テストを追加 |
| `backend/src/routes/game/index.ts` | 修正 | `GET /sessions/:sessionId` route、param validation、認証、rate limit、error mapping を追加 |
| `backend/src/routes/game/session-detail.test.ts` | 新規 | 詳細取得 route の 401 / 400 / 200 / 404 / 500 テストを追加 |
| `backend/src/routes/game/questions.test.ts` | 修正 | service mock を追加 export と整合 |
| `backend/src/routes/game/sessions.test.ts` | 修正 | service mock を追加 export と整合 |
| `frontend/src/lib/game/session-result.ts` | 新規 | `sessionId` query の正規化 helper を追加 |
| `frontend/src/lib/game/session-result.test.ts` | 新規 | trim、空文字、null、undefined の扱いをテスト |
| `frontend/src/lib/api/game.ts` | 修正 | `getGameSession()` API client と runtime validation を追加 |
| `frontend/src/lib/api/game.test.ts` | 修正 | 詳細取得 API client の URL、Authorization、error、非 JSON、validation テストを追加 |
| `frontend/src/routes/(app)/game/result/+page.svelte` | 修正 | store miss 時の API 復元、loading / error / retry / 未ログイン / 404 状態を追加 |
| `docs/04_api.md` | 修正 | `GET /game/sessions/:sessionId` の API 仕様を追加 |
| `docs/05_progress.md` | 修正 | 詳細取得・結果復元タスクを完了へ更新 |
| `docs/plans/game-result-session-restore/plan.md` | 修正 | タスク完了と実装完了記録を追記 |

### 実行した確認

| 種別 | コマンド / 手順 | 結果 |
|---|---|---|
| prisma | `cd backend && npx prisma validate` | 成功 |
| migration | `docker compose exec -T hono npx prisma migrate deploy` | 成功 |
| migration status | `docker compose exec -T hono npx prisma migrate status` | 成功。DB schema は最新 |
| prisma generate | `docker compose exec -T hono npx prisma generate` | 成功。手動確認時の Docker 内 Prisma Client 更新として実行 |
| lint | `cd backend && npm run lint` | 成功 |
| format check | `cd backend && npm run format:check` | 成功 |
| build | `cd backend && npm run build` | 成功 |
| test | `cd backend && npm run test -- --run` | 成功。23 files / 200 tests |
| format | `cd frontend && npm run format` | 成功 |
| lint | `cd frontend && npm run lint` | 成功 |
| check | `cd frontend && npm run check` | 成功 |
| test | `cd frontend && npm run test:run` | 成功。17 files / 205 tests |
| diff check | `git diff --check` | 成功 |
| 手動確認 | `/game/play` -> `/game/result?sessionId=...` -> reload | 成功 |

### 手動確認

| 条件 | 結果 |
|---|---|
| 投稿直後の結果表示 | OK。`/game/play` 完了後に `/game/result?sessionId=...` へ遷移し、score / correctCount / answer details を表示 |
| reload 復元 | OK。新規保存セッション `cmqmfv9dh00010tq6kxfqj08o` で reload 後も API から復元 |
| 復元用カラム | OK。reload 後も `あなたの回答` に保存済み回答（例: ヘリウム）を表示 |
| 直接アクセス復元 | OK。store 空状態相当の reload / URL 直接指定で復元 |
| sessionId なし | OK。「結果を表示できません」とゲーム / ホーム導線を表示 |
| 不存在 sessionId | OK。「ゲーム結果が見つかりません」と再試行 / ゲーム / ホーム導線を表示 |
| 未ログイン | OK。「ログインが必要です」とログイン / ホーム導線を表示し、結果は表示しない |
| PC 幅 | OK。結果カード、回答詳細、復習ポイントを表示 |
| モバイル幅 390px | OK。結果本文と主要導線は表示可能。共通ヘッダーのナビが縦に折れる既存レイアウト課題は別タスク候補 |

### 残課題

- 390px 幅では共通ヘッダーのナビが縦に折れる。`/game/result` 固有ではなく共通レイアウトのレスポンシブ課題として別途扱う。
- `GET /game/sessions` の履歴一覧 API と履歴 UI は本計画のスコープ外で未実装。
