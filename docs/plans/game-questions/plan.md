# GET /game/questions 実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、API 接続設計、状態管理、A11Y レビュー） + バックエンド API 契約・DB 負荷レビュー
> 対象実装者: Codex

## 概要

`docs/05_progress.md` フェーズ7の未完了タスク「GET /game/questions（ランダム10問・4択生成・GameQuestionSet保存・苦手5問未満チェック【設計決定2】）」を完了する。`GET /game/questions` は認証済みユーザーにゲーム問題10問を返し、正解情報は client に返さず `GameQuestionSet` に30分間だけ保存して、`POST /game/sessions` のサーバー側正誤判定に使う。

既存コードには route、service、frontend API client、`/game/play` 接続がすでに存在する。ただし進捗タスク名の「ランダム10問」に対して、現状の `buildQuestionElements()` は取得済み候補の先頭から循環して10問を作るため、通常モードでは先頭10元素、苦手モードでは更新順上位に偏る。実装では既存設計を活かしつつ、候補元素からランダムに10問を選ぶ処理と、その妥当性を固定するテストを追加する。

## レビュー結果と改善方針

| 観点 | レビュー結果 | 改善方針 |
|---|---|---|
| 依頼内容整合性 | 元の依頼には `{{機能名}}`, `{{planディレクトリ名}}`, `{{API一覧}}` など未置換プレースホルダーが残っていた | 主対象は `docs/05_progress.md` のタスク名から `GET /game/questions` と確定する。計画書パスは `docs/plans/game-questions/plan.md` とする |
| 既存コード整合性 | `backend/src/routes/game/index.ts`、`backend/src/services/game.service.ts`、`frontend/src/lib/api/game.ts`、`/game/play` は既に API 接続済み | 作り直しではなく、ランダム出題・テスト不足・進捗/計画書整合を中心に最小差分で直す |
| 仕様適合 | `docs/04_api.md` は `GET /game/questions` を「問題セット取得（10問）」として定義し、進捗タスク名は「ランダム10問」としている | `createGameQuestionSet()` で候補から重複なしに最大10問をランダム抽出する。候補が10件未満の苦手モードは5件以上なら重複循環を許可するかどうかを設計決定として明記し、今回は「苦手5件以上なら10問成立のため循環補充可」とする |
| セキュリティ | 公開レスポンスから `correctChoiceId` / `elementId` を除外する実装と frontend runtime validation はある | backend / frontend のテストで正解情報非公開を維持する。client に正解判定材料を増やさない |
| A11Y | `/game/play` は loading / error / retry / 未ログイン / invalid mode / timer / keyboard 1〜4 を持つ | 新しい出題ロジックは UI 構造を変えない。手動確認で `aria-busy`, `aria-live`, keyboard 操作、エラー再試行を確認する |
| DB 整合性 | `GameQuestionSet` model と `@@index([expiresAt])` はある。`GET` に副作用がある点は設計決定2に沿っている | schema 変更は行わない。`userId`, `mode`, `questions`, `expiresAt` を既存 model に保存し、期限切れ cleanup は別タスクに残す |
| DB 負荷 | 候補取得は通常モード最大98件、苦手モードはユーザーの苦手件数分。DB 側 `ORDER BY random()` は不要かつ重くなりやすい | DB では条件に合う候補を通常の index/order で取得し、Node 側で Fisher-Yates 方式のシャッフル/抽出を行う |
| テスト | route テストは 200/401/400/409/500 を持つ。service テストは4択・保存JSON・正解位置・苦手不足を持つが、ランダム10問の偏り防止が弱い | service に candidate selection の deterministic テストを追加する。frontend API client の非 JSON・正解情報混入検知も維持する |
| ドキュメント整合 | `docs/05_progress.md` のタスクには計画書リンクがない | 本計画へのリンクを追加し、実装完了時に `[x]` と `## 実装完了` を更新する |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- 設計決定2: `GET /game/questions` でDBに正解情報と有効期限（30分）を保存し `questionSetId` を返す。
- フェーズ7: `GET /game/questions（ランダム10問・4択生成・GameQuestionSet保存・苦手5問未満チェック【設計決定2】）` は未完了。
- フェーズ7: `POST /game/sessions` と `GET /game/sessions/:sessionId` は完了済み。
- フェーズ7: `期限切れ GameQuestionSet クリーンアップ処理` は別タスク。

