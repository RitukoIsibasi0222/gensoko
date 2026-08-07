# main merge後のproduction承認付き自動デプロイ 実装計画

> 設計者ロール: シニアDevOps / セキュリティエンジニア
> 対応Issue: [#174 通常リリースをmain merge後の承認付き自動デプロイへ簡略化する](https://github.com/RitukoIsibasi0222/gensoko/issues/174)
> 前提Issue: [#173 developマージ後に固定ステージングURLを自動更新する](https://github.com/RitukoIsibasi0222/gensoko/issues/173)

## 概要

`develop`から`main`へのreview済みPRを人間がmergeした後、GitHub Actionsが確定した`main` SHAを入力なしで取得し、Secret非参照のbranch・event・SHA・品質gate、production Environment承認、pending migration gateを順に通す。合格した同じSHAだけをproduction API、API health、production frontend、read-only smokeへ順序固定し、安全な固定statusだけを証拠へ残す。

production frontendのdeploy所有権はGitHub Actionsへ一本化する。Vercel Git Integrationによる`main`自動deployは停止し、API・health成功前にfrontendが公開される二重deployを作らない。現在同一Vercel project内にあるstaging Previewとproduction deploymentは、production専用projectへ分離してから自動releaseを有効化する。repository実装と外部設定移行・実deploymentは別工程・別承認にする。

## 現状確認（2026-08-06）

- `develop` HEADは`5408d35716a653b481b3756bbf31863edabfdae6`で、Issue #173完了記録PR #201を含む。
- staging frontend自動更新run 31092740154はexact Preview、develop先端、固定domain、immutable asset fingerprint、marker確認に成功している。
- M5・M6とproduction初回公開は完了している。
- `main` mergeではVercel Git IntegrationがProduction deploymentを作成するが、production APIは自動deployされない。
- GitHub `production` Environmentはrequired reviewer 1名と`main`限定deployment branch policyを維持している。
- production用Cloudflare Workerとstaging Workerは別resourceであり、production config builderは接続resourceの不一致をfail-closedで検証する。
- GitHub `staging` EnvironmentのVercel Secretはproduction Environmentに存在せず、production自動deploy credentialは未登録である。
- 現在のVercelはstaging Preview branch domainとproduction custom domainが同一project配下にある。Issue #174のresource・deploy先分離を満たすにはproduction専用projectへの外部移行が必要である。
- `Production Database Operations`はrequired reviewer付きの`production` Environmentで`migrate-deploy`をmanual-only実行できる。通常release workflowからmigrationは適用しない。

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`.github/workflows/backend-pr-quality.yml`**

- `develop` / `main`向けPRのbackend test、Workers test/build、lint、format、Prisma validateを実行する。

**`.github/workflows/frontend-pr-quality.yml`**

- `develop` / `main`向けPRのaudit、test、lint、Svelte check、format、Preview build contractを実行する。

**`.github/workflows/repository-integrity.yml`**

- `develop` / `main`向けPRでrepository境界testを実行する。

**`.github/workflows/production-database.yml`**

- validation jobは`permissions: {}`、Environmentなし、Secret参照なしでevent・branch・operationを分類する。
- protected jobはrequired reviewer付きproduction Environmentで`migrate-deploy`を実行する。
- migration適用にはreview済みmain SHAと新鮮な暗号化backup証拠を要求する。

**`.github/workflows/staging-release-candidate-campaign.yml`**

- API deploy → deployment SHA確認 → health → frontend deploy → campaignの既存順序を持つ。
- staging専用Wrangler設定、Secret、URL、resource、concurrencyを使用する。
- productionへtargetやSecretを流用せず、順序・一時log削除・固定errorのパターンだけを参考にする。

**`.github/actions/vercel-preview-domain/action.yml`**

- staging project限定tokenでPreviewのSHA・ref・target・READYと固定domain contentをread-only検証する。
- production project・production targetには流用せず、純粋なcontent fingerprint処理だけを共通化候補とする。

**`backend/src/lib/production-worker-config.ts`**

- `buildProductionWorkerConfigFromEnvironment(environment, stagingHyperdriveId)` — production専用Worker名、custom hostname、same-site frontend、production接続resource、staging非共有を検証して一時Wrangler設定を生成する。

**`backend/src/scripts/runProductionWranglerDryRun.cli.ts`**

- production一時Wrangler設定をmode `0600`で生成し、dry-run後に必ず削除する。

**`backend/src/jobs/stagingReleaseCandidateHealth.ts`**

- staging固定URLに対してhealth body、CORS、security headerをread-only検証する。
- HTTP検証の純粋処理は再利用候補だが、production URL契約はproduction専用moduleで固定する。

**`frontend/scripts/verify-staging-frontend-content.mjs`**

- candidateと固定staging domainの200、同一origin、HTML、marker、SvelteKit immutable asset集合一致をGETだけで検証する。
- asset抽出・比較だけを共通helperへ切り出し、staging / productionのURL allowlistは別wrapperで維持する。

**`frontend/scripts/vercel-ignore-build.mjs`**

- 現在は`main`を常にbuildし、`develop`はfrontend差分がある場合だけbuildする。
- production所有権移行時に`main`のGit Integration buildをskipへ変更する。

### 重要な制約

- production deployは確定した最新`main` SHAだけを許可する。SHA、target、environmentを手入力させない。
- mainへの自動merge、required reviewer削除、developからproductionへの直接deployを行わない。
- validationはEnvironmentなし、production Secret参照なし、fail-closedで行う。
- production Environmentへ到達する前にevent、branch、40文字SHA、live `main`先端一致、backend/frontend品質gateを完了する。
- production Environment内でもDB接続前・各provider mutation前にlive `main`先端が同じSHAか再確認する。
- pending migrationがある場合はAPI deploy前に停止し、`Production Database Operations`の承認付き`migrate-deploy`へ案内する。通常releaseから`prisma migrate deploy`を実行しない。
- migration後の再開はSHA入力を持たない`workflow_dispatch`を`main`から実行するか、同じrunのfailed jobs再実行を使う。どちらもlive `main`先端完全一致を再検証する。
- API deployまたはhealthが失敗した場合、frontend build/deployを実行しない。
- Vercel Git IntegrationとGitHub Actionsの二重production deployを作らない。
- staging / productionでGitHub Environment、Secretのscope・値、Vercel project、Worker、接続resource、URL、concurrency group、deployment targetを分離する。deploy credentialはproduction専用名にする。
- Secret値、token、DB URL、内部resource ID、固有deployment URL、provider raw response、stack traceをlog、Summary、Artifactへ出さない。
- provider commandのstdout/stderrは`RUNNER_TEMP`へ閉じ、成功・失敗の両方で削除する。`cat`やshell traceで表示しない。
- production DB rollbackの自動化、migrationの自動適用、provider設定の無承認変更は対象外とする。
- migration状態の判定に失敗した場合はdeployせず`unknown`として停止する。
- docsだけの`main` mergeではproduction deploy workflowを起動しない。

## production frontend deploy所有権

### 決定

production frontendの唯一のdeploy所有者をGitHub Actionsにする。

### 根拠

Vercel Git Integrationを所有者のままにすると、`main` merge直後にVercelがAPI gateと並行してProduction deploymentを開始する。GitHub Actionsから後でexact SHAを確認しても、API deploy・healthより前のfrontend公開を取り消せず、「APIまたはhealth失敗時はfrontendをdeployしない」を満たせない。

GitHub ActionsがAPI・health成功後にVercel CLIでproduction build / deployを行えば、1回のproduction Environment承認内で順序を固定できる。Git Integrationはstaging Preview専用projectに残し、production専用projectはGitHub Actionsからだけdeployする。

Vercel Hobbyのproduction専用projectではStandard Protectionによりproduction custom domain以外のdeployment URLが認証保護される。候補deployをpromote前に検証するため、production project限定のProtection Bypass for Automationを作成し、同じ値をproduction Environmentの`PRODUCTION_VERCEL_AUTOMATION_BYPASS_SECRET`へ登録する。verifierは空・空白入りのbypass Secretをfetch前に拒否し、値をlog・evidenceへ出さずcandidate requestの`x-vercel-protection-bypass` headerだけへ渡す。custom domain requestにはSecret headerを送らない。

### 二重deploy防止

1. repositoryのIgnored Build StepをTDDで変更し、既存staging projectの`main` Git buildをskipする。
2. production専用Vercel projectを作成し、Git接続によるProduction deployを無効にするか接続しない。
3. production custom domainとproduction環境変数を専用projectへ移す。
4. production GitHub Environmentの専用token / project情報 / automation bypassだけでCLI deploy・候補検証する。
5. 移行後に同じmain SHAでGit Integration由来の二重Production deploymentがないことをread-only確認する。

外部設定1〜4はrepository実装・review・merge後、対象、影響、費用、rollbackを提示した別承認で実行する。

## 目標フロー

```text
developで確認
→ developからmainへPR
→ Backend / Frontend PR Quality + Repository Integrity
→ 人間がreviewしてmainへmerge
→ push(main)からgithub.shaを自動取得
→ permissions:{} / Environmentなし / Secretなしでevent・branch・SHA・live mainを検証
→ exact SHAのbackend / frontend品質gate
→ production Environment required reviewer承認
→ live main SHAを再確認
→ production DB target・migration statusをread-only検証
→ pending / unknownなら停止して承認付きDB workflowへ案内
→ production API deploy
→ Cloudflare deployment metadataのexact SHAを検証
→ API health / CORS / security header確認
→ production frontend build / staged deploy（custom domain未反映）
→ Vercel metadataのexact SHA・ref=main・target=production・READYを検証
→ candidateのimmutable asset・markerをread-only検証
→ 検証済みcandidateだけをproductionへpromote
→ production custom domainが対象buildを参照するまでbounded poll
→ frontend / APIのread-only smoke
→ safe Summary + 最小JSON Artifact
```

## workflow契約

| 項目              | 契約                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------- |
| 自動event         | `push`、branchは`main`、deploy対象pathだけ                                                |
| 再開event         | 入力なし`workflow_dispatch`。選択refとlive headが`main`完全一致の場合だけ                 |
| 禁止event         | `pull_request`、`schedule`、`workflow_run`、`repository_dispatch`                         |
| validation        | `permissions: {}`、Environmentなし、Secretなし、provider/DB accessなし                    |
| quality           | validation成功後、exact SHAをcheckoutし、共有quality actionでbackend/frontendを並列実行   |
| approval          | quality 2 job成功後の単一production release jobに`environment: production`を設定          |
| concurrency       | `gensoko-production-release`、`cancel-in-progress: false`。staging groupと共有しない      |
| SHA               | `github.sha`を40文字lowercaseで検証し、live `refs/heads/main`と完全一致。手入力禁止       |
| migration         | DB target確認後にread-only status。`current`以外はdeploy禁止                              |
| API               | production一時Wrangler config、production専用credential、message metadataにexact SHA      |
| health            | API deploy・exact SHA確認成功後だけ。GET、有限timeout、body/CORS/header契約               |
| frontend          | health成功後だけ。`--prod --skip-domain`でstaged deployし、検証済みcandidateだけをpromote |
| frontend metadata | exact SHA、ref=`main`、target=`production`、state=`READY`、project境界を完全一致          |
| smoke             | custom domainとcandidateのimmutable asset集合・marker、API healthをGETだけで確認          |
| evidence          | SHA、run ID、固定status、UTC時刻だけ。URL・ID・raw responseなし                           |
| artifact          | schema固定JSON 1件、短期retention。source、provider log、HTML、response bodyは保存しない  |

## same SHA保証

1. workflowにはreviewed SHA入力を作らず、`push(main)`の`github.sha`を対象にする。
2. manual再開は入力なしとし、dispatch refが`main`でlive headと一致する場合だけ許可する。
3. validation jobでevent、`github.ref`、`github.ref_name`、SHA形式、live main先端を検証する。
4. quality jobとproduction jobは`ref: expected_sha`をcheckoutし、checkout後の`git rev-parse HEAD`を完全一致確認する。
5. Environment承認待ちの間にmainが進んだ場合を除外するため、production job開始時と各provider mutation直前にlive main先端を再確認する。
6. Cloudflare deploy message / deployment metadataとVercel metadataへ同じSHAを記録し、完全一致を検証する。
7. frontend buildは同じcheckoutから作成し、production API URL contractをbuild outputで検証する。
8. evidence generatorはworkflow SHA、Cloudflare確認SHA、Vercel確認SHAの一致がないとArtifactを生成しない。

## Environment承認とSecret境界

### validation・quality jobs

- Environmentを設定しない。
- production / staging Secretを参照しない。
- validation jobは`permissions: {}`とし、checkout、npm、provider CLI、DB接続も行わない。
- quality jobsは`contents: read`だけを持ち、`persist-credentials: false`でexact SHAをcheckoutする。

### production release job

- `environment: production`とし、既存required reviewer・main限定policyを維持する。
- Secretは使用stepの`env`だけへ渡し、job全体へ設定しない。
- `PRODUCTION_CLOUDFLARE_API_TOKEN`、`PRODUCTION_CLOUDFLARE_ACCOUNT_ID`、`PRODUCTION_VERCEL_TOKEN`、`PRODUCTION_VERCEL_ORG_ID`、`PRODUCTION_VERCEL_PROJECT_ID`、`PRODUCTION_VERCEL_AUTOMATION_BYPASS_SECRET`を別承認で追加する。既存M1証拠収集用・staging用credentialは使わない。
- 既存production VariablesのWorker名、API hostname、frontend origin、registrable domain、接続resource参照を値非表示で検証する。
- `DATABASE_URL`はproduction Environment内の既存production値だけをmigration gateへ渡す。

## migration gate

Prisma CLIのstdout/stderrを一時fileへ閉じ、固定allowlistの3分類だけを返す。

```typescript
type ProductionMigrationGateStatus = "current" | "pending" | "unknown";
```

- `current`: exit code 0かつcurrent markerを確認できた場合だけ。
- `pending`: exit code 1かつPrisma v7のpending markerを厳密に確認できた場合。
- `unknown`: 接続失敗、timeout、想定外exit、marker不一致、parse不能のすべて。

`pending`と`unknown`はどちらもAPI deploy前にfailureで停止する。`pending`だけは、同じmain SHAを対象に`Production Database Operations`のbackup条件と`migrate-deploy`を使用する案内を固定文言で出す。migration名、DB target値、DB URL、raw outputは出さない。

### migration適用後の再開

1. ownerが既存production DB workflowのrunbookに従い、必要なbackupと`migrate-deploy`を別承認で完了する。
2. mainが進んでいないことを確認する。
3. 元のfailed runを再実行するか、入力なし`workflow_dispatch`を`main`から開始する。
4. workflowはevent・branch・live main・品質・production approval・migration currentをすべて再評価する。

DB workflow成功を理由に自動連鎖deployはしない。DB変更承認とapplication deploy承認を分け、誤ったmigration run・古いSHAからの自動再開を防ぐ。

## rollback・復旧判断

自動rollbackは行わない。Cloudflare/Vercelの直前正常deployment履歴を維持し、障害箇所と互換性を人間が確認してから別承認でprovider rollbackまたはfix-forwardを選ぶ。DB rollbackは常に対象外である。

| 失敗箇所                                       | 自動停止           | production状態            | 判断・復旧                                                              |
| ---------------------------------------------- | ------------------ | ------------------------- | ----------------------------------------------------------------------- |
| validation / quality                           | provider前で停止   | 変更なし                  | code修正または最新mainで再実行                                          |
| migration pending / unknown                    | API前で停止        | 変更なし                  | pendingは承認付きDB workflow、unknownは原因解消まで停止                 |
| API deploy command                             | frontend禁止       | 旧API維持または状態不明   | deployment履歴を値非表示確認。状態不明なら再deployしない                |
| API metadata不一致                             | frontend禁止       | 新APIの可能性あり         | trafficを増やさず、互換version rollbackかfix-forwardを別承認            |
| API health失敗                                 | frontend禁止       | 新API・旧frontend         | API rollbackまたはfix-forward後にhealthを再確認                         |
| frontend build/staged deploy/candidate検証失敗 | public promote禁止 | 新API・旧frontend         | APIの後方互換性を確認し、必要ならAPI rollback。Vercel再deployは新承認   |
| frontend promote/domain timeout                | smoke failure      | 新API、frontend参照先不明 | domain/deployment履歴を確認し、旧frontend維持を確認するまで再実行しない |
| read-only smoke失敗                            | release failure    | 新API・新frontendの可能性 | frontendを先に旧正常版へ戻す判断後、必要ならAPIも互換版へ戻す           |

rollback時もproviderの内部version ID、raw response、SecretをIssue、Summary、Artifactへ転記しない。

## safe evidence

```typescript
type ProductionReleaseStatus =
  | "VALIDATION_CLEAR"
  | "BACKEND_QUALITY_CLEAR"
  | "FRONTEND_QUALITY_CLEAR"
  | "MIGRATION_CURRENT"
  | "API_DEPLOYED"
  | "API_HEALTH_CLEAR"
  | "FRONTEND_DEPLOYED"
  | "SMOKE_CLEAR";
```

- Summaryには対象SHA、run ID、run attempt、固定statusだけを記録する。
- Artifactはschema version、SHA、event、固定status配列、UTC timestampだけを含む。
- exact key、型、status順序、40文字SHA、UTC millisecond timestampをgeneratorとtestで検証する。
- URL、hostname、project/resource/deployment ID、provider response、DB情報、入力値を含めない。
- `if: always()`で作成するが、schema検証に失敗したArtifactはuploadしない。
- retentionは運用証拠に必要な最短期間へ固定し、backup Artifactと混ぜない。

## 既存workflow・手順の整理

| 既存経路                                 | Issue #174後の扱い                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Backend / Frontend PR Quality            | develop/main PRのreview前gateとして維持。共有composite actionへ抽出しmain exact SHA gateでも再利用       |
| Repository Integrity                     | develop/main PRで維持。production workflow source contract testをbackend全testにも含める                 |
| staging frontend自動更新 #173            | develop Preview専用として維持。Environment、Secret、project、domain、concurrencyを変更しない             |
| M2 staging campaign                      | auth/API/DB/provider設定を伴う高リスク変更の手動総合試験として維持                                       |
| Production Database Operations           | backup、migration、seed、DB operationの唯一の承認付き経路として維持                                      |
| M1 / M1R                                 | 初回状態・高リスク判断の履歴。通常releaseごとには再実行しない                                            |
| M3                                       | 初回公開用名称は通常手順から外し、同等のexact SHA品質gateを自動workflowへ統合                            |
| M5                                       | 初回provider/resource作成・手動deployを通常手順から外す。production設定変更時だけ高リスクpreflightへ戻る |
| M6                                       | 初回synthetic登録〜本人退会は通常releaseから外す。通常はread-only smokeだけ                              |
| Production Auth / Account Deletion Smoke | destructive・synthetic確認が必要な高リスク変更時だけ別承認                                               |
| Vercel Git Integration production        | 無効化し、GitHub Actionsへ所有権移行。staging Previewでは維持                                            |

## 外部設定移行

repository実装PRのmerge前には変更しない。実行直前にplan・quota・対象・影響・費用・rollbackを再確認し、ownerの明示承認後に1操作ずつ進める。

### Vercel

1. production専用projectを作成し、root directory・framework・Node.js・production環境変数を既存production contractへ合わせる。
2. Git IntegrationによるProduction deployを無効にし、GitHub Actions CLIだけをdeploy所有者にする。
3. production専用・最小権限tokenを作成し、production GitHub Environmentへ値非表示で登録する。
4. custom domainを付ける前に、現在のreview済み`main` SHAを`--prod --skip-domain`でproduction専用projectへ一度だけbaseline deployし、exact SHA・production API build contract・candidate smokeを確認する。
5. custom domainを既存混在projectからproduction専用projectへ移し、baseline candidateとimmutable asset集合が一致することを確認する。
6. production projectのbuild outputがproduction API URLだけを参照することを確認する。
7. staging projectのPreview branch domain、staging token、develop設定が変わっていないことを確認する。

baseline deployとcustom domain切替は一回限りの外部production変更であり、実行直前の明示承認なしに行わない。影響はcustom domain切替時の短時間の参照先変更と、初回production project buildによるHobby quota消費である。追加費用は実行時の現行planで再確認する。rollbackはcustom domainを直前正常deploymentが残る旧projectへ戻し、production workflowを無効化する。Git Integrationを再有効化する場合も別承認とする。

### Cloudflare

1. production Workerだけをdeployできる最小権限tokenを作成する。
2. production GitHub Environmentへ専用credentialを値非表示で登録する。
3. Worker名、custom domain、接続resource、Durable Object bindingがstagingと異なることをread-only再確認する。
4. 自動workflowの初回run前に直前正常deploymentの存在を確認する。

既存Worker、custom domain、DO、接続resourceは作り直さない。費用は実行時のWorkers planとquotaで再確認する。rollbackは直前互換versionへ手動で戻すが、自動workflowからは実行しない。

### GitHub production Environment

1. required reviewer 1名と`main`限定branch policyを維持する。
2. staging Secretをcopyせず、production専用credentialを新規登録する。
3. production/staging concurrencyが異なることをworkflow source contractで確認する。
4. Secret名の存在だけを確認し、値を読み戻さない。

## 対象ファイル一覧

| ファイル                                                     | 変更種別 | 内容                                                            |
| ------------------------------------------------------------ | -------- | --------------------------------------------------------------- |
| `.github/workflows/production-deploy.yml`                    | 新規     | main exact SHAのvalidation、quality、承認付きproduction release |
| `.github/actions/backend-quality/action.yml`                 | 新規     | backend PR/main exact SHA品質gateの共通action                   |
| `.github/actions/frontend-quality/action.yml`                | 新規     | frontend PR/main exact SHA品質gateの共通action                  |
| `.github/actions/validate-live-main/action.yml`              | 新規     | protected jobのprovider mutation前live main検証を共通化         |
| `.github/workflows/backend-pr-quality.yml`                   | 修正     | 共通action利用とproduction workflow/action差分のpaths追加       |
| `.github/workflows/frontend-pr-quality.yml`                  | 修正     | 共通action利用とproduction workflow/action差分のpaths追加       |
| `.github/workflows/repository-integrity.yml`                 | 修正     | production workflow・helperのsource contract testを追加         |
| `backend/package.json`                                       | 修正     | production migration/deploy/health/evidence用script追加         |
| `backend/src/jobs/backendPrQualityWorkflow.test.ts`          | 修正     | backend共有quality action利用のsource contractを同期            |
| `backend/src/lib/production-worker-deployment.ts`            | 新規     | production Worker deploy・exact SHA metadata・固定error処理     |
| `backend/src/lib/production-worker-deployment.test.ts`       | 新規     | config cleanup、target分離、raw非出力、exact SHA test           |
| `backend/src/scripts/runProductionWorkerDeployment.cli.ts`   | 新規     | 固定statusだけを出すproduction Worker deploy CLI                |
| `backend/src/jobs/productionMigrationGate.ts`                | 新規     | Prisma statusをcurrent/pending/unknownへ固定分類                |
| `backend/src/jobs/productionMigrationGate.test.ts`           | 新規     | Prisma v7 status分類、timeout、raw非出力test                    |
| `backend/src/jobs/productionMigrationGate.cli.ts`            | 新規     | production migration read-only gate CLI                         |
| `backend/src/jobs/productionReleaseHealth.ts`                | 新規     | production API health・CORS・header契約                         |
| `backend/src/jobs/productionReleaseHealth.test.ts`           | 新規     | 正常・timeout・redirect・body/header異常test                    |
| `backend/src/jobs/productionReleaseHealth.cli.ts`            | 新規     | 固定statusだけを出すhealth CLI                                  |
| `backend/src/jobs/productionReleaseEvidence.ts`              | 新規     | safe evidence exact schema生成                                  |
| `backend/src/jobs/productionReleaseEvidence.test.ts`         | 新規     | SHA/status/schema/禁止値contract test                           |
| `backend/src/jobs/productionReleaseEvidence.cli.ts`          | 新規     | success/failureのcanonical status prefix Artifact生成CLI        |
| `backend/src/jobs/productionDeploymentWorkflow.test.ts`      | 新規     | trigger、permission、Environment、順序、Secret、分離test        |
| `frontend/scripts/frontend-content-verifier.mjs`             | 新規     | immutable asset fingerprint・markerの純粋共通helper             |
| `frontend/scripts/verify-staging-frontend-content.mjs`       | 修正     | staging URL allowlist wrapperとして共通helperを利用             |
| `frontend/scripts/verify-production-frontend-content.mjs`    | 新規     | production candidate/custom domainのread-only verifier          |
| `backend/src/jobs/stagingFrontendContentVerifier.test.ts`    | 修正     | 共通化後もstaging contractを維持する回帰test                    |
| `backend/src/jobs/productionFrontendContentVerifier.test.ts` | 新規     | production URL分離、asset、marker、redirect、非HTML test        |
| `frontend/scripts/vercel-ignore-build.mjs`                   | 修正     | `main` Git Integration buildをskipし、develop契約を維持         |
| `frontend/src/vercel-ignore-build.test.ts`                   | 修正     | main skip、develop差分、判定不能境界test                        |
| `frontend/src/frontend-pr-quality.test.ts`                   | 修正     | frontend共有quality action利用のsource contractを同期           |
| `docs/05_progress.md`                                        | 修正     | Issue #174の進捗・完了証拠を同期                                |
| `docs/11_deployment.md`                                      | 修正     | 通常/high-risk release、migration、rollback、外部移行runbook    |
| `docs/plans/production-auto-deploy/plan.md`                  | 修正     | 実装判断、task、実変更ファイル、完了記録を同期                  |

実装中に共通helperの責務が変わった場合は、対象ファイル表を実態へ合わせて更新する。provider設定値や内部IDをrepositoryへ追加しない。

## 公開インターフェース案

```typescript
export type ProductionMigrationGateStatus = "current" | "pending" | "unknown";

export function classifyProductionMigrationStatus(
  input: Readonly<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>,
): ProductionMigrationGateStatus;

export async function validateProductionReleaseHealth(
  input: Readonly<{
    apiBaseUrl: string;
    frontendOrigin: string;
    fetchImpl?: typeof fetch;
    requestTimeoutMs?: number;
  }>,
): Promise<Readonly<{ status: "clear" }>>;

export type ProductionReleaseEvidence = Readonly<{
  schemaVersion: 1;
  sha: string;
  event: "push" | "workflow_dispatch";
  runId: string;
  runAttempt: number;
  statuses: readonly ProductionReleaseStatus[];
  createdAt: string;
}>;
```

```javascript
export async function verifyFrontendContent(options) {}
export async function verifyStagingFrontendContent(options) {}
export async function verifyProductionFrontendContent(options) {}
```

共通helperはHTTP contentの純粋比較だけを担当する。staging / productionの候補URL、固定domain、target、projectは各wrapperとworkflowで別々に検証する。

## TDD実装順

### Red

1. production workflow未作成で失敗するsource contract testを追加する。
2. `push(main)`・入力なしdispatch・`permissions: {}`・Environmentなしvalidation・production単一approvalを要求する。
3. branch/event/SHA/live main/quality未完了からSecret参照へ到達できないtestを追加する。
4. migration current/pending/unknown分類とraw非出力testを追加する。
5. API deploy前のproduction config・staging resource不一致・exact SHA・temp cleanup testを追加する。
6. API health成功前にfrontend commandが現れる状態を失敗させる順序testを追加する。
7. production frontend verifier未作成、Git Integration main build継続、staging/production project混在を失敗させるtestを追加する。
8. evidenceへURL、token名、DB URL、resource/deployment ID、raw responseが混入すると失敗するtestを追加する。

### Green

1. backend/frontend qualityをcomposite actionへ抽出し、PR workflowとproduction exact SHA gateから利用する。
2. production workflowのvalidation・quality・Environment dependencyを実装する。
3. migration gate helper / CLIを実装し、pending/unknown時にAPI前で停止する。
4. production Worker一時config、deploy、exact SHA metadata確認、log cleanupを実装する。
5. production API health validatorを実装する。
6. frontend content verifierを純粋helperへ共通化し、staging wrapperを回帰させる。
7. production専用Vercel CLI staged deploy、exact metadata、candidate検証、promote、domain propagation、read-only smokeを実装する。
8. Vercel Ignored Build Stepのmain skipを実装する。
9. safe Summary / Artifact generatorを実装する。

### Refactor

1. timeout、retry回数、固定status、CLI version、temp cleanupを各責務の一箇所へ寄せる。
2. 同じSHA検証、URL検証、禁止値検査の重複を純粋helperへ切り出す。
3. staging / production wrapper間でSecret名・URL・target・project・concurrencyが混ざっていないことを再確認する。
4. shellの`set -euo pipefail`、trap、引用符、stdout/stderr閉鎖を再reviewする。
5. 計画書、進捗、runbook、実変更ファイルを同期する。

## タスクリストレビュー記録

### v1（初版）

- main push workflow、API deploy、health、frontend deploy、smoke、evidenceを列挙した。
- production Environment承認とpending migration停止を独立taskにした。

### v2（1回目レビュー: エラー・型・セキュリティ）

- migration適用後に同じSHAを安全に再開する入力なしdispatchとlive main再検証を追加した。
- migration statusを`current | pending | unknown`へ寄せ、parse不能をfail-openにしないよう修正した。
- Secret非参照validation、step単位Secret注入、temp log削除、safe evidence schemaを追加した。
- 現在のVercel project混在を前提差分として追加し、production専用project移行を必須化した。

### v3（2回目レビュー: 既存実装・test・DB制約）

- Backend / Frontend PR QualityとのYAML重複を避ける共有composite actionを追加した。
- staging content verifierは純粋fingerprint helperだけを共有し、URL/project/Secretを共有しない構成へ修正した。
- `Production Database Operations`を唯一のmigration適用経路として明記した。
- Cloudflare/Vercel metadataのexact SHAとmain先端再確認をprovider mutation前へ追加した。

### v4（3回目レビュー・確定）

- 自動rollbackはprovider/DB状態を誤って悪化させるため除外し、失敗箇所別の停止・手動判断表へ固定した。
- 単一production Environment approval内のstep順序と、quality jobsからprotected jobへの`needs`を採用した。
- docs-only mergeは起動対象外、main自動merge・required reviewer削除・DB rollback自動化は非目標のまま維持した。
- 外部設定移行、実deploy、release PR mergeはownerの直前承認・操作へ分離した。

## タスクリスト（進捗管理）

| タスクID | 内容                                                     | ファイル                                                | 優先度 | 備考                                         |
| -------- | -------------------------------------------------------- | ------------------------------------------------------- | ------ | -------------------------------------------- |
| PDA-01   | production workflow境界のRed contract test               | `backend/src/jobs/productionDeploymentWorkflow.test.ts` | 高     | event/branch/SHA/permission/Environment/順序 |
| PDA-02   | backend/frontend共有quality actionをTDD実装              | `.github/actions/*-quality/action.yml`、PR workflows    | 高     | main exact SHA gateと共用                    |
| PDA-03   | migration gateをTDD実装                                  | `backend/src/jobs/productionMigrationGate*`             | 高     | current/pending/unknown、raw非出力           |
| PDA-04   | production Worker deploy・exact SHA確認をTDD実装         | `backend/src/lib/production-worker-deployment*`         | 高     | temp config/log cleanup                      |
| PDA-05   | production API healthをTDD実装                           | `backend/src/jobs/productionReleaseHealth*`             | 高     | GET/CORS/header/timeout                      |
| PDA-06   | frontend content verifierを安全に共通化                  | `frontend/scripts/*frontend-content*`、関連test         | 高     | URL/project/Secretは非共通                   |
| PDA-07   | production Vercel staged deploy・promote・smokeをTDD実装 | `.github/workflows/production-deploy.yml`、verifier     | 高     | API health後だけ実行                         |
| PDA-08   | Git Integration main buildを停止                         | `frontend/scripts/vercel-ignore-build.mjs`、test        | 高     | develop Preview契約維持                      |
| PDA-09   | safe evidence generatorをTDD実装                         | `backend/src/jobs/productionReleaseEvidence*`           | 高     | exact schema、禁止値test                     |
| PDA-10   | failure/rollback/runbookを同期                           | `docs/11_deployment.md`                                 | 高     | DB rollback自動化なし                        |
| PDA-11   | 計画書・進捗を実態へ同期                                 | `docs/05_progress.md`、本計画書                         | 高     | 対象ファイル・task完了記録                   |
| PDA-12   | 最終品質gateを実行                                       | backend/frontend/workflow/config                        | 高     | test/build/Workers/lint/format/YAML/Bash     |
| PDA-13   | feature PRを作成しCopilot reviewへ対応                   | GitHub PR                                               | 高     | Codexはmergeしない                           |
| PDA-14   | production外部設定を直前承認後に分離                     | GitHub/Vercel/Cloudflare                                | 高     | 対象・影響・費用・rollback提示               |
| PDA-15   | develop→main release PRをreview・merge                   | GitHub PR                                               | 高     | ownerがmerge、main自動merge禁止              |
| PDA-16   | same main SHAのproduction runを検証                      | GitHub Actions/providers                                | 高     | API→health→frontend→smoke→evidence           |
| PDA-17   | production Worker一時configの相対path基準をTDD修正       | `backend/src/lib/production-worker-deployment*`         | 高     | configはbackend内、provider logはRUNNER_TEMP |

- [x] PDA-01: production workflow境界のRed contract test
- [x] PDA-02: backend/frontend共有quality actionをTDD実装
- [x] PDA-03: migration gateをTDD実装
- [x] PDA-04: production Worker deploy・exact SHA確認をTDD実装
- [x] PDA-05: production API healthをTDD実装
- [x] PDA-06: frontend content verifierを安全に共通化
- [x] PDA-07: production Vercel staged deploy・promote・smokeをTDD実装
- [x] PDA-08: Git Integration main buildを停止
- [x] PDA-09: safe evidence generatorをTDD実装
- [x] PDA-10: failure/rollback/runbookを同期
- [x] PDA-11: 計画書・進捗を実態へ同期
- [x] PDA-12: 最終品質gateを実行
- [x] PDA-13: feature PRを作成しCopilot reviewへ対応
- [x] PDA-14: production外部設定を直前承認後に分離
- [x] PDA-15: develop→main release PRをreview・merge
- [ ] PDA-16: same main SHAのproduction runを検証
- [x] PDA-17: production Worker一時configの相対path基準をTDD修正

## Repository実装時の計画差分

- `backend/src/lib/production-worker-config.ts`は既存のproduction専用target・resource分離検証をそのまま再利用できたため変更しなかった。deploy側の一時file・provider log・exact SHA・cleanup責務は`production-worker-deployment.ts`へ分離した。
- Environment承認待ち中のmain更新をDB/provider前で同じ実装により拒否するため、Secret非参照の`.github/actions/validate-live-main/action.yml`を追加した。validation jobはEnvironmentなし・`permissions: {}`を維持するためcheckoutせず、同じfail-closed契約をinline実行する。
- production releaseのCLI境界としてWorker deploy、health、evidenceのCLIを追加した。各CLIはraw provider/DB値を出さず固定event・status・messageだけを出す。
- PR #203のreview・develop merge後にPDA-14を開始し、production専用Vercel project、Git非接続、project限定token、Cloudflare最小権限token、production Environment deploy Secret 5件を分離した。最初のbaselineはsame `main` SHA・production target・READY・project境界まで一致したが、Vercel Hobby Standard Protectionによりcandidate contentが認証画面となったためcustom domain移管前に停止した。
- 上記実機差分により`PRODUCTION_VERCEL_AUTOMATION_BYPASS_SECRET`を公開interfaceへ追加した。follow-up PR #205ではprovider mutation前の6 credential検証とcandidate requestだけへの同一bypass利用をTDDで追加し、custom domain requestはheaderなしとした。Copilot指摘対応後のPR #205はdevelopへmerge済みである。
- 2026-08-07の別承認後、production project限定automation bypassと6件目のproduction Environment Secretを値非表示で登録した。current `main` SHA `2171cf9494d2a6d62ed3262df3c3445fd3b16e2b`のbaselineはref=`main`、target=`production`、READY、project境界、candidateの200・HTML・marker・immutable assetを満たした。
- candidate gate成功後だけproduction custom domainと既存redirectを旧staging projectからproduction専用projectへ移管した。production側のValid Configuration・Production接続、旧staging側からの分離、custom domainのheaderなし200・marker・candidateとのimmutable asset一致、production projectのGit未接続、production Environmentのrequired reviewer・main限定policy維持を確認した。DB、Cloudflare Worker、release PR、production workflowはこの工程で変更・実行していない。
- safe evidenceは成功時の8 statusだけでなく、失敗runでも達成済みstatusのcanonical prefixだけを`if: always()`で生成する。schema検証に失敗した場合はArtifactをuploadしない。
- Vercel candidateはpromote前にmarker・空でないimmutable assetを単体検証し、promote後にcandidateとcustom domainのasset集合・marker一致をbounded pollする二段階へ明確化した。
- production workflow source contractを通常backend全testだけでなくRepository Integrityにも含めるため、`.github/workflows/repository-integrity.yml`を更新した。
- exact SHA checkout後の`git rev-parse HEAD`とlive `main`先端を同じ共通actionで照合し、backend/frontend quality jobとprovider mutation前の全境界でfail-closedにした。
- Vercel CLIがrunnerへ生成するproduction project link・環境設定・build outputはrelease中だけ利用し、`if: always()`の最終stepで`.vercel`全体を削除する。
- release PR #207のowner merge SHAで起動したproduction runは、branch・SHA・quality・migration・credential gateを通過後、API deployでfail-closed停止した。API health以降、frontend、smoke、DB mutationは未実行で、Cloudflareにも新versionは作成されなかった。
- 初回実装ではproduction一時Wrangler configを`RUNNER_TEMP`へ置いたため、config内の相対`main`と`$schema`の解決基準がbackend外へずれた。PDA-17では`RUNNER_TEMP`と`workingDirectory`を分離したRed testを追加し、configだけをbackend working directory内へmode `0600`で生成・cleanupし、provider logとstateは引き続き`RUNNER_TEMP`へ隔離する形へ修正した。

### スプレッドシート貼り付け用（v4確定）

```text
タスクID	タスク内容	ファイル	優先度
PDA-01	production workflow境界のRed contract test	backend/src/jobs/productionDeploymentWorkflow.test.ts	高
PDA-02	backend/frontend共有quality actionをTDD実装	.github/actions/*-quality/action.yml、PR workflows	高
PDA-03	migration gateをTDD実装	backend/src/jobs/productionMigrationGate*	高
PDA-04	production Worker deploy・exact SHA確認をTDD実装	backend/src/lib/production-worker-deployment*	高
PDA-05	production API healthをTDD実装	backend/src/jobs/productionReleaseHealth*	高
PDA-06	frontend content verifierを安全に共通化	frontend/scripts/*frontend-content*、関連test	高
PDA-07	production Vercel staged deploy・promote・smokeをTDD実装	.github/workflows/production-deploy.yml、verifier	高
PDA-08	Git Integration main buildを停止	frontend/scripts/vercel-ignore-build.mjs、test	高
PDA-09	safe evidence generatorをTDD実装	backend/src/jobs/productionReleaseEvidence*	高
PDA-10	failure/rollback/runbookを同期	docs/11_deployment.md	高
PDA-11	計画書・進捗を実態へ同期	docs/05_progress.md、plan.md	高
PDA-12	最終品質gateを実行	backend/frontend/workflow/config	高
PDA-13	feature PRを作成しCopilot reviewへ対応	GitHub PR	高
PDA-14	production外部設定を直前承認後に分離	GitHub/Vercel/Cloudflare	高
PDA-15	develop→main release PRをreview・merge	GitHub PR	高
PDA-16	same main SHAのproduction runを検証	GitHub Actions/providers	高
PDA-17	production Worker一時configの相対path基準をTDD修正	backend/src/lib/production-worker-deployment*	高
```

## テストケース一覧

| ケース                                              | 期待結果                                            |
| --------------------------------------------------- | --------------------------------------------------- |
| push / main / live SHA一致                          | validation clear                                    |
| pushがmain以外                                      | production jobへ到達しない                          |
| workflow_dispatchをmain以外から開始                 | Secret参照前にfailure                               |
| SHA入力                                             | workflowに入力欄自体がない                          |
| Environment承認待ち中にmain先端移動                 | production mutation前にfailure                      |
| backend / frontend quality失敗                      | production Environment jobを開始しない              |
| required reviewer拒否                               | provider/DB accessなし                              |
| production DB target不一致                          | migration/API前にfailure                            |
| migration current                                   | API deployへ進む                                    |
| migration pending                                   | API前で停止し既存DB workflowを固定文言で案内        |
| migration status parse不能・timeout                 | unknownとしてAPI前で停止                            |
| Cloudflare configがstaging resourceと一致           | deploy前にfailure                                   |
| API deploy metadata SHA不一致                       | frontendを実行しない                                |
| API health timeout / 非200 / body・CORS・header異常 | frontendを実行しない                                |
| Vercel production projectがstagingと一致            | frontend deploy前にfailure                          |
| Vercel metadata ref/target/SHA/state不一致          | promoteせず旧domainを維持                           |
| candidate marker/asset欠落                          | promoteせず旧domainを維持                           |
| custom domainが旧assetを参照                        | bounded timeout後にfailure                          |
| marker/asset欠落、redirect、非HTML                  | smoke failure                                       |
| provider注入markup差                                | immutable asset集合一致なら許容                     |
| docs-only main merge                                | workflowを起動しない                                |
| concurrent release                                  | cancelせず直列化し、古いSHAはlive main再確認で停止  |
| evidence正常                                        | exact schemaの固定statusだけを保存                  |
| evidenceにURL/ID/raw response候補                   | Artifact生成を拒否                                  |
| staging回帰                                         | develop Preview・固定domain自動更新が従来どおり動く |

## 品質チェック

実装・再レビュー・文書同期後、外部設定変更やproduction deploy前に次を実行する。

```bash
cd backend
npm run test -- --run src/jobs/productionDeploymentWorkflow.test.ts src/jobs/productionMigrationGate.test.ts src/lib/production-worker-deployment.test.ts src/jobs/productionReleaseHealth.test.ts src/jobs/productionReleaseEvidence.test.ts src/jobs/productionFrontendContentVerifier.test.ts src/jobs/stagingFrontendContentVerifier.test.ts
npm run test -- --run
npm run test:workers
npm run build
npm run workers:build
# production形状の検証専用値を環境変数へ注入する。実在resource IDは使わず、providerへ接続しない
env \
  PRODUCTION_WORKER_NAME=gensoko-production-quality-gate \
  PRODUCTION_API_HOSTNAME=api.gensoko-quality-gate.dev \
  PRODUCTION_FRONTEND_ORIGIN=https://gensoko-quality-gate.dev \
  PRODUCTION_REGISTRABLE_DOMAIN=gensoko-quality-gate.dev \
  PRODUCTION_HYPERDRIVE_ID=ffffffffffffffffffffffffffffffff \
  npm run workers:production:dry-run
npm run lint
npm run format:check
npx prisma validate

cd ../frontend
npm run test:run
npm run lint
npm run check
npm run format:check
env VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=develop VITE_API_BASE_URL=https://staging-api.example.invalid/api/v1 npm run build:preview
```

追加で次を検証する。

- 変更した全YAMLをparserで読み込む。
- workflow / composite action内の全`run: |` Bash blockを`bash -n`で検証する。
- package.json、production一時Wrangler config、Vercel Build Output contractを検証する。
- `git diff --check`、対象差分、Secret/resource禁止文字列contractを確認する。
- staging / productionのEnvironment、Secret名、URL、resource、concurrency、targetが混ざっていないことをsource contractで確認する。

repository品質gateではproduction/staging provider、DB、URLへ接続せず、workflow dispatch、Environment変更、Secret追加、deployを行わない。

### Repository品質ゲート実績（2026-08-06）

- backend通常test: 137 files成功、4 files skip、1357 tests成功、10 tests skip
- backend Workers test: 4 files・32 tests成功
- backend TypeScript build、Workers typecheck/build、production Worker dry-run、ESLint、Prettier、Prisma validate成功
- frontend test: 66 files・685 tests成功
- frontend ESLint、Svelte check（error 0 / warning 0）、Prettier、Preview build output contract成功
- frontend production依存audit: moderate以上0件。既知のlow 3件は強制更新がbreaking changeになるため本Issueでは変更しない
- 変更YAML 7件をparserで検証し、埋め込みBash 30 blockを`bash -n`で検証
- `git diff --check`とproduction/staging分離source contract成功

### Vercel automation bypass修正の品質ゲート実績（2026-08-06）

- Red: workflowのprovider credential事前検証・bypass Secret伝播、およびverifierの空・空白入りbypass拒否を追加し、意図した4件のfailureを確認
- Green / Refactor: 対象2 files・10 tests成功
- backend通常test: 137 files成功、4 files skip、1359 tests成功、10 tests skip
- backend Workers test: 4 files・32 tests成功
- backend TypeScript build、Workers typecheck/build、production形状の検証専用値を使うWorker dry-run、ESLint、Prettier、Prisma validate成功
- frontend test: 66 files・685 tests成功
- frontend ESLint、Svelte check（error 0 / warning 0）、Prettier、Preview build output contract成功
- 変更YAML 1件をparserで検証し、埋め込みBash 12 blockを`bash -n`で検証
- verifierの`node --check`、`git diff --check`成功
- production Worker dry-runは必須変数なしでは意図どおりfail-closedとなり、実在値を使わないproduction形状の検証専用値を明示した再実行で成功
- Copilot reviewのSecret露出面指摘に対し、candidateだけにbypass headerを付けcustom domainには送らないRed 1件を確認後、production/staging直接影響test 2 files・7 tests成功

### Production初回run follow-up修正の品質ゲート実績（2026-08-07）

- Red: `RUNNER_TEMP`とbackend working directoryを分離したfixtureで、一時configがbackend外へ生成される意図したfailure 1件を確認
- Green: 一時configだけをbackend working directory内へ生成する最小修正後、対象2 tests成功
- Refactor: production Worker configとの直接影響test 2 files・12 tests成功
- backend通常test: 137 files成功、4 files skip、1359 tests成功、10 tests skip
- backend Workers test: 4 files・32 tests成功
- backend TypeScript build、Workers typecheck/build、実在値を使わないproduction Worker dry-run、ESLint、Prettier、Prisma validate成功
- frontend test: 66 files・685 tests成功
- frontend ESLint、Svelte check（error 0 / warning 0）、Prettier、Preview build output contract成功
- GitHub Actions / composite action YAML 22件をparserで検証し、埋め込みBash 174 blockを`bash -n`で検証
- `git diff --check`成功。provider、DB、URLへの接続、workflow dispatch、Environment・Secret変更、実deploymentは実行していない

## コミット方針

1. `test: production自動デプロイのfail-closed契約を追加`
2. `feat: production API・frontendの承認付き自動デプロイを実装`
3. `refactor: frontend content検証と品質gateを共通化`
4. `docs: production通常release runbookと進捗を同期`

実際の差分に応じて不要なcommitは作らず、testと実装を分けることで不自然になる場合はTDD記録をPR本文へ残して機能単位へまとめる。

## PR・release工程

1. 本計画PRを`docs/plan-production-auto-deploy`から`develop`へ作成する。
2. GitHub Copilot reviewを依頼し、指摘をTDD/文書へ反映して再reviewする。
3. 計画PRはownerへmergeを依頼し、Codexはmergeしない。
4. 計画merge後の最新developから`feature/production-auto-deploy`を作成する。
5. PDA-01〜PDA-13をTDD実装し、feature PRを`develop`へ作成する。
6. Copilot review対応後、ownerへfeature PRのmergeを依頼する。
7. develop merge後、外部設定PDA-14を対象・影響・費用・rollback提示と別承認で実施する。
8. `develop`から`main`へのrelease PRを作成し、品質checkと人間review後にownerがmergeする。
9. main mergeから起動したproduction runでPDA-16を検証する。
10. 失敗時は自動でmerge・DB migration・rollbackせず、本計画の停止表に従う。

## 非目標

- mainへの自動merge
- production required reviewerの削除・迂回
- develop / PR Preview / scheduleからのproduction deploy
- staging Environment、Secret、project、domain、Worker、DBの流用
- DB migrationの無条件自動適用
- production DB rollbackの自動化
- Cloudflare/Vercelの自動rollback
- M2の廃止
- M1/M6 destructive synthetic workflowの毎release実行
- BO15・scheduled batch・WAF・監視設定の変更
- provider raw responseや内部IDをrelease evidenceへ保存すること

## 参考資料

- [Issue #174](https://github.com/RitukoIsibasi0222/gensoko/issues/174)
- [Issue #173](https://github.com/RitukoIsibasi0222/gensoko/issues/173)
- [staging frontend自動更新計画](../staging-frontend-auto-deploy/plan.md)
- [デプロイrunbook](../../11_deployment.md)
- [GitHub Actions environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [GitHub Actions permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions)
- [Cloudflare Wrangler deploy](https://developers.cloudflare.com/workers/wrangler/commands/#deploy)
- [Cloudflare Workers rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/)
- [Vercel CLI deploy](https://vercel.com/docs/cli/deploy)
- [Vercel CLI staged production deployment](https://vercel.com/docs/cli/deploying-from-cli)
- [Vercel Ignored Build Step](https://vercel.com/docs/project-configuration/git-settings#ignored-build-step)
