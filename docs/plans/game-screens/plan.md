# `GET /game/questions` レスポンス形式確定 実装計画

> 設計者ロール: シニアフルスタックエンジニア（Hono v4 / Prisma v7 / SvelteKit v2、API 契約設計・ゲーム状態設計・A11Y レビュー）
> 対象実装者: Codex

## 概要

`docs/05_progress.md` フェーズ6「API インターフェース確定」のうち、`GET /game/questions` のレスポンス形式（問題・選択肢・`questionSetId`）を確定する。既存の `/game/play` は mock 問題で UI モック実装済みのため、本計画では live API 接続前に、正解情報をクライアントへ渡さず `GameQuestionSet` と `POST /game/sessions` でサーバー側正誤判定できる API 契約へ整理する。

現状の `docs/04_api.md` は `questionSetId` がレスポンス例に未反映で、選択肢にも `elementId` が露出している。`docs/05_progress.md` の設計決定2（`GameQuestionSet` テーブル方式）と整合させるため、公開 API は `choiceId` ベースに寄せ、DB 内保存形式とクライアント公開形式を明確に分離する。

## レビュー結果と改善方針

| 観点 | レビュー結果 | 改善方針 |
|---|---|---|
| 既存コード整合性 | frontend の `/game/play` は `GameChoice.choiceId` / `GamePlayQuestion.questionId` / mock 専用 `correctChoiceId` で実装済み。backend の `routes/game` と `game.service` は TODO、`index.ts` に game ルーター未 mount | API 契約は既存 frontend 型へ寄せて `questionId` / `choiceId` を採用する。backend 実装は route を薄く、service に問題生成と保存を集約する |
| 仕様整合性 | `docs/05_progress.md` は `GameQuestionSet` 方式と `questionSetId` 返却を決定済みだが、`docs/04_api.md` は未反映 | `docs/04_api.md` に `questionSetId`, `expiresAt`, `questions` を明記し、`POST /game/sessions` への接続点も最小限記録する |
| セキュリティ | 現行 API 例は `elementId` をレスポンスに含み、正解推測の足場になり得る | 公開レスポンスは `{ choiceId, text }` のみ。`elementId` と `correctChoiceId` は `GameQuestionSet.questions` 内に保存し、クライアントへ返さない |
| A11Y | 既存 UI は進捗・タイマー・4択ボタン・フィードバック component があり、色だけに依存しない表示を意識している | API 接続時も既存 component を再利用する。loading / error / empty は `aria-busy` と画面内メッセージを使い、毎秒 timer を過剰に読み上げない |
| DB 整合性 | `GET /game/questions` は読み取りではなく `GameQuestionSet` を作成する副作用を持つ。連打や再読み込みで一時データが増える | 1回の開始につき1セットを作る前提を明記し、frontend の二重取得防止、backend rate limit、期限切れ cleanup の後続タスクを計画に入れる |
| DB 負荷 | 元素は118件で小さいが、苦手モードは user ごとの `WeakElement` 参照が必要。問題取得を入力ごとに走らせる設計ではない | `mode` が確定してから明示的に1回取得する。Prisma ORM の `findMany` / `create` のみ使い、生 SQL は使わない |
| テスト | API 契約、保存形式、正解非露出、frontend runtime validation をまたいだ確認が必要 | backend route / service、frontend API client、game helper、手動 A11Y / レスポンシブ確認を分けてテストする |
| スコープ整合性 | 依頼文に「検索・フィルターUI」の語が混在していたが、`docs/05_progress.md` では元素検索 UI は完了済み | 本計画は `docs/plans/game-screens/plan.md` の `GET /game/questions` 仕様確定に限定する。元素検索 UI 改修は `docs/plans/elements-search-filter/plan.md` 側で扱う |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- フェーズ6: `ゲームモード選択画面 /game` は `[x]`。
- フェーズ6: `ゲームプレイ画面 /game/play` は `[x]`。
- フェーズ6: `GET /game/questions` のレスポンス形式確定は `[ ]`。
- 設計決定2: `GET /game/questions` で DB に正解情報と有効期限（30分）を保存し、`questionSetId` を返す。

**`docs/04_api.md`**
- 現行 `GET /game/questions` は `questions` のみを返す案になっている。
- 現行レスポンス例には `questionSetId` が含まれていない。
- 現行選択肢は `{ elementId, text }` であり、frontend の既存 `choiceId` 型や正解非露出方針とズレている。

**`backend/prisma/schema.prisma`**
- `GameMode` enum は6種類定義済み。
- `GameQuestionSet` は `id`, `userId`, `mode`, `questions`, `expiresAt`, `createdAt` を持つ。
- `GameSession`, `GameAnswer`, `WeakElement`, `UserStats` は後続の `POST /game/sessions` 実装で使う。
- `datasource` に `url =` は書かない。Prisma v7 方針を維持する。

**`backend/src/routes/game/index.ts`**
- 現状 `// TODO: implement`。
- 実装時は `GET /questions` を追加し、route 入口で zod query validation を行う。

**`backend/src/services/game.service.ts`**
- 現状 `// TODO: implement`。
- 実装時は問題候補取得、4択生成、`GameQuestionSet` 保存、公開レスポンス変換を集約する。

**`backend/src/index.ts`**
- `/api/v1/game` は未 mount。
- game API 本実装時に `app.route("/api/v1/game", gameRouter)` を追加する。

**`backend/src/middleware/auth/index.ts`**
- `authMiddleware` は必須認証。成功時 `c.get("user")` で `{ id, role }` を取得できる。
- `verify(token, secret, "HS256")` の第3引数は必須。
- エラー文言は日本語で返す。

**`backend/src/middleware/rateLimit/index.ts`**
- `rateLimit(options): MiddlewareHandler`。
- 429 は `{ error: "リクエストが多すぎます。しばらく待ってから再試行してください" }`。
- 現状は IP ベース。`GET /game/questions` は DB 書き込みを伴うため適用対象にする。

**`frontend/src/lib/game/types.ts`**
- `GameMode` — backend `GameMode` と同じ6種類。
- `GameChoice` — 既存 UI mock の選択肢型 `{ choiceId: string; text: string }`。
- `GamePlayQuestion` — 既存 UI mock の問題型 `{ questionId, prompt, choices }`。
- `MockGamePlayQuestion` — UI mock 限定で `correctChoiceId` を持つ。
- `GameAnswerDraft` — 現行 mock 用の回答型。API 接続時は送信型を分ける。

**`frontend/src/lib/game/play.ts`**
- `normalizeGameModeParam(value): GameMode | null`。
- `buildAnswerDraft(...)` は mock 用の正誤判定を含む。
- API 接続時は本番送信用 answer draft と mock 正誤判定を分ける。

**`frontend/src/routes/(app)/game/+page.svelte`**
- `goto("/game/play?mode=...")` でプレイ画面へ遷移する。

**`frontend/src/routes/(app)/game/play/+page.svelte`**
- `page.url.searchParams.get("mode")` を `normalizeGameModeParam()` で検証する。
- 現状は `getMockGameQuestions(mode)` を使う。
- `authStore.isInitializing`, `authStore.isLoggedIn` を見て表示を分岐する。
- `1`〜`4` / `Numpad1`〜`Numpad4` の回答操作を持つ。

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL: string`。
- API ベース URL はここから import し、各ファイルで再定義しない。

**`frontend/src/lib/api/errors.ts`**
- `ApiError`。
- `parseErrorBody(response)`。
- `parseErrorResponse(response, defaultMessage?)`。
- 非 JSON エラー時は `null` body と default message を使う。

**`frontend/src/lib/api/elements.ts`**
- API client の既存参考実装。
- `response.ok` を JSON parse 前に判定する。
- `parseErrorResponse()` を使う。
- レスポンス形式を runtime validation し、不正なら `ApiError(500, "...レスポンス形式が不正です", data)` を投げる。

**`frontend/src/routes/(app)/elements/+page.svelte`**
- URL query、AbortController、request sequence、loading / empty / error、toast の参考実装。

### 重要な制約

- 正解情報は `GET /game/questions` レスポンスに含めない。
- `questionSetId` は必ずレスポンスに含め、後続 `POST /game/sessions` に渡す。
- `GameQuestionSet.questions` にはサーバー側正誤判定に必要な情報を保存する。
- `questionSetId` はログインユーザー本人の未期限切れセットだけ受け付ける前提にする。
- `GameQuestionSet.expiresAt` は30分後を基本方針とする。
- `GET /game/questions` は認証必須。
- 苦手モードは backend でも苦手元素5件以上を検証する。
- 入力検証は route 入口で zod に集約する。
- DB アクセスは Prisma ORM 経由に限定する。
- バックエンドのエラー文言は日本語に統一する。
- フロントエンドは `API_BASE_URL` と `parseErrorResponse()` を再実装しない。
- `response.ok` を JSON parse より先に判定する。
- UI mock 用 `correctChoiceId` と API レスポンス型を混ぜない。
- `mode` query の正規化は一度だけ行い、正規化済みの `GameMode` を再利用する。
- `/game/play` の UI ロジックに API URL 組み立てやレスポンス変換を埋め込まない。
- `localStorage` に問題セット、回答、認証情報を保存しない。

### 確認事項

- `POST /game/sessions` の完全なリクエスト/レスポンス確定は別タスクだが、本計画で `questionSetId`, `questionId`, `chosenChoiceId`, `answerTimeSec` という接続点は固定する。
- 即時フィードバックを API 接続後も維持するかは、正解非露出方針と衝突する。API 接続後は原則として結果送信後の server response で正誤を表示し、プレイ中のフィードバック仕様変更が必要なら `POST /game/sessions` 計画で明記する。
- 依頼文に含まれる「検索・フィルターUI（キーワード・分類・周期）」は既存完了タスクのため、本計画の実装対象には含めない。

## 対象ファイル一覧（変更種別つき）

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `docs/04_api.md` | 修正 | `GET /game/questions` の `questionSetId`、問題、選択肢、エラー仕様を確定 |
| `docs/05_progress.md` | 修正 | `GET /game/questions` レスポンス形式確定タスクを実装中・完了へ更新 |
| `docs/plans/game-screens/plan.md` | 修正 | 本計画、チェックボックス、実装完了記録を追加 |
| `backend/src/routes/game/index.ts` | 新規または修正 | `GET /questions` route、zod query validation、認証、rate limit、エラー形式 |
| `backend/src/services/game.service.ts` | 新規または修正 | 問題生成、4択生成、`GameQuestionSet` 保存、公開レスポンス変換 |
| `backend/src/index.ts` | 修正 | game ルーターを `/api/v1/game` に mount |
| `backend/src/routes/game/questions.test.ts` | 新規 | `GET /game/questions` の route テスト |
| `backend/src/services/game.service.test.ts` | 新規または修正 | 問題生成・選択肢生成・苦手件数ガードの service テスト |
| `frontend/src/lib/game/types.ts` | 修正 | API レスポンス型、回答送信用型、UI mock 型の責務を分離 |
| `frontend/src/lib/api/game.ts` | 新規 | `getGameQuestions()` API client、runtime validation、共通エラー処理 |
| `frontend/src/lib/api/game.test.ts` | 新規 | query、Authorization、レスポンス検証、非 JSON エラー、AbortSignal のテスト |
| `frontend/src/routes/(app)/game/play/+page.svelte` | 修正 | mock 問題から API 問題取得へ差し替える場合の loading / error / empty 状態 |
| `frontend/src/lib/game/play.ts` | 修正 | mock 正誤判定と API 接続後の回答 draft 生成を分離 |
| `frontend/src/lib/game/play.test.ts` | 修正 | API 接続後の回答 draft・mode 正規化のテスト更新 |

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
    { "message": "ゲームモードが正しくありません" }
  ]
}
```

