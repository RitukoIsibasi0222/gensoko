# ゲーム API のテスト 実装計画

> 設計者ロール: シニアフロントエンドエンジニア（API 契約、状態整合性、A11Y 回帰、テスト戦略レビュー）
> 対象実装者: Codex

## 概要

`docs/05_progress.md` フェーズ7の未完了タスク `ゲーム API のテスト` を完了する。対象は既に実装済みの `/api/v1/game` 配下 API について、ルート・サービス・フロントエンド API クライアントの既存テストをレビューし、仕様上重要だが未検証の境界条件・エラー変換・DB 更新副作用を追加で検証することである。

このタスクでは新しい画面や API を追加しない。実装変更は、追加テストによって既存仕様との不一致が見つかった場合の最小修正に限定する。

## レビュー結果と改善方針

| 観点 | レビュー結果 | 改善方針 |
|---|---|---|
| 依頼内容整合性 | 元依頼には `{{機能名}}`, `{{planディレクトリ名}}`, `{{API一覧}}`, 画面ルート例など未置換プレースホルダーが残っていた | 主対象は `docs/05_progress.md` に実在する `ゲーム API のテスト` に固定する。計画書パスは `docs/plans/game-api-tests/plan.md` とする |
| 既存コードとの整合性 | `GET /game/questions`, `POST /game/sessions`, `GET /game/sessions`, `GET /game/sessions/:sessionId` は実装済み。関連テストも既に複数存在する | 新規実装計画ではなく、既存テストの不足分を埋める計画にする |
| 仕様整合性 | `docs/04_api.md` のゲーム API 仕様は現在のルート・サービスと概ね一致する。特に正解情報非公開、サーバー側正誤判定、履歴一覧は概要のみ、詳細取得は `results` ありという責務分担が重要 | テスト追加前に `docs/04_api.md` と実装を突き合わせ、差分があれば仕様か実装のどちらを直すべきか記録する |
| A11Y | このタスクは API テストが主対象で、画面 UI を新規実装しない。直接の A11Y 改修は発生しない | 既存 `/game`, `/game/play`, `/game/result`, `/mypage` の状態表示を壊さないことを手動確認に含める。API エラー文言をフロントエンドが保持するテストで画面表示の前提を守る |
| DB 整合性 | `GameQuestionSet` 消費、`GameSession` / `GameAnswer` 保存、`WeakElement` 更新、`UserStats` 更新、`masteredCount` 差分更新が同一 transaction に集約されている | ルートだけでなくサービステストで副作用の順序・集計・二重送信・期限切れ・重複回答を検証する |
| DB 負荷 | 履歴一覧は概要項目のみの `select` と `take: limit + 1`。詳細取得は 1 セッション + 10 回答程度。習得数更新は対象元素だけを見る設計だが、`UserStats` 初回作成時は 118 元素の集計が走る | 負荷を増やす実装変更はしない。テストでは `answers` の不要な同時取得や offset pagination 化が入らないことを確認する |
| テスト方針 | 既存テストは広いが、`POST /game/sessions` route の 409 系 mapping、service の mode mismatch / answers 数不一致 / 重複 questionId、履歴空状態、frontend API の JSON エラー保持など追加余地がある | 既存テストファイルへ不足ケースを追記する。重複テストを増やさず、仕様の事故防止に効く境界へ絞る |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- フェーズ7 `ゲーム API のテスト` が未完了。
- フェーズ7のゲーム API 実装タスクは `GET /game/questions`, `POST /game/sessions`, `/game` 苦手件数反映、GameQuestionSet cleanup、`GET /game/sessions`, `GET /game/sessions/:sessionId` まで完了済み。
- 設計決定2: `GET /game/questions` で `GameQuestionSet` に正解情報を保存し、`POST /game/sessions` でサーバー側判定後に削除する。

