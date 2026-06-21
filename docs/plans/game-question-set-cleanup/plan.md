# 期限切れ GameQuestionSet クリーンアップ処理 実装計画

> 設計者ロール: シニアフロントエンドエンジニア（API 契約・画面影響・A11Y レビュー） + バックエンドジョブ設計・DB 負荷レビュー
> 対象実装者: Codex

## 概要

`docs/05_progress.md` フェーズ7の未完了タスク「期限切れ GameQuestionSet クリーンアップ処理（手動実行 + Cron Trigger 想定）」を完了する。回答されずに期限切れになった `GameQuestionSet` を Prisma 経由で削除し、`GET /game/questions` が作成する一時データの肥大化と正解情報 JSON の残留を防ぐ。

初期実装では公開 HTTP API やユーザー画面を追加しない。手動実行できる backend job を作り、将来 Cloudflare Workers Cron Trigger から同じ関数を呼べるよう、ジョブ本体・CLI entrypoint・運用設定の責務を分離する。

## レビュー結果と改善方針

| 観点             | レビュー結果                                                                                                                                              | 改善方針                                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 依頼内容整合性   | 元の依頼には `{{機能名}}`, `{{planディレクトリ名}}`, `{{API一覧}}`, `{{要件1}}` など未置換プレースホルダーが残っていた                                    | 主対象は `docs/05_progress.md` フェーズ7の「期限切れ GameQuestionSet クリーンアップ処理（手動実行 + Cron Trigger 想定）」と確定する。計画書パスは `docs/plans/game-question-set-cleanup/plan.md` とする |
| 既存コード整合性 | `GameQuestionSet` は `GET /game/questions` で作成され、`POST /game/sessions` 成功時に削除される。期限切れの場合は `QuestionSetExpiredError` で 409 を返す | cleanup は未送信の期限切れセットだけを削除する。`POST /game/sessions` の責務やエラー仕様は変更しない                                                                                                    |
| 仕様適合         | `docs/12_task_guide.md` は `expiresAt < now` と記載する一方、既存 `submitGameSession()` は `expiresAt <= now` を期限切れ扱いにしている                    | 実装では既存 service と整合させて `expiresAt <= now`、Prisma では `lte` を採用する。差分理由を計画に残す                                                                                                |
| A11Y             | 今回は UI を追加しないため、新規の keyboard / aria / focus 設計は不要                                                                                     | 画面変更は対象外。ただし `/game/play` の期限切れ・再取得導線が壊れていないことを手動確認に含める                                                                                                        |
| DB 整合性        | `backend/prisma/schema.prisma` の `GameQuestionSet` には `@@index([expiresAt])` がある。`backend/prisma/migrations/` には migration SQL が見当たらない    | schema 変更は行わない想定。実装時に開発 DB へ index が反映済みか確認し、未反映なら migration 適用確認を追加する                                                                                         |
| DB 負荷          | cleanup 対象は全ユーザー横断の期限切れ一時データ。無条件削除や全件取得は負荷・情報露出リスクがある                                                        | `deleteMany({ where: { expiresAt: { lte: cutoff } } })` の単発処理に限定する。個別レコード取得、正解 JSON 読み取り、ユーザー単位ログは行わない                                                          |
| セキュリティ     | `GameQuestionSet.questions` には正解判定用情報が保存される                                                                                                | ログには `deletedCount`, `cutoff`, `event` だけを出し、`userId` / `questions` / `questionSetId` は出さない                                                                                              |
| テスト           | 既存 game service / route テストは問題生成・送信・期限切れ送信を扱うが、期限切れデータの定期削除は未テスト                                                | `backend/src/jobs/cleanupGameQuestionSets.test.ts` を新規作成し、削除条件、0件、境界時刻、Prisma 例外、ログ内容を検証する                                                                               |
| 運用責務         | フェーズ9に「定期バッチ運用設計」が残っている                                                                                                             | 今回は手動実行可能な job と Cron から呼べる関数まで。Cloudflare の Cron 設定、失敗通知、週間リセットとの統合は後続タスクで扱う                                                                          |
| docs 整合        | `docs/04_api.md` は公開 API 仕様書であり、cleanup は公開 API ではない                                                                                     | `docs/04_api.md` は原則更新不要。`docs/05_progress.md` と本計画書に実装記録を残す                                                                                                                       |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**