### GET `/api/v1/game/questions`

| 項目 | 内容 |
|---|---|
| 認証 | 必須。`Authorization: Bearer <accessToken>` |
| Query | `mode: GameMode` |
| 成功 | 200 |
| 用途 | 指定 mode の10問・4択と `questionSetId` を取得する |
| 副作用 | `GameQuestionSet` を作成し、30分後の `expiresAt` を設定する |
| 正解情報 | レスポンスに含めない |
| 並び順 | questions は生成済みの順序、choices はサーバー生成順。正解位置は固定しない |

#### Query params

| クエリ | 型 | 正規化・検証 |
|---|---|---|
| `mode` | `GameMode` | 必須。6種類の enum 以外は 400 |

#### Response 200

```json
{
  "questionSetId": "clx_question_set_id",
  "expiresAt": "2026-06-20T12:30:00.000Z",
  "questions": [
    {
      "questionId": "q1",
      "prompt": "H",
      "choices": [
        { "choiceId": "1", "text": "水素" },
        { "choiceId": "6", "text": "炭素" },
        { "choiceId": "8", "text": "酸素" },
        { "choiceId": "7", "text": "窒素" }
      ]
    }
  ]
}
```

#### Response type

```ts
export type GameQuestionsResponse = {
  questionSetId: string;
  expiresAt: string;
  questions: GameApiQuestion[];
};

export type GameApiQuestion = {
  questionId: string;
  prompt: string;
  choices: GameApiChoice[];
};

export type GameApiChoice = {
  choiceId: string;
  text: string;
};
```

#### Error

| ステータス | 条件 | body |
|---|---|---|
| 400 | `mode` が未指定・不正 | `{ "error": "バリデーションエラー", "details": [...] }` |
| 401 | 未ログイン・token 不正 | `{ "error": "認証が必要です" }` または `{ "error": "トークンが無効です" }` |
| 403 | 停止・メール未確認・ロック中 | 既存 auth middleware の日本語エラー |
| 409 | 苦手モードで苦手元素が5件未満 | `{ "error": "苦手モードを始めるには、苦手元素が5件以上必要です" }` |
| 429 | レート制限 | `{ "error": "リクエストが多すぎます。しばらく待ってから再試行してください" }` |
| 500 | DB / 生成失敗 | `{ "error": "サーバーエラーが発生しました" }` |

### `GameQuestionSet.questions` 保存形式案

`GameQuestionSet.questions` はレスポンスと同じ表示情報に加え、サーバー正誤判定用の正解を保存する。

```ts
type StoredGameQuestionSetQuestion = {
  questionId: string;
  elementId: number;
  prompt: string;
  correctChoiceId: string;
  choices: {
    choiceId: string;
    elementId: number;
    text: string;
  }[];
};
```

- `elementId` と `correctChoiceId` は DB 内にのみ保存する。
- クライアントへ返す `choices` は `{ choiceId, text }` のみ。
- `choiceId` は当面 `String(element.id)` とし、後続 `POST /game/sessions` で選択肢照合に使う。
- `questionId` は問題セット内で一意にする。例: `q1`〜`q10`。
- 保存 JSON は10問分だけに限定し、不要な `nameEn`, `category`, `atomicWeight` などを含めない。

### 後続 `POST /api/v1/game/sessions` との接続点

本タスクで完全確定はしないが、`GET /game/questions` と整合する最低限の送信型を以下に寄せる。

```json
{
  "questionSetId": "clx_question_set_id",
  "mode": "SYMBOL_TO_NAME_LV1",
  "answers": [
    {
      "questionId": "q1",
      "chosenChoiceId": "1",
      "answerTimeSec": 5
    }
  ],
  "durationSec": 72
}
```

## 設計上の決定事項（判断理由つき）

1. **`questionSetId` をレスポンスに含めるか**
   - 選択: 必ず含める。
   - 根拠: `docs/05_progress.md` の設計決定2で `GameQuestionSet` 方式が確定している。`POST /game/sessions` でサーバー側正誤判定するには問題セットの識別子が必要。

2. **正解情報をレスポンスに含めるか**
   - 選択: 含めない。
   - 根拠: クライアントに `correctChoiceId` や正解 `elementId` を渡すと改ざんや推測が容易になる。UI mock の正誤判定は本番 API 型に混ぜない。

3. **選択肢 ID を `elementId` として公開するか**
   - 選択: レスポンス上は `choiceId` として公開し、`elementId` という名前は出さない。
   - 根拠: 画面が DB ID に密結合しない。内部保存では `elementId` を保持し、サーバー側照合に使う。

4. **`questionId` の形式**
   - 選択: 問題セット内で一意な安定 ID とし、初期実装では `q1`〜`q10` を許容する。
   - 根拠: 回答送信時に配列順だけへ依存すると、欠落・並び替え・二重送信の検証が弱くなる。

5. **`expiresAt` をレスポンスに含めるか**
   - 選択: 含める。
   - 根拠: フロントエンドで期限切れ時の再取得導線を作れる。DB の `GameQuestionSet.expiresAt` とも整合する。

6. **検索条件を URL クエリに反映するか**
   - 選択: ゲームでは検索条件ではなく `mode` を URL クエリに反映する。`/game/play?mode=SYMBOL_TO_NAME_LV1` を維持する。
   - 根拠: 既存 `/game` からの導線と `/game/play` の実装がこの形で整っている。再読み込み時も mode を復元できる。

7. **初期表示時に検索条件をどこから復元するか**
   - 選択: 検索条件は対象外。ゲーム開始条件として `page.url.searchParams` から `mode` を復元し、`normalizeGameModeParam()` で一度だけ検証する。
   - 根拠: URL を source of truth にすると、直打ち・再読み込み・戻る操作で状態が安定する。

8. **キーワード入力の反映タイミング**
   - 選択: 対象外。
   - 根拠: 本機能はゲーム問題取得 API であり、キーワード入力 UI は `docs/plans/elements-search-filter/plan.md` の責務。

9. **分類・周期の選択 UI**
   - 選択: 対象外。
   - 根拠: 本機能は `GameMode` による問題セット取得であり、元素一覧の分類・周期フィルターとは別タスク。

10. **検索条件リセット時に API 再取得するか**
    - 選択: 対象外。ゲームでは「もう一度」または mode 変更時に `GET /game/questions` を再取得する。
    - 根拠: `GameQuestionSet` は取得ごとに作成されるため、再取得操作を明示的にする。

11. **API パラメータの組み立てをどの層で行うか**
    - 選択: `frontend/src/lib/api/game.ts` で行う。
    - 根拠: page / component に URL 組み立てを埋め込まず、`elements.ts` と同じ API client 層に閉じる。

12. **正規化済みの検索条件をどこで保持するか**
    - 選択: 検索条件は対象外。正規化済み `mode` は `/game/play` page の derived state で保持し、API client には `GameMode` 型として渡す。
    - 根拠: `mode` の検証を page で一度だけ行えば、API client は不正値を受けにくくなる。backend でも zod で再検証する。

13. **エラー表示に toast を使うか、画面内表示にするか**
    - 選択: 初回取得失敗は画面内エラー、再取得失敗や手動リトライ失敗は toast 併用。
    - 根拠: ゲーム開始不能は画面の主状態なので画面内に残す必要がある。toast は補助通知に留める。

14. **既存コンポーネントを再利用するか、新規作成するか**
    - 選択: 既存 `GameProgressIndicator`, `GameTimerBar`, `GameChoiceButton`, `GameFeedbackPanel` を再利用し、API 接続用の表示状態だけ page で追加する。
    - 根拠: UI は既に実装済み。API 契約のためにコンポーネントを作り直さず、データ供給層を差し替える。

15. **`GET /game/questions` に rate limit を適用するか**
    - 選択: 適用する。
    - 根拠: GET だが `GameQuestionSet` を作成する DB 書き込み API であり、連打で一時データが増える。既存 rateLimit middleware を使う。

16. **問題取得時に既存の未使用 `GameQuestionSet` を削除するか**
    - 選択: 初期実装では期限切れ削除のみ service 内で安全に行い、同一ユーザーの未期限切れセット削除は `POST /game/sessions` と cleanup タスクで扱う。
    - 根拠: 開始済みゲームの別タブ・戻る操作を壊すリスクがある。負荷対策は rate limit と期限切れ cleanup を優先する。

## 公開インターフェース案（必要な場合）

### `frontend/src/lib/game/types.ts`

```ts
export type GameQuestionsResponse = {
  questionSetId: string;
  expiresAt: string;
  questions: GameApiQuestion[];
};

export type GameApiQuestion = {
  questionId: string;
  prompt: string;
  choices: GameApiChoice[];
};

export type GameApiChoice = {
  choiceId: string;
  text: string;
};

export type GameSessionAnswerDraft = {
  questionId: string;
  chosenChoiceId: string | null;
  answerTimeSec: number;
};
```

### `frontend/src/lib/api/game.ts`

```ts
export type GetGameQuestionsOptions = {
  mode: GameMode;
  accessToken: string;
  signal?: AbortSignal;
};

export function getGameQuestions(options: GetGameQuestionsOptions): Promise<GameQuestionsResponse>;
```

### `backend/src/services/game.service.ts`

```ts
export type PublicGameQuestion = {
  questionId: string;
  prompt: string;
  choices: { choiceId: string; text: string }[];
};

export type CreateGameQuestionSetResult = {
  questionSetId: string;
  expiresAt: Date;
  questions: PublicGameQuestion[];
};

export function createGameQuestionSet(params: {
  userId: string;
  mode: GameMode;
  now?: Date;
}): Promise<CreateGameQuestionSetResult>;
```

## タスクリスト（進捗管理）