**`docs/04_api.md`**
- `GET /api/v1/game/questions` は認証必須。
- Query: `mode: GameMode`。
- Response: `{ questionSetId, expiresAt, questions }`。
- 公開 `questions` は `questionId`, `prompt`, `choices[].choiceId`, `choices[].text` のみ。
- Error: 400 / 401 / 403 / 409 / 429 / 500。

**`backend/src/routes/game/index.ts`**
- `gameQuestionsQuerySchema` — `mode` を `GameMode` enum で検証する。
- `gameRouter.get("/questions", ...)` — `rateLimit`, `authMiddleware`, zod validation, `createGameQuestionSet()` 呼び出し。
- `InsufficientWeakElementsError` — 409 に変換する。
- 予期しない例外 — `{ error: "サーバーエラーが発生しました" }` で 500。

**`backend/src/services/game.service.ts`**
- `createGameQuestionSet(params): Promise<CreateGameQuestionSetResult>` — 問題セットを生成・保存する。
- `PublicGameChoice` — `{ choiceId: string; text: string }`。
- `PublicGameQuestion` — `{ questionId: string; prompt: string; choices: PublicGameChoice[] }`。
- `CreateGameQuestionSetResult` — `{ questionSetId: string; expiresAt: Date; questions: PublicGameQuestion[] }`。
- `InsufficientWeakElementsError` — 苦手元素5件未満時の日本語エラー。
- `QUESTION_TIME_LIMIT_SEC` — 15秒。
- `GAME_SESSION_DURATION_LIMIT_SEC` — 1800秒。

**`backend/prisma/schema.prisma`**
- `GameQuestionSet`: `id`, `userId`, `mode`, `questions`, `expiresAt`, `createdAt`。
- `GameQuestionSet` は `@@index([expiresAt])` を持つ。
- `WeakElement`: 苦手モードの候補元素取得に使う。
- datasource に `url =` は書かれていない。

**`frontend/src/lib/api/game.ts`**
- `getGameQuestions({ mode, accessToken, signal }): Promise<GameQuestionsResponse>`。
- `API_BASE_URL` と `parseErrorResponse()` を使う。
- 公開レスポンスに `correctChoiceId` / `elementId` が含まれる場合は `ApiError(500, "ゲーム問題のレスポンス形式が不正です", data)`。

**`frontend/src/lib/game/play.ts`**
- `normalizeGameModeParam(value): GameMode | null`。
- `buildSessionAnswerDraft()` — 本番 API 送信用に正誤情報を含まない回答を作る。
- `calculateAnswerDurationSec()` — 回答時間を上限内に丸める。

**`frontend/src/routes/(app)/game/play/+page.svelte`**
- URL query `mode` を `normalizeGameModeParam()` で復元する。
- `authStore.isInitializing`, `authStore.isLoggedIn`, `authStore.accessToken` を見て `getGameQuestions()` を呼ぶ。
- `questionRequestKey` と `AbortController` で二重取得・古いレスポンス反映を抑止する。
- loading / error / retry / 未ログイン / invalid mode を画面内表示する。

**`frontend/src/routes/(app)/game/+page.svelte`**
- `GET /weak` で苦手件数を取得し、苦手モード開始可否の UX 補助に使う。
- 最終的な苦手5件未満判定は backend `GET /game/questions` の 409 に任せる。

### 重要な制約

- クライアントへ `correctChoiceId`, `elementId`, `score`, `isCorrect` を返さない。
- 正解情報は `GameQuestionSet.questions` に保存し、`POST /game/sessions` でのみ使う。
- `GameQuestionSet.expiresAt` は生成時から30分後。
- 問題数は10問、選択肢は4択。
- `GameQuestionSet` はログインユーザーの `userId` に紐づける。
- 苦手モードは `WeakElement` が5件未満なら 409 を返す。
- route 入口で zod validation を行う。
- エラーレスポンスは日本語に統一する。
- API base URL とエラー処理は `frontend/src/lib/api/config.ts` / `frontend/src/lib/api/errors.ts` を使い、各ファイルで重複定義しない。
- DB アクセスは Prisma ORM 経由。生 SQL は使わない。
- DB schema / migration は変更しない想定。変更が必要になった場合は migration / Prisma / Playwright 確認を追加する。

### 確認事項

