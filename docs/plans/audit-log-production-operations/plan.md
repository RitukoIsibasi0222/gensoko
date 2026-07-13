# 監査ログ本番運用設計 実装計画

> 設計者ロール: セキュリティ・SRE・バックエンド運用設計を担当するシニアエンジニア

## 概要

フェーズ10で実装済みの監査ログ記録基盤に、保持期間、期限超過ログのcleanup、件数・容量監視、失敗検知、再実行手順、退会後の内部ID保持方針を追加する。

リポジトリ側では、Prismaによる安全な分割cleanup、低負荷な日次状態監視、dry-run既定のCLI、既存scheduled batch、GitHub Actionsへの接続を実装する。DB全体および`audit_logs` table・index容量の監視は本番DBプロバイダーに依存するため、フェーズ12で実環境へアラートを設定するまで全体を完了扱いにしない。

- 進捗タスク: `docs/05_progress.md` フェーズ11「監査ログ本番運用設計（保持期間・容量監視・cleanup・退会後の内部ID保持方針）」
- 計画書: `docs/plans/audit-log-production-operations/plan.md`
- 既存計画書: `docs/plans/audit-log/plan.md`
- 主対象: backend監査ログの保持・削除・容量監視・運用方針
- 公開API・UI: 追加しない

## レビュー結果と改善方針

### 既存計画との境界

`docs/plans/audit-log/plan.md`のT1〜T18と実装完了記録は、監査ログtable、記録service、各操作への監査追加、秘密情報除外、transaction整合性を対象としたフェーズ10の記録である。

既存計画では、保持期間cleanup、容量試算、大量ログイン失敗時の負荷確認、退会後の内部ID保持方針を明示的に後続課題としている。今回のタスクは既存計画を再オープンせず、独立した計画書で管理する。

### この計画で改善した点

初版案には、日次jobで監査ログ総件数と期限超過総件数を毎回`count()`する案が含まれていた。PostgreSQLの正確な全件`count()`はログ量に比例した負荷になり得るため、定期実行では次へ限定する。

- `occurredAt` indexを利用した直近24時間の範囲count。
- `findFirst`による最古・最新日時の確認。
- `findFirst`による期限超過rowの存在確認。
- cleanupで実際に削除した件数と上限到達の記録。

正確な期限超過総件数は手動dry-runでだけ取得し、総row数・table容量・index容量は本番DBプロバイダーのmetricsをsource of truthとする。これにより、容量監視のためのjobが大規模tableの新たな定常負荷になることを避ける。

### 観点別レビュー

| 観点 | 確認できた事実 | 未確定・推測 | 影響 | 改善方針 | 優先度 |
|---|---|---|---|---|---|
| 保持期間 | `AuditLog`に削除期限列はなく、現在は無期限に蓄積する | 必要な調査期間、プライバシー上の保持期間は未決定 | DB容量が増え続ける | 暫定推奨365日を提示し、承認後に環境変数をruntime source of truthとして有効化する | High |
| cleanup | 監査ログ用job・CLI・Cronは存在しない | 1日当たりの期限超過件数は未計測 | 大量一括削除によるlock・負荷、削除漏れ | indexを使ったID限定取得と分割`deleteMany`を採用し、1回の上限を固定する | High |
| 容量監視 | 本番Supabaseは未構築。構造化ログ基盤も未実装 | DB plan、quota、table容量取得手段、通知先は未確定 | 閾値や通知方法をコードだけでは確定できない | 日次増加監視はリポジトリで実装し、容量アラートはフェーズ12のrelease gateとする | High |
| 集計負荷 | `occurredAt, id` indexは存在する | 正確な全件countはtable増加に比例して重くなる | 監視job自体がDB負荷になる | 定期実行では範囲countと存在確認だけにし、正確な総数はprovider metricsまたは手動確認へ分離する | High |
| 定期実行 | GitHub Actions scheduleと共通`runScheduledBatch()`が実装済み | 将来Cloudflare Workers Cronへ移行する可能性がある | 別系統のbatch基盤を作ると運用が分裂する | 既存scheduled batchと`.github/workflows/batch.yml`へ追加する | High |
| 同時実行 | 現在のworkflow concurrency groupはschedule値またはinput値に依存する | scheduleと手動実行が重なる可能性がある | 同じrowを複数実行が選択する | workflow全体を安定したgroupで直列化し、service自体も重複削除に安全な構造にする | High |
| ID保持 | `actorId`・`targetId`はUser relationなしのsnapshot | 内部ID保持がプライバシーポリシー上許容されるか未承認 | 退会後もユーザーとの相関が残る | 監査rowと同じ期間だけ保持する案を推奨し、承認を有効化条件にする | High |
| 退会処理 | `deleteCurrentUser()`と管理者強制退会はsoft deleteで、User行のemail・username・学習データが残る | 将来のphysical deleteまたは匿名化方針は未決定 | `docs/02_security.md`の完全削除記載と不整合 | 本タスクで矛盾を隠さず、本番公開前の別ブロッカーとして進捗管理する | High |
| DB index | `@@index([occurredAt(sort: Desc), id(sort: Desc)])`が存在する | 本番件数での実行計画は未確認 | cleanupが遅くなる可能性 | 既存indexを使用し、stagingで実行時間・query timeout・削除件数を確認する | Medium |
| schema | raw内部IDを保持したまま監査rowごと削除する場合、追加列は不要 | 匿名化・個別legal holdを採用する場合はschemaが必要 | 不要なmigrationでリスクが増える | 初期案はschema変更なし。方針変更時は計画を再レビューする | Medium |
| API | cleanupは公開APIではなく内部運用処理 | 管理画面から実行したい要望は未確認 | 認可漏れ・攻撃面増加 | HTTP endpointを作らず、CLIとCronだけに限定する | High |
| A11Y | UI・公開API・frontend変更はない | なし | 新規A11Y欠陥は発生しない | A11Y実装は対象外。UI変更が発生した場合のみ計画を再レビューする | Low |
| エラー監視 | job失敗はGitHub Actions failureで検出可能 | 通知先と当番は未設定 | 失敗に気づかず期限超過ログが蓄積する | workflow失敗通知の受信者をrelease gateとして設定する | High |

## スコープ

- 監査ログ保持期間のruntime設定とvalidation。
- cleanupの有効・無効を切り替える安全停止設定。
- 保持期限とcutoffの一元計算。
- 期限超過監査ログの手動dry-run・preview。
- ID限定取得と分割削除によるcleanup。
- 1batch、1回当たり削除件数、最大実行時間の上限。
- cleanupの冪等性、同時実行安全性、部分失敗時の再実行。
- 直近24時間増加件数、最古・最新時刻、期限超過row有無の低負荷な定期監視。
- cleanup成功・失敗・削除件数・実行時間・上限到達の安全ログ。
- cleanup service、CLI、scheduled batch、GitHub Actions schedule。
- Docker PostgreSQLを使用したcleanup integration test。
- DBプロバイダーのquotaに対する容量監視・アラート設定方針。
- 退会後の内部ID保持方針と承認記録。
- セキュリティ・データモデル・進捗・テスト・起動・デプロイ文書の更新。

## 非スコープ

- 監査ログ閲覧・検索・更新・削除用の公開API。
- 監査ログ管理画面。
- frontend API client・store・UI。
- 個別監査ログを指定するlegal hold API。
- 監査ログのWORM化、署名、ハッシュチェーン。
- request ID、Sentry、外部構造化ログ基盤の本実装。
- Cloudflare Workers本番基盤の新設。
- Supabaseプロジェクトの作成。
- 退会処理全体のphysical delete・個人情報匿名化実装。
- メール認証操作の監査追加。
- raw SQLによるtable・index容量取得。
- HMAC匿名化。採用する場合はschema・migration・鍵管理を含む別レビューが必要。