- 設計決定2: `GET /game/questions` で DB に正解情報と有効期限（30分）を保存し `questionSetId` を返す。
- 設計決定2: `POST /game/sessions` で `questionSetId` を受け取り、正誤判定後に削除する。
- フェーズ7: `期限切れ GameQuestionSet クリーンアップ処理（手動実行 + Cron Trigger 想定）` は未完了。
- フェーズ9: `定期バッチ運用設計（週間リセット・GameQuestionSet cleanup の Cron Trigger 設定）` は後続タスク。

**`docs/04_api.md`**

- `GET /api/v1/game/questions` は `questionSetId`, `expiresAt`, `questions` を返す。
- `POST /api/v1/game/sessions` は `questionSetId` を受け取り、成功時に `GameQuestionSet` を削除する。
- 期限切れ `questionSetId` の送信は 409 の日本語エラー「問題セットの有効期限が切れています。もう一度ゲームを開始してください」。

**`docs/12_task_guide.md`**

- `backend/src/jobs/cleanupGameQuestionSets.ts` を新規作成する方針。
- `expiresAt` の index を確認し、削除件数を個人情報なしの構造化ログに出す。
- 開発環境では手動実行、本番では Cloudflare Workers Cron Trigger で定期実行する想定。

**`backend/prisma/schema.prisma`**

- `GameQuestionSet`: `id`, `userId`, `mode`, `questions`, `expiresAt`, `createdAt`。
- `GameQuestionSet` は `@@index([expiresAt])` を持つ。
- `User.gameQuestionSets` は `onDelete: Cascade` の relation を持つ。
- Prisma v7 制約どおり、`datasource` に `url =` は書かれていない。

**`backend/src/lib/prisma.ts`**

- `prisma` — `PrismaPg` adapter 付き `PrismaClient` singleton。

**`backend/src/services/game.service.ts`**

- `createGameQuestionSet(params): Promise<CreateGameQuestionSetResult>` — `expiresAt = now + 30分` の `GameQuestionSet` を作成する。
- `submitGameSession(params): Promise<SubmitGameSessionResult>` — `questionSetId`, `userId`, `mode`, `expiresAt` を照合し、正常送信時に対象 `GameQuestionSet` を削除する。
- `QuestionSetExpiredError` — `expiresAt <= now` のとき投げられる日本語エラー。

**`backend/src/routes/game/index.ts`**

- `GET /game/questions` — `createGameQuestionSet()` を呼び出す。
- `POST /game/sessions` — `submitGameSession()` を呼び出し、期限切れは 409 に変換する。

**`frontend/src/lib/api/game.ts`**

- `getGameQuestions({ mode, accessToken, signal }): Promise<GameQuestionsResponse>`。
- `submitGameSession({ questionSetId, mode, answers, durationSec, accessToken, signal }): Promise<GameSessionResponse>`。
- cleanup 用の frontend API client は存在せず、今回も追加しない。

**`frontend/src/routes/(app)/game/play/+page.svelte`**

- URL query `mode` と認証状態から `GET /game/questions` を呼び、新しい `questionSetId` を保持する。
- 問題取得中、エラー、再試行、未ログイン、invalid mode の画面内状態を持つ。

### 重要な制約

- 公開 HTTP API、管理画面、ユーザー向け UI は追加しない。
- DB アクセスは Prisma ORM 経由。`$queryRaw` 等の生 SQL は使わない。
- 削除対象は `expiresAt <= cutoff` の `GameQuestionSet` のみ。
- `questionSetId`, `userId`, `questions` JSON、正解情報をログに出さない。
- `POST /game/sessions` の期限切れ判定・二重送信判定・エラー文言は変更しない。
- 手動実行 entrypoint と job 本体を分ける。Cron Trigger からは job 本体を再利用できる形にする。
- Cloudflare Workers の `scheduled` handler、wrangler 設定、失敗通知、週間リセットとの統合は後続の定期バッチ運用設計で扱う。
- DB schema / migration は変更しない想定。schema や migration を変更した場合は、`prisma migrate deploy` と Playwright 確認を追加する。
- backend のエラー・ログ文言は日本語を基本にする。