- 依頼文の `{{機能名}}`, `{{planディレクトリ名}}`, `{{API一覧}}` は未置換だったため、主対象は進捗タスク名から判断した。
- 既存実装は `GET /game/questions` route と frontend 接続を持つが、現状の問題選定はランダム10問ではなく候補順依存である。
- 苦手モードで候補が5〜9件の場合、10問を作るには重複出題が必要。既存 `buildQuestionElements()` は循環補充しているため、この挙動を維持し「候補のランダム順を作ってから循環補充する」方針にする。
- 通常モードは候補が10件以上あるため、同一セット内では原則として重複なし10問にする。
- 選択肢の distractor も候補順に偏る可能性がある。今回タスクの中心は出題10問のランダム化だが、同じ抽出 helper を選択肢候補にも使うかは実装時に確認する。

## 対象ファイル一覧（変更種別つき）

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/services/game.service.ts` | 修正 | 候補元素からランダム10問を選ぶ helper を追加し、`createGameQuestionSet()` に接続 |
| `backend/src/services/game.service.test.ts` | 修正 | ランダム10問、候補5〜9件の循環補充、正解情報非公開、保存 JSON、苦手不足のテストを追加/更新 |
| `backend/src/routes/game/index.ts` | 確認または修正 | `GET /questions` の validation、auth、rate limit、error mapping を仕様と照合 |
| `backend/src/routes/game/questions.test.ts` | 確認または修正 | 200/401/400/409/500 と service 呼び出しの route テストを維持 |
| `frontend/src/lib/api/game.ts` | 確認または修正 | `getGameQuestions()` の URL、Authorization、AbortSignal、error handling、runtime validation |
| `frontend/src/lib/api/game.test.ts` | 確認または修正 | `getGameQuestions()` の正常系・非 JSON・レスポンス形式不正・正解情報混入検知 |
| `frontend/src/lib/game/play.ts` | 確認または修正 | `normalizeGameModeParam()` と回答 draft の正規化を確認 |
| `frontend/src/lib/game/play.test.ts` | 確認または修正 | mode query、空/null/undefined、時間境界のテストを維持 |
| `frontend/src/routes/(app)/game/play/+page.svelte` | 確認または修正 | loading/error/retry、reload、戻る、二重取得抑止、未ログイン表示 |
| `docs/04_api.md` | 確認または修正 | ランダム10問、苦手5件未満、正解非公開仕様に差分があれば更新 |
| `docs/05_progress.md` | 修正 | 対象タスクに本計画書リンクを追加し、実装完了時に `[x]` へ更新 |
| `docs/plans/game-questions/plan.md` | 新規/修正 | 本計画。実装完了時にチェックボックスと `## 実装完了` を更新 |

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
| 成功 | 200 |
| 用途 | ゲームプレイ用の10問4択問題セットを取得する |
| 副作用 | `GameQuestionSet` を作成し、正解情報と有効期限を保存する |
| rate limit | 適用する |
| 正解情報 | レスポンスには含めない |

#### Query params

| パラメータ | 型 | 検証 |
|---|---|---|
| `mode` | `GameMode` | 必須。6種類の enum のみ |

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

#### Error

| ステータス | 条件 | body |
|---|---|---|
| 400 | `mode` が不正 | `{ "error": "バリデーションエラー", "details": [...] }` |
| 401 | 未ログイン・token 不正・ユーザー削除済み | `{ "error": "認証が必要です" }` など |
| 403 | 停止・メール未確認・ロック中 | 既存 auth middleware の日本語エラー |
| 409 | 苦手モードで苦手元素が5件未満 | `{ "error": "苦手モードを始めるには、苦手元素が5件以上必要です" }` |
| 429 | レート制限 | 既存 rateLimit の日本語エラー |
| 500 | 想定外エラー | `{ "error": "サーバーエラーが発生しました" }` |

## 設計上の決定事項（判断理由つき）

1. **問題セットの source of truth**
   - 選択: backend の `GameQuestionSet` を source of truth とする。
   - 根拠: 正解情報を client に渡さず、`POST /game/sessions` で改ざんされない正誤判定を行うため。

2. **画面表示の source of truth**
   - 選択: `/game/play` の表示は `GET /game/questions` response を source of truth とする。
   - 根拠: reload / 直接アクセス時も URL query `mode` と access token から再取得できるため。

3. **初期表示時の状態復元**
   - 選択: `mode` は URL query から復元し、問題セットは store に保持せず API から取得する。
   - 根拠: 問題セットは30分で失効する一時データであり、localStorage に保存しない方が安全。