## 現状調査結果

### 確認できた事実

- `docs/05_progress.md`の本タスクは`[ ]`である。
- 監査ログ記録基盤はPR #80で実装済みである。
- `AuditLog`は`action`、`result`、`actorId`、`actorRole`、`targetType`、`targetId`、`failureReason`、`occurredAt`を持つ。
- `actorId`・`targetId`はUser relationを持たない。
- `AuditLog`は`occurredAt, id`、`action, occurredAt`、`targetType, targetId, occurredAt`のindexを持つ。
- 監査ログのupdate/delete用APIは存在しない。
- `recordAuditEvent()`は成功操作のtransaction内で監査ログを保存する。
- `recordAuditEventBestEffort()`は失敗イベントを保存し、保存失敗時もraw errorを出さない。
- `deleteCurrentUser()`はUser rowを削除せず、`isActive=false`と`deletedAt`を設定する。
- `forceDeleteAdminUser()`もsoft deleteである。
- `docs/02_security.md`は退会時に全個人情報・学習データを完全削除すると記載している。
- 既存の定期batchはGitHub Actions scheduleからNode CLIを実行する。
- `.github/workflows/batch.yml`は週間スコアリセットとGameQuestionSet cleanupを実行する。
- `backend/src/jobs/scheduled.ts`はCron文字列からjobを選択する共通wrapperである。
- batch失敗時はraw DB errorを出さず、GitHub Actionsを失敗させる。
- 本番Supabase、Workers entrypoint、Wrangler設定、構造化ログ基盤は未実装である。
- `backend/src/lib/config.ts`がバックエンド共通設定の取得とvalidationを担当する。
- `backend/.env.example`がローカル環境変数のテンプレートである。

### 推測・未確定事項

- 本番の1日当たり監査ログ生成数。
- LOGIN FAILUREが全体に占める割合。
- `audit_logs`の平均row sizeとindex size。
- 本番DB plan、quota、backup・PITR機能。
- 管理者が監査ログを必要とする最長調査期間。
- 365日保持がプロダクト要件・プライバシー方針上妥当か。
- workflow失敗・容量警告の通知先。
- cleanupの一次対応者と承認者。
- 退会後も内部IDを保持することへの承認。
- soft deleteと完全削除の不整合をどの別タスクで解消するか。

## 前提条件・依存関係

### 既存の公開インターフェース

**`backend/src/services/audit.service.ts`**

- `recordAuditEvent(client: AuditLogClient, input: AuditEventInput): Promise<void>` — 必須監査を指定transaction clientへ保存する。
- `recordAuditEventBestEffort(input: AuditEventInput): Promise<boolean>` — 失敗監査をbest-effortで保存する。

**`backend/src/jobs/cleanupGameQuestionSets.ts`**

- `cleanupExpiredGameQuestionSets(options?: CleanupGameQuestionSetsOptions): Promise<CleanupGameQuestionSetsResult>` — 期限切れ問題セットを削除する既存jobパターン。

**`backend/src/jobs/scheduled.ts`**

- `runScheduledBatch(options: RunScheduledBatchOptions): Promise<ScheduledBatchResult>` — Cron文字列に対応するjobを実行する。
- `GITHUB_WEEKLY_SCORE_RESET_CRON` — GitHub Actionsの週間リセットCron。
- `GITHUB_GAME_QUESTION_SET_CLEANUP_CRON` — GitHub Actionsの問題セットcleanup Cron。

**`backend/src/lib/config.ts`**

- `getFrontendUrl(options?: FrontendUrlOptions): string` — CORS・メール用URL設定。
- `getRateLimitConfig(options?: RateLimitConfigOptions): RateLimitConfig` — rate limit設定の共通validation。

**`backend/src/services/user.service.ts`**

- `deleteCurrentUser(input): Promise<void>` — Userをsoft deleteし、関連tokenを削除する。

**`backend/src/services/admin.service.ts`**

- `forceDeleteAdminUser(input): Promise<{ message: string }>` — 対象Userをsoft deleteし、成功監査を同一transactionへ保存する。

### 重要な制約

- DBアクセスはPrisma ORMのみを使用する。
- `$queryRaw`・`$executeRaw`は使用しない。
- cleanupで監査ログ記録serviceを呼ばない。
- cleanup自身を`AuditLog`へ保存しない。
- `actorId`・`targetId`・監査ログIDを運用ログへ出さない。
- password、token、email、username、Cookie、Authorization、request body、raw error、stack、DATABASE_URLをログへ出さない。
- `occurredAt`と基準時刻はUTCの`Date`として扱う。
- cutoff用の基準時刻は1回の実行で一度だけ確定する。
- duration制御にはwall clockではなく単調増加clockを使用し、testでは注入できる形にする。
- config、cutoff計算、batch上限、ログeventを複数ファイルへ重複定義しない。
- retention未設定または不正時に削除を実行しない。
- cleanup有効化には明示的な設定を必要とする。
- cleanup無効時も状態確認・dry-runは可能にする。
- 公開HTTP endpointを追加しない。
- ESM importへ`.js`拡張子を付ける。
- エラーメッセージは日本語に統一する。
- DB schemaを変更しない初期案とする。

### 確認事項・リリースゲート

実装開始前に以下を記録する。

| 確認事項 | 推奨案 | 承認者・確定値 |
|---|---|---|
| 保持期間 | 365日 | 未確定 |
| cleanup Cron | 毎日UTC 18:37（JST 03:37） | 未確定 |
| 退会後内部ID | 監査rowと同じ期間保持し、監査row cleanupで削除 | 未確定 |
| cleanup実行主体 | GitHub Actions schedule | 未確定 |
| cleanup失敗通知先 | GitHub Actions失敗通知を開発担当へ送る | 未確定 |
| DB容量警告 | 契約quotaの70% | 本番DB作成後に確定 |
| DB容量重大 | 契約quotaの85% | 本番DB作成後に確定 |
| cleanup一次対応者 | 開発・運用担当者 | 未確定 |
| 保持期間変更承認者 | プロダクトオーナーまたはプライバシー責任者 | 未確定 |
| 削除保留承認者 | インシデント責任者 | 未確定 |
| soft delete不整合の解消タスク | 本番公開前の別タスクとして追加 | 未確定 |

これらが未確定の状態では`AUDIT_LOG_CLEANUP_ENABLED=true`を本番へ設定しない。

## 保持期間・削除保留方針

### 推奨値

- 暫定推奨保持期間: 365日。
- 法的義務を断定する値ではなく、インシデント調査能力と容量制御の初期バランスとして提案する。
- プロダクトオーナーまたはプライバシー責任者の承認後に正式値とする。
- 承認されない場合はcleanupを有効化せず、本計画を更新する。

### source of truth

- runtime値: `AUDIT_LOG_RETENTION_DAYS`。
- cleanup有効化: `AUDIT_LOG_CLEANUP_ENABLED`。
- 認可された正式値・承認者・変更日は`docs/11_deployment.md`へ記録する。
- 値の取得とvalidationは`backend/src/lib/config.ts`へ集約する。
- Hono API起動時には読み込まず、監査ログmaintenance job実行時だけ取得する。
- `AUDIT_LOG_RETENTION_DAYS`と`AUDIT_LOG_CLEANUP_ENABLED`は秘密情報ではないためGitHub Actions Variablesで管理し、`DATABASE_URL`はSecretのまま維持する。

### validation

