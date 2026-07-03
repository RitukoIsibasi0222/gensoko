# 定期バッチ Cron Trigger 運用設計 実装計画

> 設計者ロール: シニアフルスタックエンジニア（バックエンド運用・DB負荷・Cloudflare Workers・既存 UI 回帰レビュー）

## 背景・目的

`docs/05_progress.md` フェーズ9の未完了タスク「定期バッチ運用設計（週間リセット・GameQuestionSet cleanup の Cron Trigger 設定）」を完了する。既に実装済みの `resetWeeklyScores()` と `cleanupExpiredGameQuestionSets()` を、手動実行だけでなく本番の定期実行へ接続できるようにする。

この計画では、Cron Trigger の設定そのものだけでなく、現在の backend が Node server 前提であること、`wrangler.toml` / GitHub Actions / Workers 用 Prisma 接続が未整備であることを実装前の重要なゲートとして扱う。Cron を先に書くだけでは本番で動かない可能性が高いため、実装担当者が迷わないように確認順序、採用する運用方式、失敗時対応、回帰確認まで明確化する。

## スコープ

- `resetWeeklyScores()` の定期実行設計
- `cleanupExpiredGameQuestionSets()` の定期実行設計
- Cron 実行方式の選定
  - 第一候補: Cloudflare Workers Cron Trigger
  - 代替候補: GitHub Actions schedule から既存 Docker / Node CLI を実行
- Cloudflare Workers を採用する場合の `scheduled` handler 設計
- Node 開発サーバー用 entrypoint と Workers 用 entrypoint の責務分離方針
- Cron 文字列、UTC / JST 変換、頻度、手動 retry 手順の文書化
- DB負荷、冪等性、既存データ影響、ロールバック方針の整理
- 既存 `/ranking`, `/mypage`, `/game/play`, `/game/result` の回帰確認方針
- `docs/09_startup_commands.md` と `docs/11_deployment.md` の運用手順更新
- `docs/05_progress.md` の計画書リンク・完了更新

## 非スコープ

- 新しい公開 HTTP API の追加
- ユーザー向け画面、管理画面、toast、store の新規実装
- DB schema / migration の追加
- `resetWeeklyScores()` と `cleanupExpiredGameQuestionSets()` の business logic 再実装
- Cloudflare アカウント、Supabase プロジェクト、Vercel プロジェクトの実作成
- Sentry 等のエラートラッキング本導入
- フェーズ12全体の本番デプロイ基盤完成
- `@prisma/adapter-cloudflare` / Hyperdrive 等への本格移行。ただし Cron 方式選定の前提として確認は必須

## レビュー結果と改善方針

### この計画のまま実装すべきではない理由

前回案は Cron Trigger の設定を Cloudflare Workers 前提で進めていたが、最新 `develop` では `backend/src/index.ts` が `@hono/node-server` の `serve()` を直接実行しており、`backend/wrangler.toml` も `.github/workflows/deploy.yml` も存在しない。さらに `backend/src/lib/prisma.ts` は `@prisma/adapter-pg` と `process.env.DATABASE_URL` 前提であり、`docs/11_deployment.md` の「本番 Workers では adapter 変更が必要」という記述と現在実装が一致していない。

したがって、Cron 設定だけを追加すると、型・build・runtime・DB接続のどこかで本番実行できないリスクが高い。改善版では「Workers Cron を採用できる状態か確認する」ことを最初の実装タスクにし、採用できない場合の代替として GitHub Actions schedule を比較検討する。

### 観点別レビュー