**`docs/04_api.md`**
- `GET /game/questions`: 認証必須。`mode` 必須。公開レスポンスには `correctChoiceId` / `elementId` を含めない。
- `POST /game/sessions`: 認証必須。`questionSetId`, `mode`, `answers`, `durationSec` を受け取り、サーバー側で正誤判定・スコア計算を行う。
- `GET /game/sessions`: 認証必須。履歴概要のみ返し、`results` は含めない。
- `GET /game/sessions/:sessionId`: 認証必須。保存済み結果詳細を返し、他ユーザー所有と存在なしはいずれも 404。
- エラーレスポンスは `{ "error": "メッセージ文字列" }`、validation は `details` 付き。

**`backend/src/routes/game/index.ts`**
- `gameRouter.get("/questions", ...)`。
- `gameRouter.post("/sessions", ...)`。
- `gameRouter.get("/sessions", ...)`。
- `gameRouter.get("/sessions/:sessionId", ...)`。
- `gameQuestionsQuerySchema`, `gameSessionBodySchema`, `gameSessionHistoryQuerySchema`, `gameSessionParamsSchema`。
- `authMiddleware` とエンドポイント別 `rateLimit()` を適用。
- ルート層はサービスエラーを 400 / 404 / 409 / 500 に変換する。

**`backend/src/services/game.service.ts`**
- `createGameQuestionSet(params): Promise<CreateGameQuestionSetResult>`。
- `submitGameSession(params): Promise<SubmitGameSessionResult>`。
- `getGameSessionHistory(params): Promise<GetGameSessionHistoryResult>`。
- `getGameSessionResult(params): Promise<SubmitGameSessionResult>`。
- error class: `InsufficientWeakElementsError`, `QuestionSetNotFoundError`, `QuestionSetExpiredError`, `QuestionSetModeMismatchError`, `QuestionSetAlreadySubmittedError`, `GameSessionValidationError`, `GameSessionHistoryCursorError`, `GameSessionNotFoundError`。
- constants: `QUESTION_TIME_LIMIT_SEC = 15`, `GAME_SESSION_DURATION_LIMIT_SEC = 1800`。

**`backend/prisma/schema.prisma`**
- `GameQuestionSet`: 一時問題セット。`expiresAt` index あり。
- `GameSession`: 履歴概要。`@@index([userId, playedAt, id])` あり。
- `GameAnswer`: 結果詳細、習得状態集計、苦手更新の根拠。
- `WeakElement`: `@@unique([userId, elementId])` で苦手要素を一意化。
- `UserStats`: 累計ゲーム数、正解数、回答数、スコア、習得数。

**`backend/src/services/element-mastery.service.ts`**
- `getElementMasteryStatusMap(userId, elementIds, client?)`。
- 対象元素ごとに直近2回のセッション結果を見て `unlearned` / `learning` / `mastered` を返す。
- `GAME_SESSION_PAGE_SIZE = 50`。

**`frontend/src/lib/api/game.ts`**
- `getGameQuestions(options): Promise<GameQuestionsResponse>`。
- `submitGameSession(options): Promise<GameSessionResponse>`。
- `getGameSessions(options): Promise<GameSessionsResponse>`。
- `getGameSession(options): Promise<GameSessionResponse>`。
- `API_BASE_URL`, `parseErrorResponse`, `ApiError` を使う。
- 実行時検証で正解情報漏えい・不正レスポンスを検出する。

**`frontend/src/lib/api/errors.ts`**
- `parseErrorResponse(response, defaultMessage?)`。
- `response.ok` を確認してから JSON parse し、非 JSON エラーでは代替メッセージを使う。

**既存テスト**
- `backend/src/routes/game/questions.test.ts`。
- `backend/src/routes/game/sessions.test.ts`。
- `backend/src/routes/game/session-history.test.ts`。
- `backend/src/routes/game/session-detail.test.ts`。
- `backend/src/services/game.service.test.ts`。
- `backend/src/jobs/cleanupGameQuestionSets.test.ts`。
- `frontend/src/lib/api/game.test.ts`。

### 重要な制約