4. **問題10問のランダム化**
   - 選択: DB から候補を取得した後、Node 側で Fisher-Yates 方式のシャッフルを行い、通常モードは重複なし10問、候補10件未満の苦手モードはシャッフル済み候補を循環補充して10問にする。
   - 根拠: DB の `ORDER BY random()` は負荷が上がりやすい。候補数は最大118件程度なのでアプリ側シャッフルが軽く、テストもしやすい。

5. **乱数の扱い**
   - 選択: 既存の `node:crypto randomInt` を使い、テストでは index generator / shuffle generator を注入できる形にする。
   - 根拠: セキュリティ制約の `Math.random()` 禁止に沿いつつ、ランダム挙動を決定的にテストするため。

6. **選択肢4択の生成**
   - 選択: 正解1件 + distractor 3件で作り、正解位置は `randomInt(0, 4)` で決める。distractor の候補順偏りは可能なら同じランダム helper で軽減する。
   - 根拠: 正解位置だけでなく選択肢内容も毎回同じになりすぎると学習効果が落ちるため。ただし今回の必須完了条件は「出題10問のランダム化」とする。

7. **ユーザー入力の反映タイミング**
   - 選択: 回答ボタンまたはキーボード 1〜4 の選択時に即時記録し、次問へ進む。
   - 根拠: クイズ UI として自然で、15秒タイマーと整合する。

8. **API パラメータの組み立て**
   - 選択: `frontend/src/lib/api/game.ts` の `getGameQuestions()` 内で URL query を組み立てる。
   - 根拠: page component に API URL 生成を埋め込まず、API client に責務を集約するため。

9. **正規化済みの値**
   - 選択: `mode` は `normalizeGameModeParam()` で一度だけ正規化し、page state で使い回す。
   - 根拠: URL query、API parameter、UI state のズレを避けるため。

10. **エラー表示**
    - 選択: 問題取得失敗は画面内エラーを主、toast を補助にする。
    - 根拠: ゲーム開始可否に直結するため、消える toast だけでは再試行導線が不足する。

11. **既存コンポーネントの再利用**
    - 選択: `GameChoiceButton`, `GameProgressIndicator`, `GameTimerBar` を再利用する。
    - 根拠: 既存 UI と A11Y の一貫性を保ち、API 接続の責務だけを page / API client に閉じるため。

12. **reload / 戻る操作**
    - 選択: `/game/play?mode=...` に入るたび、認証状態確定後に問題セットを再取得する。戻る操作で同じ token/mode の重複取得は `questionRequestKey` で抑止する。
    - 根拠: 古い `questionSetId` の再利用や期限切れ事故を避けるため。

13. **苦手5件未満チェック**
    - 選択: `/game` の `GET /weak` は UX 補助、最終判定は `GET /game/questions` の 409 とする。
    - 根拠: frontend 表示は古くなる可能性があるため、DB に基づく backend guard が必要。

## 公開インターフェース案（必要な場合）

```typescript
// backend/src/services/game.service.ts
export type PublicGameChoice = {
  choiceId: string;
  text: string;
};

export type PublicGameQuestion = {
  questionId: string;
  prompt: string;
  choices: PublicGameChoice[];
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
  choiceIndexGenerator?: () => number;
  questionElementIndexGenerator?: (maxExclusive: number) => number;
}): Promise<CreateGameQuestionSetResult>;

// frontend/src/lib/api/game.ts
export function getGameQuestions(options: {
  mode: GameMode;
  accessToken: string;
  signal?: AbortSignal;
}): Promise<GameQuestionsResponse>;
```

## タスクリスト（進捗管理）