### 確認事項

- 依頼文の `{{機能名}}`, `{{planディレクトリ名}}`, `{{API一覧}}` は未置換だったため、正式な計画ディレクトリ名は本計画で `game-question-set-cleanup` と定める。
- `docs/12_task_guide.md` の `expiresAt < now` と既存 `submitGameSession()` の `expiresAt <= now` に差分がある。実装では既存挙動を優先し `lte` に統一する。
- `backend/prisma/migrations/` に migration SQL がないため、実装時に開発 DB の index 反映状況を確認する。必要があれば migration 確認タスクを追加する。
- cleanup は全ユーザー横断の運用処理だが、公開 API 化しないため認証 middleware / rateLimit middleware は使わない。
- フロントエンドの URL query、store、API client、UI local state は変更しない。今回のフロントエンド作業は影響確認のみ。

## 対象ファイル一覧（変更種別つき）

| ファイル                                           | 変更種別       | 内容                                                                                      |
| -------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------- |
| `backend/src/jobs/cleanupGameQuestionSets.ts`      | 新規           | 手動実行・Cron 共用の cleanup job 本体                                                    |
| `backend/src/jobs/cleanupGameQuestionSets.test.ts` | 新規           | Prisma mock による削除条件・戻り値・ログ方針のテスト                                      |
| `backend/src/jobs/cleanupGameQuestionSets.cli.ts`  | 新規           | 手動実行用 entrypoint。job を呼び、結果ログと exit code を管理                            |
| `backend/package.json`                             | 修正           | 手動実行 script を追加。例: `cleanup:game-question-sets`                                  |
| `backend/src/services/game.service.ts`             | 確認           | `expiresAt <= now` の期限切れ判定と cleanup 条件が一致していることを確認                  |
| `backend/src/services/game.service.test.ts`        | 確認または修正 | 期限切れ `GameQuestionSet` の送信時挙動と cleanup 条件の整合を確認                        |
| `backend/src/routes/game/sessions.test.ts`         | 確認または修正 | `POST /game/sessions` の期限切れ 409 と cleanup の責務分離を確認                          |
| `backend/prisma/schema.prisma`                     | 確認           | `@@index([expiresAt])` が維持されていることを確認                                         |
| `frontend/src/lib/api/game.ts`                     | 確認           | cleanup 用 API client を追加しないこと、既存ゲーム API のエラー処理が維持されることを確認 |
| `frontend/src/routes/(app)/game/play/+page.svelte` | 確認           | 期限切れ時の再開始・再取得導線が壊れないことを確認                                        |
| `docs/04_api.md`                                   | 確認           | 公開 API 変更がないため更新不要であることを確認                                           |
| `docs/05_progress.md`                              | 修正           | 対象タスクに本計画書リンクを追加し、実装完了時に `[x]` へ更新                             |
| `docs/plans/game-question-set-cleanup/plan.md`     | 修正           | 本計画。実装完了時にチェックボックスと `## 実装完了` を更新                               |

## API 仕様（この機能で使う範囲のみ）

### 公開 API

このタスクでは公開 HTTP API を追加・変更しない。

### 関連する既存 API

| メソッド | パス                     | 認証 | 関係                                                              |
| -------- | ------------------------ | ---- | ----------------------------------------------------------------- |
| GET      | `/api/v1/game/questions` | 必須 | `GameQuestionSet` を作成し、`questionSetId` と `expiresAt` を返す |
| POST     | `/api/v1/game/sessions`  | 必須 | 成功時に対象 `GameQuestionSet` を削除する。期限切れは 409         |

### 手動実行コマンド案

```bash
cd backend
npm run cleanup:game-question-sets
```

### 手動実行ログ案

成功時:

```text
event=game_question_sets.cleanup.completed
deletedCount=12
cutoff=2026-06-21T00:00:00.000Z
```

失敗時:

```text
event=game_question_sets.cleanup.failed
message=期限切れ問題セットの削除に失敗しました
```

## 設計上の決定事項（判断理由つき）

1. **状態の source of truth をどこに置くか**
   - 選択: DB の `GameQuestionSet.expiresAt` を削除判定の source of truth にする。
   - 根拠: `GET /game/questions` が保存し、`POST /game/sessions` も同じ値で期限切れを判定しているため。