- 実装コードはテストを通すためだけに変更しない。仕様に沿わない挙動が見つかった場合のみ最小修正する。
- backend のエラーメッセージは日本語に統一する。
- Prisma ORM 経由でアクセスし、生 SQL は追加しない。
- `GET /game/questions` の公開レスポンスに `correctChoiceId` / `elementId` を含めない。
- `POST /game/sessions` は `isCorrect`, `score`, `correctChoiceId`, `elementId` をクライアントから受け取らない。
- `questionSetId`, `questionId`, `chosenChoiceId`, `cursor`, `sessionId` の前後空白除去方針は zod schema / サービス検証 / フロントエンド補助関数と矛盾させない。
- `GameQuestionSet` の消費と session 保存は transaction 内で行い、二重送信を成功させない。
- `GET /game/sessions` は概要のみ返し、`answers` / `results` を含めない。
- `GET /game/sessions/:sessionId` は `userId` と `sessionId` の両方で検索し、他ユーザー結果を漏らさない。
- DB schema / migration は原則変更しない。変更が必要になった場合は別途 migration、`npx prisma migrate deploy`、Playwright 確認を実施する。

### 確認事項

- 元依頼の正式な機能名・計画書ディレクトリ名・画面ルート・関連 API は未置換だったため、主対象は `docs/05_progress.md` の `ゲーム API のテスト` とする。
- この計画書の保存パスは `docs/plans/game-api-tests/plan.md` とする。
- 画面ルートは主対象なし。A11Y は既存画面の回帰確認として扱う。
- `docs/prs/*.md` にゲーム API テストへ直接紐づく PR メモは見当たらない。
- 既存テストが既に広いため、実装担当は最初に既存テストケース一覧を確認し、重複ケースを追加しない。