| タスクID | 内容 | ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存仕様・既存実装の再確認 | `docs/04_api.md`, `docs/05_progress.md`, `backend/src/routes/game/index.ts`, `backend/src/services/game.service.ts`, `frontend/src/routes/(app)/game/play/+page.svelte` | 既存実装済み範囲と不足差分を確認し、作り直し不要な箇所を確定 | 高 |
| T2 | ランダム10問選定 helper のテストを先に追加 | `backend/src/services/game.service.test.ts` | 候補20件から注入乱数どおりの10件が選ばれる Red を確認 | 高 |
| T3 | 候補10件未満の苦手モード補充テストを追加 | `backend/src/services/game.service.test.ts` | 苦手5件以上10件未満で10問が作られ、5件未満では既存どおり 409 相当の error | 高 |
| T4 | ランダム10問選定 helper を実装 | `backend/src/services/game.service.ts` | 通常モードは重複なし10問、候補不足時はシャッフル済み候補の循環補充 | 高 |
| T5 | 4択 distractor の偏りを確認・必要なら改善 | `backend/src/services/game.service.ts`, `backend/src/services/game.service.test.ts` | 正解位置と distractor が固定順に偏りすぎない。過度な変更が必要なら別タスク化 | 中 |
| T6 | route validation / error mapping の回帰確認 | `backend/src/routes/game/index.ts`, `backend/src/routes/game/questions.test.ts` | 200/401/400/409/500 と日本語 error が維持される | 高 |
| T7 | GameQuestionSet 保存形式の回帰確認 | `backend/src/services/game.service.test.ts`, `backend/prisma/schema.prisma` | DB JSON には判定用情報を保存し、公開レスポンスには出さない | 高 |
| T8 | frontend API client の回帰確認 | `frontend/src/lib/api/game.ts`, `frontend/src/lib/api/game.test.ts` | URL、Authorization、AbortSignal、非 JSON、正解情報混入検知が通る | 高 |
| T9 | `/game/play` 状態管理と A11Y の確認 | `frontend/src/routes/(app)/game/play/+page.svelte` | loading/error/retry、reload、戻る、二重取得抑止、keyboard 操作、`aria-busy` / `aria-live` を確認 | 高 |
| T10 | `POST /game/sessions` との接続整合確認 | `frontend/src/routes/(app)/game/play/+page.svelte`, `frontend/src/lib/api/game.ts`, `docs/04_api.md` | `questionSetId` と回答 draft だけを送信し、frontend で正誤計算しない | 中 |
| T11 | docs 更新要否確認 | `docs/04_api.md` | 実装と API docs に差分があれば更新。差分なしなら実装完了欄へ記録 | 中 |
| T12 | backend 品質チェック | `backend/` | `npm run lint`, `npm run format:check`, `npm run test -- --run` が成功 | 高 |
| T13 | frontend 品質チェック | `frontend/` | `npm run lint`, `npm run format`, `npm run check`, `npm run test:run` が成功 | 高 |
| T14 | 手動確認 | `/game`, `/game/play`, `/game/result` | 通常モード、苦手不足、reload、戻る、キーボード操作、エラー再試行を確認 | 高 |
| T15 | 進捗と計画書の実装完了更新 | `docs/05_progress.md`, `docs/plans/game-questions/plan.md` | 進捗を `[x]` にし、チェックボックスと `## 実装完了` を実態に合わせる | 高 |

- [x] T1: 既存仕様・既存実装の再確認
- [x] T2: ランダム10問選定 helper のテストを先に追加
- [x] T3: 候補10件未満の苦手モード補充テストを追加
- [x] T4: ランダム10問選定 helper を実装
- [x] T5: 4択 distractor の偏りを確認・必要なら改善
- [x] T6: route validation / error mapping の回帰確認
- [x] T7: GameQuestionSet 保存形式の回帰確認
- [x] T8: frontend API client の回帰確認
- [x] T9: `/game/play` 状態管理と A11Y の確認
- [x] T10: `POST /game/sessions` との接続整合確認
- [x] T11: `docs/04_api.md` 更新要否確認
- [x] T12: backend 品質チェック
- [x] T13: frontend 品質チェック
- [ ] T14: 手動確認（未実施・自動テストで主要契約を確認）
- [x] T15: `docs/05_progress.md` と plan.md の実装完了更新

## 技術的注意点

- `GET /game/questions` は `GET` だが DB に `GameQuestionSet` を作成する副作用がある。これは設計決定2に基づく仕様として docs に明記する。
- `choiceId` は現在 `String(element.id)` を使う。`POST /game/sessions` の照合もこの前提と一致させる。
- 現状の `buildQuestionElements()` は候補順依存で、ランダム10問の要件を満たさない。ここを主要な実装修正点にする。
- `randomInt()` を使い、`Math.random()` は使わない。
- DB 側でランダムソートをしない。候補数は小さいため Node 側でシャッフルする。
- `expiresAt <= now` の扱いは `POST /game/sessions` 側で期限切れ。`GET` では30分後の時刻を返す。
- `response.ok` は JSON parse 前に確認し、エラー body parse は `parseErrorResponse()` に寄せる。
- 公開レスポンス runtime validation は、`correctChoiceId` / `elementId` の混入を検知して失敗させる。
- API client / page / helper の責務を分け、UI コンポーネントに API 仕様を埋め込まない。
- DB schema を変更した場合は `npx prisma migrate deploy` と Playwright 確認を追加する。

