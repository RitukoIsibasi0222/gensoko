# 週間スコアリセットバッチ処理（weeklyScore リセット）実装計画

> 設計者ロール: シニアフルスタックエンジニア

## 概要

`docs/05_progress.md` フェーズ9の未完了タスク `週間スコアリセットバッチ処理（weeklyScore リセット）` を完了する。backend に、全ユーザーの `UserStats.weeklyScore` を 0 に戻す手動実行可能な job を追加し、将来の定期実行基盤から再利用できる形にする。

このタスクでは公開 HTTP API、フロントエンドの画面ルート、ランキング対象条件の仕様は変更しない。Cron Trigger の設定や運用設計は、後続タスク `定期バッチ運用設計（週間リセット・GameQuestionSet cleanup の Cron Trigger 設定）` に分離する。

## レビュー結果と改善方針

| 観点 | レビュー結果 | 改善方針 |
|---|---|---|
| 依頼内容整合性 | 元の計画案は weekly reset と ranking 仕様変更を同時に扱っていた | 今回は `weeklyScore` reset job のみを対象にし、ranking 仕様変更は行わない |
| 既存仕様整合性 | `docs/04_api.md` と `docs/plans/ranking-page/plan.md` は weekly ranking 対象を `UserStats.totalGames > 0` としている | ranking 対象条件は既存仕様を維持し、batch 実装のために API 契約を変えない |
| TDD | 元案は実装タスクがテストより前に並んでいた | job テストを Red で先に作成し、Green で job / CLI を実装する順に修正する |
| 実装方式 | `docs/12_task_guide.md` には `node-cron` 案があるが、`docs/05_progress.md` では運用設計が別タスク | 今回は scheduler を導入せず、job 本体と CLI entrypoint のみを実装する |
| ランキング挙動 | reset 後も既存仕様では `totalGames > 0` のユーザーが 0pt で weekly ranking に残る | これは既存契約として維持する。もし仕様上問題なら別タスクで設計変更する |
| フロント影響 | `/ranking` と `/mypage` は既存 API response を表示している | frontend 実装変更は原則不要。reset 後の表示回帰確認のみ行う |
| ドキュメント整合性 | 元案は ranking 仕様変更を含むのに `ranking-page` 計画書を更新対象にしていなかった | 今回は ranking 仕様変更を外し、`docs/04_api.md` は更新要否確認に留める |
| セキュリティ / 運用 | job の失敗時に内部エラーや個人情報を漏らしてはいけない | `cleanupGameQuestionSets` と同様に安全ログと日本語の汎用エラーメッセージを採用する |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- フェーズ9に `週間スコアリセットバッチ処理（weeklyScore リセット）` が未完了で存在する
- `定期バッチ運用設計（週間リセット・GameQuestionSet cleanup の Cron Trigger 設定）` は別タスク

**`docs/04_api.md`**
- `GET /ranking/weekly` と `GET /ranking/alltime` の公開仕様が定義されている
- ranking 対象は `UserStats.totalGames > 0`、`User.isActive = true`、`User.deletedAt = null`
- `GET /users/me/stats` は `weeklyScore` と `allTimeScore` を返す

**`docs/plans/ranking-page/plan.md`**
- weekly / alltime ranking の仕様と対象条件が確定済み
- `myRank` は ranking 対象条件を満たす場合のみ算出する

**`docs/plans/game-question-set-cleanup/plan.md`**
- `jobs/*.ts` + `jobs/*.cli.ts` + `jobs/*.test.ts` の構成例
- 安全ログ、CLI 実行、Cron 再利用を前提とした job 設計パターン

**`docs/12_task_guide.md`**
- weekly reset の目的は「毎週月曜日0時に全ユーザーの `weeklyScore` を 0 にリセットする」
- `node-cron` / Cloudflare Cron Trigger の案があるが、運用タスクは後続に分離されている

**`backend/prisma/schema.prisma`**
- `UserStats.weeklyScore` と `UserStats.allTimeScore` が存在する
- `@@index([weeklyScore(sort: Desc)])` が存在する
- schema 変更は不要

**`backend/src/lib/prisma.ts`**
- `prisma` — PrismaPg adapter 付き PrismaClient singleton