## 対象ファイル一覧（変更種別つき）

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/routes/game/questions.test.ts` | 修正 | `GET /game/questions` の未指定 mode、rate limit 境界、正解情報非公開のルート回帰を補強 |
| `backend/src/routes/game/sessions.test.ts` | 修正 | `POST /game/sessions` の mode mismatch、already submitted、想定外エラー、duration 境界、余分なクライアント送信項目の無視を補強 |
| `backend/src/routes/game/session-history.test.ts` | 修正 | 履歴一覧の空状態、500、limit 上限、mode filter、cursor validation の route 回帰を補強 |
| `backend/src/routes/game/session-detail.test.ts` | 修正 | 詳細取得の sessionId 正規化、404、500、ISO 変換、他ユーザー非漏えい前提を補強 |
| `backend/src/services/game.service.test.ts` | 修正 | mode mismatch、answers 数不一致、重複 questionId、保存 JSON 不正、履歴空状態、概要項目だけの select を補強 |
| `backend/src/jobs/cleanupGameQuestionSets.test.ts` | 確認 / 必要時修正 | 期限切れ GameQuestionSet cleanup の安全ログ・削除条件を回帰確認 |
| `frontend/src/lib/api/game.test.ts` | 修正 | フロントエンド API クライアントの JSON エラー保持、非 JSON 時の代替メッセージ、実行時検証、query 正規化を補強 |
| `docs/04_api.md` | 確認 / 必要時修正 | テストで仕様差分が見つかった場合のみ更新 |
| `docs/05_progress.md` | 修正 | `ゲーム API のテスト` に計画書リンク、実装中・完了マークを反映 |
| `docs/plans/game-api-tests/plan.md` | 新規 / 修正 | 本計画。実装完了時にチェック更新と完了記録を追加 |

## API 仕様（この機能で使う範囲のみ）

### エラーレスポンス共通形式

```json
{ "error": "メッセージ文字列" }
```

バリデーションエラー:

```json
{
  "error": "バリデーションエラー",
  "details": [
    { "message": "ゲームモードが正しくありません" }
  ]
}
```

### 対象エンドポイント

| メソッド | パス | 認証 | リクエスト | レスポンス | 主な検証対象 |
|---|---|---|---|---|---|
| GET | `/api/v1/game/questions` | 必須 | query `mode` | `GameQuestionsResponse` | mode 検証、正解情報非公開、苦手不足 409、rate limit |
| POST | `/api/v1/game/sessions` | 必須 | `questionSetId`, `mode`, `answers`, `durationSec` | `GameSessionResponse` | server side 判定、二重送信、期限切れ、mode mismatch、validation |
| GET | `/api/v1/game/sessions` | 必須 | query `limit`, `cursor`, `mode` | `GameSessionsResponse` | 概要のみ、cursor、空状態、本人絞り込み、limit |
| GET | `/api/v1/game/sessions/:sessionId` | 必須 | path `sessionId` | `GameSessionResponse` | 詳細復元、404、本人絞り込み、旧データ復元 |

### ステータスコード対応

| ステータス | 条件 | フロントエンドの扱い |
|---|---|---|
| 400 | zod validation / service validation | backend の `details[0].message` または `error` を保持 |
| 401 | 未認証、token 不正、ユーザーなし | backend の日本語 `error` を保持 |
| 403 | 停止、メール未確認、ロック中 | backend の日本語 `error` を保持 |
| 404 | 問題セットなし、結果なし、他ユーザー結果 | backend の日本語 `error` を保持 |
| 409 | 苦手不足、期限切れ、mode mismatch、二重送信 | backend の日本語 `error` を保持 |
| 429 | rate limit | backend の日本語 `error` を保持 |
| 500 | 想定外エラー | `{ "error": "サーバーエラーが発生しました" }` |
| 502 / 504 | proxy / server down の非 JSON 応答 | フロントエンド API クライアントの代替メッセージ |

## 設計上の決定事項（判断理由つき）

1. **主対象をどこに置くか**
   - 選択: バックエンドのルート / サービステストを主対象にし、フロントエンドは API クライアント契約テストに限定する。
   - 根拠: 進捗タスクがフェーズ7「ゲーム API 本実装」配下で、画面ルートが指定されていないため。

2. **状態の信頼する情報源**
   - 選択: 正誤・スコア・履歴・結果詳細は DB とバックエンドサービスのレスポンスを信頼する情報源にする。
   - 根拠: フロントエンドで正誤やスコアを再計算しない仕様であり、改ざん耐性と表示整合性を守るため。

3. **API パラメータの組み立て層**
   - 選択: バックエンドは zod schema、フロントエンドは `$lib/api/game.ts` と既存補助関数で組み立てる。
   - 根拠: UI コンポーネントに API 仕様や query 正規化を埋め込まないため。

4. **正規化済み値の保持**
   - 選択: ルート schema で前後空白を除去した値を `c.req.valid()` から取得し、サービスへ渡す。サービス単体テストでは schema を通らない呼び出しも守る。
   - 根拠: ルート経由とサービス直接呼び出しの両方で入力整合性を保つため。

5. **エラー表示と toast**
   - 選択: このタスクで UI 表示は変更しない。API クライアントはバックエンドの日本語 `error` / `details[0].message` を保持する。
   - 根拠: 画面側の toast / 画面内表示は既存実装の責務であり、API テストでは表示の前提となる message を守るだけで十分なため。

6. **A11Y の扱い**
   - 選択: 新規 UI がないため、A11Y は既存画面の読み込み中 / エラー / 空状態 / 再試行導線を壊さない手動回帰確認に留める。
   - 根拠: テスト計画で UI 改修を混ぜるとスコープが膨らむため。API エラー文言保持は画面内 `role="alert"` や `aria-live` 表示の前提として確認する。

7. **DB 負荷の判断**
   - 選択: schema / query 形状は変更しない。履歴一覧の概要項目 select、詳細取得の単一 session include、transaction 内集計の既存設計を維持する。
   - 根拠: 現状のデータ量はゲーム1回10問、元素118件が上限で、テストタスクで負荷の高い新規 query を追加する必要がないため。

8. **二重送信防止の検証**
   - 選択: `GameQuestionSet.deleteMany({ id, userId })` の count が 0 の場合を `QuestionSetAlreadySubmittedError` として service / route で検証する。
   - 根拠: 同じ `questionSetId` による複数保存はスコア・苦手・統計を壊すため。

9. **rate limit テスト**
   - 選択: エンドポイントごとの上限値そのものを網羅しすぎず、少なくとも 429 変換と読み取り / 書き込みの上限差分が壊れないことを確認する。
   - 根拠: ミドルウェア単体テストと重複しやすく、ルートテストを時間依存・順序依存にしすぎないため。

10. **DB migration の扱い**
    - 選択: migration は不要。必要になった場合はこのタスクから分離するか、追加チェックを明記してから実施する。
    - 根拠: テスト強化タスクで DB 構造を変える理由がないため。

## 公開インターフェース案（必要な場合）

新しい本番コード用の公開 API は追加しない。

テスト補助関数は各テストファイル内に閉じる。複数ファイルで同じ token 作成・mock user 作成が増える場合のみ、既存パターンに合わせて `backend/src/test-setup.ts` か局所的な補助関数化を検討する。

```typescript
// テスト内補助関数の例。本番コードから export する関数は追加しない。
function createValidGameSessionBody(overrides?: Partial<GameSessionBody>): GameSessionBody
```

## タスクリスト（進捗管理）

| タスクID | 内容 | ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存仕様・既存実装・既存テストの最終確認 | `docs/04_api.md`, `docs/05_progress.md`, game 関連ルート / サービス / テスト | 既存テストケース一覧と仕様差分を確認し、追加対象を重複なく確定 | 高 |
| T2 | `GET /game/questions` ルートテストを補強 | `backend/src/routes/game/questions.test.ts` | mode 未指定、正解情報非公開、409、500、必要なら 429 を検証 | 高 |
| T3 | `POST /game/sessions` ルートテストを補強 | `backend/src/routes/game/sessions.test.ts` | `QuestionSetModeMismatchError`, `QuestionSetAlreadySubmittedError`, 想定外エラー、0/15/1800 境界を検証 | 高 |
| T4 | `GET /game/sessions` ルートテストを補強 | `backend/src/routes/game/session-history.test.ts` | 空状態、limit 50、limit 51、mode filter、500、cursor error のレスポンスを検証 | 高 |
| T5 | `GET /game/sessions/:sessionId` ルートテストを補強 | `backend/src/routes/game/session-detail.test.ts` | sessionId の前後空白除去、404、500、playedAt ISO 変換、サービス呼び出し引数を検証 | 高 |
| T6 | `game.service.ts` のサービステストを補強 | `backend/src/services/game.service.test.ts` | mode mismatch、answers 数不一致、重複 questionId、保存済み questions 不正、履歴空状態、概要項目 select を検証 | 高 |
| T7 | GameQuestionSet cleanup テストの要否確認 | `backend/src/jobs/cleanupGameQuestionSets.test.ts` | 期限切れ削除、0件成功、安全ログが既に十分なら変更しない | 中 |
| T8 | フロントエンド API クライアントテストを補強 | `frontend/src/lib/api/game.test.ts` | JSON エラー保持、非 JSON 時の代替メッセージ、実行時検証、履歴 query 省略、正解情報混入検出を検証 | 中 |
| T9 | 追加テストで見つかった仕様不一致を最小修正 | 関連する本番コード | 仕様に沿った修正のみ行い、テスト専用分岐を入れない | 高 |
| T10 | `docs/04_api.md` 更新要否を確認 | `docs/04_api.md` | ステータスコード・エラーメッセージ・レスポンス形状に差分があれば反映 | 高 |
| T11 | 品質チェックを実行 | backend / frontend | lint、format、test が通過 | 高 |
| T12 | 手動確認を実施 | API / 既存 game 画面 | ゲーム開始、結果保存、結果復元、履歴一覧に回帰がない | 中 |
| T13 | 実装完了更新 | `docs/05_progress.md`, `docs/plans/game-api-tests/plan.md` | チェックボックス、対象ファイル一覧、実装完了セクションが実態と一致 | 高 |

- [ ] T1: 既存仕様・既存実装・既存テストの最終確認
- [ ] T2: `GET /game/questions` ルートテストを補強
- [ ] T3: `POST /game/sessions` ルートテストを補強
- [ ] T4: `GET /game/sessions` ルートテストを補強
- [ ] T5: `GET /game/sessions/:sessionId` ルートテストを補強
- [ ] T6: `game.service.ts` のサービステストを補強
- [ ] T7: GameQuestionSet cleanup テストの要否確認
- [ ] T8: フロントエンド API クライアントテストを補強
- [ ] T9: 追加テストで見つかった仕様不一致を最小修正
- [ ] T10: `docs/04_api.md` 更新要否を確認
- [ ] T11: lint / format / test を実行
- [ ] T12: 手動確認を実施
- [ ] T13: `docs/05_progress.md` と plan.md の実装完了更新

## 技術的注意点

- ルートテストでは `JWT_SECRET` を `vi.stubEnv()` し、`afterEach` で `vi.unstubAllEnvs()` を呼ぶ。
- JWT は `sign(payload, TEST_SECRET, "HS256")` で生成し、実装の `verify(token, secret, "HS256")` と一致させる。
- Prisma モックは既存ファイルの `vi.mock("../../lib/prisma.js", ...)` / `vi.mock("../lib/prisma.js", ...)` の深さに合わせる。
- ルートテストでサービスをモックする場合、追加 export された error class の `message` と `name` を実装と一致させる。
- サービステストでは `prisma.$transaction` の既存モックパターンを崩さない。
- `response.ok` を JSON parse 前に確認するフロントエンド API クライアントの方針を維持する。
- 502 / 504 相当の非 JSON レスポンスは `parseErrorResponse()` の代替メッセージで扱う。
- `GET /game/sessions` のレスポンス item に `results` が混ざったらフロントエンドの実行時検証で弾く。
- rate limit ミドルウェアは closure に state を持つため、429 をルートテストに追加する場合はテスト順序依存にならないよう isolated app またはリクエスト元を意識する。
- 既存 UI の A11Y 表示を変える場合は、`aria-busy`, `aria-live`, `role="alert"` の既存方針と整合させる。

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| route: `GET /game/questions` 未認証 | 401 `{ "error": "認証が必要です" }`、サービスは呼ばれない |
| route: `GET /game/questions` mode 未指定 / 不正 | 400 `バリデーションエラー` |
| route: `GET /game/questions` 正常系 | 200。`questionSetId`, `expiresAt`, `questions` を返す |
| route: `GET /game/questions` 正解情報漏えいなし | レスポンスの question / choice に `correctChoiceId` / `elementId` がない |
| route: `GET /game/questions` 苦手不足 | 409 `苦手モードを始めるには、苦手元素が5件以上必要です` |
| route: `GET /game/questions` 想定外エラー | 500 `サーバーエラーが発生しました` |
| service: 問題生成 normal Lv1 | 1〜20 の候補から10問生成 |
| service: 問題生成 normal Lv2 | 21〜118 の候補から10問生成 |
| service: 問題生成 weak 5件 | 10問に循環利用される |
| service: 問題生成 weak 4件 | `InsufficientWeakElementsError` |
| service: 公開問題 | DB JSON には判定情報を保存し、公開レスポンスには出さない |
| route: `POST /game/sessions` 未認証 | 401、サービスは呼ばれない |
| route: `POST /game/sessions` body 不正 | 400 `バリデーションエラー` |
| route: `POST /game/sessions` `answerTimeSec` 0 / 15 | 検証を通る |
| route: `POST /game/sessions` `answerTimeSec` 16 / 小数 | 400 |
| route: `POST /game/sessions` `durationSec` 0 / 1800 | 検証を通る |
| route: `POST /game/sessions` `durationSec` 1801 | 400 |
| route: `POST /game/sessions` 正常系 | 201。`playedAt` は ISO string |
| route: `POST /game/sessions` validation error | 400 `回答形式が正しくありません` |
| route: `POST /game/sessions` question set not found | 404 `問題セットが見つかりません` |
| route: `POST /game/sessions` expired | 409 `問題セットの有効期限が切れています。もう一度ゲームを開始してください` |
| route: `POST /game/sessions` mode mismatch | 409 `問題セットのゲームモードが一致しません` |
| route: `POST /game/sessions` already submitted | 409 `問題セットはすでに送信済みです` |
| service: `POST /game/sessions` 正常判定 | score、correctCount、maxStreak、GameAnswer 保存値が正しい |
| service: `chosenChoiceId: null` | 時間切れ扱い、`yourAnswer: null`, score 0 |
| service: answers 数不一致 | `GameSessionValidationError` |
| service: questionId 重複 | `GameSessionValidationError` |
| service: unknown questionId / choiceId | `GameSessionValidationError` |
| service: `questionSetId` 空白 | transaction 前に `GameSessionValidationError` |
| service: expiresAt と now が同時刻 | 期限切れ |
| service: 二重送信 | `deleteMany.count === 0` で `QuestionSetAlreadySubmittedError` |
| service: WeakElement 不正解 | missCount を不正解数だけ upsert / increment |
| service: WeakElement 正解 | consecutiveHit を増やし、2回連続で削除 |
| service: UserStats | totalGames、totalCorrect、totalAnswered、weeklyScore、allTimeScore を更新 |
| service: masteredCount | 今回影響のある元素だけ差分更新し、初回 stats 作成時は全元素集計 |
| route: `GET /game/sessions` 未認証 | 401 |
| route: `GET /game/sessions` query 未指定 | limit 20、cursor / mode undefined |
| route: `GET /game/sessions` limit 空白 | limit 20 |
| route: `GET /game/sessions` limit 50 | validation を通る |
| route: `GET /game/sessions` limit 51 / 0 / 小数 | 400 |
| route: `GET /game/sessions` cursor 空文字 / 非 string | 400 |
| route: `GET /game/sessions` service cursor error | 400 `カーソルが正しくありません` |
| route: `GET /game/sessions` 空状態 | 200 `{ sessions: [], nextCursor: null }` |
| service: 履歴一覧 | `select` は概要項目のみ、`answers` を include しない |
| service: 履歴 pagination | `limit + 1` で `nextCursor` を返す |
| service: 履歴 cursor 他ユーザー | `GameSessionHistoryCursorError` |
| route: `GET /game/sessions/:sessionId` 未認証 | 401 |
| route: `GET /game/sessions/:sessionId` 空白 | 400 |
| route: `GET /game/sessions/:sessionId` 正常系 | 200。`results` を含み、`playedAt` は ISO string |
| route: `GET /game/sessions/:sessionId` not found | 404 `ゲーム結果が見つかりません` |
| service: 結果詳細 | `userId + sessionId` で検索し、answers を表示順で返す |
| service: 旧回答データの復元 | nullable 表示フィールドがない旧データでも element と mode から復元する |
| cleanup: 期限切れ GameQuestionSet | `expiresAt <= cutoff` のみ削除 |
| cleanup: 削除0件 | 成功扱い |
| cleanup: 失敗ログ | DB エラー詳細をログやエラーメッセージに出さない |
| frontend API: `getGameQuestions` 正常系 | mode query、Authorization、credentials を付ける |
| frontend API: `getGameQuestions` 非 JSON エラー | `ゲーム問題の取得に失敗しました` |
| frontend API: `getGameQuestions` 正解情報混入 | 実行時検証で `ApiError(500)` |
| frontend API: `submitGameSession` 正常系 | client は `isCorrect` / `score` を送らない |
| frontend API: `submitGameSession` JSON error | backend の日本語 error を保持 |
| frontend API: `getGameSessions` query 省略 | null / undefined / 空白 cursor を URL から省略 |
| frontend API: `getGameSessions` item に `results` 混入 | 実行時検証で `ApiError(500)` |
| frontend API: `getGameSession` sessionId | `encodeURIComponent` された URL を使う |
| A11Y 手動回帰 | API エラー時に既存画面で状態が読み取れ、操作不能なまま固まらない |

## 実装リスクと回避策

| リスク | 回避策 |
|---|---|
| 既存テストと重複するケースを大量追加する | T1 で既存テストケース一覧を確認し、差分だけ追加する |
| ルートテストがサービスの詳細を検証しすぎる | ルートは status / response / service 呼び出し引数、サービスは DB 副作用と集計に分ける |
| モック class と実装 class の不一致で error mapping が壊れる | ルートテストのサービスモックに追加する error class は実装の message / name と揃える |
| rate limit test が順序依存になる | ミドルウェア単体テストで担保済みの範囲は重複させず、エンドポイント差分だけ確認する |
| フロントエンド API クライアントがバックエンドエラーを上書きする | `parseErrorResponse()` を使い、JSON error / details message を優先するテストを置く |
| DB 負荷の高い query が紛れ込む | サービステストで `select` / `include` / `take` / cursor 条件を検証する |
| A11Y がスコープ外として忘れられる | UI 改修はしないが、手動確認に既存状態表示の回帰確認を含める |
| docs と実装がずれる | T10 と T13 で `docs/04_api.md`, `docs/05_progress.md`, plan の整合性を確認する |

## 手動確認項目

| 項目 | 手順 | 期待結果 |
|---|---|---|
| API 起動 | `docker compose up -d` 後、`/api/v1/health` を確認 | API が応答する |
| 問題取得 | ログイン済み token で `GET /api/v1/game/questions?mode=SYMBOL_TO_NAME_LV1` | 200。正解情報が公開されない |
| 結果送信 | 取得した `questionSetId` で `POST /api/v1/game/sessions` | 201。正誤・スコアはサーバーレスポンス由来 |
| 二重送信 | 同じ `questionSetId` で再送信 | 404 または 409。二重保存されない |
| 履歴一覧 | `GET /api/v1/game/sessions` | 200。概要のみで `results` はない |
| 結果詳細 | `GET /api/v1/game/sessions/:sessionId` | 200。`results` を含む |
| 既存 `/game` | ブラウザでゲームモード選択を表示 | レイアウト崩れ・console error がない |
| 既存 `/game/play` | 可能なら1ゲームを完了 | 二重送信されず、結果画面へ遷移する |
| 既存 `/game/result` | 結果画面を reload | loading / error / result の状態が破綻しない |
| 既存 `/mypage` | 履歴一覧を表示 | 空状態・履歴あり・追加読み込みで操作不能にならない |
| A11Y 回帰 | キーボード操作と状態メッセージを確認 | エラーや loading が視覚だけに依存しない |

## 実装完了時の更新ルール

- 完了したタスクのチェックボックスを `- [x]` に更新する。
- `docs/05_progress.md` の `ゲーム API のテスト` を `[-]` から `[x]` に更新する。
- API 仕様・ステータスコード・エラーメッセージ・レスポンス形状に差分が出た場合のみ `docs/04_api.md` を更新する。
- 対象ファイル一覧を実際の変更ファイルに合わせて更新する。
- 実装完了時に以下のセクションを追記する。

```markdown
## 実装完了
- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/game-api-tests
- PR: #N