| タスクID | 内容 | ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存仕様・既存実装を確認する | `docs/05_progress.md`, `docs/04_api.md`, `docs/plans/game-screens/plan.md`, `backend/src/routes/game/index.ts`, `frontend/src/routes/(app)/game/play/+page.svelte` | `GET /game/questions` 未確定箇所、mock UI、`GameQuestionSet` 制約を把握する | 高 |
| T2 | 進捗を実装中へ更新する | `docs/05_progress.md` | `GET /game/questions` レスポンス形式確定タスクを `[-]` にする | 中 |
| T3 | API 契約を docs に確定する | `docs/04_api.md` | `questionSetId`, `expiresAt`, `questions`, `choices`, エラー仕様、`POST /game/sessions` との接続点が記載される | 高 |
| T4 | backend query validation 方針を実装する | `backend/src/routes/game/index.ts` | `mode` を zod で検証し、不正値は日本語 400 を返す | 高 |
| T5 | backend service 契約を実装する | `backend/src/services/game.service.ts` | 問題生成、4択生成、`GameQuestionSet` 保存、公開レスポンス変換の責務が service に集約される | 高 |
| T6 | `GameQuestionSet.questions` 保存形式を実装する | `backend/src/services/game.service.ts` | DB 内保存形式と公開レスポンス形式が分離される | 高 |
| T7 | rate limit と route mount を追加する | `backend/src/routes/game/index.ts`, `backend/src/index.ts` | `/api/v1/game/questions` が認証・rate limit 付きで呼べる | 高 |
| T8 | frontend 型定義を更新する | `frontend/src/lib/game/types.ts` | API レスポンス型と mock 専用型が分離される | 高 |
| T9 | frontend API client を追加する | `frontend/src/lib/api/game.ts` | `getGameQuestions({ mode, accessToken, signal })` が `API_BASE_URL` と `parseErrorResponse()` を使う | 高 |
| T10 | API client の runtime validation を実装する | `frontend/src/lib/api/game.ts` | レスポンス形式不正なら `ApiError(500, "ゲーム問題のレスポンス形式が不正です", data)` を投げる | 高 |
| T11 | `/game/play` の状態管理を API 接続向けに整理する | `frontend/src/routes/(app)/game/play/+page.svelte` | `mode` 正規化、loading、error、empty、abort、request sequence、再取得の責務が重複なく整理される | 高 |
| T12 | mock 問題と API 問題の切り替え方針を決める | `frontend/src/lib/game/mock-questions.ts`, `frontend/src/routes/(app)/game/play/+page.svelte` | API 接続後に mock を test fixture / 開発 fallback など限定用途にする | 中 |
| T13 | 回答 draft を API 送信用に分離する | `frontend/src/lib/game/play.ts`, `frontend/src/lib/game/types.ts` | 本番送信型に `isCorrect` を含めず、`questionId`, `chosenChoiceId`, `answerTimeSec` のみを保持できる | 高 |
| T14 | ローディング・空状態・エラー状態を実装する | `frontend/src/routes/(app)/game/play/+page.svelte` | 初回取得中、0問、API エラー、期限切れ再取得導線が日本語で表示される | 高 |
| T15 | backend route / service テストを作成する | `backend/src/routes/game/questions.test.ts`, `backend/src/services/game.service.test.ts` | 認証、mode validation、10問、4択、`questionSetId`, 正解非露出、苦手5件未満、500 が検証される | 高 |
| T16 | frontend API client テストを作成する | `frontend/src/lib/api/game.test.ts` | query、Authorization、AbortSignal、非 JSON エラー、レスポンス形式不正を検証する | 高 |
| T17 | frontend helper / page 関連テストを更新する | `frontend/src/lib/game/play.test.ts` | API 送信用 answer draft、空回答、時間境界、mode 正規化が検証される | 高 |
| T18 | lint を実行する | `backend/`, `frontend/` | 対象範囲に応じて `npm run lint` が通る | 高 |
| T19 | format を実行する | `backend/`, `frontend/` | 対象範囲に応じて `npm run format` または `npm run format:check` が通る | 高 |
| T20 | test を実行する | `backend/`, `frontend/` | 対象範囲に応じて `npm run test -- --run` / `npm run test:run` が通る | 高 |
| T21 | 手動確認を実施する | ブラウザ | `/game` から開始、問題取得中、成功、API エラー、再読み込み、モバイル表示を確認する | 高 |
| T22 | 実装完了更新を行う | `docs/05_progress.md`, `docs/plans/game-screens/plan.md` | 進捗を `[x]` にし、実装完了セクションへ変更点・実ファイル・確認結果を記録する | 中 |

- [x] T1: 既存仕様・既存実装を確認する
- [x] T2: 進捗を実装中へ更新する
- [x] T3: API 契約を docs に確定する
- [x] T4: backend query validation 方針を実装する
- [x] T5: backend service 契約を実装する
- [x] T6: `GameQuestionSet.questions` 保存形式を実装する
- [x] T7: rate limit と route mount を追加する
- [x] T8: frontend 型定義を更新する
- [x] T9: frontend API client を追加する
- [x] T10: API client の runtime validation を実装する
- [ ] T11: `/game/play` の状態管理を API 接続向けに整理する
- [ ] T12: mock 問題と API 問題の切り替え方針を決める
- [ ] T13: 回答 draft を API 送信用に分離する
- [ ] T14: ローディング・空状態・エラー状態を実装する
- [x] T15: backend route / service テストを作成する
- [x] T16: frontend API client テストを作成する
- [ ] T17: frontend helper / page 関連テストを更新する
- [x] T18: lint を実行する
- [x] T19: format を実行する
- [x] T20: test を実行する
- [ ] T21: 手動確認を実施する
- [x] T22: 実装完了更新を行う

## 技術的注意点

- `GET /game/questions` は route 入口で zod validation を行う。
- backend の import path は `.js` 拡張子を付ける。
- `PrismaClient` 生成箇所は既存 `backend/src/lib/prisma.ts` を使い、新規生成しない。
- `GameQuestionSet` 作成時は `expiresAt = now + 30分` にする。
- `GameQuestionSet.questions` は10問分の判定に必要な最小情報だけ保存する。
- 古い `GameQuestionSet` cleanup はフェーズ7の別タスクだが、期限切れ削除を service 内で安全に行う場合はテストする。
- 問題数は `GAME_QUESTION_COUNT = 10` と整合させる。
- 選択肢数は4件固定とする。
- 苦手モードは frontend の guard だけに依存せず、backend service で必ず 409 を返す。
- `choiceId` はレスポンス上の抽象 ID として扱い、frontend UI は `elementId` を知らなくてよい。
- API client は `API_BASE_URL` を import し、環境変数を直接読まない。
- API client は `response.ok` を JSON parse 前に確認する。
- API client は `parseErrorResponse(response, "ゲーム問題の取得に失敗しました")` を使う。
- ネットワークエラーは page 側で `ApiError` 以外として扱い、日本語 fallback を表示する。
- `/game/play` で request が重なった場合、古い response が新しい state を上書きしないよう request sequence か AbortController を使う。
- 初回 loading 中は二重開始・二重取得が起きない UI にする。
- API 接続後は `MockGamePlayQuestion.correctChoiceId` に依存した即時正誤フィードバックを本番データへ混ぜない。
- 本番 API 接続では回答直後の正解表示をどう扱うか、`POST /game/sessions` 確定タスクで最終判断する。

## A11Y要件

| 対象 | 要件 |
|---|---|
| 初回 loading | `aria-busy="true"` を使い、ゲーム開始準備中であることを画面内テキストで表示する |
| エラー状態 | toast だけに依存せず、画面内にエラー本文と再試行導線を残す |
| 空状態 | 0問の場合も空の選択肢領域を出さず、日本語メッセージと戻る導線を表示する |
| 進捗 | 既存 `GameProgressIndicator` のテキスト進捗を維持する |
| タイマー | 毎秒 `aria-live` で読み上げない。残り少ない状態は色だけに依存しない |
| 選択肢 | `button` として実装し、1〜4 の番号をテキストで表示する |
| キーボード | API loading / error / feedback 中は 1〜4 キーで誤回答が入らない |
| focus | エラーから再試行後、ゲーム本文または問題領域へ自然に戻れるようにする |
| レスポンシブ | 390px 幅で loading / error / 選択肢文言が横にはみ出さない |

## DB整合性・負荷に関する注意

- `GET /game/questions` は GET だが DB 書き込みを伴うため、実装・運用上は副作用あり API として扱う。
- 1リクエストあたり作成する `GameQuestionSet` は1件、保存 JSON は10問分に限定する。
- 元素マスターは118件のため、通常モードの候補取得は過度な負荷になりにくい。
- 苦手モードは `WeakElement` を userId で絞り、必要フィールドだけ select / include する。
- 生 SQL は使わず、Prisma ORM の `findMany`, `create`, 必要に応じて `deleteMany` を使う。
- `GET /game/questions` 連打対策として、frontend は loading 中の再取得を抑止し、backend は rate limit を適用する。
- `GameQuestionSet` の期限切れ cleanup はフェーズ7の明示タスクとして残す。実装時に route 内で軽量 cleanup を行う場合は、毎リクエストで広範囲 delete しない。
- `POST /game/sessions` では `questionSetId`, `userId`, `mode`, `expiresAt` を照合し、正誤判定後に当該 `GameQuestionSet` を削除する方針を維持する。

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| 初期表示で問題一覧が取得される | `/game/play?mode=SYMBOL_TO_NAME_LV1` で `GET /game/questions` が呼ばれ、10問が表示される |
| 有効な mode | 200 で `questionSetId`, `expiresAt`, `questions` を返す |
| mode 未指定 | 400 バリデーションエラー |
| mode 不正値 | 400 バリデーションエラー |
| 未ログイン | 401 の日本語エラー |
| メール未確認・停止・ロック | auth middleware の 403 日本語エラー |
| 通常モード | 10問・各4択が返る |
| 苦手モードで苦手元素5件未満 | 409 の日本語エラー |
| 苦手モードで苦手元素5件以上 | 10問・各4択が返る |
| レスポンスに正解情報が含まれない | `correctChoiceId`, `isCorrect`, 判定用 `elementId` が公開レスポンスに含まれない |
| `GameQuestionSet` が保存される | userId, mode, questions, expiresAt が Prisma 経由で保存される |
| `questionSetId` が返る | 保存した `GameQuestionSet.id` と一致する |
| `expiresAt` が返る | 30分後相当の ISO 文字列が返る |
| 選択肢が4件 | 各 question の choices が4件 |
| 選択肢 ID が重複しない | 1問内の `choiceId` が一意 |
| API client が query を組み立てる | `/game/questions?mode=...` へ fetch する |
| API client が Authorization を送る | `Authorization: Bearer <accessToken>` を含む |
| API client が AbortSignal を渡す | fetch options に signal が含まれる |
| API client の HTTP エラー | `ApiError` が throw され、backend の日本語 message を保持する |
| API client の非 JSON エラー | default message で `ApiError` が throw される |
| API client のレスポンス形式不正 | `ApiError(500, "ゲーム問題のレスポンス形式が不正です", data)` |
| `/game/play` loading | 読み込み中表示になり、選択肢の二重操作が起きない |
| `/game/play` API エラー | 画面内エラーと再取得導線が表示される |
| `/game/play` 0問 | 空状態として「問題を取得できませんでした」系の日本語表示になる |
| 再読み込み後 | URL の mode から再度問題を取得する |
| もう一度 | 新しい問題セットを取得する方針の場合、新しい `questionSetId` になる |
| A11Y | loading / error / empty / choices がキーボードと読み上げ順で破綻しない |
| モバイル | 390px 幅で loading / error / 選択肢文言がはみ出さない |
| lint | backend / frontend の対象 lint が通る |
| format | Prettier 整形が通る |
| test | backend / frontend の対象テストが通る |

