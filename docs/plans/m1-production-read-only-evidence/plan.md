# M1 production初回状態read-only証拠 実装計画

> 設計者ロール: シニアバックエンドエンジニア / セキュリティエンジニア / リリースマネージャー

## 概要

ポートフォリオ版v0.1最小リリース工程M1として、productionの全User・legacy User・User関連rowが0件であり、旧production配備と個人dataを含み得る旧backupがないことを、承認付きのread-only workflowで確認する。

repository内の実装とproduction実行を分離する。まず専用CLI・provider履歴照合・GitHub Actions workflow・test・runbookをTDDで実装して`develop`へmergeし、その後に別承認を得てreview済みSHAからworkflowを1回実行する。全項目が`clear`の場合だけPath A（空DB簡略化）を選び、`present`または`unknown`が1項目でもあればM1を完了せずPath B（通常移行）へ戻る。

本計画はM1の実行基盤と証拠判定を扱う。M2以降のstaging deploy、production backup作成、migration、cleanup、production deploy、smokeは実行しない。

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/plans/portfolio-release-v0-1-minimal/plan.md`**

- M1 — User・legacy・関連row 0件、旧配備・個人data入り旧backupなしを値非表示で確認する最初のrelease gate。
- M1不成立時 — 最小リリース工程を停止し、R6/R7/R9/R13〜R16の通常gateへ戻る。

**`docs/plans/r6-account-deletion-gates/plan.md`**

- Path A — active/suspended/legacyを含むUser、対象所有row、旧production配備、個人dataを含む旧backupがすべて0/なしの場合だけ選択できる。
- Path B — 1件以上、証拠不明、接続先不一致、旧配備または旧backupありの場合に選択する。
- `R13 read-only run: <URL>` — production証拠を記録する既存の受け渡し欄。

**`.github/workflows/production-database.yml`**

- `workflow_dispatch` / `environment: production` — production Environmentの承認境界。
- `group: gensoko-batch-jobs` / `cancel-in-progress: false` — production DB操作の直列化契約。
- `actions: read` / `contents: read` — 既存の最小GitHub権限。
- 現在のoperationはcapacity、backup、migration、account deletionに限定され、M1専用の全User・関連row・provider履歴確認は未実装。

**`backend/src/jobs/deleteLegacySoftDeletedUsers.ts`**

- `LegacySoftDeletedUserTableCounts` — legacy Userと所有rowの既存集計対象。
- `deleteLegacySoftDeletedUsers(...)` — legacy Userのdry-run/execute。M1では削除機能を呼ばず、対象tableの定義だけを参照する。

**`backend/src/lib/staging-database-target.ts`**

- `validateStagingDatabaseTarget(environment): void` — Supabase pooler URL、project ref、environment markerを値非表示で照合する既存validator。
- production用に同じ責務を複製せず、共通validatorへ抽出してstaging/production wrapperから利用する。

**`backend/prisma/schema.prisma`**

- `User` — active/suspended/legacyを含む全Userの判定元。
- User所有relation — `RefreshToken`、`EmailVerification`、`PasswordResetToken`、`WeakElement`、`GameSession`、`GameAnswer`、`GameQuestionSet`、`UserStats`。
- `AuditLog` — Userとの外部キーを持たず削除後も残るため、User identityまたは旧利用履歴を保持し得る追加確認対象。
- `Element` — 個人dataではないmaster dataのため0件条件から除外する。

**既存test pattern**

- `backend/src/jobs/productionDatabaseWorkflow.test.ts` — workflowのproduction固定、権限、secret非出力、Artifact契約をsource contractで検証する。
- `backend/src/jobs/accountDeletionWorkflow.test.ts` — manual operation、develop固定、承認記録、schedule非到達、fail-closedを検証する。

### 外部read-only API

実装時点の公式仕様を再確認し、responseはZodで検証する。API version、pagination、rate limit、404の意味を推測しない。

- [Vercel REST API](https://vercel.com/docs/rest-api) — production deployment履歴の取得。
- [Cloudflare Workers List Deployments](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/) — production Worker deployment履歴の取得。`Workers Scripts Read` tokenを使用する。
- [GitHub Actions Artifacts API](https://docs.github.com/en/rest/actions/artifacts) — 現存・expired Artifact metadataの取得。
- [GitHub Actions Workflow Jobs API](https://docs.github.com/en/rest/actions/workflow-jobs) — Artifact削除後も含め、過去runでbackup作成stepが成功したかを確認する。

### 重要な制約

- 計画PR・実装PRではproduction DB query、workflow dispatch、provider API request、Environment/Secret変更、deploy、migration、backup、cleanupを実行しない。
- production workflowのdispatch、Environment/Secret準備、証拠記録は、実装merge後にそれぞれ対象・権限・影響を提示して別承認を得る。
- production DBアクセスはPrisma ORMの`count`だけを使う。`$queryRaw`、SQL file、write API、fixture作成、transaction内writeを禁止する。
- 複数tableの判定は同じPrisma transaction snapshotで行い、途中状態を混在させない。snapshot確立またはtransactionが失敗した場合は`unknown`とする。
- provider/GitHub APIはGETだけを許可し、POST・PUT・PATCH・DELETE、deploy CLI、`wrangler deploy`、`vercel deploy`を禁止する。
- workflowはproduction stateの読み取りだけを行う。GitHub Step Summaryと安全なmarker Artifactへの証拠書き込みだけを例外として許可し、production providerを変更しない。
- raw password、hash、email、username、User ID、IP、token、Cookie、Authorization、DB URL、Secret、project/account/resource ID、deployment URL、providerのraw response/errorをstdout、stderr、Step Summary、Artifact、PR本文へ出さない。
- 件数そのものは出力しない。各確認は`clear` / `present` / `unknown`だけを記録する。`present`でも対象table名を越える詳細を表示しない。
- CLIはprovider responseをそのまま例外causeやconsoleへ渡さず、安全な日本語の一般化messageへ変換する。
- `set -x`、HTTP verbose/debug、trace、screenshot、provider response Artifact、shell引数へのSecret展開を禁止する。
- 全pageを走査できない、API schemaが変わった、rate limit、timeout、401/403/404の意味を安全に確定できない、対象account/project/script/repositoryを照合できない場合は`unknown`とする。
- 404を自動的に「配備なし」と扱わない。Cloudflareはaccount全体のscript一覧から期待名の不存在を確認できた場合だけ`clear`とし、認可不足と不存在を区別する。Vercelも承認済みscope全体を走査できた場合だけ`clear`とする。
- GitHub Actions Artifact一覧だけで「過去backupなし」を判定しない。全workflow run/job stepも走査し、成功済みbackup stepが1件でもあれば、当時の空DB証拠が別にない限り`present`とする。
- providerから削除されたdeployment履歴、expired後に削除されたrun、手元や外部storageへ保存されたbackup copyはAPIだけでは不存在を証明できない。承認者が確認文言で明示attestationできない場合は、実行前ならdispatchせず判定上`unknown`のPath Bを記録し、誤dispatch後ならsafe markerのstatusを`unknown`とする。
- DB・Vercel・Cloudflare・GitHubを単一transactionにできないため、M1開始からreview完了までproduction deploy、DB write、backup、cleanup、provider設定変更を凍結する。凍結をattestationできない場合はdispatchせず判定上`unknown`のPath Bを記録し、実行中の変更を検出した場合は証拠を`unknown`として無効化する。
- M1証拠はworkflow実行時点のsnapshotであり、以後のproduction変更を承認しない。production state、provider scope、対象識別子、証拠CLI、workflow SHAが変わった場合はM1を再実行する。
- M1成功後もM4の新鮮な暗号化backup、M5の値非表示preflight、M6のproduction smokeを省略しない。

## 対象ファイル一覧

### 計画PR

| ファイル                                              | 変更種別 | 内容                                        |
| ----------------------------------------------------- | -------- | ------------------------------------------- |
| `docs/plans/m1-production-read-only-evidence/plan.md` | 新規     | M1実行基盤、TDD、承認、証拠、Path分岐の正本 |
| `docs/05_progress.md`                                 | 修正     | M1を実装中にし、本計画へのリンクを追加      |

### 実装PR

| ファイル                                                          | 変更種別 | 内容                                                            |
| ----------------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| `backend/src/lib/supabase-database-target.ts`                     | 新規     | environment別Supabase接続先の共通値非表示validator              |
| `backend/src/lib/supabase-database-target.test.ts`                | 新規     | staging/production、URL境界、Secret非出力test                   |
| `backend/src/lib/staging-database-target.ts`                      | 修正     | 共通validatorを利用する既存互換wrapperへ整理                    |
| `backend/src/jobs/stagingSyntheticAdminE2eFixtures.test.ts`       | 修正     | Supabase project refの既存fixtureを実契約へ同期                 |
| `backend/src/jobs/productionInitialStateEvidence.ts`              | 新規     | check status、Path判定、安全な証拠形式の純粋ロジック            |
| `backend/src/jobs/productionInitialStateEvidence.test.ts`         | 新規     | `clear` / `present` / `unknown`と非出力契約のunit test          |
| `backend/src/jobs/inspectProductionInitialState.ts`               | 新規     | Prisma集計とVercel/Cloudflare/GitHub read clientの調停          |
| `backend/src/jobs/inspectProductionInitialState.test.ts`          | 新規     | DB・provider・pagination・errorのunit test                      |
| `backend/src/jobs/inspectProductionInitialState.cli.ts`           | 新規     | 環境変数、attestation、reviewed SHAを検証して安全な結果を出力   |
| `backend/src/jobs/inspectProductionInitialState.cli.test.ts`      | 新規     | CLIのfail-closed、終了code、stdout/stderr非漏えいtest           |
| `backend/src/jobs/productionInitialStateEvidenceWorkflow.test.ts` | 新規     | workflowのmanual-only・production承認・GET-only source contract |
| `backend/package.json`                                            | 修正     | M1専用CLI scriptを追加                                          |
| `.github/workflows/production-initial-state-evidence.yml`         | 新規     | 承認付きmanual-only production read-only workflow               |
| `docs/11_deployment.md`                                           | 修正     | M1の準備、dispatch、証拠確認、失効、停止runbook                 |
| `docs/05_progress.md`                                             | 修正     | 実装・実行状態とM1結果を同期                                    |
| `docs/plans/portfolio-release-v0-1-minimal/plan.md`               | 修正     | M1実行記録とM2への進行可否を同期                                |
| `docs/plans/r6-account-deletion-gates/plan.md`                    | 修正     | R13 run URL、Path A/B、対象外項目、再着手条件を記録             |
| `docs/plans/m1-production-read-only-evidence/plan.md`             | 修正     | task完了、実変更file、実装・実行記録を同期                      |

実装時に上表と実際の変更が異なる場合は、実装完了前に表を実態へ合わせる。

## Environment・credential契約

実装時に最終名をsource contractで固定し、同じ値を複数名へ複製しない。identifierも証拠へ出さないためSecretとして扱う。

| key                               | GitHub Environment | 種別          | 用途                                       |
| --------------------------------- | ------------------ | ------------- | ------------------------------------------ |
| `BATCH_ENVIRONMENT`               | production         | Variable      | exact `production` marker                  |
| `DATABASE_URL`                    | production         | Secret        | Prisma read-only集計先                     |
| `PRODUCTION_SUPABASE_PROJECT_REF` | production         | Secret        | DB URLのproject完全一致検証                |
| `M1_VERCEL_ACCESS_TOKEN`          | production         | Secret        | Vercel deployment GET                      |
| `M1_VERCEL_SCOPE_ID`              | production         | Secret        | 承認済みteam/account scope照合             |
| `M1_VERCEL_REPOSITORY`            | production         | Secret        | Gensoko repository完全一致                 |
| `M1_CLOUDFLARE_API_TOKEN`         | production         | Secret        | `Workers Scripts Read` GET                 |
| `M1_CLOUDFLARE_ACCOUNT_ID`        | production         | Secret        | 承認済みaccount scope照合                  |
| `M1_CLOUDFLARE_WORKER_NAME`       | production         | Secret        | 期待production Worker完全一致              |
| `GITHUB_TOKEN`                    | workflow自動       | runtime token | repository Actions/deployment metadata GET |

- tokenは対象scopeで利用可能な最小権限にする。Cloudflareは`Workers Scripts Read`を必須とし、Global API Keyを禁止する。
- Vercel credentialの権限をprovider側でread-onlyへ限定できない場合でも、workflow実装はGET-onlyとし、専用・短命credentialを優先する。scopeまたはcredential管理方針を承認できなければPath Bとする。
- Secretはjob-level env、CLI引数、`GITHUB_OUTPUT`、summary、Artifactへ渡さず、inspection stepのprocess envだけへ渡す。
- `M1_VERCEL_REPOSITORY`はprovider metadataの完全一致に使い、response側repository情報が欠落・曖昧なら`unknown`とする。
- Environment設定の作成・変更はproduction外部状態の変更であるため、実装PRへ含めずM1P-15直前の別承認で行う。

## DB確認仕様

### 0件を要求する対象

| check key             | Prisma model / 条件      | 判定理由                                 |
| --------------------- | ------------------------ | ---------------------------------------- |
| `allUsers`            | `User`全件               | active、suspended、legacyを含む全User    |
| `legacyUsers`         | `User.deletedAt != null` | 旧soft delete rowを明示確認              |
| `refreshTokens`       | `RefreshToken`全件       | 認証credentialの残存確認                 |
| `emailVerifications`  | `EmailVerification`全件  | 確認tokenの残存確認                      |
| `passwordResetTokens` | `PasswordResetToken`全件 | reset tokenの残存確認                    |
| `weakElements`        | `WeakElement`全件        | User所有学習data                         |
| `gameSessions`        | `GameSession`全件        | User所有学習data                         |
| `gameAnswers`         | `GameAnswer`全件         | session経由のUser関連data                |
| `gameQuestionSets`    | `GameQuestionSet`全件    | User所有一時data                         |
| `userStats`           | `UserStats`全件          | User所有統計data                         |
| `auditLogs`           | `AuditLog`全件           | 旧利用・操作・User識別子を保持し得る履歴 |

`Element`とPrisma migration metadataは個人dataではないため0件を要求しない。schema追加でUser所有modelまたはUser identityを保持するmodelが増えた場合、source contract testを失敗させて確認対象の更新を必須にする。

### 集計と出力

- `Prisma.TransactionClient`を受け取る集計関数へqueryを集約し、同じ正規化・判定をCLIとtestで再利用する。
- transactionのisolation levelを明示し、全countが正常終了した場合だけDB checkを確定する。
- 内部countは比較後に破棄し、公開result、console、error、Artifactへ含めない。
- 全対象が0件ならDB groupは`clear`、1件以上なら`present`、query/target検証失敗なら`unknown`とする。
- `allUsers=0`だけで関連rowを推測せず、各modelを個別にcountする。

## provider・backup確認仕様

### Vercel

- 承認済みteam/account scopeのdeployment一覧を全page取得し、Gensoko frontendのproduction targetだけを判定する。
- Preview、staging、別repository、別projectは旧production配備へ数えないが、scopeの完全一致を証明できない場合は`unknown`とする。
- production deploymentが1件でもあれば`present`。0件を全pageで確認できた場合だけ`clear`。
- deployment URL、creator、project/team ID、commit author等は読み取っても出力しない。

### Cloudflare

- `Workers Scripts Read`だけを持つtokenで承認済みaccountのscript一覧を取得し、期待production Worker名を照合する。
- scriptが存在する場合はdeployment一覧を取得し、1件でもあれば`present`。
- account-wide script一覧の完全取得で期待名がない場合だけ`clear`。個別endpointの404単独では`unknown`。
- version ID、deployment ID、author email、route、account IDは出力しない。

### GitHub deployments・backup

- `GITHUB_TOKEN`は`actions: read`、`contents: read`、必要な場合だけ`deployments: read`とする。write permissionを付けない。
- production Environmentのdeployment履歴を補助証拠として全page確認する。provider側履歴の代替にはしない。
- repository Artifact一覧を全page確認し、`production-db-backup-` prefixの現存・expired metadataを検出する。
- `Production Database Operations`の全runとjob stepを全page確認し、`Create and verify encrypted logical backup`または同じ契約名のbackup step成功を検出する。
- 過去backup成功が1件でもあり、そのrunより前または同一snapshotの空DB証拠がない場合は`present`。
- run/artifactが削除されている可能性と外部copyはowner attestationで補完し、attestation不能ならdispatchせず判定上`unknown`のPath Bを記録する。

## workflow仕様

### dispatch入力

| input                       | 形式           | 用途                                                                                          |
| --------------------------- | -------------- | --------------------------------------------------------------------------------------------- |
| `reviewed_sha`              | 40桁commit SHA | `develop`の実行SHAとの完全一致                                                                |
| `confirmation`              | 固定文字列     | `READ_ONLY_PRODUCTION_INITIAL_STATE`以外を拒否                                                |
| `approver`                  | 安全な識別子   | 承認記録。email等の個人値は使わない                                                           |
| `change_record`             | 安全な識別子   | 計画・issue・PRとの対応                                                                       |
| `history_attestation`       | 固定文字列     | 確認済みの場合だけ`NO_DELETED_DEPLOYMENT_OR_EXTERNAL_BACKUP_COPY`。確認不能ならdispatchしない |
| `change_freeze_attestation` | 固定文字列     | 確認済みの場合だけ`NO_CONCURRENT_PRODUCTION_CHANGE`。確認不能ならdispatchしない               |

### job境界

- triggerは`workflow_dispatch`だけとし、`push`、`pull_request`、`schedule`、`workflow_call`を持たない。
- refは`develop`だけを許可し、`reviewed_sha == github.sha`をcheckout前に検証する。
- jobは`environment: production`、`group: gensoko-batch-jobs`、`cancel-in-progress: false`を使う。
- provider credential、DB URL、project/account identifierはjob-level envへ置かず、検査stepのprocess envだけへ渡す。
- checkout後に`npm ci`、Prisma Client生成、M1 CLIを実行する。migration、seed、backup、cleanup commandは呼ばない。
- M1 CLIは安全なJSON markerをrunner tempへ書き、Step Summaryにはrun SHA、実行日時、check status、Path A/B候補、再確認条件だけを記録する。
- markerはstatus keyだけをallowlist再構成してから短期Artifactへ保存する。raw provider response、count、identifier、Secretは保存しない。
- `present`または`unknown`でも安全なsummary/markerを`always()`で残し、最後に非0終了してM1未完了を明示する。
- required attestationを確認できなければrunを作成しない。不一致値を含む誤dispatchはcheckout前に失敗させ、全項目`unknown`のsafe markerとPath Bだけを`always()`で残す。
- workflowの成功だけでM1完了にしない。security/release reviewerがsummary、Environment approval、Artifact allowlist、run URLを確認し、docsへ記録して初めてM1完了とする。

## 証拠形式

```typescript
export type M1CheckStatus = "clear" | "present" | "unknown";