**`backend/src/services/game.service.ts`**
- `updateUserStatsForSession()` がゲーム結果保存時に `weeklyScore` と `allTimeScore` を加算する
- reset 後も新規ゲーム結果で `weeklyScore` が再加算される前提

**`backend/src/services/ranking.service.ts`**
- `getWeeklyRanking()` と `getAllTimeRanking()`
- ranking 対象条件は `totalGames > 0`、`user.isActive = true`、`deletedAt = null`

**`backend/src/services/user.service.ts`**
- `getCurrentUserStats()` が `weeklyScore` / `allTimeScore` を返す

**`backend/src/jobs/cleanupGameQuestionSets.ts`**
- 定期 job の既存実装例
- 安全ログ・CLI・テストのパターンを流用できる

**`frontend/src/lib/api/ranking.ts`**
- `getRanking()` は weekly / alltime response を runtime validation している
- empty ranking や `myRank: null` を扱える

**`frontend/src/lib/api/users.ts`**
- `getMyStats()` は `weeklyScore: number` を runtime validation している
- `0` を許容している

**`frontend/src/routes/(app)/ranking/+page.svelte`**
- loading / error / empty state / retry を持つ
- 既存 API response を source of truth にしている

**`frontend/src/routes/(app)/mypage/+page.svelte`**
- `getMyStats()` の結果を表示する
- retry と error state を持つ

**`frontend/src/lib/components/mypage/StatsSummaryCards.svelte`**
- `stats.weeklyScore` を補助表示している
- reset 後は `0 pt` になる想定

### 重要な制約

- 公開 HTTP API の path、ステータスコード、レスポンス形式は変更しない
- ranking 対象条件は変更しない
- `weeklyScore` 以外の統計値を reset しない
- DB アクセスは Prisma ORM 経由のみ
- `node-cron` などの scheduler を `backend/src/index.ts` に組み込まない
- Cron Trigger 設定、実行時刻、失敗通知は後続の運用タスクで扱う
- job は冪等であること
- ログに個人情報、内部エラー詳細、トークン等を含めない
- backend のエラーメッセージは日本語に統一する
- frontend の API client / store / error handling を不必要に変更しない
- DB schema / migration は原則変更しない

### 確認事項

- `docs/plans/weekly-score-reset/plan.md` は現時点で存在しない
- 既存仕様では reset 直後の weekly ranking に `weeklyScore = 0` の既プレイユーザーが残る可能性がある
- 「週に参加したが 0 点だったユーザーをどう扱うか」は現行 schema だけでは厳密に制御しにくい
- この挙動を変える場合は、weekly reset batch とは別に ranking 仕様変更タスクとして扱うべき
- `UserStats.updatedAt` は reset によって更新されるため、`/mypage` の最終更新表示にも影響する。この解釈は実装時に再確認する