## 実装リスクと回避策

| リスク | 影響 | 回避策 |
|---|---|---|
| `questionSetId` を docs にだけ書いて実装に反映し忘れる | `POST /game/sessions` と接続できない | backend / frontend 型とテストに `questionSetId` 必須を入れる |
| 正解情報がレスポンスに混入する | クライアント側で正解推測・改ざんが可能になる | public response mapper を作り、保存形式と公開形式を分ける |
| `elementId` という名前を公開し続ける | UI が DB ID に密結合する | 公開 API は `choiceId` に統一する |
| mock 用 `correctChoiceId` が本番型に混ざる | 型上は動くがセキュリティ方針と矛盾する | `MockGamePlayQuestion` と `GameApiQuestion` を分ける |
| 苦手モードの件数不足を frontend だけで防ぐ | API 直叩きで不整合が起きる | backend service で必ず 409 を返す |
| `GameQuestionSet` が多重作成される | DB に不要データが溜まる | 開始中 disabled、AbortController、rate limit、期限切れ cleanup 方針を実装する |
| 古い API response が新しい mode を上書きする | 画面と URL がズレる | request sequence または AbortController を使う |
| 非 JSON 502/504 で画面がクラッシュする | エラー表示できない | `parseErrorResponse()` と try-catch パターンを守る |
| `POST /game/sessions` 仕様と再度ズレる | 後続実装で手戻りが出る | 本計画で最低限 `questionSetId`, `questionId`, `chosenChoiceId` を接続点として固定する |
| 即時フィードバックができなくなる | 既存 mock UI と UX が変わる | API 接続タスクで UX 変更を明示し、結果表示のタイミングを `POST /game/sessions` 計画に合わせる |

## 手動確認項目

| 項目 | 確認内容 |
|---|---|
| `/game` から開始 | 通常モード開始で `/game/play?mode=...` に遷移する |
| 初回 loading | 問題取得中に画面が崩れず、二重取得が起きない |
| 問題取得成功 | 10問、4択、進捗、タイマーが表示される |
| `questionSetId` | Network response に `questionSetId` と `expiresAt` が含まれる |
| 正解非露出 | Network response に `correctChoiceId`, `isCorrect`, 判定用 `elementId` が含まれない |
| 未ログイン | ログイン導線または 401 エラーが日本語で表示される |
| 不正 mode | 日本語エラーと `/game` へ戻る導線が表示される |
| API 500 | 画面内エラーと再読み込み導線が表示される |
| 非 JSON エラー | クラッシュせず fallback message が表示される |
| もう一度 | 新しい問題セットを取得する方針の場合、新しい `questionSetId` になる |
| PC 幅 | 問題・選択肢・エラー表示が既存 layout 内に収まる |
| モバイル幅 390px | 選択肢・loading・error 文言がはみ出さない |
| キーボード | loading / error / feedback 中に誤回答が入らない |
| コンソール | hydration mismatch や未処理 promise rejection が出ない |

## 実装完了時の更新ルール

実装完了時は以下を必ず行う。

- `docs/05_progress.md` の `GET /game/questions のレスポンス形式（問題・選択肢・questionSetId）を決定` を `[x]` に更新する。
- `docs/plans/game-screens/plan.md` の該当チェックボックスを `[x]` に更新する。
- `docs/04_api.md` の `GET /game/questions` が実装と一致していることを確認する。
- `POST /game/sessions` 側に影響する決定は、同セクションまたは確認事項へ記録する。
- 計画と実装で変更ファイルが異なった場合、対象ファイル一覧を実態に合わせて更新する。
- 設計判断が変わった場合、`## 実装完了` の「計画からの変更点」に記録する。
- 実行した lint / format / test / 手動確認を `## 実装完了` に記録する。

## 実装完了（GET /game/questions レスポンス形式確定）

- 完了日: 2026-06-20
- 実装ブランチ: feature/game-questions-response
- PR: #51

### 計画からの変更点
- `GET /game/questions` の契約確定に加え、backend route / service と frontend API client まで実装した。
- `/game/play` の live API 接続は今回実施しなかった。理由は、正解情報をレスポンスに含めない方針と既存の即時フィードバック UI が衝突するため。画面接続は `POST /game/sessions` の仕様確定と合わせて扱う。
- `GET /game/questions` は実装したが、フェーズ7の `GET /game/questions（ランダム10問...）` タスクは問題候補のランダム抽出・cleanup・画面接続の判断が残るため、本完了記録ではフェーズ6のインターフェース確定のみ完了扱いにした。選択肢内の正解位置は本タスクのレビュー対応でランダム化済み。
- backend build で既存の `backend/src/middleware/admin/index.ts` の import path 不整合が検出されたため、`../types/index.js` から `../../types/index.js` へ修正した。
- レビューで、選択肢の先頭が常に正解になる実装を検出したため、正解位置を問題ごとに変える生成ロジックと回帰テストを追加した。
- 実機確認で `/game/play` の UI mock 問題が `1,2,3,4` の固定パターンになっていることを確認したため、`frontend/src/lib/game/mock-questions.ts` の正解位置を、SSR/CSR で一致する決定的な疑似ランダム順に変更した。

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `docs/04_api.md` | 修正 | `GET /game/questions` レスポンス形式を更新 |
| `docs/05_progress.md` | 修正 | 進捗更新 |
| `docs/plans/game-screens/plan.md` | 修正 | 実装完了記録 |
| `backend/src/index.ts` | 修正 | game ルーターを `/api/v1/game` に mount |
| `backend/src/middleware/admin/index.ts` | 修正 | build で検出された import path を修正 |
| `backend/src/routes/game/index.ts` | 修正 | `GET /questions` route、認証、rate limit、zod validation、エラー処理を追加 |
| `backend/src/routes/game/questions.test.ts` | 新規 | `GET /game/questions` route テストを追加 |
| `backend/src/services/game.service.ts` | 修正 | 問題生成、4択生成、`GameQuestionSet` 保存、公開レスポンス変換を追加 |
| `backend/src/services/game.service.test.ts` | 新規 | 問題生成・保存形式・正解非露出・正解位置固定防止・苦手不足の service テストを追加 |
| `frontend/src/lib/api/game.ts` | 新規 | `getGameQuestions()` API client と runtime validation を追加 |
| `frontend/src/lib/api/game.test.ts` | 新規 | game API client テストを追加 |
| `frontend/src/lib/game/mock-questions.ts` | 修正 | UI mock 問題の正解位置を決定的な疑似ランダム順へ変更 |
| `frontend/src/lib/game/mock-questions.test.ts` | 新規 | UI mock 問題の正解位置生成テストを追加 |
| `frontend/src/lib/game/types.ts` | 修正 | `GameQuestionsResponse`, `GameApiQuestion`, `GameSessionAnswerDraft` を追加 |

### 品質チェック
| コマンド | 結果 |
|---|---|
| `cd backend && npm run test -- --run src/services/game.service.test.ts src/routes/game/questions.test.ts` | Red: `createGameQuestionSet` / `gameRouter` 未実装で失敗 |
| `cd backend && npm run test -- --run src/services/game.service.test.ts src/routes/game/questions.test.ts` | Green: OK（2 files / 10 tests） |
| `cd frontend && npm run test:run -- src/lib/api/game.test.ts` | Red: `frontend/src/lib/api/game.ts` 未作成で失敗 |
| `cd frontend && npm run test:run -- src/lib/api/game.test.ts` | Green: OK（1 file / 6 tests） |
| `cd backend && npm run format` | OK |
| `cd frontend && npm run format` | OK |
| `cd backend && npm run lint` | OK |
| `cd backend && npm run format:check` | OK |
| `cd backend && npm run build` | OK |
| `cd frontend && npm run lint` | OK |
| `cd frontend && npm run check` | OK（0 errors / 0 warnings） |
| `cd backend && npm run test -- --run` | OK（21 files / 162 tests） |
| `cd frontend && npm run test:run` | OK（15 files / 181 tests） |

### 手動確認
| 条件 | 結果 |
|---|---|
| `/game` から開始 | 未実施: `/game/play` はまだ mock 問題を利用しており、live API 接続は今回スコープ外 |
| `/game/play` 問題取得成功 | 未実施: API client と backend route は unit test で確認 |
| `questionSetId` 確認 | OK: backend route test / frontend API client test で確認 |
| 正解情報非露出 | OK: service test / API client runtime validation test で確認 |
| API エラー表示 | 未実施: 画面接続は `POST /game/sessions` 仕様確定後に実施 |
| モバイル幅 390px | 未実施: 画面変更なし |

## 後続タスク整理（POST /game/sessions と /game/result）

`GET /game/questions` は PR #51 で `questionSetId` を返し、正解情報をクライアントへ渡さない形で確定した。次に実装するべき中核は `POST /game/sessions` であり、ゲーム結果画面 `/game/result` はそのレスポンスを表示元として実装する。

### 実装順序

1. `POST /game/sessions` のリクエスト/レスポンス形式を確定する。
2. `POST /game/sessions` を実装し、`questionSetId` をもとにサーバー側で正誤判定・スコア計算・DB 更新を行う。
3. `/game/play` から `POST /game/sessions` へ回答を送信し、成功レスポンスを結果表示へ渡す。
4. `/game/result` を実装し、`POST /game/sessions` のレスポンスだけを信頼してスコア・最大連続正解・間違え一覧を表示する。

### `/game/result` の前提

- `/game/result` は `POST /game/sessions` の後続タスクとして扱う。
- `/game/result` は `GET /game/questions` のレスポンスや UI mock の `correctChoiceId` から正誤・スコアを計算しない。
- 表示元は `POST /game/sessions` の `sessionId`, `correctCount`, `totalScore`, `maxStreak`, `results` とする。
- 「もう一度」は同じ `mode` で新しい問題セットを取得して `/game/play` を開始する導線にする。
- 「ホームへ」はトップページ `/` へ戻す導線にする。モード選択へ戻す導線が必要な場合は別ボタンとして検討する。
- 直接 `/game/result` を開いた場合、表示できる結果がないときは `/game` へ戻る導線を出す。

### `POST /game/sessions` で先に固めるべき点