export type ProductionInitialStateEvidence = Readonly<{
  schemaVersion: 1;
  databaseTarget: M1CheckStatus;
  allUsers: M1CheckStatus;
  legacyUsers: M1CheckStatus;
  userRelatedRows: M1CheckStatus;
  auditLogs: M1CheckStatus;
  vercelProductionDeployments: M1CheckStatus;
  cloudflareProductionDeployments: M1CheckStatus;
  githubProductionDeployments: M1CheckStatus;
  productionBackupHistory: M1CheckStatus;
  deletedHistoryAndExternalCopyAttestation: M1CheckStatus;
  productionChangeFreezeAttestation: M1CheckStatus;
}>;

export type M1Path = "path-a" | "path-b";

export function determineM1Path(
  evidence: ProductionInitialStateEvidence,
): M1Path;
```

- `path-a`は全keyが`clear`の場合だけ返す。
- `present`と`unknown`は理由を問わず`path-b`へ倒す。
- safe markerへは上記status、schema version、reviewed SHA、run timestampだけを含める。count、provider object、identifierは型に追加しない。

## 公開インターフェース案

実装コードではなく、実装時に固定する責務とシグネチャ案を示す。

```typescript
export type SupabaseDatabaseTarget = Readonly<{
  environmentName: "staging" | "production";
  batchEnvironment: string | undefined;
  projectRef: string | undefined;
  databaseUrl: string | undefined;
}>;