## 対象ファイル一覧（変更種別つき）

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/jobs/resetWeeklyScores.ts` | 新規 | weekly score reset job 本体 |
| `backend/src/jobs/resetWeeklyScores.test.ts` | 新規 | reset 条件、0件、冪等性、安全ログ、Prisma 例外のテスト |
| `backend/src/jobs/resetWeeklyScores.cli.ts` | 新規 | 手動実行 entrypoint |
| `backend/package.json` | 修正 | `reset:weekly-scores` script を追加 |
| `backend/src/jobs/cleanupGameQuestionSets.ts` | 確認 | 既存 job パターンとの差分確認 |
| `backend/src/services/game.service.ts` | 確認 | reset 後の再加算ロジック確認 |
| `backend/src/services/ranking.service.ts` | 確認 | ranking 条件を変更しないことの確認 |
| `backend/src/services/user.service.ts` | 確認 | `weeklyScore` response shape 維持の確認 |
| `backend/prisma/schema.prisma` | 確認 | `weeklyScore` index が既存のまま使えることを確認 |
| `frontend/src/lib/api/ranking.ts` | 確認 | reset 後の weekly response を既存 validation で扱えることを確認 |
| `frontend/src/lib/api/users.ts` | 確認 | `weeklyScore = 0` を既存 validation が扱えることを確認 |
| `frontend/src/routes/(app)/ranking/+page.svelte` | 確認 | reset 後表示の回帰確認 |
| `frontend/src/routes/(app)/mypage/+page.svelte` | 確認 | reset 後表示の回帰確認 |
| `frontend/src/lib/components/mypage/StatsSummaryCards.svelte` | 確認 | `0 pt` 表示の回帰確認 |
| `docs/04_api.md` | 確認 | 公開 API 変更がないため更新不要か最終確認 |
| `docs/05_progress.md` | 修正 | 計画書リンク追加、完了時の進捗更新 |
| `docs/12_task_guide.md` | 確認 | 実装方式との差分がある場合のみ更新要否確認 |
| `docs/plans/weekly-score-reset/plan.md` | 新規 | 本計画。実装完了時に更新 |

## API 仕様（この機能で使う範囲のみ）

### 公開 API の追加・変更

このタスクでは公開 HTTP API を追加・変更しない。

### 関連する既存 API

| メソッド | パス | 認証 | 関係 |
|---|---|---|---|
| GET | `/api/v1/ranking/weekly` | 任意 | `weeklyScore` の reset 後結果を表示する |
| GET | `/api/v1/ranking/alltime` | 任意 | reset の影響を受けないことを確認する |
| GET | `/api/v1/users/me/stats` | 必須 | reset 後の `stats.weeklyScore` が 0 になる |
| POST | `/api/v1/game/sessions` | 必須 | reset 後に新しい `weeklyScore` を積み上げる |

### 手動実行コマンド案

```bash
cd backend
npm run reset:weekly-scores
```

### 想定ログ

成功時:

```text
event=weekly_scores.reset.completed
resetCount=42
executedAt=2026-06-29T00:00:00.000Z
```

失敗時:

```text
event=weekly_scores.reset.failed
message=週間スコアのリセットに失敗しました
executedAt=2026-06-29T00:00:00.000Z
```

## 設計上の決定事項

1. **状態の source of truth**
   - 選択: `UserStats.weeklyScore` を週次スコアの source of truth にする
   - 根拠: ranking と mypage の両方が backend の同じ集計値を参照しているため

2. **初期表示時に状態をどこから復元するか**
   - 選択: `/ranking` と `/mypage` は既存どおり API response から復元する
   - 根拠: batch 実装に伴って store や URL query の責務を変える必要がないため

3. **ユーザー入力の反映タイミング**
   - 選択: ユーザー入力は持たず、CLI または将来の Cron 実行を trigger にする
   - 根拠: 運用バッチであり、フォームや UI 入力とは無関係なため

4. **API パラメータの組み立てをどの層で行うか**
   - 選択: `resetWeeklyScores({ now, logger })` に閉じる
   - 根拠: route や frontend API client を増やさず、手動実行・Cron・テストから再利用しやすいため

5. **正規化済みの値をどこで保持するか**
   - 選択: `executedAt` を一度だけ作成し、Prisma 実行・戻り値・ログで共用する
   - 根拠: 時刻のズレを防ぎ、テストしやすくするため

6. **エラー表示**
   - 選択: batch 自体は UI に出さず、CLI のログと exit code で扱う
   - 根拠: 画面追加はスコープ外であり、既存 frontend error handling とは責務が異なるため

7. **既存コンポーネント再利用**
   - 選択: frontend コンポーネントは追加しない
   - 根拠: `/ranking` の existing state と `/mypage` の統計表示で reset 後状態を表現できるため

8. **API レスポンスを画面表示の source of truth にするか**
   - 選択: 既存どおり API response を source of truth にする
   - 根拠: frontend で weekly score を再計算しない方針と一致するため

9. **reload / 戻る / 直接アクセス時の挙動**
   - 選択: 既存挙動を維持する
   - 根拠: `/ranking?period=weekly|alltime` の URL query 復元や `/mypage` の retry を変更する必要がないため

10. **reset 対象の絞り込み**
    - 選択: `weeklyScore > 0` の `UserStats` 行だけを `weeklyScore = 0` に更新する
    - 根拠: 0点行の不要更新を避け、無駄な DB 書き込みを減らすため

11. **ランキング仕様の扱い**
    - 選択: ranking 対象条件は変更しない
    - 根拠: 既存 docs / tests / 実装契約と整合させるため

12. **運用スケジュール**
    - 選択: このタスクでは scheduler を持たない
    - 根拠: `定期バッチ運用設計` が別タスクで残っており、二重実行リスクを避けるため

## 公開インターフェース案

```typescript
export type ResetWeeklyScoresResult = {
  resetCount: number;
  executedAt: Date;
};