| 観点 | 指摘内容 | 根拠: 確認できた事実 | 根拠: 推測 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|---|---|
| DB整合性と負荷 | cleanup / weekly reset の index は概ね妥当だが、Cron 頻度による DB 負荷上限が未定義 | `GameQuestionSet.expiresAt` index と `UserStats.weeklyScoreWeekStart, weeklyScore` 複合 index が存在する | 15分 cleanup は現状規模なら軽いが、無料枠や接続制限に影響する可能性がある | 高頻度実行で DB 接続数や Workers 実行回数が増える | 初期値は `17,47 * * * *` を第一候補にし、必要なら `*/15` へ短縮する判断基準を計画に残す | Medium |
| DB整合性と負荷 | 週間 reset は Cron が失敗しても表示側が現在週に絞るため致命傷になりにくいが、その性質が前回案に弱い | ranking は `weeklyScoreWeekStart` が現在週の行だけ取得する。stats は現在週以外を 0 として返す | reset job は「表示正しさ」より古い行の正規化と負値修復の意味が強い | 失敗時の運用優先度を誤る可能性 | reset 失敗時は次回実行・手動実行で復旧可能と明記し、ロールバック方針に反映する | Medium |
| API・コード整合性 | Workers 用 entrypoint と Node entrypoint の分離が前回案では不足 | `backend/src/index.ts` が Hono app 作成と `serve()` を同一ファイルで実行している | Workers にそのまま import すると Node server 起動処理が混入する可能性が高い | 本番 build / deploy / scheduled handler が失敗する | `backend/src/app.ts` を追加して app 構築を分離し、`index.ts` は Node、`worker.ts` は Workers 専用にする | High |
| API・コード整合性 | Prisma / Workers の接続方式が未確定 | `backend/src/lib/prisma.ts` は `PrismaPg` と `process.env` を使用。`docs/11_deployment.md` は Workers では adapter 変更が必要と記載 | 現状のまま Workers 上で DB 接続できない可能性がある | Cron がDBに到達せず、全定期バッチが失敗する | Cron 実装前に Workers + Supabase + Prisma 方針を確認し、未解決なら GitHub Actions schedule 案へ切り替える | High |
| API・コード整合性 | Cron 文字列を直接散らすと設定と呼び分けがズレる | 既存 job は定数化されているが、Cron 用定数は未存在 | handler / wrangler / docs 間で文字列ズレが起きやすい | weekly と cleanup の誤実行 | `backend/src/jobs/scheduled.ts` に Cron 文字列定数と job 名を集約する | Medium |
| A11Y | UI 追加がないため大きな A11Y 実装は不要 | 対象は運用 Cron。既存 `/ranking`, `/mypage`, `/game/play`, `/game/result` に loading/error/empty と aria がある | Cron 後のデータ変化で既存表示の空状態が増える可能性はある | UI 回帰を見落とす | 新規 UI は作らず、既存画面の aria-live / role / keyboard 導線を手動確認に含める | Low |
| テスト | Workers scheduled handler のテスト環境が未定義 | Vitest は `environment: "node"`。Workers 型や `ScheduledController` 型は未導入 | `@cloudflare/workers-types` 追加が必要になる可能性 | 型エラーやテスト不能が後から発覚 | まず platform 非依存の `runScheduledBatch()` を node Vitest でテストし、Workers entrypoint は薄くする | High |
| テスト | 前回案は本番 Cron 反映確認まで含むが、開発環境で実施不能な項目が混在 | `wrangler.toml` と Cloudflare project が未作成 | 本タスク時点では dashboard 確認できない可能性がある | 完了条件が曖昧になる | ローカル検証、設定ファイル検証、本番 dashboard 確認を分け、未実施なら理由を完了記録に残す | Medium |
| リリース | Cloudflare Workers デプロイ基盤未整備なのに Cron を本番前提にしている | `.github/workflows` が存在しない。`wrangler.toml` も存在しない | フェーズ12のデプロイ作業と責務が重なる | スコープ肥大、未完了化 | 本タスクは「Cron運用設計と設定ファイル準備」まで。実デプロイはフェーズ12に接続してよい | High |

## 現状調査結果

### 確認できた事実

- `docs/plans/batch-cron-triggers/plan.md` は作成前時点で存在しない。
- `docs/05_progress.md` には「定期バッチ運用設計（週間リセット・GameQuestionSet cleanup の Cron Trigger 設定）」が未完了で存在する。
- `backend/src/jobs/resetWeeklyScores.ts` は `resetWeeklyScores(options?: ResetWeeklyScoresOptions)` を export している。
- `resetWeeklyScores()` は `weeklyScoreWeekStart` が null / 現在週以外 / `weeklyScore < 0` の行だけを `weeklyScore = 0` と現在週へ正規化する。
- `backend/src/jobs/cleanupGameQuestionSets.ts` は `cleanupExpiredGameQuestionSets(options?: CleanupGameQuestionSetsOptions)` を export している。
- `cleanupExpiredGameQuestionSets()` は `expiresAt <= cutoff` の `GameQuestionSet` を `deleteMany` で削除する。
- 両 job は成功ログと失敗ログを持ち、失敗時に DB エラー詳細を含めない。
- `backend/package.json` には `reset:weekly-scores` と `cleanup:game-question-sets` がある。
- `docs/09_startup_commands.md` は Docker container 内で手動 batch を実行する方針を記載している。
- `backend/src/index.ts` は `@hono/node-server` の `serve()` を直接呼び、Node server 起動まで同一ファイルで行う。
- `backend/wrangler.toml` は存在しない。
- `.github/workflows/deploy.yml` は存在しない。
- `backend/src/lib/prisma.ts` は `@prisma/adapter-pg` と `process.env.DATABASE_URL` を使う。
- `docs/11_deployment.md` は本番 backend を Cloudflare Workers としつつ、Workers では Prisma adapter 変更が必要と記載している。
- `backend/tsconfig.json` は `module: NodeNext`、Vitest は node environment。
- `backend/prisma/schema.prisma` には `@@index([expiresAt])` と `@@index([weeklyScoreWeekStart, weeklyScore(sort: Desc)])` がある。
- `GET /ranking/weekly` は現在週の `weeklyScoreWeekStart` を持つ行のみを取得する。
- `/users/me/stats` は現在週以外の `weeklyScore` をレスポンス上 0 とする。
- `/ranking`, `/mypage`, `/game/play`, `/game/result` には loading / error / retry / empty に関する既存 UI がある。
- Cloudflare Workers Cron Triggers 公式ドキュメントでは、Cron Trigger は `scheduled` handler で処理し、Wrangler 管理の場合は設定ファイルの `triggers.crons` に書く。Cron Trigger の変更反映には最大15分程度かかる。