| 項目 | 方針 |
|---|---|
| 入力 | `questionSetId`, `mode`, `answers[].questionId`, `answers[].chosenChoiceId`（時間切れ時は `null`）, `answers[].answerTimeSec`, `durationSec` |
| 正誤判定 | `GameQuestionSet.questions` の保存済み `correctChoiceId` を使い、サーバー側で行う |
| スコア計算 | サーバー側で行い、`totalScore` と各問の `score` をレスポンスに含める |
| 連続正解 | サーバー側で `maxStreak` を計算して返す |
| 間違え一覧 | `/game/result` が表示できるよう、`results` に `isCorrect`, `correctAnswer`, `yourAnswer`, `elementId` を含める |
| `GameQuestionSet` | userId, mode, expiresAt を照合し、正誤判定後に削除する |
| 不正・期限切れ | 別ユーザーの `questionSetId`、期限切れ、不足回答、不正な `questionId` / `chosenChoiceId` を日本語エラーで返す |
| DB 更新 | `GameSession`, `GameAnswer`, `WeakElement`, `UserStats` をサーバー側トランザクションで更新する |

---

# ゲームプレイ画面 `/game/play` 実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、ゲーム UX・状態設計）
> 対象実装者: Codex

## 概要

`docs/05_progress.md` フェーズ6「UI モック（ゲーム）」のうち、ゲームプレイ画面 `/game/play`（インジケーター・15秒タイマー・4択・正誤フィードバック・1〜4キー操作）を実装する。

既存のゲームモード選択画面 `/game` は `feature/game-mode-select` / PR #46 で実装済みであり、`docs/05_progress.md` でも `[x]` になっている。本計画は、同じ `docs/plans/game-screens/plan.md` に紐づく次タスクとして、`/game/play` の UI モックとゲーム進行ロジックの土台をレビュー改善した版である。

現状、`backend/src/routes/game/index.ts` と `backend/src/services/game.service.ts` は TODO、`backend/src/index.ts` に game ルーターも mount されていない。そのため本タスクでは live API 接続を行わず、フロントエンド内の mock question set で UX と状態遷移を固める。API 接続、サーバー側正誤判定、スコア保存、苦手更新はフェーズ7または API インターフェース確定タスクで扱う。

## レビュー結果と改善方針

| 観点 | レビュー結果 | 改善方針 |
|---|---|---|
| 既存コード整合性 | `/game` は実装済みだが、開始ボタンは `/game/play` 未実装のため toast で止めている | `/game` の `handleStart` を `/game/play?mode=...` 遷移に差し替えるタスクを含める |
| 仕様整合性 | `docs/01_features.md` は10問、15秒、1.5秒フィードバック、1〜4キーを要求している | 10問・15秒・1.5秒を定数化し、クリック/キー/時間切れの3経路を同じ回答処理に集約する |
| API 整合性 | `docs/04_api.md` の `GET /game/questions` は `questionSetId` がレスポンス例に未反映で、`elementId` 露出により正解推測も可能 | 今回は API を呼ばず、mock 専用型と将来 API 型を分離する。API 確定タスクで `questionSetId` と正解非露出の仕様を修正する |
| セキュリティ | フロントだけで正誤判定・スコア計算を完結させると改ざんできる | mock 判定は UI 確認専用と明記し、本番の正誤判定・スコア保存は `POST /game/sessions` のサーバー側に限定する |
| A11Y | 色だけの正誤表示、毎秒 `aria-live`、グローバル keydown の過剰反応は操作体験を損なう | 正誤テキストを併記し、タイマーは過剰読み上げしない。キー操作は回答可能 phase のみ受け付ける |
| DB 整合性・負荷 | UI モックで `GET /game/questions` を連打すると、将来 `GameQuestionSet` が多重作成される設計になりやすい | 本タスクでは DB に触らない。将来 API 接続時は開始中 disabled、AbortController、有効期限切れ cleanup を計画に残す |
| テスト | UI だけを手動確認するとタイマー境界・時間切れ・キー操作の回帰を拾いにくい | `play.ts` の純粋関数をユニットテストし、タイマー/keydown は手動確認項目として明確化する |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- `ゲームモード選択画面 /game（モード一覧・苦手5問未満ガード表示）` は完了済み。
- `ゲームプレイ画面 /game/play（インジケーター・15秒タイマー・4択・正誤フィードバック・1〜4キー操作）` は未実装。
- `GET /game/questions` と `POST /game/sessions` の API インターフェース確定は未実装。
- 設計決定2として、将来の `GET /game/questions` は `GameQuestionSet` を保存し `questionSetId` を返す。

**`docs/01_features.md`**
- `GameMode` は以下の6種。
  - `SYMBOL_TO_NAME_LV1`
  - `SYMBOL_TO_NAME_LV2`
  - `NAME_TO_SYMBOL_LV1`
  - `NAME_TO_SYMBOL_LV2`
  - `WEAK_SYMBOL_TO_NAME`
  - `WEAK_NAME_TO_SYMBOL`
- 1ゲームは10問。
- 各問のタイムリミットは15秒。
- 選択または時間切れ後、正誤フィードバックを1.5秒表示する。
- 問題画面ではインジケーター、カウントダウンバー、問題文、4択ボタンを表示する。
- 問題回答時に `1` `2` `3` `4` キーで選択肢を選べる。
- ブラウザを閉じた場合の sessionStorage 中断復帰は将来仕様として存在する。

**`docs/04_api.md`**
- `GET /game/questions`
  - 認証必須。
  - query: `mode: GameMode`
  - 現状レスポンス例には `questionSetId` がないため、API インターフェース確定タスクで修正が必要。
- `POST /game/sessions`
  - 認証必須。
  - 現行案は `mode` と `answers` を送信する。
  - 設計決定2と整合させるため、将来は `questionSetId` をリクエストに含める必要がある。

**`backend/prisma/schema.prisma`**
- `GameMode` enum は6種定義済み。
- `GameQuestionSet` は `id`, `userId`, `mode`, `questions`, `expiresAt`, `createdAt` を持つ。
- `GameSession` は `mode`, `totalScore`, `correctCount`, `totalCount`, `maxStreak`, `durationSec` を持つ。
- `GameAnswer` は `elementId`, `isCorrect`, `answerTimeSec` を持つ。
- `WeakElement` は `userId`, `elementId`, `missCount`, `consecutiveHit` を持つ。

**`backend/src/routes/game/index.ts`**
- 現状 `// TODO: implement`。
- 本タスクでは変更しない。

**`backend/src/services/game.service.ts`**
- 現状 `// TODO: implement`。
- 本タスクでは変更しない。

**`backend/src/index.ts`**
- mount 済みルーターは `/api/v1/auth`、`/api/v1/elements`、`/api/v1/users`。
- game ルーターは未 mount。

**`frontend/src/lib/game/constants.ts`**
- `MIN_WEAK_ELEMENTS_FOR_GAME: 5`
- 本タスクで `GAME_QUESTION_COUNT`, `QUESTION_TIME_LIMIT_SEC`, `ANSWER_FEEDBACK_MS` を追加する。

**`frontend/src/lib/game/types.ts`**
- `GameMode` — 6種類のゲームモード。
- `GameModeConfig` — `/game` のモード表示設定。
- `GameModeStartAvailability` — 開始可否とガード文言。
- `GameModeStartHandler` — mode を受け取る開始ハンドラー型。
- 本タスクでプレイ画面用の問題・選択肢・回答・phase 型を追加する。

**`frontend/src/lib/game/modes.ts`**
- `GAME_MODE_CONFIGS: readonly GameModeConfig[]`
- `getGameModeConfig(mode: GameMode): GameModeConfig`
- `isWeakGameMode(mode: GameMode): boolean`
- `getGameModeStartAvailability(mode: GameMode, weakCount: number | null): GameModeStartAvailability`

**`frontend/src/routes/(app)/game/+page.svelte`**
- モード一覧、未ログイン導線、苦手5問未満ガードを実装済み。
- 現在は開始ボタン押下時に `/game/play` へ遷移せず、toast で「プレイ画面は後続タスクで実装します。」を表示する。

**`frontend/src/routes/(app)/+layout.svelte`**
- Header / Footer / `main.max-w-5xl` を提供する。
- `/game/play` はこの既存レイアウト内で成立するレスポンシブ UI とする。

**`frontend/src/lib/stores/auth.svelte.ts`**
- `authStore.isInitializing: boolean`
- `authStore.isLoggedIn: boolean`
- `authStore.accessToken: string | null`
- `authStore.user: AuthUser | null`
- `/game/play` は認証状態の初期化完了を待ち、未ログイン時は `/login` へ誘導する。

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.info(message: string): string`
- `toastStore.warning(message: string): string`
- `toastStore.error(message: string): string`
- `toastStore.fromApiError(error: ApiError): string`

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL: string`
- 将来 API 接続時はこのファイルから import し、各画面で環境変数を直接読まない。

**`frontend/src/lib/api/errors.ts`**
- `ApiError`
- `parseErrorBody(response: Response): Promise<ErrorBody>`
- `parseErrorResponse(response: Response, defaultMessage?: string): Promise<never>`
- 将来 API 接続時は `response.ok` を JSON パース前に確認し、非 JSON エラーにも対応する。

**`frontend/src/routes/(app)/elements/+page.svelte`**
- Svelte 5 Runes、`authStore.isInitializing` 待ち、loading / error / empty / success 状態、AbortController、toast 利用の参考実装。

### 重要な制約