2. **初期表示時に状態をどこから復元するか**
   - 選択: ユーザー画面を追加しないため、復元対象の UI state はない。
   - 根拠: cleanup は運用ジョブであり、page state / store / URL query に依存させると不要な責務が増えるため。

3. **ユーザー入力の反映タイミング**
   - 選択: ユーザー入力は扱わない。手動実行時は npm script 実行をトリガーにする。
   - 根拠: 削除条件はユーザー入力ではなく `cutoff` 時刻のみで決まるため。

4. **API パラメータの組み立てをどの層で行うか**
   - 選択: 公開 API client ではなく `cleanupExpiredGameQuestionSets({ now })` の引数で時刻を受ける。
   - 根拠: fetch や HTTP response に依存しないほうが、手動実行・Cron・ユニットテストで再利用しやすい。

5. **正規化済みの値をどこで保持するか**
   - 選択: `now` から `cutoff` を一度だけ作り、Prisma where と戻り値・ログで同じ値を使う。
   - 根拠: 削除条件とログ時刻がズレると、運用確認やテストが難しくなるため。

6. **エラー表示に toast を使うか、画面内表示にするか**
   - 選択: toast / 画面内表示は使わない。CLI は標準出力/標準エラー相当のログと exit code で結果を表す。
   - 根拠: UI を追加しない運用ジョブであり、フロントエンド通知の責務ではないため。

7. **既存コンポーネントを再利用するか、新規作成するか**
   - 選択: UI コンポーネントは作成しない。
   - 根拠: cleanup 実行画面は今回のスコープ外で、管理画面追加時に別途設計するほうがよい。

8. **API レスポンスを画面表示の source of truth にするか**
   - 選択: 対象外。既存 `/game/play` と `/game/result` は引き続き game API response を source of truth にする。
   - 根拠: cleanup は既存レスポンス形式を変えないため。

9. **reload / 戻る / 直接アクセス時の挙動**
   - 選択: 既存挙動を維持する。期限切れで送信できない場合は `POST /game/sessions` の 409 を受け、ユーザーはゲームを再開始する。
   - 根拠: cleanup が走っても、期限切れセットは既に利用不可であり、UI は既存のエラー導線で扱えるため。

10. **削除境界**
    - 選択: `expiresAt <= cutoff` を削除対象にする。
    - 根拠: `submitGameSession()` の `expiresAt <= now` と一致し、同一時刻境界で「送信不可なのに残す」状態を避けるため。

11. **DB 負荷対策**
    - 選択: `expiresAt` index を前提に `deleteMany` を1回実行する。対象行を先に取得しない。
    - 根拠: 正解 JSON を読み出さず、DB round trip とメモリ使用量を抑えられるため。

12. **Cron Trigger との責務分離**
    - 選択: 今回は job 関数と手動 CLI まで。Cloudflare scheduled handler / wrangler 設定は後続タスク。
    - 根拠: 進捗上、定期バッチ運用設計が別タスクとして残っているため。

## 公開インターフェース案（必要な場合）

```typescript
// backend/src/jobs/cleanupGameQuestionSets.ts

export type CleanupGameQuestionSetsResult = {
  deletedCount: number;
  cutoff: Date;
};

export type CleanupGameQuestionSetsLogger = Pick<Console, "info" | "error">;

export type CleanupGameQuestionSetsOptions = {
  now?: Date;
  logger?: CleanupGameQuestionSetsLogger;
};

export function cleanupExpiredGameQuestionSets(
  options?: CleanupGameQuestionSetsOptions,
): Promise<CleanupGameQuestionSetsResult>;
```

## タスクリスト（進捗管理）