### 推測・実装時に再確認すること

- 現状の `@prisma/adapter-pg` + `pg` が Cloudflare Workers runtime でそのまま動く可能性は低い。Hyperdrive、Prisma adapter、または GitHub Actions schedule への切り替えを確認する必要がある。
- Cloudflare Workers 本番化がフェーズ12まで未着手なら、本タスクで Workers Cron を完全に本番稼働させるのはスコープ過多になる可能性がある。
- cleanup 頻度は15分でも機能上は妥当だが、無料枠・DB接続・実行回数を考えると初期値30分で十分な可能性がある。
- Cloudflare dashboard での Cron Events 確認は、Cloudflare project が存在しない場合は実施できない。

## 実装方針

### 方針A: Cloudflare Workers Cron Trigger を採用する条件

以下が実装時に確認できる場合、Cloudflare Workers Cron Trigger を第一候補として実装する。

- `backend/wrangler.toml` を追加できる。
- Workers 用 entrypoint `backend/src/worker.ts` を追加できる。
- Hono app を `backend/src/app.ts` に分離できる。
- Workers runtime で Prisma / Supabase 接続する方針が確定している。
- `wrangler dev` で `scheduled` handler をローカル確認できる。

### 方針B: GitHub Actions schedule を代替候補にする条件

以下の場合は、Cloudflare Workers Cron 実装を無理に進めず、GitHub Actions schedule で既存 CLI を実行する案を検討する。

- Workers 用 DB 接続方針が未確定。
- `wrangler.toml` や Workers deploy がフェーズ12まで未着手。
- 本タスクの目的が「既存手動 job を定期化すること」であり、Workers API 本番移行はまだ行わない。

代替案では、GitHub Actions の scheduled workflow から backend dependency install、`DATABASE_URL` secret 設定、`npm run reset:weekly-scores` / `npm run cleanup:game-question-sets` を実行する。ただし Actions の schedule も遅延・スキップの可能性があるため、失敗時 retry と手動 dispatch を設計に含める。

### 推奨する実装順

1. Cron 実行基盤として Cloudflare Workers を今タスクで採用できるか確認する。
2. 採用できるなら `app.ts` / `index.ts` / `worker.ts` の entrypoint 分離を先に行う。
3. 採用できないなら、GitHub Actions schedule 案に切り替え、Workers Cron はフェーズ12に残す。
4. いずれの方式でも既存 job 本体は再実装せず、薄い wrapper から呼ぶ。
5. Cron wrapper の job 呼び分け・安全ログ・未知 cron 処理を node Vitest で先に固定する。
6. docs に採用方式、時刻、手動実行、失敗時対応、未実施事項を記録する。

## DB変更方針

- DB schema / migration は変更しない。
- `GameQuestionSet.expiresAt` index を cleanup に利用する。
- `UserStats.weeklyScoreWeekStart, weeklyScore` 複合 index を weekly ranking と reset 後確認に利用する。
- `$queryRaw` は使わない。既存 job と同じく Prisma ORM の `updateMany` / `deleteMany` を使う。
- cleanup は対象行を取得せず、`deleteMany({ where: { expiresAt: { lte: cutoff } } })` の単発処理に留める。
- weekly reset は既存の正規化条件を維持し、現在週の正のスコアを触らない。
- 既存データへの影響は「古い週 / null週 / 負値の weekly score を現在週 0 に正規化」「期限切れ GameQuestionSet を削除」のみ。
- migration が不要なため、expand / contract の追加対応は不要。
- DB 変更が発生した場合は本計画から逸脱するため、計画書の対象ファイル・ロールバック方針・Playwright 確認を更新する。

## API変更方針