- 本タスクは `/game/play` の UI モック範囲に限定する。
- backend game API の live fetch は行わない。
- `GET /game/questions` の正解情報をクライアントに渡さない本番方針は維持する。
- UI モック用の正解情報は `MockGamePlayQuestion` に閉じ、将来 API 型に混ぜない。
- 本番の正誤判定・スコア計算・苦手更新はサーバー側で行う前提を崩さない。
- `localStorage` に認証情報・ゲーム状態・回答内容を保存しない。
- sessionStorage 中断復帰は本タスクでは実装しない。将来タスクとして設計を分ける。
- Svelte 5 Runes（`$state`, `$derived`, `$effect`, `$props`）を使う。
- `authStore.isInitializing` 中はログイン状態を確定表示しない。
- `mode` query は一度だけ正規化し、正規化済み値を再利用する。
- タイマー、フィードバック timeout、keydown listener は `onDestroy` で必ず解除する。
- 数値定数（10問、15秒、1.5秒）は `frontend/src/lib/game/constants.ts` に集約し、UI に直書きしない。
- ゲーム進行ロジックは `frontend/src/lib/game/play.ts` に集約し、page / component に重複定義しない。
- API ベース URL や共通エラー処理を各ファイルで重複定義しない。
- UI 文言・エラー・ガードメッセージは日本語に統一する。
- Tailwind の既存 `brand` / `ink` / gray 系のトーンに寄せ、既存画面から極端に浮かないデザインにする。
- カード内カードを避け、問題表示・選択肢・状態表示を読みやすく構成する。
- モバイル幅で選択肢、キー番号、フィードバック文言がはみ出さないようにする。
- Prettier `tabWidth: 2` に従う。

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/game/constants.ts` | 修正 | 10問、15秒、1.5秒フィードバックの定数を追加 |
| `frontend/src/lib/game/types.ts` | 修正 | 問題、選択肢、回答、ゲーム進行 phase、プレイ画面用 handler 型を追加 |
| `frontend/src/lib/game/play.ts` | 新規 | mode query 正規化、回答判定、次問遷移、進捗、タイマー率、サマリー算出 |
| `frontend/src/lib/game/play.test.ts` | 新規 | mode 正規化、回答判定、時間切れ、進捗、タイマー境界のユニットテスト |
| `frontend/src/lib/game/mock-questions.ts` | 新規 | UI モック用の10問問題セット生成 |
| `frontend/src/lib/components/game/GameProgressIndicator.svelte` | 新規 | 10問分の進捗インジケーター |
| `frontend/src/lib/components/game/GameTimerBar.svelte` | 新規 | 15秒カウントダウンバー |
| `frontend/src/lib/components/game/GameChoiceButton.svelte` | 新規 | 4択ボタン、キー番号、選択状態表示 |
| `frontend/src/lib/components/game/GameFeedbackPanel.svelte` | 新規 | 正解・不正解・時間切れフィードバック |
| `frontend/src/routes/(app)/game/+page.svelte` | 修正 | `/game/play?mode=...` への開始導線に変更 |
| `frontend/src/routes/(app)/game/play/+page.ts` | 新規 | `ssr = true`, `prerender = false` を明示 |
| `frontend/src/routes/(app)/game/play/+page.svelte` | 新規 | プレイ画面本体、タイマー、キー操作、4択、フィードバック、完了表示 |
| `docs/05_progress.md` | 修正 | 実装時に `/game/play` を `[-]`、完了時に `[x]` へ更新 |
| `docs/plans/game-screens/plan.md` | 修正 | 本計画、チェックボックス、実装完了記録を更新 |

## API 仕様（この機能で使う範囲のみ）

### エラーレスポンス共通形式

```json
{ "error": "メッセージ文字列" }
```

ステータスコード: 400 / 401 / 403 / 404 / 409 / 429 / 500 / 502 / 504

### 今回の実装での API 利用

| メソッド | パス | 認証 | 今回の呼び出し | 理由 |
|---|---|---|---|---|
| GET | `/api/v1/game/questions?mode=...` | 必須 | 呼び出さない | backend 未実装・未 mount のため |
| POST | `/api/v1/game/sessions` | 必須 | 呼び出さない | backend 未実装・未 mount のため |

### 将来接続する API 仕様案

#### GET `/game/questions`

| 項目 | 内容 |
|---|---|
| 認証 | 必須 |
| Query | `mode: GameMode` |
| 用途 | 10問の問題セットと `questionSetId` を取得する |
| 注意 | `questionSetId` は `POST /game/sessions` に渡す。正解情報の露出方針は API 確定タスクで再設計する |

想定レスポンス案:

```json
{
  "questionSetId": "cuid",
  "questions": [
    {
      "questionId": "q1",
      "prompt": "H",
      "choices": [
        { "choiceId": "c1", "text": "水素" },
        { "choiceId": "c2", "text": "炭素" },
        { "choiceId": "c3", "text": "酸素" },
        { "choiceId": "c4", "text": "窒素" }
      ]
    }
  ]
}
```

#### POST `/game/sessions`

| 項目 | 内容 |
|---|---|
| 認証 | 必須 |
| 用途 | 10問分の回答を送信し、サーバー側で正誤判定・スコア計算・苦手更新を行う |
| 注意 | UI モックでは呼び出さない。結果画面 `/game/result` 実装時に接続する |

想定リクエスト案:

```json
{
  "questionSetId": "cuid",
  "mode": "SYMBOL_TO_NAME_LV1",
  "answers": [
    {
      "questionId": "q1",
      "chosenChoiceId": "c1",
      "answerTimeSec": 5
    }
  ],
  "durationSec": 72
}
```

## 設計上の決定事項

1. **`/game/play` で live API fetch を行うか**
   - 選択: 今回は行わない。
   - 根拠: backend game API は TODO かつ未 mount。フェーズ6は UI モックで UX と API インターフェースを固める段階。

2. **問題データをどこに置くか**
   - 選択: `frontend/src/lib/game/mock-questions.ts` に UI モック専用データを置く。
   - 根拠: page に問題配列を直書きせず、将来 `getGameQuestions()` API クライアントに差し替えやすくする。

3. **正誤判定をどこで行うか**
   - 選択: UI モックでは `play.ts` の helper で判定する。将来 API 接続時はサーバー判定に差し替える。
   - 根拠: 現時点で即時フィードバックを確認するにはローカル判定が必要。ただし本番仕様では正解情報露出を避ける方針があるため、責務を隔離する。

4. **mode query の扱い**
   - 選択: `/game/play?mode=SYMBOL_TO_NAME_LV1` を受け取り、`normalizeGameModeParam()` で一度だけ検証する。
   - 根拠: URL 直打ち・不正値に対応しつつ、以降の処理では `GameMode` 型で安全に扱う。

5. **タイマーの実装方法**
   - 選択: `setInterval` で残り秒数を管理し、回答済み・時間切れ・フィードバック中・完了時に停止する。
   - 根拠: 15秒単位の UI モックには十分。`onDestroy` で解除し、離脱時のリークを防ぐ。

6. **時間切れの扱い**
   - 選択: 残り秒数が 0 になったら未回答として不正解扱いにし、時間切れフィードバックを表示する。
   - 根拠: 仕様の「選択または時間切れ → 正誤フィードバック」に合わせる。

7. **フィードバック後の遷移**
   - 選択: 1.5秒後に次問へ進む。10問目の後は `/game/result` 未実装のため、完了サマリーを画面内に表示し、結果画面は後続タスクとして toast または導線で示す。
   - 根拠: `/game/result` は別タスク。壊れた遷移を作らず、プレイ体験だけ完結させる。

8. **1〜4キー操作**
   - 選択: `keydown` listener を page で登録し、`Digit1`〜`Digit4` と `Numpad1`〜`Numpad4` を受け付ける。
   - 根拠: キーボード上段・テンキーの両方を自然に使えるようにする。

9. **回答ボタンの状態表示**
   - 選択: 選択後は全選択肢を disabled にし、選んだ選択肢と正解/不正解を視覚・テキストの両方で示す。
   - 根拠: 多重回答を防ぎ、色だけに依存しないフィードバックにする。

10. **ゲーム中断・再開**
    - 選択: 本タスクでは sessionStorage による中断復帰は実装しない。
    - 根拠: `docs/01_features.md` に将来仕様として存在するが、今回は画面モックの基本体験に集中する。保存形式は API 接続・結果画面と合わせて別途設計する。

11. **`/game` の開始導線をこのタスクで変更するか**
    - 選択: 変更する。
    - 根拠: `/game/play` が実装されると、既存 toast のままではユーザーがプレイ画面へ到達できない。`goto('/game/play?mode=...')` または link 相当の導線へ差し替える。

12. **API インターフェース確定タスクを同時に完了扱いにするか**
    - 選択: 完了扱いにしない。
    - 根拠: 本タスクで API 仕様案は記録するが、backend 実装・`docs/04_api.md` 更新・サーバー側テストを含まないため、`GET /game/questions` / `POST /game/sessions` の確定タスクは別途実施する。

## 公開インターフェース案

### `frontend/src/lib/game/constants.ts`

```ts
export const GAME_QUESTION_COUNT = 10;
export const QUESTION_TIME_LIMIT_SEC = 15;
export const ANSWER_FEEDBACK_MS = 1500;
```

### `frontend/src/lib/game/types.ts`

```ts
export type GameChoice = {
  choiceId: string;
  text: string;
};

export type GamePlayQuestion = {
  questionId: string;
  prompt: string;
  choices: readonly GameChoice[];
};

export type MockGamePlayQuestion = GamePlayQuestion & {
  correctChoiceId: string;
};

export type GameAnswerDraft = {
  questionId: string;
  chosenChoiceId: string | null;
  answerTimeSec: number;
  isCorrect: boolean;
  timedOut: boolean;
};

export type GamePlayPhase = 'answering' | 'feedback' | 'completed';
```

### `frontend/src/lib/game/play.ts`

```ts
export function normalizeGameModeParam(value: string | null): GameMode | null;

export function getProgressLabel(currentIndex: number, totalCount: number): string;

export function getTimerPercent(remainingSec: number, timeLimitSec: number): number;

export function buildAnswerDraft(params: {
  question: MockGamePlayQuestion;
  chosenChoiceId: string | null;
  remainingSec: number;
  timeLimitSec: number;
}): GameAnswerDraft;

export function getNextQuestionIndex(currentIndex: number, totalCount: number): number | null;