| タスクID | 内容                                                  | ファイル                                                                                                                                 | 完了条件                                                                                | 優先度 |
| -------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------ |
| T1       | 既存仕様・既存実装を確認する                          | `docs/05_progress.md`, `docs/04_api.md`, `docs/12_task_guide.md`, `backend/src/services/game.service.ts`, `backend/prisma/schema.prisma` | cleanup 対象・非対象、期限判定、index 状況、公開 API 変更不要が整理される               | 高     |
| T2       | job の型・公開インターフェースを実装する              | `backend/src/jobs/cleanupGameQuestionSets.ts`                                                                                            | `CleanupGameQuestionSetsResult` と `cleanupExpiredGameQuestionSets()` が export される  | 高     |
| T3       | Prisma `deleteMany` による削除処理を実装する          | `backend/src/jobs/cleanupGameQuestionSets.ts`                                                                                            | `expiresAt <= cutoff` のみを削除し、`deletedCount` と `cutoff` を返す                   | 高     |
| T4       | 構造化ログ方針を実装する                              | `backend/src/jobs/cleanupGameQuestionSets.ts`                                                                                            | 成功ログに `event`, `deletedCount`, `cutoff` のみが含まれ、個人情報・正解情報を出さない | 高     |
| T5       | 手動実行 entrypoint を追加する                        | `backend/src/jobs/cleanupGameQuestionSets.cli.ts`, `backend/package.json`                                                                | `npm run cleanup:game-question-sets` で実行でき、失敗時は非0 exit になる                | 高     |
| T6       | Cron Trigger 想定の再利用性を確認する                 | `backend/src/jobs/cleanupGameQuestionSets.ts`                                                                                            | Cloudflare 固有 API に依存せず、将来 scheduled handler から呼べる                       | 中     |
| T7       | API client / 型定義 / validation の変更要否を確認する | `backend/src/types/index.ts`, `frontend/src/lib/api/game.ts`, `frontend/src/lib/api/errors.ts`                                           | 公開 API と frontend API client の変更が不要と確認される                                | 中     |
| T8       | 状態管理・UI 影響を確認する                           | `frontend/src/routes/(app)/game/play/+page.svelte`, `frontend/src/lib/stores/toast.svelte.ts`                                            | store / URL query / toast / 画面内表示の新規実装が不要と確認される                      | 中     |
| T9       | reload / 戻る / 直接アクセス時の扱いを確認する        | `frontend/src/routes/(app)/game/play/+page.svelte`, `frontend/src/routes/(app)/game/result/+page.svelte`                                 | 期限切れセット削除後も既存 409 導線で再開始できる                                       | 中     |
| T10      | ローディング・空状態・エラー状態を確認する            | CLI, 既存 game 画面                                                                                                                      | cleanup 0件は成功、Prisma 例外は失敗、既存画面の loading/error/retry が維持される       | 高     |
| T11      | job テストを作成する                                  | `backend/src/jobs/cleanupGameQuestionSets.test.ts`                                                                                       | 削除条件、境界時刻、0件、Prisma 例外、ログ内容がテストされる                            | 高     |
| T12      | 既存ゲーム系テストとの整合を確認する                  | `backend/src/services/game.service.test.ts`, `backend/src/routes/game/sessions.test.ts`                                                  | `POST /game/sessions` の期限切れ 409 と cleanup の削除条件が矛盾しない                  | 中     |
| T13      | DB index / migration 要否を確認する                   | `backend/prisma/schema.prisma`, `backend/prisma/migrations/`                                                                             | `@@index([expiresAt])` があり、追加 migration 要否が記録される                          | 高     |
| T14      | backend lint を実行する                               | `backend`                                                                                                                                | `npm run lint` が通る                                                                   | 高     |
| T15      | backend format を実行・確認する                       | `backend`                                                                                                                                | `npm run format` または `npm run format:check` が通る                                   | 高     |
| T16      | backend test を実行する                               | `backend`                                                                                                                                | `npm run test -- --run` が通る                                                          | 高     |
| T17      | 手動確認を行う                                        | `backend`, `/game/play`, `/game/result`                                                                                                  | 手動 cleanup、削除0件、既存ゲーム導線、期限切れ導線を確認する                           | 高     |
| T18      | docs 更新要否を確認し、完了記録を残す                 | `docs/04_api.md`, `docs/05_progress.md`, 本計画                                                                                          | API 変更なしなら `docs/04_api.md` は未変更、進捗と plan は実装完了更新される            | 高     |