- 公開 HTTP API は追加・変更しない。
- `docs/04_api.md` は原則更新不要。実装完了時に「公開 API 契約変更なし」と記録する。
- Cron 実行結果をユーザー画面や API response に返さない。
- 認証・認可 middleware は Cron には適用しない。Cron は公開 route ではなく runtime / workflow の入口で実行する。
- 既存 API の影響確認対象:
  - `GET /api/v1/ranking/weekly`
  - `GET /api/v1/users/me/stats`
  - `GET /api/v1/game/questions`
  - `POST /api/v1/game/sessions`
- `POST /game/sessions` の 409 エラー、期限切れ判定、二重送信判定は変更しない。

## UI / A11Y 方針

- 新規 UI は作成しない。
- toast / store / page state は追加しない。
- Cron の状態はユーザー画面ではなく運用ログで確認する。
- 既存 UI の回帰確認として、以下を手動確認する。
  - `/ranking`: weekly ranking が空でも `role` / focusable retry / キーボード操作が破綻しない。
  - `/mypage`: `weeklyScore = 0` が統計カードで自然に表示される。
  - `/game/play`: 問題取得 loading / error / retry が支援技術で理解できる。
  - `/game/result`: session restore の loading / error / unauthenticated が `role` / `aria-live` で通知される。
- 色だけに依存する新規表現は追加しない。
- UI を変更した場合のみ frontend の lint / test / check と必要に応じて Playwright 確認を追加する。

## Cron 設計

### Cron 文字列

| job | 第一候補 | 意味 | 理由 |
|---|---|---|---|
| weekly reset | `0 15 * * SUN` | UTC 日曜 15:00 = JST 月曜 00:00 | `getWeeklyScoreWeekStart()` が JST 月曜始まりのため |
| GameQuestionSet cleanup | `*/30 * * * *` | 30分ごと | 問題セット有効期限が30分であり、過剰実行を避けるため |

cleanup を `*/15 * * * *` に短縮する条件:

- 期限切れ `GameQuestionSet` の件数が短時間で多く積み上がる。
- `GET /game/questions` の利用量が増え、30分ごとの削除ではテーブルサイズや正解情報の滞留が問題になる。
- Supabase / Workers の実行回数・接続数に余裕がある。

### Cloudflare Workers 採用時の公開インターフェース案

```typescript
export const WEEKLY_SCORE_RESET_CRON = "0 15 * * SUN";
export const GAME_QUESTION_SET_CLEANUP_CRON = "*/30 * * * *";

export type ScheduledBatchJobName =
  | "resetWeeklyScores"
  | "cleanupExpiredGameQuestionSets"
  | "unknown";

export type ScheduledBatchResult =
  | {
      job: "resetWeeklyScores";
      cron: string;
      executedAt: Date;
      resetCount: number;
    }
  | {
      job: "cleanupExpiredGameQuestionSets";
      cron: string;
      cutoff: Date;
      deletedCount: number;
    }
  | {
      job: "unknown";
      cron: string;
      executedAt: Date;
      skipped: true;
    };

export type ScheduledBatchLogger = Pick<Console, "info" | "warn" | "error">;

export type RunScheduledBatchOptions = {
  cron: string;
  scheduledTime: number;
  logger?: ScheduledBatchLogger;
};

export function runScheduledBatch(
  options: RunScheduledBatchOptions,
): Promise<ScheduledBatchResult>;
```

### ログ方針

成功ログ例:

```text
event=batch.cron.completed
cron=0 15 * * SUN
job=resetWeeklyScores
executedAt=2026-07-05T15:00:00.000Z
resetCount=42
```

```text
event=batch.cron.completed
cron=17,47 * * * *
job=cleanupExpiredGameQuestionSets
cutoff=2026-07-03T09:00:00.000Z
deletedCount=12
```

失敗ログ例:

```text
event=batch.cron.failed
cron=17,47 * * * *
job=cleanupExpiredGameQuestionSets
message=定期バッチの実行に失敗しました
executedAt=2026-07-03T09:00:00.000Z
```

ログに含めない値:

- `userId`
- `questionSetId`
- `questions`
- `email`
- token / cookie
- raw DB error message
- `DATABASE_URL`

## テスト方針

### Unit test

- `backend/src/jobs/scheduled.test.ts` を追加する。
- node Vitest で platform 非依存の `runScheduledBatch()` をテストする。
- Workers 固有型を濃く使うテストは避け、`cron` と `scheduledTime` を plain object として渡す。
- `resetWeeklyScores()` と `cleanupExpiredGameQuestionSets()` は mock する。

### Existing job regression

- `backend/src/jobs/resetWeeklyScores.test.ts`
  - stale / null / negative 行の正規化
  - 0件成功
  - 二重実行の冪等性
  - 安全ログ