export function summarizeAnswers(answers: readonly GameAnswerDraft[]): {
  correctCount: number;
  totalCount: number;
};
```

### `frontend/src/lib/game/mock-questions.ts`

```ts
export function getMockGameQuestions(mode: GameMode): readonly MockGamePlayQuestion[];
```

## タスクリスト（進捗管理）

| タスクID | 内容 | ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 進捗を実装中へ更新する | `docs/05_progress.md` | `/game/play` タスクが `[ ]` から `[-]` に更新される | 中 |
| T2 | ゲームプレイ用の定数・型を追加する | `frontend/src/lib/game/constants.ts`, `frontend/src/lib/game/types.ts` | 10問、15秒、1.5秒、問題、選択肢、回答、phase 型が定義される | 高 |
| T3 | ゲーム進行 helper を実装する | `frontend/src/lib/game/play.ts` | mode query 検証、回答判定、タイマー率、進捗、サマリー算出が page から分離される | 高 |
| T4 | helper のユニットテストを作成する | `frontend/src/lib/game/play.test.ts` | 正常 mode、不正 mode、正解、不正解、時間切れ、進捗境界、タイマー境界のテストが通る | 高 |
| T5 | UI モック用問題セットを追加する | `frontend/src/lib/game/mock-questions.ts` | 6モードのいずれでも10問・各4択を返せる。選択肢 ID が重複しない | 高 |
| T6 | 進捗インジケーターを実装する | `frontend/src/lib/components/game/GameProgressIndicator.svelte` | 10問分の現在位置・回答済み状態がテキストと視覚の両方で分かる | 中 |
| T7 | 15秒タイマー表示を実装する | `frontend/src/lib/components/game/GameTimerBar.svelte` | 残り秒数とバーが表示され、0秒時にも崩れない | 高 |
| T8 | 4択ボタンを実装する | `frontend/src/lib/components/game/GameChoiceButton.svelte` | 1〜4の番号、選択肢テキスト、disabled、選択後状態を表示できる | 高 |
| T9 | 正誤フィードバックを実装する | `frontend/src/lib/components/game/GameFeedbackPanel.svelte` | 正解・不正解・時間切れの日本語メッセージを表示できる | 高 |
| T10 | `/game` から `/game/play` への導線を接続する | `frontend/src/routes/(app)/game/+page.svelte` | 開始可能な mode で `/game/play?mode=...` へ遷移する。多重クリック対策は維持される | 高 |
| T11 | `/game/play` route 設定を追加する | `frontend/src/routes/(app)/game/play/+page.ts` | `ssr = true`, `prerender = false` が明示される | 中 |
| T12 | `/game/play` page を実装する | `frontend/src/routes/(app)/game/play/+page.svelte` | 認証状態、mode 検証、問題表示、15秒タイマー、4択、正誤フィードバック、完了表示が動作する | 高 |
| T13 | キーボード操作を実装する | `frontend/src/routes/(app)/game/play/+page.svelte` | 回答可能中のみ `1`〜`4` / `Numpad1`〜`Numpad4` で回答できる | 高 |
| T14 | エラー・ガード状態を実装する | `frontend/src/routes/(app)/game/play/+page.svelte` | 未ログイン、不正 mode、問題生成失敗時に日本語メッセージと戻る導線が表示される | 高 |
| T15 | frontend lint を実行する | `frontend/` | `npm run lint` が通る | 高 |
| T16 | format を実行する | `frontend/` | `npm run format` 実行後に不要な差分がない | 高 |
| T17 | frontend test を実行する | `frontend/` | `npm run test:run` が通る | 高 |
| T18 | Svelte / TypeScript check を実行する | `frontend/` | `npm run check` が通る | 高 |
| T19 | 手動確認を実施する | ブラウザ | PC / モバイルで `/game` → `/game/play`、クリック回答、1〜4キー、時間切れ、完了表示を確認する | 高 |
| T20 | 進捗・計画書を実装完了へ更新する | `docs/05_progress.md`, `docs/plans/game-screens/plan.md` | `/game/play` タスクが `[x]` になり、実装完了セクションに実際の変更ファイルと確認結果が記録される | 中 |

- [x] T1: 進捗を実装中へ更新する
- [x] T2: ゲームプレイ用の定数・型を追加する
- [x] T3: ゲーム進行 helper を実装する
- [x] T4: helper のユニットテストを作成する
- [x] T5: UI モック用問題セットを追加する
- [x] T6: 進捗インジケーターを実装する
- [x] T7: 15秒タイマー表示を実装する
- [x] T8: 4択ボタンを実装する
- [x] T9: 正誤フィードバックを実装する
- [x] T10: `/game` から `/game/play` への導線を接続する
- [x] T11: `/game/play` route 設定を追加する
- [x] T12: `/game/play` page を実装する
- [x] T13: キーボード操作を実装する
- [x] T14: エラー・ガード状態を実装する
- [x] T15: frontend lint を実行する
- [x] T16: format を実行する
- [x] T17: frontend test を実行する
- [x] T18: Svelte / TypeScript check を実行する
- [x] T19: 手動確認を実施する
- [x] T20: 進捗・計画書を実装完了へ更新する

## 技術的注意点

- `GAME_QUESTION_COUNT`, `QUESTION_TIME_LIMIT_SEC`, `ANSWER_FEEDBACK_MS` を UI component に直書きしない。
- `GameMode` の文字列 union は Prisma の `GameMode` enum と一致させる。
- `mode` query の正規化は `normalizeGameModeParam()` に集約し、page 内で `GAME_MODE_CONFIGS.includes(...)` のような判定を重複させない。
- `MockGamePlayQuestion.correctChoiceId` は UI モック限定とし、将来 API レスポンス型には含めない。
- 正解判定、時間切れ回答生成、サマリー計算は `play.ts` に置き、Svelte component に重複実装しない。
- タイマー interval と feedback timeout は別々に管理し、状態遷移時に既存 timer を clear する。
- `keydown` listener は `onMount` / `onDestroy` で登録解除し、回答可能 phase 以外では何もしない。
- 選択肢ボタンは `disabled` 中でも理由・状態がテキストで分かるようにする。
- `aria-live` は正誤・時間切れ・完了の通知に限定し、毎秒の timer 更新を読み上げ続けない。
- 未ログイン時は `authStore.isInitializing` 完了後にログイン導線を表示する。初期化中に「未ログイン」と断定しない。
- `/game/play` 直打ちで mode が不正な場合は `/game` へ戻る link を表示する。
- 将来 API 接続する場合は `API_BASE_URL`、`Authorization: Bearer ${authStore.accessToken}`、`credentials: 'include'`、`parseErrorResponse` を使う。
- API エラー時はバックエンドの日本語メッセージを上書きしない。
- `response.json()` は `response.ok` チェック前に呼ばない。
- `<button>` と `<a>` の役割を混同しない。回答操作は button、画面遷移は link または `goto` を使う。
- モバイルでは選択肢を1列、広い画面では2列程度にし、ボタン内テキストがはみ出さないようにする。
- 結果画面 `/game/result` は別タスク。10問完了後は画面内 summary と戻る導線で完結させる。

## A11Y要件

| 対象 | 要件 |
|---|---|
| ページ構造 | `h1` は `/game/play` の画面名またはモード名にし、問題領域・進捗・選択肢を見出しで分ける |
| 進捗 | 視覚インジケーターだけでなく「3 / 10問」のようなテキストを併記する |
| タイマー | 残り秒数を表示するが、毎秒 `aria-live` で読み上げない。残り少ない状態は色だけに依存しない |
| 選択肢 | 4択は button として実装し、`1`〜`4` のキー番号をテキストで表示する |
| 正誤表示 | 正解/不正解/時間切れを文字で表示し、色だけに依存しない |
| キーボード | Tab で選択肢へ移動でき、`1`〜`4` / `Numpad1`〜`Numpad4` でも回答できる |
| 読み上げ順 | DOM順は「見出し → 進捗 → 問題文 → 選択肢 → フィードバック」の流れにし、見た目だけの grid 並び替えで読み上げ順を崩さない |
| focus | 回答後に focus が消失しない。次問遷移後も自然に問題領域へ戻れるようにする |
| disabled | フィードバック中・完了後の disabled 状態が見た目とテキストで分かる |
| レスポンシブ | 390px 幅でもタイマー、選択肢、フィードバック文言が切れない |

## DB整合性・負荷に関する注意

- 本タスクでは DB 読み書きを行わないため、DB 負荷は発生しない。
- `/game/play` 初期表示で `GET /game/questions` を呼ぶ実装は今回は行わない。
- Phase7 で `GET /game/questions` を接続する場合、`GameQuestionSet` が作成されるため、開始ボタンの多重クリック防止とリクエスト中断を必ず実装する。
- `GameQuestionSet.expiresAt` と `createdAt` は存在するが、自動削除方針は未実装。API 実装時に期限切れ cleanup を検討する。
- `POST /game/sessions` では `questionSetId` を受け取り、サーバー側で正誤判定後に該当 `GameQuestionSet` を削除する方針を維持する。
- 苦手モードの5問未満チェックはサーバー側でも必ず実行する。フロントのガードは UX 補助であり、セキュリティ境界ではない。
- スコア、連続正解、`WeakElement` 更新、`UserStats` 更新はフロントで信頼しない。DB 更新はサーバー側のトランザクションで行う。

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| mode query が有効 | `GameMode` として返る |
| mode query が `null` | `null` を返し、画面でエラー導線を表示する |
| mode query が未知値 | `null` を返し、クラッシュしない |
| mock questions | 10問、各4択、選択肢 ID 重複なし |
| 正解選択 | `isCorrect: true`, `timedOut: false` の回答になる |
| 不正解選択 | `isCorrect: false`, `timedOut: false` の回答になる |
| 時間切れ | `chosenChoiceId: null`, `isCorrect: false`, `timedOut: true` の回答になる |
| 残り15秒 | timer percent が100になる |
| 残り0秒 | timer percent が0になる |
| 進捗1問目 | 「1 / 10」相当の表示になる |
| 10問目回答後 | phase が `completed` になり完了表示になる |
| 未ログイン | ゲーム UI を開始せず、ログイン導線を表示する |
| `authStore.isInitializing` 中 | 未ログインと断定せず確認中表示になる |
| クリック回答 | 選択後にボタンが disabled になり、正誤フィードバックが出る |
| `1`〜`4`キー回答 | 対応する選択肢を選べる |
| `Numpad1`〜`Numpad4`キー回答 | 対応する選択肢を選べる |
| フィードバック中のキー入力 | 追加回答されない |
| 時間切れ後のクリック | 追加回答されない |
| `/game` 開始導線 | `/game/play?mode=...` に遷移する |
| モバイル表示 | 390px 幅で選択肢・タイマー・フィードバックがはみ出さない |
| lint | `npm run lint` が通る |
| format | `npm run format` 実行後、Prettier 整形済み |
| test | `npm run test:run` が通る |
| check | `npm run check` が通る |

## 実装リスクと回避策

| リスク | 影響 | 回避策 |
|---|---|---|
| API 未実装なのに live fetch してしまう | `/game/play` が常に失敗する | 本タスクでは mock questions のみ使用する |
| 正解情報の扱いが本番仕様と混ざる | セキュリティ方針と矛盾する | `MockGamePlayQuestion` に限定し、API 型には `correctChoiceId` を含めない |
| タイマーが複数走る | 残り秒数が不安定になる | interval ID を1つだけ保持し、状態遷移ごとに clear する |
| 離脱後に timer / keydown が残る | メモリリークや別画面での誤作動 | `onDestroy` で必ず解除する |
| フィードバック中に二重回答できる | 回答数・進捗が壊れる | phase が `answering` の時だけ回答を受け付ける |
| mode 不正値でクラッシュする | URL 直打ち時に白画面になる | `normalizeGameModeParam()` とエラー画面を用意する |
| 未ログイン判定がちらつく | refresh 中にログイン導線が一瞬出る | `authStore.isInitializing` 中は判定保留 UI を出す |
| 1〜4キーがページ全体で過剰に効く | 将来入力 UI と衝突する | 回答可能状態のみ処理し、必要に応じて target を確認する |
| UI モックの問題データが page に散る | API 接続時の差し替えが難しい | `mock-questions.ts` に集約する |
| 結果画面未実装で遷移先が壊れる | 10問完了後にユーザーが迷う | 本タスクでは画面内完了サマリーを表示し、`/game/result` は後続タスクにする |
| DB 更新をフロント計算値に依存する | スコア改ざんや苦手更新不整合が起きる | API 実装時はサーバー側で `questionSetId` をもとに正誤判定・集計する |

## 手動確認項目

| 項目 | 確認内容 |
|---|---|
| `/game` から開始 | 通常モード開始で `/game/play?mode=...` に遷移する |
| `/game/play` 初期表示 | 見出し、モード名、進捗、タイマー、問題、4択が表示される |
| 未ログイン表示 | ゲーム開始せずログイン導線が表示される |
| 不正 mode | 日本語エラーと `/game` へ戻る導線が表示される |
| クリック回答 | 正解/不正解フィードバックが1.5秒表示され、次問に進む |
| 1〜4キー回答 | 対応する選択肢を選べる |
| 時間切れ | 0秒で時間切れフィードバックが表示され、次問に進む |
| 10問完了 | 完了サマリーと戻る導線が表示される |
| PC 幅 | 既存 layout 内で問題・選択肢が読みやすい |
| モバイル幅 390px | 選択肢・タイマー・フィードバック文言がはみ出さない |
| キーボード操作 | Tab / Shift+Tab と `1`〜`4` が自然に使える |
| コンソール | 不要なエラーや hydration mismatch が出ない |

## 実装完了時の更新ルール

実装完了時は以下を必ず行う。

- `docs/05_progress.md` の `ゲームプレイ画面 /game/play（インジケーター・15秒タイマー・4択・正誤フィードバック・1〜4キー操作）` を `[x]` に更新する。
- `docs/plans/game-screens/plan.md` の該当チェックボックスを `[x]` に更新する。
- 計画時と実装時で変更ファイルが異なった場合、対象ファイル一覧を実態に合わせて更新する。
- 設計判断が変わった場合、`## 実装完了` の「計画からの変更点」に記録する。
- 実行した品質チェックを `## 実装完了` に記録する。
- 手動確認した画面幅・ログイン状態・タイマー・キー操作を `## 実装完了` に記録する。