- [x] T1: 既存仕様・既存実装を確認する（`docs/05_progress.md`, `docs/04_api.md`, `docs/12_task_guide.md`, `backend/src/services/game.service.ts`, `backend/prisma/schema.prisma`）
- [x] T2: job の型・公開インターフェースを実装する（`backend/src/jobs/cleanupGameQuestionSets.ts`）
- [x] T3: Prisma `deleteMany` による削除処理を実装する（`backend/src/jobs/cleanupGameQuestionSets.ts`）
- [x] T4: 構造化ログ方針を実装する（`backend/src/jobs/cleanupGameQuestionSets.ts`）
- [x] T5: 手動実行 entrypoint を追加する（`backend/src/jobs/cleanupGameQuestionSets.cli.ts`, `backend/package.json`）
- [x] T6: Cron Trigger 想定の再利用性を確認する（`backend/src/jobs/cleanupGameQuestionSets.ts`）
- [x] T7: API client / 型定義 / validation の変更要否を確認する（`backend/src/types/index.ts`, `frontend/src/lib/api/game.ts`, `frontend/src/lib/api/errors.ts`）
- [x] T8: 状態管理・UI 影響を確認する（`frontend/src/routes/(app)/game/play/+page.svelte`, `frontend/src/lib/stores/toast.svelte.ts`）
- [x] T9: reload / 戻る / 直接アクセス時の扱いを確認する（`frontend/src/routes/(app)/game/play/+page.svelte`, `frontend/src/routes/(app)/game/result/+page.svelte`）
- [x] T10: ローディング・空状態・エラー状態を確認する（CLI, 既存 game 画面）
- [x] T11: job テストを作成する（`backend/src/jobs/cleanupGameQuestionSets.test.ts`）
- [x] T12: 既存ゲーム系テストとの整合を確認する（`backend/src/services/game.service.test.ts`, `backend/src/routes/game/sessions.test.ts`）
- [x] T13: DB index / migration 要否を確認する（`backend/prisma/schema.prisma`, `backend/prisma/migrations/`）
- [x] T14: backend lint を実行する（`backend`）
- [x] T15: backend format を実行・確認する（`backend`）
- [x] T16: backend test を実行する（`backend`）
- [x] T17: 手動確認を行う（`backend`, `/game/play`, `/game/result`）
- [x] T18: docs 更新要否を確認し、完了記録を残す（`docs/04_api.md`, `docs/05_progress.md`, 本計画）

## 技術的注意点

- `Math.random()` は使わない。今回の cleanup では乱数自体が不要。
- `new Date()` は job 関数のデフォルト値に留め、テストでは `now` を注入する。
- `cutoff` は一度だけ計算し、Prisma where、戻り値、ログで同じ値を使う。
- `expiresAt` 比較は `lte` を使い、既存 `submitGameSession()` の期限切れ判定と揃える。
- `deleteMany` の where に `userId` を含めない。全ユーザーの期限切れ一時データを対象にする。
- 削除前に対象行を `findMany` しない。正解 JSON を読み出さず、DB 負荷と情報露出を抑える。
- ログには `deletedCount`, `cutoff`, `event` 程度だけを出す。
- `questions` JSON、`questionSetId`, `userId`, `mode` はログに出さない。
- 手動実行 entrypoint では例外を握りつぶさず、失敗時は `process.exitCode = 1` を設定する。
- `backend/package.json` の script は `tsx src/jobs/cleanupGameQuestionSets.cli.ts` を想定する。
- `src/jobs/` は新規ディレクトリのため、import path は ESM ルールに従い `.js` 拡張子を付ける。
- DB schema を変更した場合のみ migration / `prisma migrate deploy` / Playwright 確認を追加する。

## テストケース一覧