export function validateSupabaseDatabaseTarget(
  target: SupabaseDatabaseTarget,
): void;

export type ProductionInitialStateDependencies = Readonly<{
  prisma: PrismaClient;
  fetch: typeof globalThis.fetch;
}>;

export type ProductionInitialStateConfig = Readonly<{
  batchEnvironment: string;
  databaseUrl: string;
  productionSupabaseProjectRef: string;
  githubRepository: string;
  githubToken: string;
  vercelAccessToken: string;
  vercelScopeId: string;
  vercelRepository: string;
  cloudflareApiToken: string;
  cloudflareAccountId: string;
  cloudflareWorkerName: string;
  reviewedSha: string;
  historyAttestation: "NO_DELETED_DEPLOYMENT_OR_EXTERNAL_BACKUP_COPY";
  changeFreezeAttestation: "NO_CONCURRENT_PRODUCTION_CHANGE";
}>;

export type SafeProductionInitialStateMarker = Readonly<{
  schemaVersion: 1;
  reviewedSha: string;
  executedAt: string;
  evidence: ProductionInitialStateEvidence;
  decision: M1Path;
}>;

export async function inspectProductionInitialState(
  dependencies: ProductionInitialStateDependencies,
  config: ProductionInitialStateConfig,
): Promise<ProductionInitialStateEvidence>;