実装完了セクションのテンプレート:

```markdown
## 実装完了
- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/game-play
- PR: #N

### 計画からの変更点
- なし

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/game/constants.ts` | 修正 | ゲームプレイ定数 |
| `frontend/src/lib/game/types.ts` | 修正 | プレイ画面型 |
| `frontend/src/lib/game/play.ts` | 新規 | ゲーム進行 helper |
| `frontend/src/lib/game/play.test.ts` | 新規 | helper テスト |
| `frontend/src/lib/game/mock-questions.ts` | 新規 | UI モック問題 |
| `frontend/src/lib/components/game/GameProgressIndicator.svelte` | 新規 | 進捗 |
| `frontend/src/lib/components/game/GameTimerBar.svelte` | 新規 | タイマー |
| `frontend/src/lib/components/game/GameChoiceButton.svelte` | 新規 | 選択肢 |
| `frontend/src/lib/components/game/GameFeedbackPanel.svelte` | 新規 | フィードバック |
| `frontend/src/routes/(app)/game/+page.svelte` | 修正 | 開始導線 |
| `frontend/src/routes/(app)/game/play/+page.ts` | 新規 | route 設定 |
| `frontend/src/routes/(app)/game/play/+page.svelte` | 新規 | プレイ画面 |
| `docs/05_progress.md` | 修正 | 進捗更新 |
| `docs/plans/game-screens/plan.md` | 修正 | 実装完了記録 |

### 品質チェック
| コマンド | 結果 |
|---|---|
| `cd frontend && npm run lint` | OK |
| `cd frontend && npm run format` | OK |
| `cd frontend && npm run test:run` | OK |
| `cd frontend && npm run check` | OK |

### 手動確認
| 条件 | 結果 |
|---|---|
| `/game` から開始 | OK |
| `/game/play` クリック回答 | OK |
| `/game/play` 1〜4キー回答 | OK |
| `/game/play` 時間切れ | OK |
| `/game/play` 10問完了 | OK |
| PC 幅 | OK |
| モバイル幅 390px | OK |
```

## 実装完了

- 完了日: 2026-06-13
- 実装ブランチ: `feature/game-play`
- PR: #47

### 計画からの変更点

- `GET /game/questions` / `POST /game/sessions` は計画どおり呼び出さず、`frontend/src/lib/game/mock-questions.ts` の UI モック問題で実装した。
- `/game/result` は未実装のため、10問完了後は `/game/play` 画面内の完了サマリーと「もう一度」「モード選択へ戻る」導線で完結させた。
- ログイン済みセッションがない環境だったため、ブラウザでの実ゲーム進行操作は未確認。ゲーム進行の核は `play.test.ts`、画面構文は `npm run check`、未ログインガードとモバイル表示は Browser で確認した。

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/game/constants.ts` | 修正 | `GAME_QUESTION_COUNT`, `QUESTION_TIME_LIMIT_SEC`, `ANSWER_FEEDBACK_MS` を追加 |
| `frontend/src/lib/game/types.ts` | 修正 | プレイ画面用の問題、選択肢、回答、phase、選択 handler 型を追加 |
| `frontend/src/lib/game/play.ts` | 新規 | mode 正規化、進捗ラベル、タイマー率、回答生成、次問遷移、サマリー算出を追加 |
| `frontend/src/lib/game/play.test.ts` | 新規 | mode 正規化、回答判定、時間切れ、進捗、タイマー、サマリーのテストを追加 |
| `frontend/src/lib/game/mock-questions.ts` | 新規 | UI モック用の10問問題セット生成を追加 |
| `frontend/src/lib/components/game/GameProgressIndicator.svelte` | 新規 | 10問分の進捗インジケーターを追加 |
| `frontend/src/lib/components/game/GameTimerBar.svelte` | 新規 | 15秒カウントダウンバーを追加 |
| `frontend/src/lib/components/game/GameChoiceButton.svelte` | 新規 | 4択ボタン、キー番号、選択後状態表示を追加 |
| `frontend/src/lib/components/game/GameFeedbackPanel.svelte` | 新規 | 正解・不正解・時間切れフィードバックを追加 |
| `frontend/src/routes/(app)/game/+page.svelte` | 修正 | 開始ボタンを `/game/play?mode=...` 遷移へ変更 |
| `frontend/src/routes/(app)/game/play/+page.ts` | 新規 | `ssr = true`, `prerender = false` を明示 |
| `frontend/src/routes/(app)/game/play/+page.svelte` | 新規 | プレイ画面、timer、4択、1〜4キー操作、フィードバック、完了サマリーを追加 |
| `docs/05_progress.md` | 修正 | `/game/play` タスクを実装中、完了へ更新 |
| `docs/plans/game-screens/plan.md` | 修正 | タスク完了チェックと実装完了記録を追記 |

### 品質チェック

| コマンド | 結果 |
|---|---|
| `cd frontend && npm run test:run -- src/lib/game/play.test.ts` | Red: `play.ts` 未実装で import 解決失敗 |
| `cd frontend && npm run test:run -- src/lib/game/play.test.ts` | Green: OK（12 tests） |
| `cd frontend && npm run format` | OK |
| `cd frontend && npm run lint` | OK |
| `cd frontend && npm run test:run` | OK（13 files / 169 tests） |
| `cd frontend && npm run check` | OK（0 errors / 0 warnings） |

### 手動確認

| 条件 | 結果 |
|---|---|
| `/game` 未ログイン表示 | OK: 6モードとログイン導線を表示 |
| `/game/play?mode=SYMBOL_TO_NAME_LV1` 未ログイン表示 | OK: 「ログインが必要です」とログイン導線を表示 |
| `/game/play?mode=SYMBOL_TO_NAME_LV1` コンソール | OK: error log なし |
| モバイル幅 `/game` | OK: 390px 相当で横はみ出しなし（`scrollWidth <= clientWidth`） |
| モバイル幅 `/game/play` 未ログイン表示 | OK: 390px で横はみ出しなし（`scrollWidth <= clientWidth`） |
| ログイン済み `/game/play` クリック回答 | 未確認: 手動確認環境にログインセッションなし。`play.test.ts` と `npm run check` で主要ロジック・画面構文を確認 |
| ログイン済み `/game/play` 1〜4キー回答 | 未確認: 手動確認環境にログインセッションなし。キー入力 handler は実装済み |
| ログイン済み `/game/play` 時間切れ | 未確認: 手動確認環境にログインセッションなし。時間切れ回答生成は `play.test.ts` で確認 |

## 既存 `/game` 実装完了記録

- 完了日: 2026-06-12
- 実装ブランチ: `feature/game-mode-select`
- PR: #46
- `docs/05_progress.md` の `ゲームモード選択画面 /game（モード一覧・苦手5問未満ガード表示）` は現在 `[x]`。

### 計画からの変更点

- `GameModeCard.svelte` のルート要素は当初 `article` で実装したが、外側が `ul > li` のモード選択リストであり、カード自体は独立記事ではなくリスト項目内の表示コンテナであるため `div` に変更した。
- `/game/play` は未実装のため、開始ボタン押下時は遷移せず toast で「プレイ画面は後続タスクで実装します。」と表示する UI モックにした。
- `onStart` の関数型は Svelte ファイル内で `no-unused-vars` に検出されたため、`GameModeStartHandler` として `frontend/src/lib/game/types.ts` に切り出した。
- backend game / weak API は未実装・未 mount のため、計画どおり live fetch は行っていない。

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/game/constants.ts` | 新規 | 苦手ガード定数 `MIN_WEAK_ELEMENTS_FOR_GAME` を追加 |
| `frontend/src/lib/game/types.ts` | 新規 | `GameMode`、`GameModeConfig`、`GameModeStartAvailability`、`GameModeStartHandler` を追加 |
| `frontend/src/lib/game/modes.ts` | 新規 | 6 モード定義、苦手モード判定、開始可否判定、ガード文言生成を追加 |
| `frontend/src/lib/game/modes.test.ts` | 新規 | モード定義・苦手 5 件境界・ガード文言のユニットテストを追加 |
| `frontend/src/lib/components/game/GameModeCard.svelte` | 新規 | モードカード、ログイン導線、開始ボタン、disabled 理由表示を追加 |
| `frontend/src/routes/(app)/game/+page.svelte` | 修正 | `/game` スタブをモード選択画面へ置換 |
| `frontend/src/routes/(app)/game/+page.ts` | 新規 | `ssr = true`, `prerender = false` を明示 |
| `docs/05_progress.md` | 修正 | `/game` タスクを実装中、完了へ更新 |
| `docs/plans/game-screens/plan.md` | 修正 | タスク完了チェックと実装完了記録を追記 |

### 品質チェック

| コマンド | 結果 |
|---|---|
| `cd frontend && npm run lint` | OK |
| `cd frontend && npm run format` | OK |
| `cd frontend && npm run test:run` | OK（12 files / 157 tests） |
| `cd frontend && npm run check` | OK（0 errors / 0 warnings） |

### 手動確認

| 条件 | 結果 |
|---|---|
| 未ログイン `/game` | OK: 6 モード表示、ログイン導線 6 件 |
| PC 幅 `/game` | OK: 見出し、モード一覧、コンソールエラーなし |
| モバイル幅 390px | OK: 6 カード表示、横はみ出し検出なし |
| 苦手 4 件相当 | OK: `modes.test.ts` で開始不可・ガード文言を確認。UI は preview 値 4 件で苦手モード disabled 表示 |
| ログイン済み `/game` | 未確認: 手動確認時にログインセッションなし。`authStore.isLoggedIn` 分岐は実装済み |
| 苦手 5 件相当 | 未確認: backend weak API 未実装のため実データ確認なし。`modes.test.ts` で開始可能境界を確認 |