| ケース                                                 | 期待結果                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 初期表示                                               | UI 変更なし。`/game/play` は既存どおり API から問題取得する                                             |
| 正常系: 期限切れあり                                   | `gameQuestionSet.deleteMany({ where: { expiresAt: { lte: cutoff } } })` が呼ばれ、`deletedCount` が返る |
| 正常系: 削除0件                                        | `deletedCount: 0` を返し、エラーにしない                                                                |
| 境界値: `expiresAt === cutoff`                         | 削除対象になる                                                                                          |
| 境界値: `expiresAt > cutoff`                           | 削除対象にならない                                                                                      |
| 入力値の正規化                                         | `now` は関数入口で一度だけ `cutoff` として扱われ、Prisma where とログで再計算しない                     |
| 空文字・null・undefined                                | 外部入力を受けない。`now` 未指定時は現在時刻を使い、`logger` 未指定時も実行できる                       |
| 複数条件の組み合わせ                                   | `expiresAt` 以外の条件を混ぜず、期限切れ判定だけで削除する                                              |
| API エラー                                             | 公開 API を呼ばないため対象外。既存 game API の error handling は変更しない                             |
| 非 JSON エラー                                         | fetch を使わないため対象外。frontend API client の非 JSON エラー処理は既存のまま                        |
| Prisma 例外                                            | 例外を caller / CLI に伝播し、CLI は失敗ログと非0 exit にする                                           |
| ローディング中の二重送信・二重取得防止                 | UI なし。手動コマンドを同時実行しても `deleteMany` は冪等に0件または残件を返す                          |
| 空状態                                                 | 期限切れデータがなくても成功扱い                                                                        |
| 認証が必要な場合の未ログイン状態                       | 認証不要の運用コマンドなので対象外。公開 API 化しない                                                   |
| URL query 再読み込み後復元                             | URL query を使わない。既存 `/game/play?mode=...` の再取得挙動は維持                                     |
| store reload / 直接アクセス時の空状態                  | store を使わない。既存 `/game/result` の復元挙動は維持                                                  |
| backend ステータスコードと frontend ハンドリング整合性 | 公開 API 追加なし。既存 `POST /game/sessions` の 409 期限切れ挙動を維持                                 |
| A11Y 最低限                                            | UI 追加なし。既存ゲーム画面の loading / error / retry / keyboard 操作に変更がないことを確認する         |
| ログ安全性                                             | 成功・失敗ログに `userId`, `questionSetId`, `questions` JSON が含まれない                               |

## 実装リスクと回避策

| リスク                                    | 影響                                                     | 回避策                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 未期限切れの問題セットを削除する          | 進行中ゲームが送信不能になる                             | `expiresAt <= cutoff` のみを where に指定し、境界値テストを固定する                                        |
| `POST /game/sessions` と期限判定がズレる  | 送信不可なのに DB に残る、または送信可能なのに削除される | 既存 service の `expiresAt <= now` に合わせて cleanup も `lte` にする                                      |
| 個人情報・正解情報をログ出力する          | セキュリティ事故になる                                   | ログは `event`, `deletedCount`, `cutoff`, 汎用エラーメッセージに限定する                                   |
| Cron 専用に作りすぎる                     | 手動実行やテストが難しくなる                             | job 関数を export し、CLI / Cron は薄い呼び出し元にする                                                    |
| migration 未反映で index がない           | cleanup が遅くなる                                       | 実装時に `@@index([expiresAt])` と DB 反映状況を確認する                                                   |
| `docs/04_api.md` に運用ジョブを書きすぎる | 公開 API 仕様と運用仕様が混ざる                          | API 変更なしとして、必要なら本計画と progress にのみ記録する                                               |
| 手動実行が失敗しても成功扱いになる        | 運用で削除漏れに気づけない                               | CLI で catch したら error ログを出し、`process.exitCode = 1` を設定する                                    |
| 大量削除で DB に負荷がかかる              | 一時的な DB 負荷上昇                                     | 初期実装は index 付き `deleteMany` の単発に限定。大量化が観測されたら batch limit 方式を別タスクで検討する |

## 手動確認項目

| 確認           | 手順                                                          | 期待結果                                                 |
| -------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| 手動コマンド   | `cd backend && npm run cleanup:game-question-sets`            | 削除件数ログが出て、コマンドが成功する                   |
| 削除対象       | 期限切れ `GameQuestionSet` を用意して実行                     | 対象行だけ削除される                                     |
| 非対象         | `expiresAt` が未来の `GameQuestionSet` を用意して実行         | 削除されない                                             |
| 削除0件        | 期限切れデータがない状態で実行                                | `deletedCount: 0` で成功する                             |
| 既存ゲーム導線 | `/game/play` で問題取得、期限内に `/game/result` へ送信       | 既存どおり成功する                                       |
| 期限切れ導線   | 期限切れ相当の `questionSetId` で送信                         | 既存どおり 409 の日本語エラーになる                      |
| A11Y           | `/game/play` の loading / error / retry / keyboard 操作を確認 | cleanup 実装前後で挙動が変わらない                       |
| ログ           | 実行ログを確認                                                | `userId`, `questionSetId`, `questions` JSON が含まれない |