| 項目 | 方針 |
|---|---|
| `AUDIT_LOG_RETENTION_DAYS` | 10進整数、30〜3650日 |
| 未設定 | maintenance jobを失敗させ、削除しない |
| 空文字 | 不正値として削除しない |
| 0・負数 | 拒否 |
| 小数・NaN・Infinity | 拒否 |
| 上限超過 | 拒否 |
| `AUDIT_LOG_CLEANUP_ENABLED` | `true`または`false`のみ |
| 未設定 | 安全側で`false` |
| 不正値 | jobを失敗させ、削除しない |

### cutoff

- job入口で受け取った`now`から一度だけ計算する。
- `retentionDays × 86,400,000ms`を引いたUTC時刻とする。
- DSTやサーバーtimezoneに依存させない。
- 削除対象は`occurredAt < cutoff`とする。
- `occurredAt === cutoff`は残す。
- dry-run、実削除、ログ、戻り値で同じcutoffを使う。

### 保持期間変更

- 延長: 新しい短縮削除は発生しない。次回から新しいcutoffを使用する。
- 短縮: 実行前にdry-runし、対象件数、最古日時、想定削除回数を確認する。
- 短縮時も1回の最大削除件数を解除しない。
- 値変更、理由、承認者、適用日時を`docs/11_deployment.md`へ記録する。

### 削除保留

- 初期実装は全体保留のみ対応する。
- インシデント調査中は`AUDIT_LOG_CLEANUP_ENABLED=false`へ変更する。
- 保留理由、開始日時、承認者、見直し期限を運用文書へ記録する。
- 個別row・対象ユーザー単位のholdは実装しない。
- 個別holdが必要になった場合は、schema・migration・閲覧権限・解除手順を含む別計画を作成する。

## 容量監視・アラート方針

### 定期実行で取得する低負荷な状態

監査ログcleanupの定期実行時に、次を取得する。

- `occurredAt >= now - 24時間`の生成件数。
- 最古の`occurredAt`。
- 最新の`occurredAt`。
- cutoffより古いrowが存在するか。
- cleanup削除件数。
- cleanup実行時間。
- 最大削除件数・最大時間到達の有無。
- 削除後も期限超過rowが存在するか。

範囲countは日次maintenance jobだけで使用し、HTTP requestごとに実行しない。正確な全row数と期限超過総件数を定期実行ごとに取得しない。

### 手動previewで取得する状態

オペレーターが明示的にdry-runした場合だけ、次を追加取得する。

- cutoffより古いrowの正確な件数。
- batch sizeと1回最大件数から計算した最低実行回数。

previewは高頻度監視や公開APIから呼ばない。件数取得がtimeoutした場合もcleanupを有効化せず、DB plan・query実行状況を確認する。

### 本番DBプロバイダー側で監視する状態

- DB全体の使用量と契約quota。
- `audit_logs` table容量。
- 監査ログindex容量。
- DB接続数。
- CPU・I/O・storage latency。
- backupまたはPITRの状態。
- 可能であれば総row数のprovider統計または低負荷な推定値。

table・index容量のためにアプリケーションコードからraw SQLを発行しない。本番Supabase構築後、利用可能なDashboard・Metrics・Integrationを確認して設定する。

### 暫定閾値

| 項目 | 警告 | 重大 | 対応 |
|---|---:|---:|---|
| DB全体容量 | 契約quotaの70% | 85% | 増加原因確認、cleanup結果確認、plan変更検討 |
| 期限超過残件 | 1件以上が次回実行後も残る | 最大削除件数到達または2回連続残存 | 手動再実行、設定・DB負荷確認 |
| cleanup失敗 | 1回 | 2回連続 | 自動削除停止、担当者確認 |
| audit write failure | 1件 | 継続発生 | backend・DB状態確認 |
| 日次増加件数 | 初期7日間はbaseline収集 | baseline確定後に決定 | LOGIN FAILURE急増、攻撃、rate limit状態を確認 |

固定row件数だけで容量警告を決めない。平均row・index sizeとDB planが確定した後、日次増加量からquota到達までの推定日数を算出してrunbookを更新する。

### 通知

- 初期通知経路はGitHub Actions workflow failure。
- GitHub Actions通知の受信者を本番有効化前に確認する。
- 容量警告は本番DBプロバイダーの通知機能またはフェーズ11の構造化ログ基盤へ接続する。
- 通知内容に内部ID、メール、username、監査ログID、raw errorを含めない。
- 本番通知先が未設定の間はタスクを`[x]`にしない。

## cleanup job・CLI・Cron設計

### 実行頻度

- 暫定Cron: `37 18 * * *`。
- UTC毎日18:37、JST毎日03:37。
- 毎時00分付近と既存batchの分を避ける。
- 365日保持に対して日次実行で開始する。
- staging実測で1回の最大件数を恒常的に超える場合、頻度または上限を再設計する。

### 固定安全上限

| 項目 | 初期値 | 管理方法 |
|---|---:|---|
| 1batch件数 | 500件 | code定数 |
| 1回最大削除件数 | 10,000件 | code定数 |
| 最大実行時間 | 8分 | code定数 |
| GitHub Actions timeout | 10分 | workflow |

安全上限は環境変数へ分散せず、変更にはcode・test・docsの同時更新を必要とする。

### 削除手順

1. `now`、retention config、cutoffを確定する。
2. 低負荷な日次状態を取得する。
3. dry-runまたはcleanup無効の場合はDBを変更せず結果を返す。
4. `occurredAt < cutoff`を満たすIDだけを`occurredAt ASC, id ASC`順で最大500件取得する。
5. 取得したIDと`occurredAt < cutoff`の両方を条件に`deleteMany`する。
6. 削除件数を累積する。
7. 取得0件、最大10,000件、または8分到達で終了する。
8. 最大件数・時間上限到達時は残件の有無を1件だけ確認する。
9. 残件があれば`limitReached=true`としてscheduled実行を失敗させ、通知対象にする。
10. raw errorを捨て、安全な固定メッセージで失敗する。

1batchごとの`deleteMany`は原子的だが、複数batch全体を長時間transactionにしない。途中失敗時は完了済みbatchを維持し、次回実行で残件から再開する。

対象ID取得後に別実行で削除された場合、`deleteMany.count`が取得件数より少なくてもエラーにしない。期限内ログが削除されないことを優先する。

### dry-run

- 専用CLIは引数なしまたは`--dry-run`でdry-runする。
- 実削除には`--execute`を必要とする。
- `--execute`でも`AUDIT_LOG_CLEANUP_ENABLED=true`でなければ削除しない。
- `--dry-run`と`--execute`の同時指定はvalidation error。
- dry-runは期限超過件数、cutoff、最古・最新時刻を返すが、ID一覧を出さない。

### 同時実行

- `.github/workflows/batch.yml`のconcurrency groupを安定した`gensoko-batch-jobs`へ変更し、既存batchを含めて直列化する。
- `cancel-in-progress: false`を維持する。
- 手動CLIとの完全な排他は保証しない。
- serviceは同じIDの重複取得・削除済みrowを許容し、並行実行でも対象期間外を削除しない。
- 厳密なDB lockが必要になった場合はraw SQLで迂回せず、別設計を行う。

### 安全ログ

許可するevent例:

- `audit_logs.cleanup.previewed`
- `audit_logs.cleanup.completed`
- `audit_logs.cleanup.skipped`
- `audit_logs.cleanup.limit_reached`
- `audit_logs.cleanup.failed`

許可するfield:

- `event`
- `cutoff`
- `retentionDays`
- `dryRun`
- `deletedCount`
- `createdLast24HoursCount`
- `hasExpiredRows`
- `oldestOccurredAt`
- `latestOccurredAt`
- `durationMs`
- `limitReached`
- `message`

手動preview時だけ許可するfield:

- `expiredCount`
- `minimumRunsRequired`

禁止するfield:

- `id`
- `actorId`
- `targetId`
- `email`
- `username`
- `password`
- token・Cookie・Authorization
- request・response・body・headers
- raw Error・Prisma error・stack
- DATABASE_URL

### CLI終了code

| 状態 | exit code |
|---|---:|
| dry-run成功 | 0 |
| cleanup無効によるskip | 0 |
| cleanup成功 | 0 |
| DB・実行時エラー | 1 |
| 最大件数・時間到達後も残件あり | 1 |
| 引数・設定validationエラー | 2 |

## 退会後の内部ID保持方針

### 推奨案

- `actorId`・`targetId`は監査ログの保持期間中だけ保持する。
- 退会時に監査ログの内部IDを即時変更・削除しない。
- 監査ログcleanup時にrow全体を削除し、内部IDも同時に消去する。
- 公開API・UIへ内部IDを返さない。
- User relationを追加しない。
- 監査ログからUserを自動joinしない。
- 利用目的をセキュリティインシデントと管理者操作の調査に限定する。
- 保持期間は監査ログ本体と同じ365日を暫定推奨とする。

### 選択肢比較

| 案 | 調査能力 | プライバシー | migration・実装負荷 | 評価 |
|---|---|---|---|---|
| 監査rowと同期間raw内部ID保持 | 同一主体・対象の相関が可能 | 保持中は再識別可能性がある | 追加schema不要 | 初期推奨。承認必須 |
| 退会時にnull化 | 退会前後の相関を失う | リスクは低下 | 全監査row更新が必要 | 調査要件と衝突しやすい |
| keyed HMACへ変換 | 相関は維持可能 | 元IDの直接保持を避けられる | 鍵管理、rotation、migrationが必要 | 別計画が必要 |
| 監査ログを即時削除 | 調査不能 | 最も少ない保持 | cleanupは簡単 | 監査要件を満たさない可能性 |

### soft deleteとの不整合

現在のUser rowにはsoft delete後もemail・username・学習データが残る。内部IDだけを監査ログに保持する問題とは別に、`docs/02_security.md`の完全削除要件を満たしていない。

本計画では、退会処理全体を無断でphysical deleteへ変更しない。以下を本番公開前の別タスクとして追加する。

- User個人情報の匿名化またはphysical delete方針。
- 学習データの削除範囲。
- 管理者強制退会と本人退会の整合。
- 監査ログ内部IDを例外保持する場合のプライバシーポリシー記載。
- 既存soft-deleted userへの移行。
- cascade deleteと監査証跡の非連動確認。

この別タスクが未解決でもcleanup codeは実装できるが、本番運用タスクを完了扱いにしない。

## 運用責任・runbook

詳細な運用手順は`docs/11_deployment.md`へ追加する。

| 項目 | 手順 |
|---|---|
| 通常実行 | GitHub Actions scheduleで日次実行 |
| dry-run | workflow_dispatchまたはDocker CLIで実行 |
| 手動実削除 | 承認後に`--execute`とcleanup有効設定で実行 |
| 失敗確認 | Actions summaryと安全ログを確認 |
| 再実行 | 原因解消後、workflow_dispatchで同じjobを実行 |
| cleanup停止 | `AUDIT_LOG_CLEANUP_ENABLED=false`へ変更 |
| Cron停止 | workflow scheduleをdisableまたは対象cronを削除 |
| 保持期間変更 | 承認、dry-run、件数確認、文書更新後に反映 |
| 削除保留 | cleanupを無効化し、理由・期限・承認者を記録 |
| 容量警告 | 増加量、期限超過残件、cleanup失敗、DB quotaを確認 |
| 誤削除 | cleanup停止、書込み継続可否判断、backup/PITRからの復旧を検討 |
| backend rollback | 監査tableと収集済みログは残し、cleanupだけ停止可能にする |

本番有効化前に、一次対応者、通知先、承認者を実名またはチーム名で記録する。

## DB変更方針

- 初期案では`backend/prisma/schema.prisma`とmigrationを変更しない。
- `AuditLog.occurredAt, id`の既存indexをcleanupの検索・順序に利用する。
- 保持期限列は追加しない。保持期間変更時の全row更新を避けるため、`occurredAt`とruntime configからcutoffを計算する。
- legal hold列は追加しない。初期実装は全体停止で対応する。
- `actorId`・`targetId`のUser relationを追加しない。
- raw SQLは使用しない。
- N+1は発生させない。IDをbatch単位で取得し、`deleteMany`を1回実行する。
- 複数batchを1つの長時間transactionへ含めない。
- 既存データbackfillは不要。
- DB schema変更が必要になった場合は本計画を再レビューし、migration deploy、実DB確認、Playwright回帰を追加する。

`docs/03_data_model.md`は現在`AuditLog`を記載していないため、実装済みschemaと保持・index方針を追記する。

## API・UI・A11Y変更方針

- 公開HTTP APIは追加・変更しない。
- 監査ログcleanup endpointは作らない。
- 管理者画面へcleanupボタンを追加しない。
- frontend API client、store、page、componentは変更しない。
- `docs/04_api.md`は既存監査副作用の記載を確認するが、公開API変更がないため原則更新しない。
- `docs/04_api.md`を更新しない判断を実装完了記録へ残す。
- API status、body、Cookieを変更しない。
- UI変更がないため、新規keyboard・focus・aria・loading・empty・error stateは発生しない。
- DB schemaを変更しない限り、AGENTS.mdのDB変更時Playwright必須条件には該当しない。
- user・admin退会処理、公開API、frontendのいずれかを変更する場合は本計画のスコープ変更として扱い、API整合性、A11Y、関連route/component test、Playwrightを追加する。

## 対象ファイル一覧

### 変更対象

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `docs/plans/audit-log-production-operations/plan.md` | 新規 | 本計画、判断、タスク、完了記録 |
| `backend/src/jobs/cleanupAuditLogs.ts` | 新規 | retention状態取得、preview、分割cleanup |
| `backend/src/jobs/cleanupAuditLogs.test.ts` | 新規 | cutoff、batch、上限、ログ、並行安全性test |
| `backend/src/jobs/cleanupAuditLogs.cli.ts` | 新規 | dry-run既定の手動実行CLI |
| `backend/src/jobs/cleanupAuditLogs.cli.test.ts` | 新規 | 引数、exit code、disconnect、秘密情報除外test |
| `backend/src/jobs/cleanupAuditLogs.integration.test.ts` | 新規 | Docker PostgreSQLで境界・分割削除・冪等性を確認 |
| `backend/src/jobs/scheduled.ts` | 修正 | 監査ログcleanup Cronとresultを追加 |
| `backend/src/jobs/scheduled.test.ts` | 修正 | audit cleanup Cron、skip、上限到達test |
| `backend/src/lib/config.ts` | 修正 | retention・cleanup有効化設定を一元管理 |
| `backend/src/lib/config.test.ts` | 修正 | 未設定・境界・不正値・安全停止test |
| `backend/package.json` | 修正 | cleanup CLI・integration test script追加 |
| `backend/.env.example` | 修正 | retention・cleanup有効化設定例 |
| `.github/workflows/batch.yml` | 修正 | schedule、workflow_dispatch、Variables、安定concurrency |
| `docs/02_security.md` | 修正 | 監査保持・内部ID・完全削除との差を承認内容へ整合 |
| `docs/03_data_model.md` | 修正 | AuditLog model・index・保持方針を現行schemaへ整合 |
| `docs/05_progress.md` | 修正 | 新計画書link、実装中・完了状態、別privacy blocker |
| `docs/07_testing_flow.md` | 修正 | cleanup実DBintegration test手順 |
| `docs/09_startup_commands.md` | 修正 | dry-run、手動実行、integration test手順 |
| `docs/11_deployment.md` | 修正 | retention、Cron、監視、通知、停止、再実行runbook |