## テストケース一覧

| ケース | 対象 | 期待結果 |
|---|---|---|
| 初期表示: `/game/play?mode=SYMBOL_TO_NAME_LV1` | frontend page | 認証完了後に問題取得 loading を表示し、成功後に1問目を表示 |
| 初期表示: mode query なし | frontend helper/page | invalid mode として `/game` へ戻る導線を表示 |
| reload | frontend page | URL query の mode から再取得し、新しい `questionSetId` を使う |
| 戻る操作 | frontend page | 同じ mode/token の不要な二重取得を抑止し、必要時は再取得 |
| 正常系: 記号→名前 Lv1 | backend service | 1〜20番候補からランダムに10問、prompt は記号、choices は日本語名 |
| 正常系: 名前→記号 Lv1 | backend service | prompt は日本語名、choices は元素記号 |
| 正常系: Lv2 | backend service | 21〜118番候補からランダムに10問 |
| ランダム10問 | backend service | 注入した乱数列に応じて先頭10件固定ではない問題順になる |
| 通常モードの重複 | backend service | 候補が10件以上なら同一セット内の出題元素は重複しない |
| 苦手モード5〜9件 | backend service | シャッフル済み候補を循環補充し、10問を返す |
| 正常系: 4択生成 | backend service | 各問4 choices、正解 choice を1つ含む |
| 正解位置ランダム | backend service | 正解 choice が常に先頭にならない |
| 正解非公開 | backend route/frontend api | response に `correctChoiceId` / `elementId` が含まれない |
| GameQuestionSet 保存 | backend service | DB JSON に `elementId`, `correctChoiceId`, `choices[].elementId` を保存 |
| expiresAt | backend service | `now + 30分` の有効期限を保存・返却 |
| 苦手モード5件未満 | backend route/service | 409 と日本語エラー |
| mode 不正 | backend route | 400 バリデーションエラー |
| 未ログイン | backend route/frontend page | backend は 401、frontend はログイン導線 |
| API エラー | frontend api/page | backend の日本語 error を画面内表示し、toast 補助 |
| 非 JSON エラー | frontend api | fallback message で `ApiError` |
| レスポンス形式不正 | frontend api | `ApiError(500, "ゲーム問題のレスポンス形式が不正です")` |
| ローディング中二重取得防止 | frontend page | 古い request を abort し、古い response を反映しない |
| 空状態 | frontend page | `questions.length === 0` なら「出題できる問題がありません。」 |
| キーボード操作 | frontend page | 1〜4 キーで回答でき、入力欄 focus 中は反応しない |
| A11Y | frontend page | loading/error/status に `aria-busy` / `aria-live` がある |

## 実装リスクと回避策

| リスク | 回避策 |
|---|---|
| 既存実装済み箇所を重複実装して壊す | T1 で既存実装とテストを確認し、不足差分だけを変更する |
| 出題が候補順に固定され、ランダム10問の要件を満たさない | `buildQuestionElements()` をランダム抽出 helper に置き換え、deterministic test を追加する |
| DB に高負荷なランダムソートをさせる | Prisma では通常取得し、Node 側で最大118件程度をシャッフルする |
| 正解情報が client に漏れる | backend response 生成と frontend runtime validation の両方で検知する |
| 苦手候補5〜9件で10問を作れない | 5件未満は 409、5件以上はシャッフル済み候補を循環補充する |
| `docs/05_progress.md` と実装状態がズレたまま残る | T15 で進捗・計画書・実装完了欄を必ず更新する |
| 苦手件数 frontend 表示と backend guard がズレる | frontend は UX 補助に留め、最終判定は `GET /game/questions` の 409 とする |
| 非 JSON エラーで UI が落ちる | `parseErrorResponse()` を必ず使い、JSON parse を `response.ok` 後に行う |
| 期限切れ問題セットを再利用する | reload/back では問題セットを再取得し、`questionSetId` を localStorage に保存しない |

## 手動確認項目