- `backend/src/jobs/cleanupGameQuestionSets.test.ts`
  - `expiresAt <= cutoff`
  - 0件成功
  - 安全ログ

### Integration / manual

- Docker container 内で既存 CLI を手動実行する。
- Cloudflare Workers 採用時は `wrangler dev` の scheduled handler を確認する。
- GitHub Actions schedule 採用時は `workflow_dispatch` を先に確認する。
- Cloudflare project が未作成の場合、本番 Cron Events 確認は未実施として理由を完了記録に残す。

## リリース・移行方針

- DB migration は不要。
- 公開 API 変更は不要。
- Cloudflare Workers 採用時:
  1. `app.ts` / `index.ts` / `worker.ts` を分離する。
  2. `wrangler.toml` を追加する。
  3. Cron Trigger を設定する。
  4. `wrangler dev` で scheduled handler を確認する。
  5. 本番 deploy はフェーズ12の deploy 手順と接続する。
- GitHub Actions schedule 採用時:
  1. `.github/workflows/batch.yml` を追加する。
  2. `workflow_dispatch` と `schedule` を定義する。
  3. `DATABASE_URL` を GitHub Secret で参照する。
  4. `npm ci`, `npx prisma generate`, job scripts を実行する。
  5. 失敗通知は GitHub Actions の失敗通知から開始する。

## ロールバック方針

- DB schema を変更しないため DB rollback は不要。
- Cron 設定に問題がある場合:
  - Cloudflare Workers 採用時は `triggers.crons` から対象 cron を削除して deploy する。
  - GitHub Actions 採用時は workflow の `schedule` を削除または workflow を disable する。
- job 本体に問題がある場合:
  - 対象 commit を revert する。
  - 直近の手動 job 実行を停止し、原因調査後に Docker container 内で手動 retry する。
- weekly reset は現在週以外の表示を既存 API が 0 に正規化するため、Cron 停止中も表示上の致命的影響は限定的。
- cleanup 停止中は期限切れ `GameQuestionSet` が溜まるため、復旧後に手動 cleanup を実行する。

## リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| Workers runtime で Prisma が動かない | Cron が DB 接続に失敗する | Workers 接続方針を最初に確認し、未確定なら GitHub Actions schedule 案へ切り替える |
| Node entrypoint を Worker から import する | `serve()` が混入して build / runtime が壊れる | `app.ts` に Hono app を分離し、Node / Workers entrypoint を分ける |
| Cron 時刻の UTC/JST 変換ミス | 週間 reset がズレる | `0 15 * * SUN = JST 月曜 00:00` を定数・docs・テストに明記する |
| cleanup の頻度が高すぎる | DB接続・実行回数が増える | 初期値は30分。必要時だけ15分へ変更する |
| Cron が失敗しても気づけない | stale data が残る | 成功・失敗ログ、Cloudflare Cron Events / Actions failure の確認手順を docs に残す |
| raw error をログに出す | 内部情報漏洩 | wrapper でも汎用日本語メッセージのみを出す |
| 本番確認ができない | 完了条件が曖昧 | ローカル確認と本番 dashboard 確認を分け、未実施なら理由を記録する |
| フェーズ12とスコープ衝突 | 作業が大きくなりすぎる | 本タスクは Cron 運用設計と設定準備まで。deploy 完了は必要条件にしない |

## 作業手順

1. 現在の `develop` で `backend/wrangler.toml`, `.github/workflows`, Workers deploy 方針の有無を確認する。
2. Cloudflare Workers Cron を今タスクで採用できるか判断する。
3. 採用できる場合は `app.ts` / `worker.ts` / `scheduled.ts` / `wrangler.toml` 方針で実装する。
4. 採用できない場合は GitHub Actions schedule 案で実装し、Workers Cron はフェーズ12へ明示的に残す。
5. `scheduled.test.ts` または workflow 相当のテストを Red で作成する。
6. 既存 job 本体を再実装せず、薄い wrapper / workflow から呼び出す。
7. ログに含める項目と含めない項目をテストする。
8. `docs/09_startup_commands.md` に手動実行・定期実行の確認手順を追記する。
9. `docs/11_deployment.md` に採用方式、時刻、失敗時対応、確認手順を追記する。
10. `docs/05_progress.md` と本計画書を更新する。
11. lint / format / test / build / 手動確認を実施する。
12. 実装完了時に本計画書のチェックボックスと `## 実装完了` を更新する。

## タスクリスト