### 計画からの変更点
- なし

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/routes/game/questions.test.ts` | 修正 | 追加したテスト内容 |
| `backend/src/routes/game/sessions.test.ts` | 修正 | 追加したテスト内容 |
| `backend/src/routes/game/session-history.test.ts` | 修正 | 追加したテスト内容 |
| `backend/src/routes/game/session-detail.test.ts` | 修正 | 追加したテスト内容 |
| `backend/src/services/game.service.test.ts` | 修正 | 追加したテスト内容 |
| `frontend/src/lib/api/game.test.ts` | 修正 | 追加したテスト内容 |
| `docs/05_progress.md` | 修正 | 完了マーク更新 |
| `docs/plans/game-api-tests/plan.md` | 修正 | 実装完了記録 |

### 品質チェック
| コマンド | 結果 |
|---|---|
| `cd backend && npm run lint` | |
| `cd backend && npm run format:check` | |
| `cd backend && npm run test -- --run` | |
| `cd frontend && npm run lint` | |
| `cd frontend && npm run test:run` | |
| `cd frontend && npm run check` | |

### 手動確認
| 項目 | 結果 |
|---|---|
| 問題取得 | |
| 結果送信 | |
| 二重送信 | |
| 履歴一覧 | |
| 結果詳細 | |
| 既存画面 A11Y 回帰 | |
```