### 確認のみ

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260711105051_add_audit_logs/migration.sql`
- `backend/src/services/audit-events.ts`
- `backend/src/services/audit.service.ts`
- `backend/src/services/audit.service.test.ts`
- `backend/src/services/audit-rollback.integration.test.ts`
- `backend/src/services/auth.service.ts`
- `backend/src/services/user.service.ts`
- `backend/src/services/admin.service.ts`
- `backend/src/jobs/scheduled.cli.ts`
- `docker-compose.yml`
- `docs/04_api.md`

## 設計上の決定事項

1. **既存監査計画を更新するか**
   - 選択: 新規`audit-log-production-operations`計画へ分離する。
   - 根拠: 既存計画はフェーズ10の完了記録であり、後続タスクと混ぜると完了状態を誤認するため。

2. **保持期間のsource of truth**
   - 選択: `AUDIT_LOG_RETENTION_DAYS`。
   - 根拠: 環境ごとに設定でき、code・Cron・docsへの重複定義を避けられるため。

3. **初期保持期間**
   - 選択: 365日を暫定推奨し、承認前はcleanupを有効化しない。
   - 根拠: 調査期間を確保しつつ無期限保持を避けるため。法的根拠は別途確認する。

4. **削除境界**
   - 選択: `occurredAt < cutoff`。
   - 根拠: cutoffと同時刻のrowを安全側で残し、境界の誤削除を避けるため。

5. **cleanup方式**
   - 選択: `findMany`でIDを限定取得し、IDとcutoffを再指定した`deleteMany`を繰り返す。
   - 根拠: Prisma ORMだけで件数上限を実現し、大量単発deleteを避けるため。

6. **transaction境界**
   - 選択: 1batchを単位とし、全batchを1つのtransactionへ含めない。
   - 根拠: 長時間transaction、lock保持、rollback量を抑え、途中失敗後に安全に再実行するため。

7. **batch上限**
   - 選択: 500件、1回最大10,000件、最大8分。
   - 根拠: workflow timeout内で処理を制限し、異常なbacklogを通知可能にするため。

8. **dry-run**
   - 選択: 専用CLIはdry-runを既定にし、実削除へ`--execute`を必須とする。
   - 根拠: 誤操作による早期削除を防ぐため。

9. **定期実行基盤**
   - 選択: 現在採用済みのGitHub Actions schedule。
   - 根拠: Workers本番基盤が未整備で、既存Node・PrismaPg CLIが動作確認済みであるため。

10. **Cron**
    - 選択: `37 18 * * *`。
    - 根拠: 保持期間に対して日次で開始でき、既存batchの実行分と分散できるため。

11. **同時実行**
    - 選択: workflowを安定groupで直列化し、serviceも冪等にする。
    - 根拠: scheduleとmanual dispatchの重複を防ぎ、CLI並行時も誤削除しないため。

12. **定期監視クエリ**
    - 選択: 範囲count、最古・最新、期限超過存在確認だけを日次実行する。
    - 根拠: 正確な全件countを定常負荷にしないため。

13. **容量監視**
    - 選択: 日次row増加はPrisma、本番storageはDBプロバイダーのmetrics。
    - 根拠: table・index容量取得のためにraw SQLをアプリへ追加しないため。

14. **退会後ID**
    - 選択: 監査rowと同じ期間だけraw内部IDを保持し、row cleanupで削除する案を推奨する。
    - 根拠: 追加schema・鍵管理なしで調査相関を維持し、無期限保持を避けられるため。

15. **HMAC匿名化**
    - 選択: 初期スコープでは採用しない。
    - 根拠: 鍵rotation、既存row移行、transaction変更が必要で、独立レビューなしに安全に追加できないため。

16. **soft delete不整合**
    - 選択: 本タスクで無断修正せず、本番公開前の別ブロッカーとして追跡する。
    - 根拠: 学習データcascade、認証、監査、管理者操作へ広範囲な影響があるため。

17. **cleanup自身の監査**
    - 選択: `AuditLog`へ保存しない。
    - 根拠: cleanupが新しい監査ログを生成すると保持処理が自己増殖し、責務も循環するため。

## 公開インターフェース案

```typescript
export type AuditLogRetentionEnvironment = Readonly<{
  AUDIT_LOG_RETENTION_DAYS?: string;
  AUDIT_LOG_CLEANUP_ENABLED?: string;
}>;

export type AuditLogRetentionConfig = Readonly<{
  retentionDays: number;
  cleanupEnabled: boolean;
}>;

export function getAuditLogRetentionConfig(options?: {
  environment?: AuditLogRetentionEnvironment;
}): AuditLogRetentionConfig;
```

```typescript
export const AUDIT_LOG_CLEANUP_BATCH_SIZE: 500;
export const AUDIT_LOG_CLEANUP_MAX_ROWS_PER_RUN: 10000;
export const AUDIT_LOG_CLEANUP_MAX_DURATION_MS: 480000;
export const AUDIT_LOG_CLEANUP_CRON: "37 18 * * *";

export type AuditLogHealthSnapshot = Readonly<{
  createdLast24HoursCount: number;
  hasExpiredRows: boolean;
  oldestOccurredAt: Date | null;
  latestOccurredAt: Date | null;
}>;

export type AuditLogCleanupPreview = Readonly<{
  cutoff: Date;
  expiredCount: number;
  minimumRunsRequired: number;
}>;

export type CleanupAuditLogsResult = Readonly<{
  cutoff: Date;
  retentionDays: number;
  dryRun: boolean;
  skipped: boolean;
  deletedCount: number;
  durationMs: number;
  limitReached: boolean;
  healthBefore: AuditLogHealthSnapshot;
}>;

export type CleanupAuditLogsLogger = Pick<Console, "info" | "warn" | "error">;

export type CleanupAuditLogsOptions = Readonly<{
  now?: Date;
  dryRun?: boolean;
  logger?: CleanupAuditLogsLogger;
  config?: AuditLogRetentionConfig;
  getMonotonicTime?: () => number;
}>;

export function calculateAuditLogCutoff(now: Date, retentionDays: number): Date;

export function inspectAuditLogHealth(
  options: CleanupAuditLogsOptions,
): Promise<AuditLogHealthSnapshot>;

export function previewExpiredAuditLogs(
  options: CleanupAuditLogsOptions,
): Promise<AuditLogCleanupPreview>;