| タスクID | 内容 | ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存仕様・実装・deploy 基盤を確認する | `docs/05_progress.md`, `docs/09_startup_commands.md`, `docs/11_deployment.md`, `backend/src/jobs/*.ts`, `backend/src/index.ts`, `backend/src/lib/prisma.ts` | Workers Cron を採用できるか、代替が必要か判断できる | 高 |
| T2 | Cron 実行方式を決定する | 本計画, `docs/11_deployment.md` | Cloudflare Workers Cron または GitHub Actions schedule の採用理由が記録される | 高 |
| T3 | Red: 定期実行 wrapper / workflow のテストを作る | `backend/src/jobs/scheduled.test.ts` または workflow 検証手順 | weekly / cleanup / 未知 cron / 失敗ログの failing test または検証観点が揃う | 高 |
| T4 | Cloudflare 採用時: Hono app を entrypoint から分離する | `backend/src/app.ts`, `backend/src/index.ts` | Node server と Worker fetch が同じ app を安全に使える | 高 |
| T5 | Cloudflare 採用時: Workers entrypoint を追加する | `backend/src/worker.ts` | `fetch` と `scheduled` が export され、`serve()` が混入しない | 高 |
| T6 | Cloudflare 採用時: scheduled wrapper を実装する | `backend/src/jobs/scheduled.ts` | Cron 文字列に応じて既存 job を呼び分ける | 高 |
| T7 | Cloudflare 採用時: Wrangler 設定を追加する | `backend/wrangler.toml` | `triggers.crons` と main entrypoint が設定される | 高 |
| T8 | GitHub Actions 採用時: scheduled workflow を追加する | `.github/workflows/batch.yml` | `workflow_dispatch` と `schedule` で既存 CLI を実行できる | 高 |
| T9 | DB接続・秘密情報の扱いを確認する | `backend/src/lib/prisma.ts`, `backend/prisma.config.ts`, `docs/11_deployment.md` | `DATABASE_URL` を code / config にハードコードしない方針が明記される | 高 |
| T10 | 安全ログと失敗時挙動を固定する | `backend/src/jobs/scheduled.ts`, tests, docs | raw DB error や個人情報をログに出さない | 高 |
| T11 | API client / 型定義 / validation の変更要否を確認する | `docs/04_api.md`, `backend/src/types/index.ts`, `frontend/src/lib/api/*.ts` | 公開 API 変更なしなら未変更と記録される | 中 |
| T12 | UI / A11Y 影響を確認する | `/ranking`, `/mypage`, `/game/play`, `/game/result` 関連ファイル | 新規 UI 不要、既存 loading/error/empty の確認項目が整理される | 中 |
| T13 | 運用手順 docs を更新する | `docs/09_startup_commands.md`, `docs/11_deployment.md` | 手動実行、定期実行、確認、失敗時対応が記載される | 高 |
| T14 | `docs/05_progress.md` と plan を更新する | `docs/05_progress.md`, 本計画 | 計画書リンク、完了時更新ルールが反映される | 高 |
| T15 | backend lint を実行する | `backend` | `npm run lint` が通る | 高 |
| T16 | backend format check を実行する | `backend` | `npm run format:check` が通る。必要なら `npm run format` を実行する | 高 |
| T17 | backend test を実行する | `backend` | `npm run test -- --run` が通る | 高 |
| T18 | build / 定期実行ローカル検証を行う | `backend` | `npm run build` と採用方式ごとの local check が成功する | 高 |
| T19 | 既存画面の手動回帰確認を行う | `/ranking`, `/mypage`, `/game/play`, `/game/result` | Cron 後データ状態でも表示・A11Y が破綻しない | 中 |
| T20 | 実装完了記録を残す | 本計画 | 実際の変更ファイル、検証結果、未実施事項が記録される | 高 |