## 実装完了時の更新ルール

- `docs/05_progress.md` の対象タスクを `[-]` から `[x]` に更新する。
- 本計画のチェックボックスを完了状態に更新する。
- 実際に変更したファイルが「対象ファイル一覧」と一致しているか確認し、差分があれば表を更新する。
- `docs/04_api.md` は公開 API 変更があった場合のみ更新する。変更なしの場合は実装完了セクションに「更新不要」と記録する。
- DB schema / migration を変更した場合は、migration 適用確認と Playwright 確認結果を記録する。
- 最後に以下の形式で追記する。

```markdown
## 実装完了

- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/game-question-set-cleanup
- PR: #N

### 計画からの変更点

- `docs/04_api.md` は公開 API 変更がないため更新しなかった

### 実際の変更ファイル

| ファイル                                           | 変更種別 | 内容                                 |
| -------------------------------------------------- | -------- | ------------------------------------ |
| `backend/src/jobs/cleanupGameQuestionSets.ts`      | 新規     | 期限切れ GameQuestionSet cleanup job |
| `backend/src/jobs/cleanupGameQuestionSets.test.ts` | 新規     | cleanup job テスト                   |
| `backend/src/jobs/cleanupGameQuestionSets.cli.ts`  | 新規     | 手動実行 entrypoint                  |
| `backend/package.json`                             | 修正     | 手動実行 script 追加                 |
```

## 実装完了

- 完了日: 2026-06-21
- 実装ブランチ: feature/game-question-set-cleanup
- PR: #57

### 計画からの変更点

- `docs/04_api.md` は公開 API 変更がないため更新しなかった。
- DB schema / migration は変更しなかった。`@@index([expiresAt])` と migration `20260620172000_add_game_session_indexes` の `game_question_sets_expiresAt_idx` を確認した。
- WSL ホスト直実行の `npm run cleanup:game-question-sets` は DB 接続に失敗したが、Docker backend コンテナ内の同コマンドは成功した。失敗時ログは内部エラー詳細を出さず、非0終了になることを確認した。
- Cloudflare Workers の `scheduled` handler / wrangler 設定 / 失敗通知は計画どおり後続の定期バッチ運用設計タスクで扱う。

### 実際の変更ファイル

| ファイル                                           | 変更種別 | 内容                                 |
| -------------------------------------------------- | -------- | ------------------------------------ |
| `backend/src/jobs/cleanupGameQuestionSets.ts`      | 新規     | 期限切れ GameQuestionSet cleanup job |
| `backend/src/jobs/cleanupGameQuestionSets.test.ts` | 新規     | cleanup job テスト                   |
| `backend/src/jobs/cleanupGameQuestionSets.cli.ts`  | 新規     | 手動実行 entrypoint                  |
| `backend/package.json`                             | 修正     | 手動実行 script 追加                 |
| `docs/05_progress.md`                              | 修正     | 対象タスクの進捗を更新               |
| `docs/plans/game-question-set-cleanup/plan.md`     | 修正     | チェックボックスと実装完了記録       |

### 検証結果

| 確認 | 結果 |
| ---- | ---- |
| Red: `npm run test -- src/jobs/cleanupGameQuestionSets.test.ts --run` | 実装前に `Cannot find module './cleanupGameQuestionSets.js'` で失敗することを確認 |
| Green: `npm run test -- src/jobs/cleanupGameQuestionSets.test.ts --run` | 4 tests passed |
| `npm run format` | 成功 |
| `npm run lint` | 成功 |
| `npm run format:check` | 成功 |
| `npm run test -- --run` | 成功（26 files / 213 tests） |
| `docker compose exec -T hono npm run cleanup:game-question-sets` | 成功（`deletedCount=17`） |
| WSL host: `npm run cleanup:game-question-sets` | DB 接続に失敗し、詳細を漏らさない失敗ログと非0終了を確認 |