export function cleanupExpiredAuditLogs(
  options?: CleanupAuditLogsOptions,
): Promise<CleanupAuditLogsResult>;
```

実際の型は既存Prisma型とtestabilityを確認して確定する。公開HTTP APIではなく、backend内部moduleのexportである。

## テスト方針

- AGENTS.mdに従いRed→Green→Refactorを実施する。
- unit testではPrismaをmockし、呼出し回数、where、orderBy、take、戻り値、ログを検証する。
- health checkとpreviewを分離し、定期実行が全件countを呼ばないことをtestで固定する。
- integration testは専用環境変数がある場合だけ実行する。
- integration DB hostは`localhost`、`127.0.0.1`、`postgres`だけを許可する。
- fixtureには一意なIDを使用し、終了時に作成データを削除する。
- 通常の全testではintegration testをskipする。
- cleanup追加後も既存監査記録・rollback testを通す。
- schema変更がないためmigrationは想定しない。
- UI変更がないためfrontend component testとA11Y testは追加しない。
- 公開API変更がないためroute responseの新規testは追加せず、既存監査関連testを回帰実行する。

## テストケース一覧

### retention・cutoff・config

| ケース | 期待結果 |
|---|---|
| 365日 | `now`から正確に365×24時間を引く |
| 月・年境界 | UTC時刻で正しいcutoffになる |
| うるう年 | 経過時間として一貫する |
| timezone変更 | 結果がサーバーtimezoneに依存しない |
| cutoff再利用 | DB条件・戻り値・ログで同じDateを使う |
| retention未設定 | validation error、DB未呼出し |
| 空文字 | validation error |
| 29日 | 下限未満として拒否 |
| 30日 | 受理 |
| 3650日 | 受理 |
| 3651日 | 上限超過として拒否 |
| 0・負数 | 拒否 |
| 小数・NaN・Infinity | 拒否 |
| cleanup enabled未設定 | `false` |
| `true`・`false` | 正しくboolean化 |
| その他文字列 | validation error |

### cleanup

| ケース | 期待結果 |
|---|---|
| dry-run | previewだけ実行し、deleteしない |
| cleanup無効 | skipし、deleteしない |
| 対象0件 | 成功、`deletedCount=0` |
| 対象1件 | 1件だけ削除 |
| cutoffと同時刻 | 削除しない |
| cutoffより1ms古い | 削除する |
| cutoffより新しい | 削除しない |
| 500件未満 | 1batchで終了 |
| 500件 | 1batch後に残件確認 |
| 501件 | 2batchで削除 |
| 10,000件 | 最大件数まで処理 |
| 10,001件以上 | 10,000件で停止し`limitReached=true` |
| 最大時間到達 | 次batchを開始せず残件を通知 |
| wall clock変更 | 単調増加clockでduration上限を判断する |
| 対象取得後に別実行が削除 | count差を許容し再実行可能 |
| 対象取得後に新規ログ追加 | cutoffより新しいrowを削除しない |
| 途中のPrisma error | 以降のbatchを停止し、固定errorだけを出す |
| 再実行 | 残件だけを処理する |
| 同時実行 | 対象期間外削除や例外的なID露出がない |
| cleanup自身 | `auditLog.create`を呼ばない |
| 成功ログ | 許可fieldだけを含む |
| 失敗ログ | raw DB error・ID・PIIを含まない |

### 容量・状態監視

| ケース | 期待結果 |
|---|---|
| 空table | 増加件数0、期限超過なし、日時null |
| 直近24時間 | 境界内の件数だけ数える |
| 24時間境界 | 定義した`gte`条件どおり |
| 最古・最新 | `occurredAt, id`順で正しいrowの日時を返す |
| 期限超過存在確認 | `occurredAt < cutoff`を`findFirst`で確認する |
| 定期health | 全件count・期限超過countを呼ばない |
| 手動preview | 期限超過countを1回だけ実行する |
| preview timeout | cleanupを有効化せず安全に失敗する |
| 状態取得失敗 | cleanupを開始せず安全に失敗する |
| limit残件 | scheduled jobが非0終了になる |
| 通知内容 | 内部ID・監査ログID・秘密情報を含まない |

### CLI・scheduled・workflow

| ケース | 期待結果 |
|---|---|
| 引数なし | dry-run |
| `--dry-run` | dry-run |
| `--execute` | config有効時だけ実削除 |
| 引数競合 | exit code 2 |
| 未知引数 | exit code 2 |
| DB失敗 | exit code 1 |
| Prisma disconnect失敗 | cleanup結果確定後なら結果を上書きしない |
| audit cleanup Cron | audit cleanupを1回呼ぶ |
| 未知Cron | DB jobを呼ばずskip |
| scheduledTime | 同じDateをjobとログへ渡す |
| job失敗 | raw errorを出さず共通batch failure |
| workflow_dispatch dry-run | 実削除なし |
| workflow_dispatch execute | 明示有効時だけ削除 |
| schedule | 日次Cronで実行 |
| concurrency | manualとscheduleを同時実行しない |
| Variables | retentionとenableをSecret扱いせず環境別に渡す |
| Secret | DATABASE_URLをworkflow・ログへ表示しない |

### 退会後ID・回帰

| ケース | 期待結果 |
|---|---|
| 退会前の監査row | 保持期間中はactorId・targetIdが維持される |
| 本人退会後 | 監査rowは即時削除・変更されない |
| 管理者強制退会後 | actor・targetの相関を保持する |
| 退会した管理者 | actorIdを監査rowの保持期間中維持する |
| 保持期限経過 | 監査rowと内部IDが削除される |
| 既存LOGIN監査 | success/failure記録が継続する |
| password監査 | change/reset成功監査が継続する |
| admin監査 | success/failure/retry境界が継続する |
| audit rollback | 必須監査失敗時のrollbackが継続する |
| API契約 | status・body・Cookieが変わらない |

### 実DB

| ケース | 期待結果 |
|---|---|
| 古いfixture | 削除される |
| cutoff同時刻fixture | 残る |
| 新しいfixture | 残る |
| 複数batch | 全対象を上限内で削除する |
| 二重実行 | 2回目は0件成功 |
| limit到達 | 対象外rowを削除せず残件を検出 |
| cleanup後 | fixture以外の監査rowを変更しない |
| test終了 | 作成fixtureを削除する |

## リリース・移行方針

1. 保持期間、内部ID保持、担当者、通知先を承認する。
2. docs/05_progress.mdを実装中へ更新する。
3. config testをRed化して共通設定を実装する。
4. cleanup unit testをRed化してserviceを実装する。
5. CLI・scheduled wrapper・workflowをTDDで追加する。
6. Docker PostgreSQL integration testを実行する。
7. lint、format check、build、全testを完了する。
8. security、data model、testing、startup、deployment docsを更新する。
9. 変更種別ごとにcommitし、実装PRを作成する。この時点ではcleanupを無効、進捗を実装中のままにする。
10. 実装PRのreviewと必須checkを完了し、developへmergeする。
11. cleanupを無効にした状態でcodeとworkflowをstagingへdeployする。
12. stagingでdry-runし、件数、cutoff、実行時間、ログ安全性を確認する。
13. stagingで対象を限定してcleanupを有効化し、再実行、上限到達、停止手順を確認する。
14. 本番DBのbackup・PITR状態を確認する。
15. 本番DB容量の警告・重大閾値と通知先を設定する。
16. productionでdry-runし、対象件数と最古日時を記録する。
17. 承認後にAUDIT_LOG_CLEANUP_ENABLED=trueを設定する。
18. 初回はActionsを監視し、削除件数、残件、DB負荷を確認する。
19. 7日間の増加量baselineを記録し、増加率の閾値を確定する。
20. docsとplanを実態へ合わせ、全release gate完了後だけ進捗を完了へ更新する。
21. 完了記録用docs PRのreviewと必須checkを完了し、developへmergeする。

schema変更・backfillは想定しない。

## ロールバック・cleanup停止方針

- 問題発生時は最初に`AUDIT_LOG_CLEANUP_ENABLED=false`へ変更する。
- 必要に応じてGitHub Actions scheduleをdisableする。
- cleanup停止中も監査ログ記録処理は維持する。
- cleanup codeのrevertより先に削除停止を行う。
- 収集済み監査ログtableをDROPしない。
- 誤削除されたrowはアプリケーションrollbackでは復元できない。
- 復旧が必要な場合はbackupまたはPITRからの復元を判断する。
- DB全体復元による他データ巻き戻りリスクを評価してから実施する。
- 最大件数到達は削除範囲の拡大ではなく、頻度・実行時間・原因を先に確認する。
- 保持期間を緊急短縮して容量を確保しない。承認とdry-runを必須とする。
- backendを旧versionへ戻してもworkflowがcleanupを呼び続けないことを確認する。

## 実装リスクと回避策

| リスク | 影響 | 回避策 |
|---|---|---|
| retention誤設定 | 必要な証跡を早期削除 | 下限・上限validation、cleanup明示有効化、dry-run |
| cutoff境界ミス | 期限内ログ削除 | `< cutoff`をtestと実DBで固定 |
| 大量単発delete | lock・I/O増加 | 500件batch、10,000件上限、8分上限 |
| 長時間transaction | lock保持・rollback増加 | 1batch単位でcommitし、全体transactionを作らない |
| 同時実行 | 重複処理・負荷増 | 安定concurrency group、冪等なID削除 |
| 部分失敗 | 一部だけ削除 | batch単位で再実行可能にする |
| 失敗未検知 | 無制限増加 | workflow failure、残件時非0終了 |
| 正確な全件countの定常実行 | table増加に比例したDB負荷 | provider metricsへ分離し、手動previewだけでcount |
| LOGIN FAILURE急増 | 容量・書込み負荷 | 日次増加監視、rate limit、baseline後alert |
| raw error漏えい | 接続情報・内部情報漏えい | 固定日本語error、security test |
| cleanupログのID漏えい | 内部ID露出 | 許可field方式、完全なログ引数test |
| cleanup自己監査 | 無限増加 | `AuditLog.create`を呼ばない |
| soft deleteとの不整合 | プライバシー仕様違反 | 別pre-production blockerとして追跡 |
| raw内部ID保持 | 再識別可能性 | 目的限定、アクセス非公開、期間限定、承認 |
| HMACへ途中変更 | migration・鍵運用事故 | 計画再レビューなしに変更しない |
| 本番基盤未構築 | 容量alert未設定 | フェーズ12release gate、完了扱い禁止 |
| Actions schedule遅延 | cleanup遅延 | 365日保持、手動dispatch、残件監視 |
| Actions設定drift | docsと実値の不一致 | Cron・Variables・担当者・変更日をdocsへ記録 |
| 誤削除 | 証跡喪失 | backup確認、dry-run、停止flag、上限 |
| backend rollback後のworkflow残存 | 旧codeへ想定外引数 | cleanup停止をrollbackの最初に実施 |

## タスクリスト

実装開始時にAGENTS.mdの3回レビューを行い、v1→v2→v3→v4の差分をPR本文へ記録する。

| ID | 内容 | 対象ファイル | 完了条件 | 依存 | 優先度 |
|---|---|---|---|---|---|
| T1 | 既存監査・batch・本番基盤を再確認 | 指定docs・backend・workflow | 事実と未確定事項が最新developと一致 | なし | High |
| T2 | 保持期間・ID保持・担当者を承認 | plan、`docs/02_security.md`、`docs/11_deployment.md` | 値・目的・承認者・通知先が確定 | T1 | High |
| T3 | 進捗を実装中へ更新 | `docs/05_progress.md` | `[-]`と新plan link、別privacy blockerを記録 | T2 | High |
| T4 | Red: retention config test | `backend/src/lib/config.test.ts` | 未設定・境界・不正値が失敗 | T2 | High |
| T5 | Green: retention config実装 | `backend/src/lib/config.ts`, `.env.example` | 一元validation、既定false、T4通過 | T4 | High |
| T6 | Red: cleanup service test | `cleanupAuditLogs.test.ts` | cutoff、preview、batch、limit、log testが失敗 | T5 | High |
| T7 | Green: cleanup service実装 | `cleanupAuditLogs.ts` | Prisma限定削除、冪等、上限、安全log、T6通過 | T6 | High |
| T8 | Red: CLI test | `cleanupAuditLogs.cli.test.ts` | dry-run既定、execute、exit codeが失敗 | T7 | High |
| T9 | Green: CLI・script実装 | CLI、`backend/package.json` | Docker内手動dry-run・executeが可能 | T8 | High |
| T10 | Red: scheduled接続test | `scheduled.test.ts` | audit Cron、result、上限到達が失敗 | T7 | High |
| T11 | Green: scheduled・workflow接続 | `scheduled.ts`, `batch.yml` | 日次実行、manual、Variables、安定concurrency、T10通過 | T10 | High |
| T12 | 実DBcleanup integration test追加 | integration test、package、testing docs | 境界・分割・冪等性をDocker DBで検証可能 | T7 | High |
| T13 | 横断security・回帰test | cleanup/audit/auth/user/admin tests | PII・raw errorなし、既存監査を維持 | T7,T11 | High |
| T14 | 運用・security・data model docs更新 | `docs/02`, `03`, `07`, `09`, `11` | retention、ID、手順、停止、通知が整合 | T2,T11,T12 | High |
| T15 | Refactor・format適用 | backend | 重複削除、Prettier適用、対象test維持 | T13 | High |
| T16 | backend品質チェック | backend | lint、format check、build、全test成功 | T15 | High |
| T17 | Docker PostgreSQL確認 | backend/Docker | integration test成功、fixture残存なし | T12,T16 | High |
| T18 | 実装commit・push・PR・merge | git/GitHub | 変更種別を分割し、cleanup無効・進捗実装中でdevelopへmerge | T14,T16,T17 | High |
| T19 | staging dry-run・cleanup確認 | Actions・staging DB | 件数、境界、再実行、停止、logを確認 | T18 | High |
| T20 | production容量監視・通知設定 | Supabase・Actions・runbook | quota閾値、通知先、担当者、backup確認 | T19、フェーズ12 | High |
| T21 | 初回production実行とbaseline確認 | production | 初回成功、残件なし、7日baselineを記録 | T20 | High |
| T22 | plan・progress完了更新とdocs PR | plan、docs/05_progress.md、git/GitHub | 実変更・決定値・検証・PR・完了状態を整合しdevelopへmerge | T21 | High |

- [ ] T1: 既存監査・batch・本番基盤を再確認する
- [ ] T2: 保持期間・退会後ID保持・担当者・通知先を承認する
- [ ] T3: `docs/05_progress.md`を実装中へ更新する
- [ ] T4: retention config testをRed化する
- [ ] T5: retention configと環境変数例を実装する
- [ ] T6: cleanup service testをRed化する
- [ ] T7: 分割cleanup・低負荷状態監視・安全logを実装する
- [ ] T8: CLI testをRed化する
- [ ] T9: dry-run既定のCLIとnpm scriptを実装する
- [ ] T10: scheduled接続testをRed化する
- [ ] T11: scheduled wrapperとGitHub Actionsへ接続する
- [ ] T12: Docker PostgreSQL cleanup integration testを追加する
- [ ] T13: security・既存監査回帰testを追加・更新する
- [ ] T14: security・data model・testing・startup・deployment docsを更新する
- [ ] T15: Refactorとformatを実施する
- [ ] T16: lint・format check・build・全testを通す
- [ ] T17: Docker PostgreSQLで境界・分割・冪等性を確認する
- [ ] T18: 変更種別ごとにcommitし、実装PRをreview後developへmergeする
- [ ] T19: stagingでdry-run・cleanup・再実行・停止を確認する
- [ ] T20: production容量監視・通知・backup確認を完了する
- [ ] T21: production初回実行と7日baselineを確認する
- [ ] T22: planとprogressを実装完了へ更新し、docs PRをdevelopへmergeする

### タブ区切りタスクリスト

```text
タスクID	タスク内容	ファイル	優先度
T1	既存監査・batch・本番基盤の再確認	指定docs・backend・workflow	高
T2	保持期間・ID保持・担当者・通知先の承認	plan・security・deployment docs	高
T3	進捗を実装中へ更新	docs/05_progress.md	高
T4	retention config Red test	backend/src/lib/config.test.ts	高
T5	retention config実装	backend/src/lib/config.ts・backend/.env.example	高
T6	cleanup service Red test	backend/src/jobs/cleanupAuditLogs.test.ts	高
T7	cleanup service実装	backend/src/jobs/cleanupAuditLogs.ts	高
T8	CLI Red test	backend/src/jobs/cleanupAuditLogs.cli.test.ts	高
T9	CLI・npm script実装	CLI・backend/package.json	高
T10	scheduled接続 Red test	backend/src/jobs/scheduled.test.ts	高
T11	scheduled・workflow接続	scheduled.ts・.github/workflows/batch.yml	高
T12	実DBcleanup integration test	integration test・package・testing docs	高
T13	security・監査回帰test	関連tests	高
T14	運用・security・data model docs更新	docs/02・03・07・09・11	高
T15	Refactor・format	backend	高
T16	品質チェック	backend	高
T17	Docker PostgreSQL確認	backend・Docker	高
T18	実装commit・push・PR・merge	git・GitHub	高
T19	staging確認	Actions・staging DB	高
T20	production監視・通知設定	Supabase・Actions・runbook	高
T21	初回production実行・baseline	production	高
T22	plan・progress完了更新・docs PR	plan・docs/05_progress.md・git/GitHub	高
```

## セキュリティ・プライバシー確認項目

- [ ] 保持期間と利用目的が承認されている。
- [ ] 退会後内部ID保持が承認されている。
- [ ] cleanup無効が安全側の既定値である。
- [ ] retention未設定・不正時に削除しない。
- [ ] dry-runが既定である。
- [ ] 実削除に`--execute`と有効設定の両方が必要である。
- [ ] cutoffと同時刻の監査ログを削除しない。
- [ ] 1batch・1回・実行時間に上限がある。
- [ ] cleanupが`AuditLog.create`を呼ばない。
- [ ] ID、PII、秘密情報、raw errorをlogへ出さない。
- [ ] workflowへDATABASE_URLをハードコードしない。
- [ ] cleanup失敗が非0終了になる。
- [ ] concurrencyが安定したgroupで直列化されている。
- [ ] 削除保留手順がある。
- [ ] 誤削除時のbackup・PITR判断手順がある。
- [ ] soft deleteと完全削除の不整合が別タスクで追跡されている。
- [ ] プライバシーポリシーへ必要な記載要件が引き継がれている。
- [ ] 公開cleanup APIがない。
- [ ] 監査ログ閲覧権限を今回追加していない。
- [ ] 本番通知先と一次対応者が設定されている。
- [ ] 本番容量閾値がDB planと整合している。

## 手動確認項目

- [ ] Docker内CLIを引数なしで実行し、dry-runになる。
- [ ] `--dry-run`でDBが変更されない。
- [ ] cleanup無効状態の`--execute`でDBが変更されない。
- [ ] cleanup有効状態の`--execute`で期限超過rowだけが削除される。
- [ ] cutoffと同時刻のrowが残る。
- [ ] cutoffより新しいrowが残る。
- [ ] 500件超を複数batchで処理する。
- [ ] 10,000件上限を超えて削除しない。
- [ ] 上限到達後の残件が通知対象になる。
- [ ] 二重実行しても結果が壊れない。
- [ ] scheduleとmanual dispatchが同時実行されない。
- [ ] cleanup失敗時にActionsが失敗する。
- [ ] workflow_dispatchで再実行できる。
- [ ] cleanup停止手順が機能する。
- [ ] retention変更前にdry-runできる。
- [ ] 定期health checkが正確な全件countを実行しない。
- [ ] 状態logから24時間増加、期限超過有無、最古・最新日時を確認できる。
- [ ] logに内部ID・監査ログID・PII・秘密情報がない。
- [ ] 本番DBの使用量をprovider metricsで確認できる。
- [ ] 70%・85%閾値の通知先が設定されている。
- [ ] backupまたはPITR状態を確認できる。
- [ ] LOGIN success/failure監査が継続する。
- [ ] password change/reset監査が継続する。
- [ ] admin操作監査が継続する。
- [ ] 本人退会・管理者強制退会後も承認した期間中の内部ID相関が維持される。
- [ ] 保持期限経過後は監査rowと内部IDが削除される。
- [ ] API status・body・Cookieに回帰がない。
- [ ] 7日間の増加量baselineを記録する。
- [ ] soft delete不整合の別タスクが本番公開前に完了または明示的にblockされている。

## 実装完了時の更新ルール

実装完了時は以下を必ず行う。

- 完了したタスクを`- [x]`へ更新する。
- 対象ファイル一覧を実際の変更へ合わせる。
- Prisma schema・migrationを変更しなかったこと、または変更理由を記録する。
- 公開API・frontendを変更しなかったことを記録する。
- `docs/04_api.md`の更新要否と判断理由を記録する。
- retentionの正式値、承認者、承認日を記録する。
- 退会後内部ID保持の正式方針、承認者、承認日を記録する。
- cleanup Cron、batch件数、最大件数、最大時間を記録する。
- cleanup停止・再実行手順の確認結果を記録する。
- 本番DB plan、quota、警告・重大閾値を記録する。
- 通知先と一次対応者を記録する。
- integration test、全test、lint、format、build結果を記録する。
- staging dry-run・実削除・再実行・停止結果を記録する。
- production初回実行とbaselineを記録する。
- soft delete不整合の解消状況を記録する。
- 未確定項目が残る場合は`docs/05_progress.md`を`[x]`にしない。
- `## 実装完了`セクションを追記する。