export function toSafeProductionInitialStateMarker(
  evidence: ProductionInitialStateEvidence,
  reviewedSha: string,
  executedAt: Date,
): SafeProductionInitialStateMarker;
```

- external clientは`fetch`を注入し、unit testでnetworkへ接続しない。
- Prisma依存も注入し、unit testでproduction/staging/local DBへ接続しない。
- configとexternal responseはZod schemaで検証し、正規化済み値を全処理で再利用する。

## タスクリスト（3回レビュー）

### v1: 初版

- DBの全User・legacy・所有rowをPrismaで集計するCLIとmanual production workflowを追加する。
- Vercel、Cloudflare、GitHubの旧deploymentとbackup Artifactをread-only APIで確認する。
- safe summary、marker Artifact、run URLを証拠として記録する。

### v2: セキュリティ・失敗時レビュー

- Artifact一覧だけでは削除済みbackupを検出できないため、workflow run/job step履歴とowner attestationを追加した。
- provider 404を不存在と誤判定しないよう、account/team scopeの全一覧を基準にした。
- count、PII、Secret、resource ID、raw response/errorを型・stdout・Artifactから排除した。
- `present`だけでなく認可不足、pagination不完了、schema変更、timeoutを`unknown`としてPath Bへ倒した。
- external requestをGET-onlyにし、production stateへのwrite経路をsource contractで禁止した。

### v3: 既存実装・DB整合レビュー

- legacy Userだけでなく全Userと全User所有modelを個別countする。
- User削除後も残る`AuditLog`を追加し、`Element`は非個人masterとして除外した。
- production接続先検証をstaging validatorと共通化し、重複実装を避けた。
- 既存`production-database.yml`へoperationを追加せず、schedule誤到達を構造的に避ける専用workflowへ分離した。
- `gensoko-batch-jobs` concurrencyとproduction Environment approvalは既存契約を再利用する。

### v4: 実行可能性・証拠レビュー（確定）

- 実装merge前のproduction実行を禁止し、review済み`develop` SHAだけを許可した。
- machine evidenceで証明できない削除済み履歴・外部copyは明示attestationがなければ`unknown`とした。
- workflow成功とM1完了を分離し、reviewer確認とdocs記録を完了条件にした。
- M1成功後のstate変更で証拠が失効する条件と、M4〜M6を省略しない境界を明記した。
- 複数system間のTOCTOUを見落とさないよう、M1実行中のproduction変更凍結attestationを追加した。

### 確定タスク

| タスクID | 内容                                                      | ファイル                                         | 優先度 | Phase     |
| -------- | --------------------------------------------------------- | ------------------------------------------------ | ------ | --------- |
| M1P-01   | workflow/source contract testを先に追加してRed確認        | `productionInitialStateEvidenceWorkflow.test.ts` | 高     | Red       |
| M1P-02   | Supabase接続先validatorを共通化してtest追加               | `supabase-database-target.ts`ほか                | 高     | Red/Green |
| M1P-03   | status・Path判定・safe markerの純粋ロジックをTDD実装      | `productionInitialStateEvidence.ts`ほか          | 高     | Red/Green |
| M1P-04   | 全User・legacy・関連row・AuditLogのPrisma集計をTDD実装    | `inspectProductionInitialState.ts`ほか           | 高     | Red/Green |
| M1P-05   | Vercel production履歴の全page read clientをTDD実装        | `inspectProductionInitialState.ts`ほか           | 高     | Red/Green |
| M1P-06   | Cloudflare script/deployment履歴のread clientをTDD実装    | `inspectProductionInitialState.ts`ほか           | 高     | Red/Green |
| M1P-07   | GitHub deployment・Artifact・run/job履歴照合をTDD実装     | `inspectProductionInitialState.ts`ほか           | 高     | Red/Green |
| M1P-08   | config、attestation、safe output、終了codeをCLIへ実装     | `inspectProductionInitialState.cli.ts`ほか       | 高     | Red/Green |
| M1P-09   | M1専用npm scriptを追加                                    | `backend/package.json`                           | 中     | Green     |
| M1P-10   | manual-only production workflowを実装                     | `production-initial-state-evidence.yml`          | 高     | Green     |
| M1P-11   | 秘密非出力・GET-only・pagination・未知responseを再テスト  | 対象test一式                                     | 高     | Refactor  |
| M1P-12   | M1 runbookと各計画の実装状態を同期                        | `docs/`                                          | 高     | Docs      |
| M1P-13   | backend最終品質gateとworkflow/Markdown formatを実行       | `backend/`・`.github/`・`docs/`                  | 高     | Quality   |
| M1P-14   | 厳格review、develop向けPR作成を完了                       | GitHub                                           | 高     | Review    |
| M1P-15   | Environment/Secret準備を別承認し、review済みSHAでdispatch | GitHub production Environment                    | 高     | Execute   |
| M1P-16   | 証拠review、docs記録、Path A/B決定、M1状態更新            | `docs/`                                          | 高     | Evidence  |

- [x] M1P-01: workflow/source contract testを追加し、未実装理由でRedを確認する
- [x] M1P-02: Supabase接続先validatorを共通化する
- [x] M1P-03: status・Path判定・safe markerをTDD実装する
- [x] M1P-04: production DB初回状態のPrisma集計をTDD実装する
- [x] M1P-05: Vercel production履歴確認をTDD実装する
- [x] M1P-06: Cloudflare Worker deployment履歴確認をTDD実装する
- [x] M1P-07: GitHub deployment・backup履歴確認をTDD実装する
- [x] M1P-08: CLI config・attestation・safe outputをTDD実装する
- [x] M1P-09: M1専用npm scriptを追加する
- [x] M1P-10: 承認付きmanual-only workflowを実装する
- [x] M1P-11: 秘密非出力・GET-only・fail-closedを再レビューする
- [x] M1P-12: runbookと関連計画を同期する
- [x] M1P-13: 最終品質gateを通過する
- [x] M1P-14: 実装PRを厳格reviewして`develop`向けに作成する（mergeは行わない）
- [ ] M1P-15: 別承認後にproduction read-only workflowを実行する
- [ ] M1P-16: 証拠を記録し、Path A/BとM1完了可否を確定する

### タブ区切り

```tsv
タスクID	タスク内容	ファイル	優先度
M1P-01	workflow/source contract testのRed	backend/src/jobs/productionInitialStateEvidenceWorkflow.test.ts	高
M1P-02	Supabase接続先validator共通化	backend/src/lib/supabase-database-target.ts	高
M1P-03	status・Path判定・safe marker実装	backend/src/jobs/productionInitialStateEvidence.ts	高
M1P-04	production DB初回状態Prisma集計	backend/src/jobs/inspectProductionInitialState.ts	高
M1P-05	Vercel production履歴確認	backend/src/jobs/inspectProductionInitialState.ts	高
M1P-06	Cloudflare deployment履歴確認	backend/src/jobs/inspectProductionInitialState.ts	高
M1P-07	GitHub deployment・backup履歴確認	backend/src/jobs/inspectProductionInitialState.ts	高
M1P-08	CLI config・attestation・safe output	backend/src/jobs/inspectProductionInitialState.cli.ts	高
M1P-09	M1専用npm script追加	backend/package.json	中
M1P-10	manual-only production workflow実装	.github/workflows/production-initial-state-evidence.yml	高
M1P-11	秘密非出力・GET-only・fail-closed再review	backend/src/jobs/*.test.ts	高
M1P-12	runbook・関連計画同期	docs/	高
M1P-13	最終品質gate	backend・.github・docs	高
M1P-14	実装PR review・develop向け作成	GitHub	高
M1P-15	別承認production dispatch	GitHub production Environment	高
M1P-16	証拠記録・Path確定	docs/	高
```

## TDD実装順

### Red

1. 専用workflowが存在しない、またはmanual-only・production Environment・develop SHA・read-only権限・GET-onlyを満たさないため失敗するsource contract testを追加する。
2. 全DB model、全provider page、GitHub run/job履歴、attestationをfixture化し、`clear` / `present` / `unknown`の期待を先に記述する。
3. stdout/stderr/markerへcount、Secret fixture、resource ID、raw errorが出た場合に失敗するtestを追加する。
4. production/staging接続、外部HTTP、GitHub Actions dispatchを行わずRed理由を確認する。

### Green

1. 共通Supabase target validatorと既存staging wrapper互換を実装する。
2. 純粋なstatus・Path判定・safe markerを実装する。
3. injected Prisma/fetch依存でDB・provider inspectorを実装する。
4. CLIのZod config、固定確認文言、attestation、safe output、exit codeを実装する。
5. manual-only workflowとnpm scriptを追加する。

### Refactor

1. providerごとのpagination、timeout、Zod parse、error一般化を共通helperへまとめる。
2. 同じ正規表現、status集約、safe marker allowlist、Supabase URL検証を重複させない。
3. 対象testと直接影響する既存workflow/staging target testを実行する。
4. Prettierを適用し、source contractがformat後も成立することを確認する。

## 実装品質gate

Red/Green中は対象testだけを実行し、最終文書同期後に次を原則1回実行する。

```bash
cd backend
npm run test -- --run
npm run test:workers
npm run build
npm run workers:build
npm run lint
npm run format:check
npx prisma validate

npx prettier --check \
  ../.github/workflows/production-initial-state-evidence.yml \
  ../docs/05_progress.md \
  ../docs/11_deployment.md \
  ../docs/plans/portfolio-release-v0-1-minimal/plan.md \
  ../docs/plans/r6-account-deletion-gates/plan.md \
  ../docs/plans/m1-production-read-only-evidence/plan.md

cd ..
git diff --check
```

DB schema/migrationは変更しないため、`prisma migrate deploy`とPlaywrightは本実装PRの品質gateに含めない。実装中にschema/migration変更が必要になった場合は作業を停止し、計画変更と別承認を行う。

## production実行手順

### 実行前

1. 実装PRが`develop`へmerge済みで、review済みSHAが固定されていることを確認する。
2. production Environmentのrequired reviewer、対象repository、branch policy、concurrencyを値非表示で確認する。
3. DB/project/provider scope、read-only credential、GitHub permissions、外部backup copy attestation、実行中のproduction変更凍結の対象と限界を提示し、別承認を得る。
4. Secret/Variableの新規登録・変更が必要な場合は、workflow dispatchとは別の外部変更として承認を得る。
5. credentialがread契約を満たさない、対象scopeが不明、owner attestation不能ならworkflowをdispatchせずPath Bを記録する。placeholderや不一致値でrunを意図的に作成しない。

### 実行

1. 両attestationが成立している場合だけ`develop`のreview済みSHAを選び、固定確認文言・approver・change record・history attestation・change freeze attestationを入力する。
2. production Environment approval画面で対象SHA、workflow名、read-only scope、実行者を再確認して承認する。
3. workflowはprovider履歴を確認し、最後に同一snapshot内のDB countを実行する。write commandは実行しない。
4. `present` / `unknown`でもsummaryとsafe markerを残した後に失敗させる。

### 実行後

1. run URL、review済みSHA、実行日時、Environment approval、各status、attestation、safe marker allowlistをsecurity/release reviewerが確認する。
2. raw logやprovider dashboardをdocsへ転載しない。resource IDや個人値が露出した場合はM1証拠を無効とし、Artifact/logの安全な処理を別承認で行う。
3. 全項目`clear`ならPath A、1項目でも`present` / `unknown`ならPath Bを記録する。
4. Path AではM1を`[x]`にし、M2へ進む。Path BではM1を完了にせず、通常gateの再開taskを明示する。
5. 実行後にproduction stateまたは証拠実装が変わった場合、古いrunを再利用せずM1を再実行する。

## 証拠記録テンプレート

```markdown
### M1 production初回状態read-only証拠

- reviewed SHA: `<SHA>`
- workflow run: `<URL>`
- executed at: `YYYY-MM-DDTHH:mm:ss.sssZ`
- approval: production Environment review済み
- database target: clear / present / unknown
- all User: clear / present / unknown
- legacy User: clear / present / unknown
- User関連row: clear / present / unknown
- AuditLog: clear / present / unknown
- Vercel production deployment: clear / present / unknown
- Cloudflare production deployment: clear / present / unknown
- GitHub production deployment: clear / present / unknown
- production backup history: clear / present / unknown
- deleted history / external copy attestation: clear / present / unknown
- production change freeze attestation: clear / present / unknown
- decision: Path A / Path B
- evidence invalidation condition: production state・scope・workflow SHA変更時は再実行
- follow-up: M2へ進行 / 通常gateへ復帰
```

count、email、username、User ID、project/account/resource ID、deployment URL、Artifact ID、Secret値、provider raw responseは記録しない。

## 停止・復旧方針

- workflow準備中にwrite permission、write endpoint、deploy command、migration、backup、cleanupを検出した場合はmergeしない。
- production target不一致、branch/SHA不一致、Secret不足、provider scope不明、pagination不完了、API error、Zod parse failure、DB query failureはすべて`unknown`で停止する。
- nonzeroを検出してもcleanup・削除・Artifact削除・deployment削除を続けて実行しない。M1は観測だけで終了する。
- workflow timeout/cancel時は証拠を不完全としてPath Bへ倒し、同じrunを成功扱いにしない。再実行には改めてproduction Environment approvalを要求する。
- SecretやPIIがlog/Artifactへ露出した可能性がある場合は、値を会話やPRへ転載せず、credential rotation、Artifact/log処理、incident記録を別承認で行う。
- Path B選択後は、R6/R7/R9/R13〜R16の通常gateを再開し、簡略化のためにdataや履歴を削除しない。

## テストケース一覧

| ケース                                                         | 期待結果                                                          |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| 全DB対象0、全provider履歴なし、backup履歴なし、attestation成立 | 全status `clear`、Path A候補、workflow成功                        |
| Userが1件以上                                                  | `allUsers=present`、count非表示、Path B、workflow失敗             |
| legacy Userが1件以上                                           | `legacyUsers=present`、ID非表示、Path B                           |
| User所有tableのいずれかが1件以上                               | `userRelatedRows=present`、table別count非表示、Path B             |
| AuditLogが1件以上                                              | `auditLogs=present`、actor/target非表示、Path B                   |
| Elementだけ存在                                                | DB個人data checksは`clear`                                        |
| production DB target不一致                                     | `databaseTarget=unknown`、query前停止                             |
| DB query/transaction失敗                                       | `databaseTarget`を含むDB group `unknown`、raw error非表示、Path B |
| Vercel Previewだけ存在                                         | production deployment checkは`clear`                              |
| Vercel production deploymentあり                               | `present`、URL/ID/author非表示、Path B                            |
| Cloudflare期待scriptなしをaccount全一覧で確認                  | `clear`                                                           |
| Cloudflare個別API 404だけ                                      | `unknown`、不存在扱いにしない                                     |
| Cloudflare deploymentあり                                      | `present`、version/deployment ID非表示、Path B                    |
| GitHub Artifactが現存またはexpired                             | backup history `present`                                          |
| Artifact削除済みだが過去backup step成功                        | backup history `present`                                          |
| owner attestation未確認・未入力                                | required inputを埋めずdispatchしない、Path Bを記録                |
| owner attestation不一致の誤dispatch                            | checkout前に停止、全status `unknown`、Path B                      |
| production変更凍結attestation未確認                            | required inputを埋めずdispatchしない、Path Bを記録                |
| production変更凍結attestation不一致の誤dispatch                | checkout前に停止、全status `unknown`、Path B                      |
| M1実行中にproduction変更を検出                                 | 証拠無効、Path B、変更内容を値非表示で別review                    |
| pagination途中で429/timeout/schema不一致                       | 対象check `unknown`、部分結果を`clear`にしない                    |
| provider raw errorにSecret/ID fixtureを含む                    | stdout/stderr/markerへ出力されない                                |
| workflowをschedule/push/PRで起動しようとする                   | triggerが存在せず起動不可                                         |
| feature branchまたはreviewed SHA不一致                         | checkout/DB/API前に失敗                                           |
| workflow sourceにwrite endpoint/command追加                    | source contract test失敗                                          |
| M1成功後にproduction state・scope・SHA変更                     | 既存証拠を失効し再実行                                            |

## 実装完了

- 完了日: 2026-07-27
- 実装ブランチ: `feature/m1-production-read-only-evidence`
- PR: [#155](https://github.com/RitukoIsibasi0222/gensoko/pull/155)（`develop`向け・未merge）

### 計画からの変更点

- ユーザーの明示条件に従い、M1P-14はPR作成までとし、mergeを本作業の範囲から除外した。merge済みであることはM1P-15の別承認実行前提として維持する。
- safe marker再構成でouter/evidenceのexact key、reviewed SHA完全一致、statusからのdecision再計算を追加し、未検証inputはsummaryへ出さない形に強化した。
- Vercel paginationのpage count不一致とpage上限を`unknown`へ倒す契約を追加した。
- 共通Supabase validatorで顕在化した既存staging synthetic E2E testのproject ref fixtureを、小文字英数字の実契約へ同期した。
- PR review [#4785098125](https://github.com/RitukoIsibasi0222/gensoko/pull/155#pullrequestreview-4785098125)で検出されたfallback markerの秒精度timestampを、通常markerと同じミリ秒付きUTC形式へ修正し、source contractで固定した。
- PR review [#4785241679](https://github.com/RitukoIsibasi0222/gensoko/pull/155#pullrequestreview-4785241679)を受け、attestation不能時はplaceholderで誤dispatchせずPath Bを記録する境界、誤dispatch時だけ全項目`unknown`のfallbackを残す境界、証拠日時のミリ秒形式をworkflow・runbook・親計画・R6計画・source contractで同期した。
- PR review [#4785483509](https://github.com/RitukoIsibasi0222/gensoko/pull/155#pullrequestreview-4785483509)で検出されたDB query/transaction失敗時の`databaseTarget=clear`を、DB evidenceが全項目確定した場合だけ`clear`とするfail-closed判定へ修正した。
- schema/migrationは変更していないため、`prisma migrate deploy`とPlaywrightは計画どおり実行していない。

### 実際の変更ファイル

| ファイル                                                          | 変更種別 | 内容                                               |
| ----------------------------------------------------------------- | -------- | -------------------------------------------------- |
| `backend/package.json`                                            | 修正     | M1専用CLI scriptを追加                             |
| `backend/src/lib/supabase-database-target.ts`                     | 新規     | environment別Supabase接続先validator               |
| `backend/src/lib/supabase-database-target.test.ts`                | 新規     | URL境界・環境分離・秘密非出力test                  |
| `backend/src/lib/staging-database-target.ts`                      | 修正     | 共通validatorを利用するwrapperへ整理               |
| `backend/src/jobs/stagingSyntheticAdminE2eFixtures.test.ts`       | 修正     | 既存project ref fixtureを実契約へ同期              |
| `backend/src/jobs/productionInitialStateEvidence.ts`              | 新規     | status・Path・safe markerの純粋ロジック            |
| `backend/src/jobs/productionInitialStateEvidence.test.ts`         | 新規     | status・Path・marker allowlist test                |
| `backend/src/jobs/inspectProductionInitialState.ts`               | 新規     | Prisma集計とprovider/backup GET client             |
| `backend/src/jobs/inspectProductionInitialState.test.ts`          | 新規     | DB・provider・pagination・fail-closed test         |
| `backend/src/jobs/inspectProductionInitialState.cli.ts`           | 新規     | config・safe output・marker・終了code              |
| `backend/src/jobs/inspectProductionInitialState.cli.test.ts`      | 新規     | CLI正常系・異常系・秘密非出力test                  |
| `backend/src/jobs/productionInitialStateEvidenceWorkflow.test.ts` | 新規     | manual-only・GET-only・safe marker source contract |
| `.github/workflows/production-initial-state-evidence.yml`         | 新規     | production承認付きmanual-only read-only workflow   |
| `docs/05_progress.md`                                             | 修正     | 実装PRとproduction未実施状態を同期                 |
| `docs/11_deployment.md`                                           | 修正     | M1準備・dispatch・判定・失効・停止runbook          |
| `docs/plans/portfolio-release-v0-1-minimal/plan.md`               | 修正     | M1実装基盤と別承認境界を同期                       |
| `docs/plans/r6-account-deletion-gates/plan.md`                    | 修正     | R13 run/Path未確定と再着手条件を同期               |
| `docs/plans/m1-production-read-only-evidence/plan.md`             | 修正     | task、実変更、TDD、review、品質gate、PR記録を同期  |

### TDD・厳格review・品質gate記録

- Red: workflow未実装、marker exact allowlist欠落、reviewed SHA再照合欠落、Vercel page count不一致をそれぞれ意図した理由で失敗確認した。
- Green/Refactor: 対象7 test fileと既存staging互換test 71件を通過し、共通GET/pagination/validator、safe marker再構成へ整理した。
- 厳格review: 秘密非出力、GET-only、Prisma count-only、pagination完全性、404/429/timeout/schema不一致の`unknown`化、TOCTOU変更凍結を再確認した。
- PR review対応: fallback `executedAt`の形式不一致をRed確認後に修正し、marker・CLI・workflow直接関連test 17件とGNU `date`出力形式を確認した。
- PR review対応（#4785241679）: attestation不能時のno-dispatch契約と証拠日時形式の不整合をsource contract 1件のRedで確認後に修正し、対象7件・直接関連18件をGreen確認した。親計画・R6計画を含む横断監査でno-run Path Bを同期した。
- PR review対応（#4785483509）: DB transaction失敗時に`databaseTarget`だけ`clear`となる回帰test 1件をRed確認後、DB evidence完了判定を追加して対象32件・直接関連50件をGreen確認した。
- backend test: 1,216件成功、外部DB前提10件skip
- Workers runtime test: 32件成功
- build、Workers build/dry-run、lint、format、Prisma validate、workflow/Markdown Prettier、`git diff --check`: すべて成功
- production DB接続、provider API request、workflow dispatch、Environment/Secret/Variable変更、backup、migration、cleanup、deploy、smoke: すべて未実施
- M1P-15〜M1P-16、M1証拠review、Path A/B確定: 別承認のため未実施

## 完了条件

### 実行基盤

- M1P-01〜M1P-14が完了し、実装PRが`develop`向けに作成されている。本作業ではmergeしない。
- manual-only、production Environment approval、develop/review済みSHA固定、GET-only、Prisma read-only、safe evidence、fail-closedがtestで固定されている。
- backend品質gate、workflow/Markdown Prettier、`git diff --check`が成功している。
- production DB query、provider API request、workflow dispatch、Environment/Secret変更を実装PRでは実行していない。
- 実装PRのmergeはM1P-15の実行前提として別途reviewし、本作業の権限では行わない。

### M1

- M1P-15〜M1P-16を別承認で完了している。
- 全checkが`clear`で、security/release reviewerがrunとsafe markerを確認している場合だけM1を完了している。
- `present` / `unknown`がある場合はM1を未完了のままPath Bとし、通常gateの再開先を記録している。
- `docs/05_progress.md`、親release計画、R6計画、本計画のstatus・run URL・Path・再着手条件が一致している。