export type ResetWeeklyScoresLogger = Pick<Console, "info" | "error">;

export type ResetWeeklyScoresOptions = {
  now?: Date;
  logger?: ResetWeeklyScoresLogger;
};

export function resetWeeklyScores(
  options?: ResetWeeklyScoresOptions,
): Promise<ResetWeeklyScoresResult>;
```

## タスクリスト

| タスクID | 内容 | ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存仕様・既存実装・既存 job パターンを確認する | `docs/05_progress.md`, `docs/04_api.md`, `docs/12_task_guide.md`, `docs/plans/game-question-set-cleanup/plan.md`, `backend/src/services/*.ts`, `frontend/src/routes/(app)/ranking/+page.svelte`, `frontend/src/routes/(app)/mypage/+page.svelte` | スコープ外の ranking 仕様変更を含めない方針が確定する | 高 |
| T2 | Red: weekly reset job テストを先に作成する | `backend/src/jobs/resetWeeklyScores.test.ts` | reset 条件、0件、冪等性、安全ログ、Prisma 例外の failing test が揃う | 高 |
| T3 | Green: job の型・公開インターフェースを実装する | `backend/src/jobs/resetWeeklyScores.ts` | `ResetWeeklyScoresResult` と `resetWeeklyScores()` が export される | 高 |
| T4 | Green: Prisma `updateMany` による reset 処理を実装する | `backend/src/jobs/resetWeeklyScores.ts` | `weeklyScore > 0` の行だけを `weeklyScore = 0` に更新し、`resetCount` と `executedAt` を返す | 高 |
| T5 | Green: 安全ログと日本語エラーを実装する | `backend/src/jobs/resetWeeklyScores.ts` | 成功・失敗ログが安全で、失敗時は汎用日本語メッセージを返す | 高 |
| T6 | Red/Green: CLI entrypoint と script を追加する | `backend/src/jobs/resetWeeklyScores.cli.ts`, `backend/package.json` | `npm run reset:weekly-scores` で実行でき、失敗時は非0 exit になる | 高 |
| T7 | 既存 ranking / stats 契約の回帰確認を行う | `backend/src/services/ranking.service.ts`, `backend/src/services/user.service.ts`, `frontend/src/lib/api/ranking.ts`, `frontend/src/lib/api/users.ts` | ranking 条件・response shape・validation が未変更であることを確認する | 中 |
| T8 | Refactor: job パターンの重複を必要最小限で整理する | `backend/src/jobs/resetWeeklyScores.ts`, `backend/src/jobs/cleanupGameQuestionSets.ts` | 不要な大規模共通化を行わず、必要な責務だけ整理される | 低 |
| T9 | backend lint を実行する | `backend` | `npm run lint` が通る | 高 |
| T10 | backend format を実行・確認する | `backend` | `npm run format` または `npm run format:check` が通る | 高 |
| T11 | backend test を実行する | `backend` | `npm run test -- --run` が通る | 高 |
| T12 | 手動確認を行う | `backend` | CLI 実行と rerun の結果が期待どおりであることを確認する | 高 |
| T13 | docs 更新要否を確認し、進捗と計画書を完了状態にする | `docs/04_api.md`, `docs/05_progress.md`, `docs/12_task_guide.md`, `docs/plans/weekly-score-reset/plan.md` | docs が実態と一致し、完了記録が残る | 高 |

- [x] T1: 既存仕様・既存実装・既存 job パターンを確認する
- [x] T2: Red: weekly reset job テストを先に作成する
- [x] T3: Green: job の型・公開インターフェースを実装する
- [x] T4: Green: Prisma `updateMany` による reset 処理を実装する
- [x] T5: Green: 安全ログと日本語エラーを実装する
- [x] T6: Red/Green: CLI entrypoint と script を追加する
- [x] T7: 既存 ranking / stats 契約の回帰確認を行う
- [x] T8: Refactor: job パターンの重複を必要最小限で整理する
- [x] T9: backend lint を実行する
- [x] T10: backend format を実行・確認する
- [x] T11: backend test を実行する
- [x] T12: 手動確認を行う
- [x] T13: docs 更新要否を確認し、進捗と計画書を完了状態にする

## 技術的注意点

- `updateMany` の `where` は `weeklyScore: { gt: 0 }` に限定する
- `allTimeScore`、`totalGames`、`totalCorrect`、`totalAnswered`、`masteredCount`、`currentStreak`、`lastActiveDate` を変更しない
- `executedAt` は 1 回だけ決めて再利用する
- 例外の詳細をそのまま `logger.error` に出さない
- `cleanupGameQuestionSets` と同様に、失敗時は安全な日本語メッセージを使う
- frontend 側では `response.ok` → error parse → success JSON parse の既存順序を変えない
- ranking 条件変更や zod validation 追加はこのタスクのスコープ外
- scheduler を `backend/src/index.ts` に常駐させない
- DB schema を変更しない限り migration / Playwright は不要だが、UI の手動確認は行う
- `updatedAt` が reset で更新される点は手動確認結果に含める

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| 正常系: `weeklyScore > 0` の統計がある | 対象行だけ `weeklyScore = 0` になり `resetCount` が返る |
| 正常系: `weeklyScore = 0` のみ | `resetCount = 0` で成功する |
| 正常系: rerun | 2回目実行は `resetCount = 0` で成功する |
| 境界値: 1件だけ対象 | 1件だけ更新される |
| 境界値: 負数や不整合値はない前提 | Prisma update 条件は `gt: 0` のみで安全に動く |
| ログ安全性: 成功 | `event`, `resetCount`, `executedAt` だけを出す |
| ログ安全性: 失敗 | 内部エラー詳細を出さず、日本語の汎用失敗メッセージだけを出す |
| CLI 成功 | `npm run reset:weekly-scores` が 0 exit で終了する |
| CLI 失敗 | `process.exitCode = 1` になる |
| ranking 回帰: weekly | response shape が変わらず、既存 API client が扱える |
| ranking 回帰: alltime | reset 前後で alltime response に影響がない |
| stats 回帰 | `/users/me/stats` の response shape が変わらず、`weeklyScore = 0` を返せる |
| frontend 回帰: `/ranking` | loading / error / retry / query 復元が壊れない |
| frontend 回帰: `/mypage` | `weeklyScore = 0` 表示でも画面崩れしない |
| 非 JSON error | 既存 frontend API client の共通エラーハンドリングに変更不要であることを確認する |
| A11Y 最低限 | `/ranking` の empty / retry、`/mypage` の error 表示が既存どおり動く |

## 実装リスクと回避策

| リスク | 影響 | 回避策 |
|---|---|---|
| `allTimeScore` まで reset してしまう | 全期間ランキングとマイページ統計が壊れる | update data を `weeklyScore: 0` のみに固定し、テストで担保する |
| scheduler を先に入れてしまう | 多重実行や責務混在のリスク | 今回は job + CLI のみ。運用設定は別タスクに分離する |
| 例外詳細をログに出してしまう | 内部情報漏えい | 安全ログだけを出し、詳細例外は外に漏らさない |
| ranking 仕様変更を混ぜる | docs / tests / frontend 契約が崩れる | ranking 条件は変更しない |
| reset 後の weekly ranking 表示が仕様上わかりにくい | UX 上の違和感 | 既存契約として維持し、必要なら別仕様変更タスクで扱う |
| `updatedAt` 更新が `/mypage` 表示に影響する | 最終更新時刻の意味が曖昧になる | 手動確認と実装完了記録に残し、必要なら別タスクで文言や設計を見直す |
| cleanup job との重複を過度に共通化する | 不要な横断変更になる | 共通化は最小限に留める |

## 手動確認項目

| 確認 | 手順 | 期待結果 |
|---|---|---|
| 手動コマンド | `cd backend && npm run reset:weekly-scores` | 成功ログが出て終了する |
| rerun | 連続で 2 回実行 | 2回目は `resetCount = 0` で成功する |
| weekly ranking API | 実行前後で `GET /api/v1/ranking/weekly` を確認 | response shape は変わらず、`weeklyScore` の値だけ reset 後状態になる |
| alltime ranking API | 実行前後で `GET /api/v1/ranking/alltime` を確認 | 変化しない |
| my stats API | `GET /api/v1/users/me/stats` を確認 | `weeklyScore = 0`、`allTimeScore` は維持される |
| weekly page | `/ranking?period=weekly` を開く | 画面崩れせず、既存 UI で表示される |
| alltime page | `/ranking?period=alltime` を開く | reset の影響を受けない |
| mypage | `/mypage` を開く | weekly score が 0pt で表示される |
| retry 導線 | ranking / mypage のエラー状態を確認 | 既存 retry と error 表示が壊れていない |
| A11Y | `/ranking` の period 切替、retry、`/mypage` のエラー表示をキーボード操作 | 既存操作性が維持される |
| ログ | 実行ログを確認 | 個人情報や内部エラー詳細が含まれない |

## 実装完了

- 完了日: 2026-06-29
- 実装ブランチ: feature/weekly-score-reset
- PR: 未作成

### 計画からの変更点

- `backend/.env` の `DATABASE_URL` は Docker Compose 内ホスト名 `postgres` を使っていたため、ホストシェルでの手動確認時だけ `localhost` に差し替えて CLI を実行した
- `/ranking` `/mypage` の画面・API を手動で叩く代わりに、`ranking.service.test.ts` `user.service.test.ts` `get-me-stats.test.ts` の回帰確認で既存契約維持を検証した
- `docs/04_api.md` は公開 API 契約変更がないため更新しなかった
- `docs/12_task_guide.md` は実装方針の差分を生む変更がないため更新しなかった

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/jobs/resetWeeklyScores.ts` | 新規 | weekly score reset job 本体 |
| `backend/src/jobs/resetWeeklyScores.test.ts` | 新規 | reset 条件・安全ログ・失敗時エラーのテスト |
| `backend/src/jobs/resetWeeklyScores.cli.ts` | 新規 | 手動実行 CLI entrypoint |
| `backend/src/jobs/resetWeeklyScores.cli.test.ts` | 新規 | CLI の exit code と disconnect のテスト |
| `backend/package.json` | 修正 | `reset:weekly-scores` script を追加 |
| `docs/05_progress.md` | 修正 | タスクの進捗を完了へ更新 |
| `docs/plans/weekly-score-reset/plan.md` | 修正 | タスク完了状況と実装完了記録を反映 |

## 実装完了時の更新ルール

- `docs/05_progress.md` の対象タスクを `[x]` に更新する
- 本計画のチェックボックスを更新する
- 実際の変更ファイルが「対象ファイル一覧」と一致しているか確認する
- `docs/04_api.md` は公開 API 契約変更がなければ更新不要と記録する
- `docs/12_task_guide.md` は実装差分が明確に問題になる場合のみ更新する
- DB schema を変更した場合だけ migration / `prisma migrate deploy` / Playwright 確認を追加する
- 最後に以下の形式で追記する

```markdown
## 実装完了

- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/weekly-score-reset
- PR: #N

### 計画からの変更点

- ranking 対象条件は変更しなかった
- `docs/04_api.md` は公開 API 契約変更がないため更新しなかった

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/jobs/resetWeeklyScores.ts` | 新規 | weekly score reset job |
| `backend/src/jobs/resetWeeklyScores.test.ts` | 新規 | job テスト |
| `backend/src/jobs/resetWeeklyScores.cli.ts` | 新規 | 手動実行 CLI |
| `backend/package.json` | 修正 | `reset:weekly-scores` script 追加 |
| `docs/05_progress.md` | 修正 | 進捗更新 |
| `docs/plans/weekly-score-reset/plan.md` | 修正 | 完了記録追記 |
```