- [x] T1: 既存仕様・実装・deploy 基盤を確認する
- [x] T2: Cron 実行方式を決定する
- [x] T3: Red: 定期実行 wrapper / workflow のテストを作る
- [x] T4: Cloudflare 採用時: Hono app を entrypoint から分離する（GitHub Actions 採用により対象外と判断）
- [x] T5: Cloudflare 採用時: Workers entrypoint を追加する（GitHub Actions 採用により対象外と判断）
- [x] T6: Cloudflare 採用時: scheduled wrapper を実装する（GitHub Actions 採用により対象外と判断）
- [x] T7: Cloudflare 採用時: Wrangler 設定を追加する（GitHub Actions 採用により対象外と判断）
- [x] T8: GitHub Actions 採用時: scheduled workflow を追加する
- [x] T9: DB接続・秘密情報の扱いを確認する
- [x] T10: 安全ログと失敗時挙動を固定する
- [x] T11: API client / 型定義 / validation の変更要否を確認する
- [x] T12: UI / A11Y 影響を確認する
- [x] T13: 運用手順 docs を更新する
- [x] T14: `docs/05_progress.md` と plan を更新する
- [x] T15: backend lint を実行する
- [x] T16: backend format check を実行する
- [x] T17: backend test を実行する
- [x] T18: build / 定期実行ローカル検証を行う
- [x] T19: 既存画面の手動回帰確認を行う（UI / 公開 API / DB schema 変更なしのため未実施として記録）
- [x] T20: 実装完了記録を残す

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| weekly cron 正常系 | weekly cron で `resetWeeklyScores()` が1回呼ばれる |
| cleanup cron 正常系 | cleanup cron で `cleanupExpiredGameQuestionSets()` が1回呼ばれる |
| scheduledTime 利用 | `scheduledTime` から作った `Date` が job とログに共通利用される |
| 未知 cron | DB更新せず skipped / warning 扱いになる |
| weekly reset 0件 | `resetCount = 0` でも成功扱い |
| cleanup 0件 | `deletedCount = 0` でも成功扱い |
| weekly reset 失敗 | 汎用日本語メッセージで失敗ログを出し raw error を含めない |
| cleanup 失敗 | 汎用日本語メッセージで失敗ログを出し `questions` / `questionSetId` を含めない |
| 二重実行: weekly | 2回目は既存 job の冪等性により `resetCount = 0` を許容 |
| 二重実行: cleanup | 2回目は `deletedCount = 0` を許容 |
| UTC/JST 境界 | `0 15 * * SUN` が JST 月曜 00:00 相当であることを docs / test に記録 |
| cleanup 境界 | `expiresAt <= cutoff` の既存条件を維持する |
| 公開 API 変更なし | `docs/04_api.md` の仕様変更が不要であることを確認 |
| `/ranking` 空状態 | weekly ranking が空でも画面内導線が維持される |
| `/mypage` 0点表示 | `weeklyScore = 0` が正常表示される |
| `/game/play` 期限切れ導線 | cleanup 後の期限切れセットも既存 409 導線で扱える |
| `/game/result` reload | result restore の loading / error / unauthenticated 表示が維持される |
| 非 JSON エラー | frontend API client は変更しない。既存 `parseErrorResponse` 方針に影響なし |
| A11Y | 新規 UI なし。既存画面の `role`, `aria-live`, keyboard retry が破綻しない |
| 手動 CLI | Docker container 内で `reset:weekly-scores` と `cleanup:game-question-sets` が実行できる |
| 定期実行 local | 採用方式に応じて `wrangler dev` scheduled または `workflow_dispatch` 相当の確認ができる |

## 実装完了時の更新ルール

実装完了時は以下を必ず行う。

- 本計画のチェックボックスを `[x]` に更新する。
- `docs/05_progress.md` の対象タスクを `[x]` に更新する。
- 実際の変更ファイルが本計画のタスクリストと一致しているか確認する。
- Cloudflare Workers Cron を採用しなかった場合は、その理由と代替方式を `## 実装完了` に明記する。
- `docs/04_api.md` は公開 API 変更なしなら更新しない。更新不要の判断を記録する。
- DB schema / migration を変更した場合は、計画からの変更点、`prisma migrate deploy`、Playwright 確認結果を追加する。
- 本番 dashboard 確認が未実施なら、未実施理由とフェーズ12での確認項目を記録する。

### 実装完了セクションのテンプレート

```markdown
## 実装完了

- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/batch-cron-triggers
- PR: #N

### 採用した定期実行方式

- Cloudflare Workers Cron Trigger / GitHub Actions schedule
- 採用理由:
- 採用しなかった方式と理由:

### 計画からの変更点

- 例: Workers DB接続方針が未確定だったため、GitHub Actions schedule を暫定採用した
- 例: cleanup cron は `17,47 * * * *` から `*/15 * * * *` に変更した

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/jobs/scheduled.ts` | 新規 | Cron wrapper |

### 検証結果