```markdown
## 実装完了

- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/audit-log-production-operations
- PR: #N
- 保持期間: N日
- cleanup Cron: ...
- cleanup実行主体: ...
- DB plan / quota: ...
- 容量警告: ...%
- 容量重大: ...%
- 通知先: ...
- 一次対応者: ...
- 保持期間承認者・承認日: ...
- 内部ID保持承認者・承認日: ...

### 計画からの変更点

- なし / 内容

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/jobs/cleanupAuditLogs.ts` | 新規 | 監査ログmaintenance job |

### TDD実施記録

| フェーズ | 対象 | 結果 |
|---|---|---|
| Red | retention config | |
| Green | retention config | |
| Red | cleanup service | |
| Green | cleanup service | |
| Red | CLI・scheduled | |
| Green | CLI・scheduled | |
| Refactor | 重複削除・format | |

### 検証結果

| 確認 | 結果 |
|---|---|
| backend lint | |
| backend format check | |
| backend build | |
| backend全test | |
| 既存audit rollback integration | |
| cleanup integration | |
| Docker dry-run | |
| Docker execute | |
| staging workflow_dispatch | |
| staging schedule | |
| cleanup停止・再実行 | |
| production初回実行 | |
| DB容量alert | |
| 通知受信 | |
| 7日baseline | |

### セキュリティ・プライバシー決定

- 監査ログ保持期間:
- 退会後内部ID:
- 利用目的:
- アクセス範囲:
- プライバシーポリシーへの引き継ぎ:
- soft delete不整合の解消状況:

### 残課題

- なし / 内容
```