| 手順 | 期待結果 |
|---|---|
| ログイン後 `/game` から通常モードを開始 | `/game/play?mode=...` で問題が読み込まれる |
| `/game/play?mode=SYMBOL_TO_NAME_LV1` を直接開く | 認証済みなら問題取得、未ログインならログイン導線 |
| 不正な `mode` query で開く | invalid mode 表示と `/game` へ戻る導線 |
| 問題取得中 | loading 表示、回答ボタン無効 |
| API を一時的に失敗させる | 画面内エラーと「もう一度読み込む」導線 |
| 苦手元素4件以下で苦手モードを開始 | backend 409 の日本語エラーを表示 |
| 苦手元素5件以上で苦手モードを開始 | 10問が表示され、候補が5〜9件でもゲームが成立する |
| 同じモードを複数回開始 | 出題順が固定ではない |
| 1〜4キーで回答 | 選択肢が選ばれ、入力欄 focus 中は誤作動しない |
| 全問回答後 | `POST /game/sessions` に進み、結果画面へ遷移 |
| `/game/play` を reload | mode から新しい問題セットを取得 |
| PC / 390px 幅 | テキスト・ボタン・選択肢が重ならない |

## 実装完了時の更新ルール

実装完了時は以下を必ず実施する。

- `docs/05_progress.md` の対象タスクを `[x]` に更新する。
- 本計画のチェックボックスを完了状態へ更新する。
- 対象ファイル一覧を実際の変更ファイルに合わせて修正する。
- `docs/04_api.md` に差分があった場合は実装内容に合わせて更新する。
- DB schema / migration を変更した場合は、migration 適用確認と Playwright 確認結果を記録する。
- 本計画末尾に以下の `## 実装完了` セクションを追記する。

```markdown
## 実装完了
- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/xxx
- PR: #N

### 計画からの変更点
- 変更があれば記録する

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/services/game.service.ts` | 修正 | ランダム10問選定 |
| `backend/src/services/game.service.test.ts` | 修正 | ランダム10問と苦手候補補充のテスト |

### 検証結果
| コマンド/確認 | 結果 |
|---|---|
| `cd backend && npm run lint` |  |
| `cd backend && npm run format:check` |  |
| `cd backend && npm run test -- --run` |  |
| `cd frontend && npm run lint` |  |
| `cd frontend && npm run format` |  |
| `cd frontend && npm run check` |  |
| `cd frontend && npm run test:run` |  |
| 手動確認 `/game` → `/game/play` → `/game/result` |  |
```


## 実装完了（実績）
- 完了日: 2026-06-21
- 実装ブランチ: feature/game-questions
- PR: 作成後に追記予定

### 計画からの変更点
- route と frontend API client は既存実装・既存テストで仕様を満たしていたため、コード変更は行わず回帰テストで確認した
- docs/04_api.md は既に正解情報非公開、苦手5件未満 409、4択の正解位置ランダムを記載しており、仕様差分がなかったため変更しなかった
- DB schema / migration は変更していないため、migration 適用確認と DB 変更起因の Playwright 確認は対象外
- 手動確認はローカル dev server 未起動のため未実施。代わりに backend service / route と frontend API client の自動テストで主要契約を確認した

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| backend/src/services/game.service.ts | 修正 | 候補元素からランダム10問を選定し、候補10件未満ではランダム順を循環補充する処理を追加 |
| backend/src/services/game.service.test.ts | 修正 | ランダム10問選定、通常モード重複なし、苦手5〜9件の循環補充テストを追加 |
| docs/05_progress.md | 修正 | 対象タスクを完了に更新 |
| docs/plans/game-questions/plan.md | 修正 | タスクリストと実装完了記録を更新 |

### 検証結果
| コマンド/確認 | 結果 |
|---|---|
| cd backend && npm run test -- src/services/game.service.test.ts --run | 成功（33 tests） |
| cd backend && npm run test -- src/routes/game/questions.test.ts --run | 成功（5 tests） |
| cd frontend && npm run test:run -- src/lib/api/game.test.ts | 成功（18 tests） |
| cd backend && npm run format | 成功 |
| cd frontend && npm run format | 成功 |
| cd backend && npm run lint | 成功 |
| cd backend && npm run format:check | 成功 |
| cd backend && npm run test -- --run | 成功（25 files / 209 tests） |
| cd frontend && npm run lint | 成功 |
| cd frontend && npm run check | 成功（0 errors / 0 warnings） |
| cd frontend && npm run test:run | 成功（18 files / 211 tests） |
| 手動確認 /game → /game/play → /game/result | 未実施（dev server 未起動。UI変更なし） |