| 確認 | 結果 |
|---|---|
| `cd backend && npm run lint` | 成功 / 失敗 |
| `cd backend && npm run format:check` | 成功 / 失敗 |
| `cd backend && npm run test -- --run` | 成功 / 失敗 |
| `cd backend && npm run build` | 成功 / 失敗 |
| Docker 手動 weekly reset | 成功 / 未実施 |
| Docker 手動 cleanup | 成功 / 未実施 |
| 定期実行 local check | 成功 / 未実施 |
| `/ranking` 回帰 | 成功 / 未実施 |
| `/mypage` 回帰 | 成功 / 未実施 |
| `/game/play` 回帰 | 成功 / 未実施 |
| `/game/result` 回帰 | 成功 / 未実施 |
```


## 実装完了

- 完了日: 2026-07-03
- 実装ブランチ: feature/batch-cron-triggers
- PR: #70

### 採用した定期実行方式

- 採用方式: GitHub Actions schedule
- 採用理由: 現在の backend は Node server と Prisma adapter-pg 前提で、wrangler.toml、Workers 用 Prisma 接続、Workers deploy workflow が未整備のため。既存 CLI と同じ Node 実行環境から安全に定期実行できる方式を優先した。
- 採用しなかった方式: Cloudflare Workers Cron Trigger
- 採用しなかった理由: Workers runtime での DB 接続方針が未確定で、entrypoint 分離や Workers 用 adapter 整備まで同時に行うとフェーズ12のデプロイ基盤作業とスコープが衝突するため。

### 計画からの変更点

- Cloudflare Workers Cron は本タスクでは実装せず、フェーズ12で Workers 本番基盤が整った後に移行する方針を docs/11_deployment.md に記録した。
- GitHub Actions の週間 cron は 7 15 * * 0 を使用する。GitHub Actions schedule の遅延・スキップリスクを下げるため、毎時00分を避けて JST 月曜 00:07 に寄せた。wrapper は計画書で定義した Cloudflare 形式の 0 15 * * SUN と旧 GitHub 形式の 0 15 * * 0 も受け付ける。
- 公開 HTTP API、frontend、DB schema / migration は変更しない。docs/04_api.md の更新も不要。
- GameQuestionSet cleanup は GitHub Actions では 17,47 * * * * を使用する。Cloudflare Cron 移行時の互換性として */30 * * * * も wrapper で受け付ける。
- 新規 UI はないため Playwright 回帰は未実施。既存画面への影響は API / DB schema 変更なしとして限定的。

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| backend/src/jobs/scheduled.ts | 新規 | Cron 文字列から既存 batch job を呼び分ける wrapper |
| backend/src/jobs/scheduled.test.ts | 新規 | weekly / cleanup / 未知 cron / 失敗ログの unit test |
| backend/src/jobs/scheduled.cli.ts | 新規 | GitHub Actions と手動実行用の CLI entrypoint |
| backend/package.json | 修正 | batch:scheduled script を追加 |
| .github/workflows/batch.yml | 新規 | schedule と workflow_dispatch で定期バッチを実行 |
| docs/09_startup_commands.md | 修正 | 手動実行と wrapper 確認手順を追記 |
| docs/11_deployment.md | 修正 | 採用方式、cron、Secret、retry、Workers 移行条件を追記 |
| docs/05_progress.md | 修正 | 対象タスクの進捗を更新 |
| docs/plans/batch-cron-triggers/plan.md | 修正 | チェックボックスと実装完了記録を更新 |

### 検証結果

| 確認 | 結果 |
|---|---|
| cd backend && npm run lint | 成功 |
| cd backend && npm run format | 成功 |
| cd backend && npm run format:check | 成功 |
| cd backend && npm run test -- --run src/jobs/scheduled.test.ts | 成功（8 tests） |
| cd backend && npm run test -- --run src/jobs/scheduled.cli.test.ts | 成功（4 tests） |
| cd backend && npm run test -- --run | 成功（36 files / 289 tests） |
| cd backend && npm run build | 成功 |
| npm run batch:scheduled の BATCH_CRON 未指定時エラー | 成功（日本語エラーで終了） |
| Docker 手動 weekly reset | 未実施（DB を更新するため、手順を docs/09_startup_commands.md に記録） |
| Docker 手動 cleanup | 未実施（DB を更新するため、手順を docs/09_startup_commands.md に記録） |
| GitHub Actions workflow_dispatch | 未実施（リモート Secret / Actions 実行環境が必要） |
| Cloudflare Cron Events 確認 | 未実施（Cloudflare Workers Cron は本タスクでは未採用） |
| /ranking 回帰 | 未実施（新規 UI / 公開 API / DB schema 変更なし） |
| /mypage 回帰 | 未実施（新規 UI / 公開 API / DB schema 変更なし） |
| /game/play 回帰 | 未実施（新規 UI / 公開 API / DB schema 変更なし） |
| /game/result 回帰 | 未実施（新規 UI / 公開 API / DB schema 変更なし） |

### TDD 実施記録

| フェーズ | 内容 | 結果 |
|---|---|---|
| Red | backend/src/jobs/scheduled.test.ts を先に追加 | scheduled.js 未存在で失敗を確認 |
| Green | backend/src/jobs/scheduled.ts と CLI を実装 | scheduled wrapper 8 件、scheduled CLI 3 件の対象テスト成功 |
| Refactor | Prettier 適用後に対象テストと全テストを再実行 | 全テスト成功 |
