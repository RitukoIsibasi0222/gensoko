# デプロイ・インフラ設計書

---

## 全体構成

```
┌─────────────────────────────────────────────────────┐
│                   インターネット                        │
└──────────┬────────────────────┬──────────────────────┘
           │ 画面にアクセス         │ APIにアクセス
           ▼                    ▼
  ┌─────────────────┐   ┌───────────────────────┐
  │     Vercel       │   │  Cloudflare Workers    │
  │  SvelteKit       │──▶│  Hono API (TypeScript) │
  │  （フロントエンド）│   │  （バックエンドAPI）    │
  └─────────────────┘   └──────────┬────────────┘
                                    │ SQL (Prisma)
                                    ▼
                         ┌──────────────────────┐
                         │      Supabase         │
                         │  PostgreSQL (DB)      │
                         └──────────────────────┘
```

| サービス               | 役割                   | 費用の扱い                                 |
| ---------------------- | ---------------------- | ------------------------------------------ |
| **Vercel**             | SvelteKitの画面を配信  | 無料枠候補。SD15直前に現行plan・上限を確認 |
| **Cloudflare Workers** | Hono APIサーバー       | 無料枠候補。SD13直前に現行plan・上限を確認 |
| **Supabase**           | PostgreSQLデータベース | 無料枠候補。実接続前に現行plan・容量を確認 |

料金・quota・スリープ・自動deploy条件は変更され得るため、この表を費用承認の根拠にしない。2026-07-20時点でstaging Vercel/Cloudflareは配備済みだが、追加の外部操作前には現在のplanと影響を再確認する。

---

## 各サービスの説明

### Vercel（フロントエンド）

- SvelteKit公式adapterでBuild Outputを生成できる
- project接続後はGit連携deployを構成できる
- plan・domain・build/Function利用量はSD15直前に確認する

### Cloudflare Workers（バックエンド API）

- 世界中に分散したサーバーで動く → 日本からも高速
- **スリープなし**（Renderなどの無料プランと違い、最初のアクセスでも遅くならない）
- Honoは Cloudflare Workers での動作に最適化されている

> ⚠️ **注意点**: Cloudflare Workers は Node.js の一部APIが使えません。
> Prismaは`@prisma/adapter-pg`とcache無効Hyperdriveを使い、requestごとにClientを構築します。
> 開発中は Docker 上の通常の Node.js で動かして、本番だけ Workers にデプロイします。

### Supabase（データベース）

- PostgreSQLをホストしてくれるサービス
- Web画面でDBの中身をブラウザで確認・編集できる
- 接続URLを発行してくれるので、Prismaにそのまま設定できる

---

## ドメイン設計

### 開発環境（ローカル）

| サービス            | URL                     |
| ------------------- | ----------------------- |
| SvelteKit           | `http://localhost:5174` |
| Hono API            | `http://localhost:3000` |
| DB（Prisma Studio） | `http://localhost:5555` |
| メール確認          | `http://localhost:8025` |

### 本番環境

実在hostnameはG1〜G8のowner判断とR14 preflightで確定するまで記載・推測しない。productionは次のparameter契約だけを正本とする。

| parameter          | 契約                                                              |
| ------------------ | ----------------------------------------------------------------- |
| frontend origin    | HTTPS origin、provider domain不可、path/query/hash/credentialなし |
| API base URL       | 別hostのHTTPS custom domain + `/api/v1`、`workers.dev`不可        |
| registrable domain | frontend/APIの共通site。CookieのDomain属性には設定しない          |

frontendとAPIはcross-originでもsame-siteとなる兄弟hostにする。`SameSite=Strict`を維持できないhostname案は採用せず、R5を停止して別security設計へ戻す。

---

## CORS（クロスオリジン）設定

別ドメイン間の通信を許可するため、Honoに CORS ミドルウェアを設定します。

`backend/src/app.ts`では、CORS許可originとレート制限依存をapp factoryへ注入する。

```typescript
import type { RateLimitDependencies } from "./middleware/rateLimit/store.js";

type CreateAppOptions = {
  isProduction: boolean;
  rateLimit: RateLimitDependencies;
};
```

実装の正本は `backend/src/app.ts` とし、この文書へmiddleware全体を複製しない。

`NODE_ENV=production` では `FRONTEND_URL` を必須とし、未設定・空文字ならapp構築時にエラーで停止する。HTTP(S)のorigin形式だけを許可し、path、query、hash、認証情報付きURLは拒否する。localhostへのfallbackはdevelopment/testだけで使用する。

## R5 production auth / refresh 配備契約

### コードと外部操作の境界

- `src/worker.ts`はstaging専用、`src/worker-production.ts`は`expectedTarget: "production"`専用。
- production Wrangler設定は実在値をcommitしない。`PRODUCTION_WORKER_NAME`、`PRODUCTION_API_HOSTNAME`、`PRODUCTION_FRONTEND_ORIGIN`、`PRODUCTION_REGISTRABLE_DOMAIN`、`PRODUCTION_HYPERDRIVE_ID`から一時生成し、dry-run後に削除する。
- validatorはproduction target、HTTPS/same-site URL、custom domain、`workers_dev: false`、production専用Hyperdrive、staging ID非共有を値非表示でfail-fastする。
- Durable Objectはproduction worker名でstagingとnamespaceを分離する。Secret値、DB URL、実在resource IDは文書・PR・ログへ記録しない。
- `workers:production:dry-run`はlocal bundleだけを作り、deploy/promotionを行わない。

### rollout / rollback

1. R14: G1〜G8、review済みSHA、frontend/API URL、resource存在、Environment key名、rollback先をread-only・値非表示で確認する。
2. R15: 別承認後に`CREATE INDEX CONCURRENTLY`のexpand-only migration → additive API → smoke → frontendの順で配備する。migration直後に対象indexの`indisvalid=true`を値非表示で確認する。失敗またはinvalid indexが残った場合はcleanup/API rolloutを停止し、承認付きでinvalid indexだけを`DROP INDEX CONCURRENTLY`してからmigrationを再試行する。custom domain/CORSを片側だけ切り替えない。
3. R16: manual `Production Auth Smoke`でlogin → reload 2回 → logout → refresh 401を確認する。trace/screenshot/video/storageState/Cookie一覧は保存しない。
4. rollbackはAPIを互換versionへ戻し、health/CORS/authを確認後frontendを戻す。Cookie名/Domain/Pathは変更しない。cleanup scheduleを先に停止し、indexは緊急時に無理にdropしない。

### 現在の保留

G1〜G8、R14 preflight、R15 production migration/deploy、R16 smokeは未実施である。このためR5は`[-]`のままとし、本節をproduction適用済み証拠として扱わない。

## ポートフォリオ版 v0.1 最小公開手順

現在の正本は[`portfolio-release-v0-1-minimal`](plans/portfolio-release-v0-1-minimal/plan.md)である。一般登録・認証・ゲーム・本人退会は維持し、M1R・M3・M5・M6と条件付きM4だけを初回公開のblockerとする。

1. **M1R**: M1 schema v1のPath Bを維持したまま、DB target、全User、legacy User、User関連row、AuditLogの`clear`と、ownerによる一般公開・一般登録・実利用者data保存実績なしの確認を記録する。
2. **M3**: backend/frontendの最終品質gateをrelease候補SHAで1回実行し、production依存のCritical/Highを0件にする。Moderateは到達可能性、回避策、更新期限を記録する。
3. **M4（条件付き）**: pending Prisma migrationがある場合だけ、24時間以内の暗号化済み成功Artifact 1世代とchecksumを確認し、別承認でmigrationする。対象migrationにindex作成がある場合は、成功run IDと対象SHAを固定し、対象indexの`indisvalid`・`indisready`を値非表示で確認する。migration不要なら対象外と記録する。
4. **M5**: same-site URL、Cookie、CORS、productionメール送信元、production専用Secret/binding、DB target、pending Prisma migration、review済みSHAを値非表示でpreflightし、別承認でAPI、frontendの順にdeployする。
5. **M6**: synthetic User 1件で登録・メール受信〜退会、game、refresh、通常password verifier DO、最小429、securityを確認し、同じchange内でUser所有row cleanup・flag復旧・release記録を完了する。AuditLogは365日保持方針に従う。

M1のDB 5項目またはownerの実利用者data不存在確認が不明な場合はこの最小手順を使わず、R6/R7/R9/R13〜R16の通常gateへ戻る。M2 same-SHA staging campaign、WAF、24/48時間soak、rollback baseline drill、backup 2世代目以降、restore drill、T35 legacy cleanup実演は公開後へ移す。schema v1 Artifactの再分類、schema v2 / Path C engine、古いbackup復号、過去履歴の完全分類は行わない。

pending Prisma migrationがない通常経路の追加workflow dispatchは、既存`Production Account Deletion Smoke`の`main` 1回だけとする。登録、メール認証、login、reloadによるrefresh、game、最小429は同じsynthetic Userで手動確認し、`Production Auth Smoke`を重複実行しない。承認はM5のAPI・frontend deployをまとめたrelease承認と、M6本人退会workflowのproduction Environment承認の2回とする。migrationが必要なら`migrate-deploy`を1回追加し、有効な24時間以内のbackup Artifactもなければbackup作成を1回追加する。失敗時の`recovery-only`は必要時だけ別承認で実行する。

初回productionで正本118元素が未投入の場合は、上記通常経路に承認付き`seed-elements`を1回追加する。seedはM5 deploy後かつM6のElement・game確認前に行い、直接CLI、ローカルshell、provider SQL editor、staging workflowの流用は禁止する。production Environment approvalを通すため、M5/M6の承認回数はElement seedを含む場合に3回となる。

初回productionでv2より前の互換versionがない間は、障害時にCloudflareのproduction公開routeを停止してAPI trafficを遮断し、pre-v2 rollbackを行わずfix-forwardする。未実装のapplication flagやmaintenance UIを前提にしない。v2適用後の互換versionが複数揃った後は通常のversion rollbackを利用できる。

### Production 元素seed runbook

このrunbookは、M6でElement APIが通信成功の空配列を返し、production DBに正本118元素が未投入であることをread-only確認した場合だけ使用する。workflow実装がreview済みで`main`へmergeされ、ownerが実行直前に別の明示承認を行うまでdispatchしない。

#### 実行前gate

1. `Production Database Operations`の実行元が`main`で、対象commitがreview済みrelease SHAと完全一致することを値非表示で確認する。
2. GitHub `production` Environmentがrequired reviewerと`main`限定branch policyを維持していることを確認する。
3. `BATCH_ENVIRONMENT=production`、production専用DB Secret、production project ref Secretが存在することだけを確認し、値は読み戻さない。
4. pending Prisma migrationがなく、M5のAPI・frontend healthが成功していることを確認する。
5. `gensoko-batch-jobs`で実行中・承認待ちの別runがないことを確認する。既存runをseedのためにcancelしない。
6. M6 synthetic Userと一時メールルーティングルールをcleanup前の状態で維持する。

#### 手動dispatch

1. Actionsの`Production Database Operations`を開き、`main`から`seed-elements`を選ぶ。
2. review済みSHA、固定確認文字列、承認者、change recordを入力する。DB URL、project ref、credential、resource IDは入力しない。
3. 画面の最終`Run workflow`はownerの明示承認後だけ押す。
4. production Environment approval画面でworkflow名、`main`、review済みSHA、operationが`seed-elements`であることを確認して承認する。

#### workflow内の順序

1. Environment・Secretへ到達する前に`main`を検証する。
2. manual operation、実行SHA、固定確認文字列、承認者、change recordを検証する。
3. `npm ci`後、`seed-elements`時だけPrisma Clientを生成する。生成logは一時fileへ閉じ、成功・失敗とも削除して固定文言だけを表示する。DB接続情報をstepへ渡さない。
4. production project refとSession pooler接続先を値非表示で完全検証する。
5. migrationがcurrentであることを生log非表示で確認する。
6. Elementが0件または既に正本118件のどちらかであることをtransaction内で確認する。部分件数、余分なrow、field不一致があればwrite前に停止する。
7. 118件を同一transactionで主キー`upsert`し、transaction内で件数・ID集合・全fieldの正本一致を検証する。interactive transactionはmaxWait 10秒・timeout 120秒、workflowのseed stepは3分上限とし、無制限に待機させない。
8. commit後に別process・別接続で同じ118件完全一致を再検証する。
9. Summaryにはreview・承認記録・DB target・118件検証の固定statusだけを残し、入力値やDB値を表示しない。

#### 成功・停止・再実行

- seed stepと独立verify stepが両方成功し、Summaryが固定statusだけを示す場合に限りM6を再開する。
- validation、target、migration、preflight、seed、verifyのどれかが失敗した場合は、元素一覧やgame requestを増やさずM6を停止する。
- raw logを表示・Artifact化せず、固定errorとsource testから原因を調査する。
- transaction失敗は部分投入を残さない。状態不明時は直接query・DELETE・再seedを行わず、read-only確認と新しい承認を先に行う。
- 初回runはseed stepで失敗し、Element APIの空配列からrollbackを確認した。既定5秒timeoutを根因候補として有限120秒timeout・10秒maxWait・workflow 3分上限を追加したが、review・main昇格・別承認後の2回目もDB target・migration current成功後のseed stepで即時失敗したため、timeoutを根因とする断定は撤回する。
- 同じCLIはローカルPostgreSQLの既存正本118件と新規一時空DBの両方でseed・独立verifyに成功した。production固有の既存状態不一致、transaction内検証不一致、DB transaction失敗、disconnect失敗をraw errorなしの固定allowlistで区別できる修正をreview・main昇格した。
- 上記修正後の別承認付き3回目は、main・入力・target・migration current成功後のseed stepでtransaction内4分類へ到達せず汎用fallbackへ安全停止し、独立verifyはskip、失敗後の元素一覧も空のままだった。CLI client初期化失敗を固定分類し、entrypoint開始markerの有無で起動前・起動後の予期せぬ失敗を区別する。追加修正のreview・main昇格・さらに別の明示承認が完了するまで再実行しない。
- CLI起動境界修正後の別承認付き4回目は、main・入力・target・migration current成功後のseed stepでCLI起動前カテゴリへ0秒で安全停止し、独立verifyはskip、失敗後の元素一覧も空のままだった。remote mainに最新markerが存在し、同じNode+tsx直接entrypointはローカルの到達不能接続を固定transactionカテゴリへ変換できることを確認した。production workflowでは書込前module-load probeを実行し、seed・独立verifyをnpm wrapperではなくNode+tsxで直接起動する。追加修正のreview・main昇格・さらに別の明示承認が完了するまで再実行しない。
- Node+tsx直接entrypoint修正後の別承認付き5回目は、main・入力・target・migration current成功後、書込前module-load probeで`module_load_failure`へ安全停止した。書込み用CLI本体とDB transactionには未到達で、独立verifyはskip、失敗後の元素一覧は0件のままだった。同じrunを再実行しない。
- production接続・Secretなしのclean一時環境で、実workflow相当の`npm ci`直後はPrisma Client生成物がなくmodule importが失敗し、`npx prisma generate`後は生成物が作成され同importが成功することを確認した。production workflowではseed時だけ`npm ci`後・DB target検証前にPrisma Clientを生成し、生の生成logを表示しない。追加修正のreview・develop/main再昇格・さらに別の明示承認が完了するまで再実行しない。
- 正規118件への再実行は冪等だが、成功runを理由なく再実行しない。
- workflow成功後はproduction元素一覧で118件を確認し、同じsynthetic Userでgame、ranking、rate limit、security、本人退会、cleanupへ進む。

#### M6完了記録（2026-08-06）

- Prisma Client生成修正をreview・develop/mainへ昇格した後、失敗runを再実行せず、別の明示承認による新規`seed-elements` runでseed stepと別process・別接続の独立118件verifyが成功した。production DBへの直接CLI・SQL seedは行っていない。
- 公開・認証済み元素一覧118件、game、ranking、mypage、weak、通常password verifier DO、最小429とreset、password resetを確認した。
- 本人退会workflowのmain/recoveryは固定失敗として終了し、同じrunを再実行しなかった。再認証後の通常UIで予約identityを再確認して本人退会を完了し、削除成功表示、再設定メール非発行、保護画面拒否、ランキング消失を独立確認した。
- 追加検証Userはlogin拒否と再設定メール非発行で不在を確認した。本人退会用一時Secret 2件・対象Variable・M6専用Email Routingルールを削除し、本人退会flagと`PRODUCTION_SCHEDULED_BATCH_ENABLED`は`false`、BO15は無効、active workflowは0件を維持した。
- Secret値、email、URL、resource ID、DB URL、token、内部ID、接続文字列、raw errorはrelease記録へ残していない。AuditLogは365日保持方針に従う。

## main merge後のproduction承認付き自動release

Issue [#174](https://github.com/RitukoIsibasi0222/gensoko/issues/174)の設計・実装正本は
[`production-auto-deploy`](plans/production-auto-deploy/plan.md)とする。repositoryには
`.github/workflows/production-deploy.yml`を置き、production frontendのdeploy所有権をGitHub Actionsへ一本化する。Vercel Git Integrationはstaging Preview専用projectだけに残し、production専用projectからはGit連携によるProduction deployを発生させない。

repository実装のmergeだけでは自動releaseを有効化しない。production専用Vercel project、Git Integration停止、Protection Bypass for Automation、custom domain移行、production専用credential登録、Cloudflare最小権限credential登録は、実行直前に対象・影響・費用・rollbackを提示し、ownerの明示承認後に別工程で行う。移行完了前に`develop`から`main`へのrelease PRをmergeしない。

production Environmentへ別承認で追加するdeploy専用Secret名は、`PRODUCTION_CLOUDFLARE_API_TOKEN`、`PRODUCTION_CLOUDFLARE_ACCOUNT_ID`、`PRODUCTION_VERCEL_TOKEN`、`PRODUCTION_VERCEL_ORG_ID`、`PRODUCTION_VERCEL_PROJECT_ID`、`PRODUCTION_VERCEL_AUTOMATION_BYPASS_SECRET`とする。既存のproduction Variables `PRODUCTION_WORKER_NAME`、`PRODUCTION_API_HOSTNAME`、`PRODUCTION_FRONTEND_ORIGIN`、`PRODUCTION_REGISTRABLE_DOMAIN`、`PRODUCTION_HYPERDRIVE_ID`は値を表示せず再検証する。`DATABASE_URL`と`PRODUCTION_SUPABASE_PROJECT_REF`はmigration gate専用であり、provider stepやfrontendへ渡さない。

Vercel HobbyのStandard Protectionではproduction custom domain以外のdeployment URLが認証保護される。production project限定のautomation bypassを使い、candidate単体検証とpromote後比較のcandidate requestだけへ`x-vercel-protection-bypass` headerを渡す。custom domain requestにはSecret headerを送らない。6件のprovider credentialはmigration gate後かつAPI mutation前に非空・空白なしを検証し、値をlog、summary、Artifactへ出さない。

### 外部設定実績（2026-08-07）

- ownerの別承認後にproduction専用Vercel project、Git未接続、project限定Vercel token、Cloudflare最小権限token、production Environment deploy Secret 6件を分離した。
- production project限定automation bypassを登録し、current `main` exact SHAのbaseline candidateでref=`main`、target=`production`、READY、project境界、200、HTML、marker、immutable assetを値非表示で確認した。
- candidate gate成功後だけproduction custom domainと既存redirectを旧staging projectからproduction専用projectへ移管した。production側のValid Configuration・Production接続、旧staging側からの分離、custom domainのheaderなし200・marker・candidateとのimmutable asset一致を確認した。
- production projectのGit未接続、production Environmentのrequired reviewer、main限定branch policyを移管後も維持した。DB、Cloudflare Worker、release PR、production workflowはこの工程で変更・実行していない。

### 初回production runのfail-closed記録（2026-08-07）

- release PR #207のowner merge SHAで起動したrunは、branch・SHA・backend/frontend quality・production DB target・migration current・provider credential・mutation直前live main gateを通過した。
- production Worker deployはprovider受理前に固定errorで停止し、API health以降、frontend candidate、promote、smoke、DB mutationは実行されなかった。safe evidenceには達成済みの固定statusだけを記録した。
- 原因は一時Wrangler configを`RUNNER_TEMP`へ置き、相対`main`と`$schema`の解決基準をbackend working directory外へ移したことだった。configはbackend working directory内へmode `0600`で生成・削除し、provider stdout/stderrとstateだけを`RUNNER_TEMP`へ隔離する。
- credentialとaccount targetの検証過程でも再実行はすべてAPI deployで停止し、Cloudflareに新versionは作成されなかった。追加runを重ねず、PDA-17のTDD修正・review・develop/main昇格後に再検証する。

### 2回目production runのfail-closed記録（2026-08-07）

- PR #208とdocs同期PR #210を含むrelease PR #209のowner merge SHA `27d8b3e3849c0b3eff3ded764500ba5228b3ecf2`でrun [31145881782](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/31145881782)を開始した。
- branch・SHA・backend/frontend quality・production DB target・migration current・provider credential・production API deploy・API healthは同じSHAで成功した。
- frontendは`vercel pull`によるproduction設定取得で固定error停止し、candidate build/deploy、promote、read-only smokeは未実行だった。DB mutationはなく、APIは同SHAへ更新済み、公開frontendは直前版を維持した。
- production projectはGit未接続のため、production environment scopeへPreview branch用の`--git-branch=main`を併用しない。`vercel pull --environment=production`でproject設定を取得し、exact SHAとref=`main`はdeploy時の環境変数とmetadataで固定する。修正のreview・develop/main昇格前にrunを再実行しない。

### 通常release

1. `develop`でstaging確認を完了し、`develop`から`main`へのPRを作成する。mainへの自動mergeは使わない。
2. Backend / Frontend PR QualityとRepository Integrityをexact PR SHAで通し、人間がreviewしてmergeする。
3. deploy対象pathを含む`main` pushから`github.sha`を自動取得する。docs-only mergeではworkflowを起動しない。
4. Environmentなし・Secretなし・`permissions: {}`のvalidationでevent、branch、40文字SHA、live `main`先端を完全一致確認する。
5. backend / frontend共有quality actionをexact SHAで並列実行する。どちらかが失敗した場合はproduction Environmentへ進まない。
6. required reviewer付き`production` Environmentの単一release jobを承認する。required reviewerと`main`限定branch policyは削除・迂回しない。
7. protected job開始時にlive `main`を再確認し、production DB targetを値非表示で検証する。
8. `prisma migrate status`をread-only実行し、`current`だけを許可する。`pending`または`unknown`はAPI deploy前に停止する。
9. provider mutation直前にもlive `main`を再確認し、production専用一時Wrangler configをbackend working directory内へmode `0600`で生成してAPIをdeployする。相対`main`と`$schema`の解決基準を維持し、provider出力とstateだけを`RUNNER_TEMP`へ隔離する。deployment metadataのexact SHAが一致しない場合はfrontendへ進まない。
10. API health、CORS、security headerをGETだけで確認する。失敗時はfrontend build/deployを行わない。
11. Git未接続のproduction専用Vercel projectはCI環境変数で固定し、branch scopeを付けず`vercel pull --environment=production`で設定を取得する。その後`--prod --skip-domain`で候補をdeployし、project境界、SHA、ref=`main`、target=`production`、READY、automation bypass header経由のcandidate marker・immutable assetを検証する。
12. 検証済みcandidateだけを`vercel promote`し、custom domainが同じasset集合とmarkerを参照するまで有限回pollする。
13. production frontendとAPIをread-only smokeし、SHA、run ID、run attempt、固定status、UTC時刻だけのJSON Artifactを7日保持する。

concurrencyは`gensoko-production-release`、`cancel-in-progress: false`とする。承認待ちや直列待ちの間に`main`が進んだ古いrunは、live head再確認でprovider mutation前に停止する。stagingのEnvironment、Secret、URL、project、Worker、DB、concurrencyは共有しない。

### pending migrationがあるrelease

通常release workflowからmigrationを適用しない。`pending`の場合は次の順序で再開する。

1. deploy runをAPI前のfailureで終了させる。同じrunでmigrationへ進めない。
2. `Production Database Operations`のrunbookに従い、必要な24時間以内の暗号化backup証拠を確認し、別のproduction承認で`migrate-deploy`を実行する。
3. migration名、DB URL、接続先、provider raw responseをIssue、Summary、Artifactへ残さない。
4. `main`が同じSHAのままであることを確認し、元runのfailed job再実行、または入力なし`workflow_dispatch`を`main`から実行する。
5. validation、quality、production approval、DB target、migration current、live mainをすべて再評価する。DB workflow成功からdeployを自動連鎖させない。

`unknown`は接続失敗、timeout、marker不一致、parse不能を含む。原因を安全に解消して`current`を確認できるまでdeployを再開しない。

### failure・rollback判断

自動rollbackは行わない。DB rollbackは常に対象外とし、Cloudflare / Vercelも直前正常deploymentと互換性を人間が確認してから、別承認でrollbackまたはfix-forwardを選ぶ。

| 失敗箇所                            | 自動停止        | 判断・復旧                                                                   |
| ----------------------------------- | --------------- | ---------------------------------------------------------------------------- |
| validation / quality / approval拒否 | provider・DB前  | codeまたは設定を修正し、最新mainで最初から再評価                             |
| migration `pending` / `unknown`     | API前           | pendingは承認付きDB workflow、unknownは原因解消まで停止                      |
| API deploy / metadata / health      | frontend禁止    | deployment履歴を値非表示確認し、互換APIへの手動rollbackかfix-forwardを別承認 |
| frontend build / candidate検証      | promote禁止     | 旧frontendを維持し、API後方互換性を確認してから次の判断                      |
| promote / domain poll               | release failure | 参照先を値非表示確認し、再実行を重ねず旧frontend維持可否を確定               |
| read-only smoke                     | release failure | frontendを先に旧正常版へ戻す判断後、必要な場合だけ互換APIを判断              |

token、Secret、DB URL、内部resource/deployment/project ID、固有deployment URL、provider raw response、stack traceをlog、Summary、Artifactへ出さない。一時provider outputは`RUNNER_TEMP`へmode `0600`で閉じ、成功・失敗とも削除する。

## staging frontend/API配備runbook

### コード基盤の現在地点

2026-08-06時点で、staging API/frontendは配備・基本smoke済みであり、PR #125 merge後のSD16 synthetic Admin Playwrightも成功した。production baselineはM5/M6で別途配備・smoke済みである。staging配備計画はAPI rollback実確認と完全削除計画のT33/T35以降を残し、固定frontend domainは`develop` Preview branchへ割り当て済みである。

- API: Workers専用entrypoint、request-scoped Prisma/mail/DO adapter、`wrangler.jsonc` staging設定、生成binding型、dry-run、bundle contract、production相当Workers runtime test
- frontend: `@sveltejs/adapter-vercel`、Node.js 22、公開API URL fail-fast、Vercel Build Output/secret contract、frontend PR CIを固定
- 実環境確認済み: Vercel Hobby `develop` Preview、staging Worker、SQLite-backed DO、Hyperdrive、7件のWorker secret、Supabase migration current、health/CORS/OPTIONS、元素118件
- synthetic確認済み: 登録・メール認証・login・ゲーム10問/score 500・password reset・本人退会・削除後login拒否・Admin強制退会・旧credential拒否。Resendはallowlist宛の確認メール2通・resetメール1通だけを送信
- 未実施: staging API rollback実確認、T35 legacy cleanup。日常staging frontend自動更新はrun 31092740154と固定URLの最新UI確認で完了した。

コード基盤のローカル再確認は外部serviceへ接続せず、次で行う。

```bash
cd ~/labs/Gensoko/backend
npm ci
npm run test -- --run
npm run test:workers
npm run workers:build
npm run lint
npm run format:check

cd ~/labs/Gensoko/frontend
npm ci
npm run test:run
npm run lint
npm run check
npm run format:check
npm audit --audit-level=moderate
env \
  VERCEL_ENV=preview \
  VERCEL_GIT_COMMIT_REF=develop \
  VITE_API_BASE_URL=https://staging-api.example.invalid/api/v1 \
  npm run build:preview
```

`.invalid`は外部接続しないbuild fixtureであり、実staging URLではない。`build:preview`はNode.js 22 Function、Build Output version 3、SSR catch-all、fixture公開API URLの埋め込み、frontend成果物へのDB/JWT/rate limit/mail secret識別子の非混入を自動検証する。API URLの未設定・空白・形式不正、PreviewでのHTTP URLはbuild前に拒否する。

### Preview環境変数契約

| 値                                     | scope                                 | 公開性           | 契約                                                            |
| -------------------------------------- | ------------------------------------- | ---------------- | --------------------------------------------------------------- |
| `VITE_API_BASE_URL`                    | Vercel Preview + `develop` branchのみ | browserへ公開    | staging APIのHTTPS origin + `/api/v1`。production値と共用しない |
| `VERCEL_ENV` / `VERCEL_GIT_COMMIT_REF` | Vercel system                         | server/build情報 | application secretとして扱わず、clientへ転送しない              |
| DB/JWT/rate limit/mail credential      | frontendへ登録しない                  | secret           | `VITE_` prefix禁止。Cloudflare staging側だけで管理する          |

branch scoped値は新しいdeploymentのbuild時に反映される。設定変更後は既存deploymentを合格扱いにせず、承認後に新しい`develop` Previewを作成して成果物を確認する。固定branch URLだけをAPIの`FRONTEND_URL`に使い、commit URLやwildcard CORSは使わない。

初回公開前のSD15では、Vercel Project Settings → Build and Deployment → Ignored Build StepをCustomとし、`develop`だけをbuildする契約だった。2026-08-06のread-only再確認では、外部設定は次の既存commandへ変わっており、`develop`と`main`を常にbuildしていた。

```bash
if [ "$VERCEL_GIT_COMMIT_REF" = "develop" ] || [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then exit 1; else exit 0; fi
```

Vercelの契約どおりexit code 1はbuild、0はskipを表す。Issue #173の承認済み外部設定で`npm run vercel:ignore-build`へ変更し、保存後の設定表示で反映を確認した。Issue #174のrepository scriptは`main`を常にskipし、`develop`は前後SHA間の`frontend`差分がある場合だけbuildし、差分判定不能時はfail-openでbuildする。他branchもskipする。これによりproduction frontendの所有権をGitHub Actionsへ一本化するが、production専用project分離・custom domain移行・credential登録を完了する前に同変更を`main`へ昇格しない。feature branchへstaging API URLを広げて失敗を回避してはいけない。上記の旧Custom commandは、production workflowを無効化し旧projectのGit Integrationへ戻すことを別承認したrollback時だけ使用する。

### 日常staging frontend自動更新（Issue #173）

実装計画の正本は[`docs/plans/staging-frontend-auto-deploy/plan.md`](plans/staging-frontend-auto-deploy/plan.md)とする。Vercel Git Integrationが`develop`のfrontend変更からPreviewを作成し、Vercel Project Settingsのbranch domainが成功Previewを固定URLへ自動反映する。GitHub Actionsはfrontend品質gate、exact SHA / ref / preview / READY確認、develop先端再確認、対象Previewと固定domainのread-only immutable asset fingerprint・marker検証だけを実行する。

docsなどfrontend成果物へ影響しないdevelop変更は、GitHub Actionsの`paths`とrepository管理のVercel Ignored Build Step scriptの両方でskipする。Ignored Build Stepの外部設定は対象project・影響・rollbackを確認した承認後に反映済みである。stagingの`develop` Preview契約はIssue #174後も変更しない。

docsだけのmergeではworkflowとVercel buildをskipする。quality失敗、Preview timeout、metadata不一致、古いdevelop SHA、domain content追従timeoutではGitHub Actionsからprovider状態を変更せずfailureにする。固有deployment URL、provider ID、raw response、tokenをlog・Summary・Artifactへ残さない。

#### 外部設定preflight

自動更新を有効化する前に、値を表示せず次を確認する。

1. GitHub `staging` Environmentのdeployment branch policyが`develop`限定で、日常自動runを止めるrequired reviewerがないこと。
2. `staging` Environment Secretにproject限定`VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`、必要な場合は`VERCEL_AUTOMATION_BYPASS_SECRET`が存在すること。repository secretやproduction Environmentと共用しない。
3. Vercel projectがHobby `gensoko-frontend-staging`で、Git Integrationが`develop`のfrontend変更からPreviewを作成し、Previewの`VITE_API_BASE_URL`がstaging APIへbranch scopeされていること。
4. Vercel Ignored Build Stepを`npm run vercel:ignore-build`へ変更すること。repository側scriptのmerge前に先行変更しない。
5. 固定domain `gensoko-frontend-staging-develop.vercel.app`がPreview環境・`develop` branchへ割り当てられていること。

2026-08-06のread-only確認では対象`develop`先端のPreviewが`READY`でも固定URLが古いdeploymentを参照する問題を再現した。承認後、対象Hobby project限定・1年有効のautomation tokenを作成し、`VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`を`staging` Environmentへ値非表示で登録した。Ignored Build Stepは`npm run vercel:ignore-build`へ変更済みである。PR #196の失敗確定後、ownerの包括承認に基づき固定domainをPreview環境・`develop` branchへ追加し、Valid Configurationと最新UIを確認した。production Environment、main、production deploymentは変更していない。

PR #192のmerge SHA `b84667a166c296355dd5a5f98957954b5950b203`で起動したrun [31072094165](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/31072094165)は、初回は3 Secret未登録、preflight後のfailed job再実行はPreview探索timeoutでalias更新前に失敗した。再実行でも固定aliasは維持され、安全側で停止した。

Vercel CLIでは`VERCEL_ORG_ID`と`VERCEL_PROJECT_ID`をCI環境変数としてprojectを固定する。team IDである`VERCEL_ORG_ID`をteam slug用の`--scope`へ渡してはいけない。project限定tokenのまま`list gensoko-frontend-staging --format=json`でSHA、ref、URL、target、READYを確認する。固定domain追従は、同じbypass / no-cache条件で対象Previewと固定domainを取得し、200、同一origin、`text/html`、同一originの`/_app/immutable/` asset集合一致、両URLのmarkerを確認する。外部provider markupは比較対象にせず、asset集合は空を許可しない。`inspect`、`alias ls`、`alias set`、deployment detail API、provider状態を変更するREST methodは使用しない。

PR #193のmerge SHA `ef97e98d72a6fa159c424c02cc9a0e0523231aaa`で起動したrun [31076459494](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/31076459494)は、exact `READY` Preview探索とalias直前のdevelop先端再確認に成功した後、共通alias actionで失敗した。固定aliasは旧CSS bundleを維持し、merge SHA固有Previewのbundleとは一致しなかった。provider raw値をlogへ出さない契約は維持し、次の修正では失敗箇所をcandidate不一致、更新前metadata、alias set、更新後inspect、更新後不一致、smokeの固定メッセージだけで分類する。

PR #194のmerge SHA `0918f9a545276f4fa4973927886055683d78fdeb`で起動したrun [31079563100](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/31079563100)は、同じ前段gateの成功後、candidate project metadata不一致でalias更新前に停止した。pinned CLI `50.17.1`ではlistのproject nameがprovider応答次第で省略されるため、listのexact Git metadataと同じcandidateをinspectしたproject metadataをdeployment IDで結ぶ。固定aliasはこの修正のmerge runまで既存参照を維持する。

PR #195のmerge SHA `d40bf3657b806449c0abc5b2bc18bb53cba397e2`で起動したrun [31081222649](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/31081222649)は、同じ前段gateの成功後、candidate list metadata不一致でalias更新前に停止した。pinned CLI `50.17.1`ではlistのdeployment IDもprovider応答次第で省略されるため、候補の一意なURLをinspectして初めてIDを取得し、以後の更新後・rollback検証へ一時fileで引き継ぐ。固定aliasはこの修正のmerge runまで既存参照を維持する。

PR #196のmerge SHA `2fa65d4c5857a2a048e56d60062309091af369db`で起動したrun [31082530994](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/31082530994)とfailed job再実行は、品質gate、exact `READY` Preview探索、develop先端再確認まで成功した後、candidate inspectが内部利用するdeployment detail APIの権限制約で同じ固定段階へ安全停止した。Vercel CLI最新版でも同API依存が残るため、tokenをteam scopeへ広げずbranch domain方式へ移行した。

PR #198のmerge SHA `0091f71342ab07d19684b0f2e5e11b0702f84b63`で起動したrun [31086958523](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/31086958523)は、frontend品質gate、exact `READY` Preview探索、develop先端再確認まで成功した後、project限定tokenで`alias ls`を利用できず固定domain確認で安全停止した。token権限を広げずstaging / production分離を維持するため、固定domainのprovider metadataではなく対象PreviewとのHTML content一致をread-only検証する方式へ変更した。

PR #199のmerge SHA `a817d3682acc5732cd01798ed8fcfb8f1c42e40b`で起動したrun [31090151492](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/31090151492)は、frontend品質gate、exact `READY` Preview探索、develop先端再確認まで成功し、固定domain content待機だけがtimeoutした。ログイン済みbrowserで固定domainの最新トップページUIを確認し、候補Previewと固定domainが同じ14件のSvelteKit `/_app/immutable/` assetを参照していることを確認した。候補HTMLだけにVercel Toolbarの外部scriptが注入されていたため、HTML全体比較は同じapplication buildを誤検知する。候補固有originのhydration時API errorはstaging API CORSが固定domainだけを許可する契約によるもので、固定domainの動作確認結果には影響しない。

PR #200のmerge SHA `97cf7e66395ad59355da3f5bcf99d05bf870f9e3`で起動したrun [31092740154](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/31092740154)は、frontend品質jobを1分11秒、exact Preview・develop先端・固定domain・smoke jobを19秒で完了した。対象Previewと固定domainのimmutable asset fingerprint、両URLのmarker、固定status `BRANCH_DOMAIN_READY` / `SMOKE_CLEAR`が成立し、固定URLでは最新トップページ「元素を、遊んで覚える。」、アプリ概要、認証hydration後のログイン・新規登録導線、ランキングプレビューを確認した。Node 20 deprecation annotationは既知の通知であり失敗原因ではない。production Environment、main、production deploymentは参照・変更していない。

#### 通常の自動更新

1. `frontend/**`を含むreview済みPRを`develop`へmergeする。
2. `Staging Frontend Deploy`の`frontend-quality`がmerge commitのexact SHAでaudit、test、lint、Svelte check、format check、Preview build検証を通す。
3. `verify-preview`がVercel Git Integration由来の`READY` Previewを最大5分bounded pollし、listでSHA、ref=`develop`、target=`preview`、URL、候補一意性を構造化JSONで確認する。
4. domain確認直前にGitHubの`develop`先端を再確認する。先端が移動していれば旧runを安全に失敗させ、新しいrunへ委譲する。
5. 共通actionが候補metadataを再確認し、対象Previewと固定domainを同じbypass / no-cache条件で取得する。200、同一origin、`text/html`、空でないSvelteKit immutable asset集合一致、両URLのmarkerを最大5分bounded pollし、redirect・非HTML・asset不一致・asset欠落・marker欠落は安全に失敗させる。外部provider markupとabsolute / relative URL表記差は比較対象外にする。
6. Summaryにexact SHAと`BRANCH_DOMAIN_READY` / `SMOKE_CLEAR`だけが残り、固定URLで対象Previewと同じ最新UIを確認できることを確認する。

同じSHAのPreviewをGitHub Actionsから再deployしない。日常workflowを手動dispatchへ拡張せず、失敗修正後の次のfrontend mergeで再実行する。API、DB、fixture、synthetic campaignを伴う高リスク変更だけ、既存M2を別承認で使う。

#### 失敗時の復旧

- Preview / domain確認前の失敗: provider状態を変更せず、quality、Vercel Preview、metadata、develop先端、Environment Secret名、branch domain設定を値非表示で確認する。
- domain content追従timeout: 新しいrunやM2を重ねず、Vercel dashboardで固定domainの`develop`割り当てと直前の正常deploymentを確認する。候補・固定domainのHTTP status、同一origin、content type、immutable asset集合、markerを値非表示で切り分け、固有URLやprovider JSONをworkflow logへ出さない。
- 自動更新の緊急停止: Vercel staging projectのbranch domain割り当てを外すか、Git Integrationを停止する。GitHub検証だけを止める場合はworkflowを無効化する。production project、main、production domainは変更しない。

### SD13以降の承認境界

次の操作はローカルコードPRへ含めない。実行直前に対象account/project、現在の料金planと見積り、影響、rollbackを提示し、個別承認を得る。

| task | 外部操作                                                                     | 費用・影響の確認                                                                  | rollback                                                                 |
| ---- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| SD13 | Cloudflare staging Worker、Hyperdrive、SQLite-backed DO、binding、secret準備 | account/plan、resource数、Hyperdrive・DO・Workers利用料金、staging DB接続先を確認 | 新規resource/bindingを削除または旧設定へ戻す。secret値は表示・記録しない |
| SD14 | review済みSHAのAPI staging deploy・smoke                                     | 公開staging API、request/DB/mail利用量、synthetic以外へ到達しないことを確認       | 直前Worker versionへrollbackし、必要ならrouteを外す                      |
| SD15 | Vercel project接続、`develop` Preview、branch scoped env、CORS再deploy       | plan、公開Preview URL、build/Function利用量、アクセス保護可否を確認               | 直前deploymentへ戻し、branch scoped envと不要deploymentを削除する        |
| SD16 | T34 synthetic API/UI/Playwright                                              | staging synthetic dataだけを変更すること、mail宛先制限、実行時間を確認            | fixture cleanupを実行し、異常時はAPI/UIを直前versionへ戻す               |

Supabase/実DB接続、migration、legacy cleanup、production deploy、実データ確認は上表の承認にも含まれず、それぞれ別の直前承認を必要とする。

### SD16 synthetic Admin Playwright runbook

実行対象は`.github/workflows/staging-synthetic-admin-e2e.yml`だけとし、GitHub Actionsの`develop` refから手動実行する。別branch、schedule、push、PRからは実行しない。

1. GitHub `staging` Environmentの`BATCH_ENVIRONMENT=staging`、staging専用`DATABASE_URL`とproject refが既存validatorの契約を満たすことを、値を表示せず確認する。VercelでProtection Bypass for Automationを有効にし、その値と同一の`VERCEL_AUTOMATION_BYPASS_SECRET`をGitHub Environment Secretとして登録する。どちらの値も読み戻さない。
2. `STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED`を直前承認後だけ`true`にする。実行完了後は成否にかかわらず`false`へ戻す。
3. 固定frontend `https://gensoko-frontend-staging-develop.vercel.app`と固定API `https://gensoko-api-staging.rituko-labs.workers.dev/api/v1`を変更しない。production・任意URLはguardが拒否する。
4. Vercel Deployment Protectionは解除しない。automation bypassは固定frontend originへのnavigation/subresource requestだけにheaderで付与し、固定Worker APIへは送らない。query parameter、Playwright全体の`extraHTTPHeaders`、CLI引数、artifactを使わない。`x-vercel-set-bypass-cookie: true`はbrowser遷移を安定させるため同じfrontend requestだけへ付与する。
5. 予約識別子`staging-synthetic-e2e-admin` / `staging-synthetic-e2e-user`と対応username/emailを実在Userや別fixtureへ流用しない。完全一致しない衝突rowがあればworkflowは削除せず停止する。
6. workflowはVercel automation bypass Secretをfixture作成前に検証し、backend/frontend依存、Prisma Client、Chromiumの準備完了後に一時passwordを生成する。値はmaskして`GITHUB_OUTPUT`へ書き、fixture prepareとPlaywrightのstep環境変数だけへ渡す。CLI引数、job全体の環境変数、log、artifactへcredentialを出さない。
7. backend依存導入→DB target検証→Prisma/frontend/Chromium準備→credential生成→完全一致fixture prepare→5分制限のAdmin強制退会Playwright→main jobの`always()` cleanupの順で実行する。workflow全体を共通batch concurrencyで直列化し、cleanup完了前に次のrunを開始しない。
8. 通常の失敗・cancelではmain jobの`always()` cleanupを確認する。main jobが非成功の場合は、`needs`と`always()`を持つ10分制限のrecovery cleanup jobが別runnerでも冪等cleanupする。workflow全体または両cleanup runnerの強制終了などで結果を確認できない場合は、実在Userを手動操作せず、同じreview済みSHAのworkflowを再実行する。prepareが完全一致fixtureだけを安全に置換し、最後に再cleanupする。
9. fixture cleanupは予約済みsynthetic User rowとcascade対象だけを削除する。Admin login・強制退会・対象User login拒否のAuditLogはUserと非連結の監査証跡として保持し、credentialを含まないことを前提に既存の監査ログ保持期限・承認済みcleanup運用で管理する。

#### 初回実行と再実行条件（2026-07-20）

- `develop`の`0f43610016587ed3cf7169707853f7ef1fff1239`で[run 29746415785](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/29746415785)を実行した。prepareは成功したが、Vercel Deployment Protectionが`/login`をSSOへ302 redirectしたため、Playwrightはログインフォーム取得前にtimeoutし、Admin login・強制退会・旧credential 401確認には到達しなかった。
- main jobの`always()` cleanupと独立recovery cleanupはともに成功した。追加の直接DB queryは行っていないため、再実行では両cleanup結果に加えてworkflow内のfixture残存確認結果を記録する。`STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED`は終了後に`false`へ戻した。
- 同じrunを設定変更なしで再実行してもSSO redirectは解消しない。Vercel保護を公開解除せず、上記のorigin限定automation bypass対応を`develop`へmergeし、VercelとGitHub `staging` Environmentへ対応Secretを値を表示せず設定してから、新しい明示承認のもとで再実行する。
- production URL、production DB、production deploy、migration、実メール送信は実行していない。

#### PR #120 merge後の再実行結果（2026-07-21）

- `develop`の`e3893c95c6c842c74f22e65fb23613e0b7987947`で[run 29788242095](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/29788242095)を1回だけ実行した。Vercel automation bypassにより固定frontendのAdmin login画面へ到達し、fixture prepareは`createdUsers: 2`、`replacedUsers: 0`で成功した。
- Playwrightはlogin送信後、固定Worker APIの`POST /api/v1/auth/login` responseを60秒以内に観測できずtimeoutした。Admin login成功、synthetic User強制退会、対象Userの旧credentialによる401拒否には到達しておらず、workflow全体はfailureである。
- main cleanupは`deletedUsers: 2`で成功し、独立recovery cleanupも`deletedUsers: 0`で成功した。recovery時点で削除対象fixtureが残っていないことをworkflow結果で確認した。credential値は取得・表示していない。
- `STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED`は成否にかかわらず終了後に`false`へ戻し、値が`false`であることを確認した。追加の読み取り確認ではstaging API healthが200、固定Vercel originからlogin endpointへのCORS preflightが204だったが、失敗原因は未確定である。
- 設定を変えない再実行で解消する根拠がないため、同一内容のworkflowは再実行しない。browser側のlogin request発行とresponse観測をcredentialを含めず診断し、必要な修正をTDD・review・mergeした後、改めて明示承認を得る。
- staging DBへの追加の直接DB queryや手動fixture操作、production URL・DB・deploy、migration、実メール、再配備は実行していない。

#### login response timeout補正後の再実行条件（2026-07-21）

- credentialを使わないlive診断ではclient validationとdummy login 401を確認し、固定Worker APIへ同じdummy requestを直接送った場合も約1.6秒で401だった。run logではSSR formの入力・click後にPOST responseがなく、遅いrunnerでhydration完了前にnative submitした可能性が最も高いと推定する。
- Playwrightは各loginでsynthetic credentialを入力する前に、画面遷移を起こさないcancelable `SubmitEvent`をformへdispatchし、Svelte handlerの`preventDefault()`とclient validation alertをhydration readinessとして待つ。入力値、API request、fixture、credential、AuditLogを使用しない。
- 補正を`develop`へmergeし、実行SHA、workflow guard、GitHub `staging` Environment、固定URL、automation bypass Secret名、enable flag `false`を再確認する。Secret値は取得・表示しない。
- 新しい明示承認を得るまでworkflowを起動しない。承認後もenable flagを`true`にして1回だけ起動し、成否にかかわらず`false`へ戻す既存手順を維持する。

#### PR #122 merge後の再実行結果（2026-07-21）

- `develop`の`31723f2a44f4a527253479548d9dfecf242ee7c4`で[run 29795967063](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/29795967063)を1回だけ実行した。fixture prepareは`createdUsers: 2`、`replacedUsers: 0`で成功した。
- hydration readiness確認後のAdmin loginは200となり、固定frontendのトップへ遷移した。前回のlogin response timeoutは再発しなかった。
- 続く`/admin`遷移後に「管理者ダッシュボード」見出しを10秒以内に取得できずPlaywrightは失敗した。synthetic Userの強制退会と対象Userの旧credentialによる401拒否には未到達であり、workflow全体はfailureである。
- main cleanupは`deletedUsers: 2`、独立recovery cleanupは`deletedUsers: 0`で成功した。recovery時点で予約fixtureが残っていないことをworkflow結果で確認し、enable flagは終了後に`false`へ戻して確認した。
- credential値は取得・表示していない。staging DBへの追加の直接DB query、手動fixture操作、production URL・DB・deploy、migration、実メール、再配備は実行していない。原因を診断し、必要な修正をreview・mergeして新しい明示承認を得るまで同一workflowを再実行しない。

#### `/admin`到達失敗の診断・TDD補正（2026-07-21）

- Admin login成功時は`authStore.login()`がADMIN roleとaccess tokenをmemory・`sessionStorage`へ保存し、SvelteKitのSPA遷移でトップへ移動する。失敗時の`page.goto('/admin')`は新しいdocumentを読み込むためmemory上の認証stateを失い、root layoutの`authStore.initialize()`が認証確定前にrefreshを実行する経路へ入っていた。
- refresh cookieはbackend契約上`SameSite=Strict`である。固定frontendの`vercel.app`と固定APIの`workers.dev`はcross-siteのためフルナビゲーション後のrefreshにはcookieを送れず、refresh失敗時にauth storeがanonymousへclearされる。Admin pageはURLをredirectせず「ログインが必要です」を表示するため、runでは`/admin`に留まったまま「管理者ダッシュボード」見出しを取得できなかった。Admin role不足やtimeout長不足ではない。
- Playwrightはlogin後に実UIの「管理者」リンクが表示されることを確認してclickし、SPA遷移後の`/admin` URLと「管理者ダッシュボード」見出しを順に検証する。後続の対象User強制退会と旧credential 401確認、hydration readiness、固定URL、origin限定automation bypass、完全一致fixture、両cleanupは変更しない。
- RedではAdmin login後の管理者リンク・SPA遷移・URL確認を要求し、`page.goto('/admin')`を禁止するsource contract 1件が意図どおり失敗した。Greenではcontract 6件、RefactorではHeader・Admin pageを含む関連3 files・35 testsが成功した。
- 最終品質gateはfrontend 51 files・555 tests、ESLint、Prettier check、Svelte check（0 errors / 0 warnings）、production build、backend workflow contract 5 testsが成功した。実credential・Secretを使わないローカル用ダミー設定のPlaywright `--list`で1 specを収集し、browser・staging接続は実行していない。
- この補正中にstaging workflow、fixture、DB query、migration、実メール、再配備、production操作は実行していない。補正をreview・`develop`へmergeし、merge後preflightと新しい明示承認を得るまでworkflowを起動せず、enable flag `false`を維持する。

#### PR #125 merge後の成功run（2026-07-21）

- `develop`の`6bb898d52915df1139b863383e8be88e35a3d63b`で[run 29802327100](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/29802327100)を1回だけ実行した。実行前にworkflow guard、staging Environmentの必要Secret名、固定frontend/API、enable flag `false`を値非表示で確認し、承認後だけflagを`true`へ変更した。
- fixture prepareは`createdUsers: 2`、`replacedUsers: 0`で成功した。Admin login、実UIの管理者linkによる`/admin` SPA遷移、dashboard見出し、synthetic User強制退会、旧credential 401拒否を含むPlaywright 1件が11.7秒で成功した。
- E2E内で対象Userを物理削除し、main cleanupは残るsynthetic Admin 1件を削除して成功した。main job成功のためrecovery cleanupは契約どおりskipされた。
- workflowとmain jobは成功し、終了後にenable flagを`false`へ戻して確認した。credential、Secret値、DB接続情報は取得・表示していない。
- production URL・DB・deploy、migration、実メール、追加の直接DB queryは実行していない。SD16/T34は完了とし、T35 legacy cleanupとproduction gateは未完了のまま維持する。

このコード実装中はworkflow、staging/production DB、実メール、再配備を実行しない。Playwright実行は別途直前承認を得る。

---

## Vercel へのデプロイ手順

以下はSD15の直前承認後だけ実行する。承認前にaccount作成、GitHub連携、project import、環境変数登録、Deployを行わない。

### 1. 承認内容を再確認

1. 対象account・organization・repository・料金plan・見積りを確認する。
2. staging APIの承認済みHTTPS URL、公開範囲、rollback先を確認する。
3. project作成・GitHub連携・初回deploymentの影響を提示し、SD15の直前承認を得る。

### 2. projectとbuild設定を準備

1. Vercelダッシュボードで「Add New Project」
2. GitHubリポジトリ `gensoko` を選択
3. 設定:
   - **Framework Preset**: SvelteKit（自動検出）
   - **Root Directory**: `frontend`
   - **Node.js**: repositoryの`engines.node=22.x`と一致
4. API URL未設定ではbuildがfail-fastすることを前提に、次の環境変数設定まで合格扱いにしない。

### 3. branch scoped環境変数を設定してDeploy

Vercelダッシュボード → Settings → Environment Variables：

```
VITE_API_BASE_URL = https://<approved-staging-api-origin>/api/v1
```

stagingではEnvironmentをPreview、Git Branchを`develop`へ限定する。値はbrowserへ公開されるためsecretを設定しない。scopeと値を再確認後にだけDeployし、生成deploymentをCORSやsmokeの合格対象とする。設定前に生成されたdeploymentがある場合は合格扱いにせず、設定後に新しいdeploymentを作成する。

---

## Cloudflare Workers へのデプロイ手順

### 1. Cloudflare アカウント作成

1. https://cloudflare.com にアクセス
2. 「Sign Up」でアカウント作成

### 2. Workers基盤の実装状況

2026-07-20時点で、SD9までのWorkersコード基盤は実装済みである。`backend/wrangler.jsonc`、Workers専用entrypoint、request-scoped Hyperdrive Prisma adapter、HTTPS mail adapter、SQLite-backed Durable Object、生成binding型、dry-run・bundle contract、production相当runtime testを持つ。

`backend/src/index.ts`はNode.js開発用entrypointであり、`@hono/node-server`とmemory storeを使用する。`wrangler`の`main`へ指定してはいけない。またproductionの`RATE_LIMIT_STORE=durable-object`をNode entrypointへ渡すと、memory storeへの危険なfallbackを防ぐため起動を拒否する。

`npm run workers:build`は生成型差分、Workers typecheck、staging dry-run、bundle contractを外部resourceなしで検証する。production相当runtime testは別の`npm run test:workers`で実行する。`backend/wrangler.jsonc`のstaging Hyperdrive IDは、作成済み`gensoko-postgres-staging`の実resource IDへ更新済みであり、production用resourceと共用しない。

R7 Free Worker password verification分離では、main Workerのloginからcost 12 `bcrypt.compare`を除き、同一scriptの`PasswordVerifierDurableObject`へaccount単位の内部RPCで委譲する。`PASSWORD_VERIFIER` bindingをstaging/test/production構成で必須とし、既存`v1`の`RateLimitCounter` migrationは変更せず、`v2`の`new_sqlite_classes`へ新classだけを追加する。DOはSQLite-backed classとして登録するがstorage、alarm、cacheを使用せず、password、hash、result、account識別子を保存・記録しない。通常staging/production bundleはlocal bcrypt adapterの混入を拒否する。

v2適用後のrollback先にはpre-v2 versionを使わない。rollback互換baselineは`worker-staging-rollback-baseline.ts`だけが既存cost 12 local adapterを明示DIし、通常stagingと同じWorker名、binding、Hyperdrive、v1/v2 migration、2 class exportを持つ。`wrangler.jsonc`は通常entrypointのまま変更せず、`npm run workers:rollback-baseline:dry-run`がstrict検証済みの一時configを権限`0600`で生成し、成功・失敗とも削除する。通常staging、production、baselineは別bundle profileで検証し、production config/entrypointへbaseline pathやmodeを含めない。

repository実装ではlocal test、workerd、型生成、通常/baseline/production dry-runだけを行った。M2のstaging外部実行は公開後へ移し、v0.1公開前はM5でv2 migrationとbindingを値非表示でpreflightし、M6 production smokeでvalid login、auth 429、cleanupを確認する。R7PVRB-13〜15のbaseline deploy・rollback drillは実施せず、公開後の運用訓練として未完了のまま保持する。

password verifierのbinding/RPC/result障害はmain Workerでlocal bcryptへfallbackせず、固定日本語503と`Retry-After: 60`でfail-closedにする。M5はcleanなreview済みcommitの通常版をdeployし、M6で実HTTPを確認する。v2 migration後に障害が起き、互換versionへrollbackできない場合はrequestを増やさず公開停止・fix-forwardとする。新namespaceと適用済みv2 migrationは直後に削除せず、cleanupは公開後の別承認へ分離する。

Cloudflare account、staging Hyperdrive origin、Worker `gensoko-api-staging`、SQLite-backed DO、7件のWorker secret、公開Workers URLは作成・配備済みである。health 200、CORS、OPTIONS 204、Hyperdrive経由の元素118件を確認済みで、production resourceは作成していない。secret値は読み戻し・文書化しない。

---

## Supabase のセットアップ手順

1. https://supabase.com にアクセス
2. 「Start your project」→ GitHubアカウントで登録
3. stagingは`gensoko-staging`、productionは別Free organizationの`gensoko-production`として作成する
4. 両projectを次の設定にする:
   - Database Password: password managerで生成・保存し、環境間で共用しない
   - Region: Northeast Asia (Tokyo)
   - Data API: 無効（GensokoはSupabase client libraryではなくPrismaからPostgreSQLへ接続する）
   - Automatic RLS: 無効
5. 作成完了後、`Connect`のPrisma設定からSession pooler（port 5432）のURIを取得する
6. GitHub Environmentごとの`DATABASE_URL`へ登録し、repository共通Secretには登録しない

Cloudflare Workersは`DATABASE_URL`を直接受けず、staging専用Hyperdrive bindingの`connectionString`をrequest境界で使う。Hyperdrive origin credentialはCloudflare resource側で管理し、repository、frontend、Worker変数へ複製しない。resource作成・接続先設定はSD13の直前承認後だけ実行する。

---

## 本番DBバックアップ・マイグレーション運用

### 基本方針

- 本番DBの変更は `prisma migrate deploy` でのみ適用する
- `prisma migrate deploy` は通常のproduction deployへ含めず、required reviewer付き`Production Database Operations`の手動`migrate-deploy`だけで実行する
- 実行前に24時間以内の暗号化backup workflowが成功し、Artifactが期限内であることを確認する
- `DATABASE_URL`はmigration/batch用のGitHub Environment Secretとして管理する。Workers runtimeへ`DATABASE_URL`を渡さず、DB接続はCloudflare resource側でcredentialを管理する`HYPERDRIVE` bindingを使う。いずれの値もリポジトリへ書かない

### Free planのbackup・容量監視

productionはSupabase Free planで運用する。[Supabase pricing](https://supabase.com/pricing)上、Free planはDB容量500MB（500,000,000 bytes）で、自動backup・PITR・Metrics endpointを利用できない。[Database Backups](https://supabase.com/docs/guides/platform/backups)でもFree projectは`supabase db dump`による外部backupが推奨されている。

`.github/workflows/production-database.yml`はproduction Environmentへ固定し、既存batchと同じ`gensoko-batch-jobs`concurrency groupでDB操作を直列化する。

repository default branchが`main`へ切り替わるまで、非mainから発生したscheduleはbranch validation jobと後続jobをskipし、production Environment・Secretへ到達させない。移行期間のskipはcapacity-checkまたはbackupの成功実績として数えず、manual実行は非mainのままfail-closedを維持する。

| operation                       | schedule                     | 内容                                                                                                 |
| ------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `capacity-check`                | UTC毎日19:23（JST毎日04:23） | `pg_database_size(current_database())`でDB容量を取得し、500MBに対する使用率を確認                    |
| `backup`                        | UTC毎日19:41（JST毎日04:41） | roles・schema・dataをdumpし、AES-256で暗号化・復号検証してArtifactへ7日保存                          |
| `migrate-deploy`                | 手動のみ                     | 24時間以内に成功したbackup run IDと期限内Artifactを確認後、`prisma migrate deploy`を実行             |
| `verify-v0-1-migration-indexes` | 手動のみ                     | 成功migration run IDと対象SHAを確認し、v0.1対象indexの`indisvalid`・`indisready`だけを値非表示で確認 |

上表の日次cronはcode・contract testまで完了した。capacity-check、暗号化・復号検証・7日保持・手動実行・Prisma migration時の24時間以内backup gateは維持している。M1Rが成立するv0.1では、pending Prisma migrationがある場合だけ実行前24時間以内の成功Artifact 1世代とchecksumをM4で確認する。migration不要時はbackupを公開前blockerにせず、日次scheduleと2世代目以降は公開後に確認する。旧R9とbackup計画全体は未完了のまま継続する。

最大3回retry、2時間後recovery、36時間鮮度監視、通常7世代の定常確認、四半期restore drillは初回公開後の強化とする。これらを日次化の完了条件へ混在させず、未実装項目は同計画で継続管理する。

### R9日次scheduleの観測とrollback

次は旧R9とbackup計画全体の公開後観測手順であり、M4の完了条件ではない。原則として自動scheduleを待ち、2回以上確認する。

1. eventが`schedule`、head branchが`main`で、head SHAが日次化commitを含む。
2. `Resolve requested operation`が`backup`を解決し、暗号化backup作成・復号検証・uploadが成功する。
3. 各runに`production-db-backup-{run ID}`が1件あり、同一確認時点で未失効Artifactが2世代以上ある。
4. `retention-days: 7`の保持境界をmetadataで確認し、run ID、head SHA、実行日時、Artifact名、expiry、確認日時だけを記録する。

Artifactをdownload・復号せず、Secret、DB情報、Artifact内容、digest、download URL、個人dataを記録しない。観測を早めるためのmanual dispatchも行わない。

日次化でDB負荷、Actions使用量、schedule競合に問題が出た場合は、新規migration・cleanupを停止して有効な最新Artifactを確認する。原因と影響をreviewしたうえで、schedule宣言とoperation解決caseの両方を既知の週次値`41 19 * * 6`へ戻す。manual `operation=backup`、capacity-check、暗号化、7日保持、24時間以内backup gateは維持し、既存Artifactを手動削除しない。

容量閾値はFree quotaの70%=350MBを警告、85%=425MBを重大とする。どちらもworkflowを失敗させ、GitHub Actionsのfailed workflowメール通知へ接続する。workflowの値はDB本体の論理容量であり、最終確認はSupabase Dashboardのdatabase usageをsource of truthとする。

### 暗号化backup

production Environment Secretへ`BACKUP_ENCRYPTION_PASSPHRASE`を登録する。20文字以上の本番専用値をpassword managerで生成し、DB passwordと共用しない。復元時に必要なため、GitHubだけでなくpassword managerにも保存する。

backup workflowはSupabase公式手順に従い、次を作成する。

- `roles.sql`: custom role
- `schema.sql`: `supabase db dump`の標準動作でSupabase管理schemaを除外したschema（[CLI Reference](https://supabase.com/docs/reference/cli/supabase-db-dump)）
- `data.sql`: `--data-only --use-copy`で取得したdata

平文3ファイルを一時archiveへまとめ、GnuPGのAES-256 symmetric encryptionで暗号化する。同じpassphraseで復号し、3ファイルを再確認してから、暗号化ファイルとSHA-256だけをArtifactへuploadする。平文dumpと復号確認用archiveはrunner終了前に削除する。repositoryはpublicのため、平文dumpをcommit・Artifact・logへ出してはいけない。

### backupの手動実行と復元

初回migration前と、破壊的変更を含むmigration前は次の順序を守る。

1. Actions > Production Database Operations > Run workflowを開く。
2. branchは`main`、operationは`backup`を選択する。
3. 成功後、run IDと`production-db-backup-{run ID}`Artifactの存在を確認する。
4. 24時間以内にoperation `migrate-deploy`を選び、`confirmed_backup_run_id`へrun IDだけを入力する。
5. backup確認stepと`prisma migrate deploy`の両方が成功したことを確認する。

復元はDB担当者の承認後だけ行う。対象Artifactをdownloadし、password managerからpassphraseを読み出して次の順に確認する。

```bash
sha256sum --check production-db-backup-<run-id>.tar.gz.gpg.sha256

printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" | gpg --decrypt \
  --batch \
  --pinentry-mode loopback \
  --passphrase-fd 0 \
  --output production-db-backup.tar.gz \
  production-db-backup-<run-id>.tar.gz.gpg

tar -xzf production-db-backup.tar.gz
```

復元先には新しいSupabase projectを用意し、現在のproductionへ直接上書きしない。`roles.sql`、`schema.sql`、`data.sql`の順で`psql --single-transaction --set ON_ERROR_STOP=1`を使って復元し、検証後に切替可否を判断する。復元作業中も接続URL、password、passphraseをterminal log・Issue・PR・チャットへ残さない。

### ロールバック方針

DBを即時に巻き戻す前提にはしない。まず直前のアプリケーションバージョンへロールバックできるよう、スキーマ変更は後方互換を維持する。

- 列追加は nullable または default 付きで追加し、旧コードが動く状態を保つ
- 既存列の削除・rename・not null 化・型変更は同一リリースで行わず、expand/contract 方式で分ける
- データ移行が必要な場合は、追加 → backfill → 新旧両対応 → 切替 → 旧列削除の順で進める
- 障害時は API / フロントを先に直前バージョンへ戻し、データ復元が必要な場合のみバックアップからの復元を判断する

## アカウント完全削除のrollout・legacy cleanup

> 2026-07-23時点: 物理削除backend、legacy cleanup CLI、synthetic fixture preflight、staging/production manual workflow、DB列非参照code、隔離contract SQL、production本人削除smoke/recoveryは実装済み。staging/productionのcleanup、production本人削除smoke、contract workflowは未実行であり、本番適用済みとは扱わない。

### release gate

次をすべて記録するまで、物理削除backendの本番公開、production cleanup、`deletedAt` contract migrationを行わない。

- T30・T31のbackend/frontend品質checkとT32の専用DB integration testが成功している
- stagingでexpand migration、削除性能、本人退会・管理者強制退会・削除後auth・管理UIを確認している
- staging legacy cleanupでdry-run、execute、実行後0件、再実行0件を確認している
- Phase 2 backendとPhase 4 frontendを同じrelease windowで切り替え、旧soft-delete instanceをdrainできる
- R4のプライバシーポリシー、監査内部IDの正式保持、backup境界、全損時の削除replay残存リスクが2026-07-22に承認済みである
- production cleanupの実行者・承認者・実行時間帯・通知先など、残るT1B gateが実行前に別途確定・承認されている
- production cleanup前の24時間以内の暗号化backupとdry-run Artifactを確認できる

### Environment設定

| Environment | 種別     | 名前                                             | 値・扱い                                                               |
| ----------- | -------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| staging     | Variable | `ACCOUNT_DATA_DELETION_EXECUTE_ENABLED`          | 通常`false`。T35の承認済みexecute中だけ`true`                          |
| staging     | Variable | `ACCOUNT_DATA_DELETION_STAGING_FIXTURES_ENABLED` | 通常`false`。T35のsynthetic fixture準備・検証・cleanup中だけ`true`     |
| staging     | Variable | `ACCOUNT_DATA_DELETION_BATCH_SIZE`               | 1〜100。既定25                                                         |
| staging     | Variable | `STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED`   | 通常`false`。T33の承認済みmigration probe・cascade execute中だけ`true` |
| production  | Variable | `ACCOUNT_DATA_DELETION_EXECUTE_ENABLED`          | 通常`false`。T38の承認済みexecute中だけ`true`                          |
| production  | Variable | `ACCOUNT_DATA_DELETION_BATCH_SIZE`               | 1〜100。既定25                                                         |
| production  | Variable | `PRODUCTION_ACCOUNT_DELETION_SMOKE_ENABLED`      | 通常`false`。R16の承認済み本人削除smoke中だけ`true`                    |
| production  | Variable | `PRODUCTION_ACCOUNT_DELETION_USERNAME`           | 専用予約値`prod_delete_smoke`。通常accountと共用しない                 |
| production  | Secret   | `PRODUCTION_ACCOUNT_DELETION_EMAIL`              | `prod-delete-smoke`または`prod-delete-smoke+<suffix>`の専用email       |
| production  | Secret   | `PRODUCTION_ACCOUNT_DELETION_PASSWORD`           | 専用accountの資格情報。stepのprocess env以外へ出力しない               |

`DATABASE_URL`、`STAGING_SUPABASE_PROJECT_REF`、`BATCH_ENVIRONMENT`は既存のEnvironment単位設定を使い、repository共通値やローカルshellへ複製しない。project refは接続先照合用の値だが、Actionsのenv一覧への表示を防ぐためEnvironment Secretで管理する。staging/productionで同じ接続文字列を共用しない。

### staging expand migration・性能runbook（T33）

T33はT35のlegacy cleanupと分離する。PR mergeと明示承認前にworkflowを実行せず、次の順序を変更しない。

1. `STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED=false`を確認する。
2. `Staging Account Deletion Performance`の`preview`を`develop`から実行する。出力は最大GameSession件数・最大GameAnswer件数、残存synthetic fixture User件数、fixture元Elementの有無だけで、既存Userを変更しない。残存fixtureが1件以上、またはfixture元Elementがない場合はcascade executeを開始しない。
3. fixture元Elementがない場合は、`Staging Database Setup`の`seed-elements`へ`SEED_STAGING_ELEMENTS`を入力する。対象index migrationだけがpending、または全migration適用済みの場合に限り、118元素をPrisma `upsert`する。生ログは表示せず、削除は行わない。成功後にpreviewを再実行してElement有りを確認する。
4. 対象の`20260716112500_add_account_deletion_indexes`がstagingでpendingであることを確認する。既に適用済みなら同じDB上で計測済みと偽らず、isolated staging相当環境での再現計画を作る。
5. Environment flagを`true`へ変更する。
6. `Staging Database Setup`で`measure-account-deletion-indexes`を選び、`MEASURE_STAGING_ACCOUNT_DELETION_MIGRATION`と5,000〜120,000msのwrite probe時間を入力する。
7. workflowはproject ref・Session pooler host・port 5432・path `/postgres`を検証し、synthetic Userと3つのindex対象子rowだけへwriteしながら`prisma migrate deploy`を実行する。
8. `migrationResult`、`probeResult`、`migrationDurationMs`、`writeProbeMaxDurationMs`、`fixtureCleanupStatus`、適用後migration statusを記録する。probe失敗時も許可済みfieldだけを集計し、migration statusを最終確認してからjobを失敗させる。通常`CREATE INDEX`中のwrite待ちがmaintenance windowを超える場合はproductionへ進まない。
9. preview以上・上限以内のsession/answer件数とplatform request timeoutを決め、performance `execute`へ`MEASURE_STAGING_ACCOUNT_DELETION`を入力する。
10. 実`deleteCurrentUser` service経路の`durationMs`が`min(timeout * 0.5, 5,000)`以内であることを確認する。超過時はproduction公開をblockして非同期方式を再設計する。
11. 成功・失敗にかかわらずsynthetic User・所有row・synthetic成功監査が残っていないことを確認し、flagを`false`へ戻す。

#### T33 managed DB判定基準

ローカルDockerの初回migration再現値は測定手段のbaselineであり、managed DBの合格証拠には使わない。PostgreSQL公式仕様では通常の`CREATE INDEX`は対象tableのwriteを完了までblockし、Supabaseもcompute classごとにI/O性能が異なるため、PostgreSQL versionだけの一致では同等と判断しない（[PostgreSQL CREATE INDEX](https://www.postgresql.org/docs/17/sql-createindex.html)、[Supabase compute別I/O](https://supabase.com/docs/guides/troubleshooting/interpreting-supabase-grafana-io-charts-MUynDR)）。将来の再計測環境は、次をすべて満たす場合だけstaging/production相当の候補とする。

- Supabaseのcompute classとPostgreSQL major versionがproduction予定値と一致する
- 東京region、Session pooler、port 5432、path `/postgres`を使用する
- 対象の`20260716112500_add_account_deletion_indexes`だけがpendingである
- `refresh_tokens`、`email_verifications`、`game_question_sets`、`users`のrow数が、PII・内部IDを出さずに取得したproduction集計値以上である
- synthetic fixtureだけへwriteし、実在User・legacy Userを変更しない

正式なmaintenance windowが未決定である間は、次を暫定gate候補とする。

| 項目                      | 暫定条件                                                             | 根拠・扱い                                               |
| ------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| write probe継続時間       | 30,000ms以上                                                         | migration前後のwriteを継続して観測する                   |
| `migrationDurationMs`     | 5,000ms以下                                                          | 10,000msのplatform request timeoutの半分を上限候補とする |
| `writeProbeMaxDurationMs` | 1,000ms以下                                                          | 同timeoutの10%を単一write待ち上限候補とする              |
| `probeCount`              | 20回以上                                                             | 短時間成功だけを合格にしない最低回数                     |
| 終了状態                  | migration/probe成功、cleanup `completed`、migration status `current` | いずれか欠落時は不合格                                   |

これらはGensoko固有の保守的な候補であり、SupabaseのSLOや正式な運用承認値ではない。環境同等性を確認できない、1項目でも超過・欠落する、またはmaintenance windowが未承認の場合はT33を未完了のままとし、T36へ進まない。production migrationを初回性能試験に使わない。通常`CREATE INDEX`では許容できない場合は、`CREATE INDEX CONCURRENTLY`のinvalid index検出・除去・再試行を含む別runbookを設計してから計画を更新する。

workflowは`gensoko-batch-jobs`でmigration、性能確認、監査fixture、legacy cleanupを直列化する。既存User・legacy soft-deleted Userを削除せず、Prismaとprobeの生ログを表示せず、ログへ内部ID・PII・接続情報・生Errorを出さない。run URL、件数、時間、cleanup状態、合否だけを計画書へ記録する。

`Staging Database Setup`の既定`apply`は通常・将来migration用で、性能測定flagや確認文字列を要求しない。ただし対象account deletion index migrationがpendingの間は初回計測を迂回しないよう拒否する。対象以外も同時にpendingなら`measure-account-deletion-indexes`と`seed-elements`を拒否し、対象1件だけをpendingにできる適用順序またはisolated staging相当環境での再現計画を作る。

### staging runbook（T35）

Actionsの`Staging Account Deletion Cleanup Fixtures`と`Staging Account Data Deletion`を`develop` branchから実行する。fixture preflightを含む変更がmergeされ、T35のタスク境界で明示承認を得るまで実行せず、承認後も次の順序を変更しない。

1. `ACCOUNT_DATA_DELETION_EXECUTE_ENABLED=false`と`ACCOUNT_DATA_DELETION_STAGING_FIXTURES_ENABLED=false`を確認する。
2. fixture flagだけを`true`へ変更し、fixture workflowの`prepare`を実行する。legacy target 1件、所有row 2件、active/suspended sentinel各1件、Element有り以外なら停止する。
3. cleanup workflowの`dry-run`を実行する。workflow内の`verify-isolated`が未知のlegacy row 0件と完全一致fixtureを確認してから、User件数、所有row件数、必要batch数、終了codeを記録する。
4. 旧API instanceのdrain、staging backup、承認記録を確認する。
5. execute flagを`true`へ変更し、operation `execute`と確認文字列`DELETE_LEGACY_SOFT_DELETED_USERS`を指定する。workflowは`--staging-synthetic-only`で完全一致fixture IDだけを削除候補に限定する。preflight後に未知のlegacy rowが発生した場合、そのrowは削除せず残件として失敗させる。実行後の`verify-cleaned`でtarget・所有row 0件、sentinel・Element保持を確認する。
6. 同じexecuteを再実行し、preflightがcleanup済み0件を受理して削除0件で成功する冪等性を確認する。
7. fixture workflowの`remove`でsentinelを削除し、両flagを`false`へ戻す。
8. run URL、件数、所要時間、API/UI確認結果を計画書へ記録する。

失敗時は最初にflagを`false`へ戻す。処理済みbatchはcommit済みであり、再実行は残件から継続する。raw DB error、User ID、email、usernameをIssue・PR・チャットへ転載しない。

### production runbook（T38）

Actionsの`Production Database Operations`を`develop` branchから実行する。Environment protection ruleによる承認を維持し、次の順序を変更しない。

1. operation `backup`を実行し、24時間以内の成功run IDと期限内の暗号化Artifactを確認する。
2. `ACCOUNT_DATA_DELETION_EXECUTE_ENABLED=false`で`account-deletion-dry-run`を実行し、24時間以内の成功run IDと1日保持marker Artifactを確認する。
3. dry-run件数、必要batch数、DB負荷、旧instance drain、承認者、change recordを確認する。
4. flagを`true`へ変更し、`account-deletion-execute`へbackup run ID、dry-run run ID、確認文字列、承認者識別子、change record識別子を入力する。
5. workflow内の実行後dry-runが残件0件で成功し、step summaryへ承認記録が残ったことを確認する。
6. flagを直ちに`false`へ戻し、再度`account-deletion-dry-run`を実行して0件を確認する。
7. run URL、件数、所要時間、backup run ID、dry-run run ID、承認者、change recordを安全な運用記録へ残す。

### production本人削除smoke runbook（R16）

Actionsの`Production Account Deletion Smoke`を、R15でreview済みrelease候補を配備した後に`main` branchから手動実行する。R5の反復利用するauth smoke accountとは別に、公開registerとmail verifyを通した一回限りのsynthetic `USER`だけを使う。DBへの直接insert、ローカルshellからのDELETE、通常accountへの流用は禁止する。

#### 事前準備

1. T35、R13〜R15のうち選択pathで必要なgateが完了し、T1Bの実行者、承認者、実行時間帯、通知先が実値で承認済みであることを確認する。
2. production Environmentのfrontend origin、API base URL、registrable domainがR14の証拠と一致し、review済み40桁SHAが配備対象かつworkflowを起動する`main`の`GITHUB_SHA`と完全一致することを確認する。
3. 一回限りaccountのusernameが`prod_delete_smoke`、email local-partが`prod-delete-smoke`または`prod-delete-smoke+<英小文字・数字・hyphen>`、email domainがproduction registrable domain配下、roleが`USER`であることを作成責任者が確認する。email、password、内部IDを運用記録へ転記しない。
4. `PRODUCTION_ACCOUNT_DELETION_SMOKE_ENABLED=false`を別画面で確認する。実行直前の承認後だけ`true`へ変更する。
5. runbookの記録欄へreview済みSHA、承認者の非秘密識別子、change record、実行時間帯、通知先を記入する。

#### main実行

1. Actions > Production Account Deletion Smoke > Run workflowで`main` branchとoperation `main`を選ぶ。
2. `reviewed_sha`へ現在の40桁`GITHUB_SHA`、`confirmation`へ`DELETE_PRODUCTION_SYNTHETIC_ACCOUNT`、`approved_by`と`change_record`へ承認済みの非秘密識別子を入力する。credentialはworkflow入力やcommand lineへ入力しない。
3. validation jobがbranch、SHA、enable flag、確認文字列、承認者、change recordを拒否しなかったことを確認する。
4. main summaryのstatusが`completed`であることを確認する。specは削除前profileのemail・username・`USER`完全一致、loginで発行されたrefresh tokenの安全属性、keyboardだけによる確認checkbox・本人削除、refresh Cookie削除、旧access token 401、削除前refresh tokenの明示再送401、同一資格情報login 401を一続きで検証する。
5. main成功時はrecovery jobがskipされる。mainが失敗・cancel・timeoutになった場合は、別runnerのrecoveryが起動する。production Environmentのrequired reviewerはjobごとに保護ルールを通過させるため、recoveryが`Waiting`なら元の承認者が内容を再確認して承認し、bypassしない。summaryは`completed`だけを成功とし、`failed`、summary欠落、job未起動・未承認は公開停止条件とする。
6. 成否にかかわらず`PRODUCTION_ACCOUNT_DELETION_SMOKE_ENABLED=false`へ戻し、別画面で復旧を確認する。

#### recovery-only

runnerのhard killなどで自動recovery自体が起動しなかった場合だけ、同じreview済みSHA、同じEnvironment Secret、同じ承認記録でoperation `recovery-only`を実行する。login 401は削除済みとSecret不一致を区別できないため`failed`とする。login 200かつprofileの予約identity完全一致時だけ削除を再試行して`completed`とする。profile不一致、401、5xx、network、非JSON、状態不明ではDELETEを送らず公開を停止する。

`recovery-only`でSecretやidentityを差し替えない。別accountの削除、identity不一致時の手動DELETE、DBからの直接削除は新しい事故対応計画と承認がない限り行わない。

#### 証拠・停止条件

安全な運用記録へ残すのは、run URL、review済みSHA、実行日時、承認者、change record、main/recoveryの`completed` / `failed`、flag復旧結果だけとする。email、username、password、token、Cookie、内部ID、raw error、trace、video、screenshot、storageStateは保存しない。

- validation失敗、profile不一致、main/recoveryの`failed`、status欠落、flag復旧未確認ではR6/R16を完了にせず公開を停止する
- 削除後の旧access、refresh、loginのいずれかが401以外なら、新しいsynthetic accountで再試行せず、認証・削除実装を調査する
- 本人削除済みUserと所有rowはrollbackで復元しない。配備障害時は新規削除を停止し、互換な直前app版へのrollbackを検討する
- Playwright設定はworkers 1、retries 0、trace/screenshot/video off、output非保持を維持する

### contract migration runbook（T43/T44）

guard SQLは`backend/prisma/contract-migrations`へ隔離され、通常の`prisma migrate deploy`では適用されない。T41のcleanup後backup・旧Artifact 7日失効とT42のisolated restore drill、各環境のlegacy dry-run 0件、T39非参照codeのdeploy・soakがすべて完了するまで、staging/productionへ手動適用しない。

適用手段と承認記録はT44で別途確定する。T44では、legacy 0件確認後にPrisma schemaから`deletedAt`を除去してClientを再生成し、そのClientを使う非参照版をdeploy・soakしてからcontract SQLを適用する。SQLはtransaction開始直後に`users` tableの`ACCESS EXCLUSIVE` lockを取得し、guard確認からDDLまでの間にlegacy rowが挿入される競合を閉じる。SQLを通常migration directoryへ移動してgateを迂回しない。guard失敗時はgeneric errorだけを記録し、件数、User ID、接続情報、生Errorを転載しない。drop後のrollback候補は再生成済みT39非参照版だけとし、旧列をPrisma Clientの暗黙`RETURNING`へ含む版を再配備しない。

### rollback・restore制約

- アプリケーションを旧versionへ戻しても、commit済みの物理削除User・所有rowは復元されない。障害時は新規削除を停止し、未処理batchだけを保留する
- backup復元は現在のproductionへ直接上書きせず、isolated projectで行う。復元dataにはbackup取得時点の削除対象Userが含まれる可能性がある
- 現行production DBが読める場合は、backup取得後の削除成功監査をreplay sourceとして削除済みUserを再削除する。現行production DBも全損した場合のexternal replay sourceは未導入で、完全な再削除を保証できない残存リスクを2026-07-22に正式承認した
- T42のrestore drill完了前に復元を完全削除保証済みと判断しない。削除済みdataが一時的に復元され得ることを前提に、再削除と切替前承認が完了するまでtrafficを流さない
- cleanup後backupの取得とcleanup前Artifactの7日失効確認はT41で行う。期限前のArtifactを手動削除せず、保持境界を運用記録へ残す
- 誤実行時はflagを`false`へ戻し、対象件数・実行時刻・run URL・承認記録だけを保存する。無承認のDB復元や、削除済み個人情報の別DBへの抽出を行わない

### R4 privacy・監査・backup承認記録

| 項目           | 正式値・承認内容                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 承認者         | プロダクトオーナー `RitukoIsibasi0222`                                                                                                    |
| 承認日         | 2026-07-22                                                                                                                                |
| 運営主体       | `rituko.llink`                                                                                                                            |
| 問い合わせ先   | `isibasiwork@gmail.com`                                                                                                                   |
| 制定日・発効日 | 2026年8月1日                                                                                                                              |
| 初版バージョン | `1.0`                                                                                                                                     |
| 外部サービス   | Vercel、Cloudflare、Supabase、Resend、GitHub Actions・Artifacts                                                                           |
| 監査           | セキュリティインシデント・管理者操作の相関調査、公開API・UIへの非提供、運用上必要な担当者へのアクセス限定、365日保持                      |
| backup         | AES-256暗号化archiveとSHA-256 checksumだけをArtifactへ保存し、最大7日保持。平文dumpは保存しない                                           |
| 全損時replay   | external replay sourceは未導入で完全な再削除を保証できない。隔離復元、確認できる削除記録の再適用、最大7日の失効境界を残存リスクとして承認 |
| 改定           | 制定日は維持し、改定日・発効日・バージョンを更新して `/privacy` で告知                                                                    |

この承認はproduction deploy、backup日次化、restore drill、production cleanupの実行許可ではない。各操作は対応するRタスクと個別承認を満たしてから実施する。

---

## GitHub Actions による自動デプロイ（CI/CD）

backend/frontend品質手順は`.github/actions/backend-quality/action.yml`と
`.github/actions/frontend-quality/action.yml`を正本とし、PR workflowとproduction exact SHA gateから共用する。PR workflowへcommandを複製しない。

| workflow                      | trigger                                         | Environment / mutation                                                          |
| ----------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `backend-pr-quality.yml`      | `develop` / `main`向け関連PR                    | Environmentなし。test、Workers test/build、lint、format、build、Prisma validate |
| `frontend-pr-quality.yml`     | `develop` / `main`向け関連PR                    | Environmentなし。audit、test、lint、check、format、Preview build contract       |
| `repository-integrity.yml`    | `develop` / `main`向け全PR                      | Environmentなし。workflow/source境界test                                        |
| `staging-frontend-deploy.yml` | `develop`のfrontend push                        | `staging`。Git Integration由来Previewと固定domainをread-only検証                |
| `production-deploy.yml`       | deploy対象を含む`main` push、入力なしmanual再開 | 単一`production`承認。API→health→staged frontend→promote→smoke→safe evidence    |
| `production-database.yml`     | manual、許可済みschedule                        | DB操作の唯一の承認付き経路。通常deployからmigrationを呼ばない                   |

production deploy専用credentialは`production` Environmentだけへ登録し、Secret参照stepの`env`に限定する。既存M1証拠収集用credential、staging credential、repository Secretを流用しない。Workers runtimeへ`DATABASE_URL`を設定せず、production Workerはproduction専用Hyperdrive bindingを使う。

---

## 定期バッチ運用（GitHub Actions schedule）

フェーズ9時点ではCloudflare Workers基盤が未整備だったため、週間スコアリセット、GameQuestionSet cleanup、監査ログcleanupはGitHub Actions scheduleから既存Node CLIを実行する方針を採用した。2026-07-23時点ではAPI Worker、`backend/wrangler.jsonc`、Hyperdrive接続は実装済みだが、定期batchの実行主体は変更しておらず、GitHub Actions scheduleを正本として維持する。

### 採用理由

- 既存のresetWeeklyScores、cleanupExpiredGameQuestionSets、cleanupExpiredAuditLogsはNode + Prisma adapter-pg前提で動作確認済み
- API WorkerのPrisma/Hyperdrive方針が確定しても、scheduled handler、失敗通知、concurrency、手動recoveryの移行証拠は別途必要
- CronだけをWorkersへ移すと、既存Actionsの通知・artifact・承認gateと二重実行防止を同時に設計する必要がある
- GitHub Actions schedule なら DATABASE_URL を Actions Secret として渡し、既存の npm run batch:scheduled から同じ wrapper を実行できる

### 実行スケジュール

| job                     | GitHub Actions cron | 意味                            | 備考                                                     |
| ----------------------- | ------------------- | ------------------------------- | -------------------------------------------------------- |
| 週間スコアリセット      | 7 15 \* \* 0        | UTC 日曜 15:07 = JST 月曜 00:07 | wrapper は Cloudflare 形式の 0 15 \* \* SUN も受け付ける |
| GameQuestionSet cleanup | 17 18 \* \* \*      | UTC毎日18:17 = JST毎日03:17     | 論理TTLはAPIで同期検証し、物理削除だけを日次実行する     |
| 監査ログcleanup         | 37 18 \* \* \*      | UTC毎日18:37 = JST毎日03:37     | cleanup無効時は状態確認後にskipする                      |

GameQuestionSetの有効期限30分は`submitGameSession()`が`expiresAt <= now`で同期的に拒否する。cleanupが次の日次runまで遅れても期限切れ送信は受理されないため、物理削除頻度を論理TTLと同じ30分へ合わせない。設定上の起動回数は週344回から週15回へ減少する。

### 必要なSecret・Variables

GitHub の Settings > Environments でmanual用`staging` / `production`とscheduled専用`production-batch`を分離する。以下のSecret・Variablesはrepository-level（Settings > Secrets and variables > Actions）へ登録せず、表に示す各Environmentへ登録する。

| Environment      | 種別     | 名前                                 | 値・扱い                                                                            |
| ---------------- | -------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| staging          | Secret   | `DATABASE_URL`                       | staging専用DB接続文字列。workflow・リポジトリ・ログへ直接書かない                   |
| staging          | Variable | `BATCH_ENVIRONMENT`                  | `staging`                                                                           |
| staging          | Variable | `AUDIT_LOG_RETENTION_DAYS`           | 検証用`365`                                                                         |
| staging          | Variable | `AUDIT_LOG_CLEANUP_ENABLED`          | 初期値`false`。実削除確認中だけ明示的に`true`へ変更する                             |
| staging          | Variable | `REFRESH_TOKEN_CLEANUP_ENABLED`      | 初期値`false`。refresh token実削除の承認中だけ明示的に`true`へ変更する              |
| staging          | Variable | `AUDIT_LOG_STAGING_FIXTURES_ENABLED` | 初期値`false`。T19のfixture操作中だけ`true`へ変更する                               |
| staging          | Secret   | `STAGING_SUPABASE_PROJECT_REF`       | staging Supabase project ref。接続先取り違え防止用。Actionsのenv一覧へ表示させない  |
| production       | Secret   | `DATABASE_URL`                       | production専用DB接続文字列。stagingと共用しない                                     |
| production       | Secret   | `BACKUP_ENCRYPTION_PASSPHRASE`       | 20文字以上のbackup暗号化専用値。password managerにも保存し、DB passwordと共用しない |
| production       | Variable | `BATCH_ENVIRONMENT`                  | `production`                                                                        |
| production       | Variable | `AUDIT_LOG_RETENTION_DAYS`           | 2026-07-14承認済みの正式保持期間`365`                                               |
| production       | Variable | `AUDIT_LOG_CLEANUP_ENABLED`          | 全release gate完了までは`false`                                                     |
| production       | Variable | `REFRESH_TOKEN_CLEANUP_ENABLED`      | refresh token実削除が別途承認されるまでは`false`                                    |
| production-batch | Secret   | `DATABASE_URL`                       | production専用Session pooler。値を取得・表示・記録しない                            |
| production-batch | Secret   | `BACKUP_ENCRYPTION_PASSPHRASE`       | scheduled暗号化backup専用。BO15前に別承認で追加し、値を取得・表示・記録しない       |
| production-batch | Variable | `BATCH_ENVIRONMENT`                  | `production`                                                                        |
| production-batch | Variable | `AUDIT_LOG_RETENTION_DAYS`           | 承認済みの正式保持期間`365`                                                         |
| production-batch | Variable | `AUDIT_LOG_CLEANUP_ENABLED`          | release gate完了までは`false`                                                       |
| production-batch | Variable | `REFRESH_TOKEN_CLEANUP_ENABLED`      | 自動化が別途承認されるまでは`false`                                                 |

repository Variable `PRODUCTION_SCHEDULED_BATCH_ENABLED`はscheduled job全体のkill switchである。初期値は未設定または`false`とし、`production-batch`の設定を値非表示で確認し、ownerが有効化を別途明示承認した後だけ文字列`true`へ変更する。

`Batch Jobs`は、手動実行では選択した`staging` / `production`、scheduleでは`production-batch`を参照する。`Production Database Operations`はmanualでrequired reviewer付き`production`、scheduleで`production-batch`を参照する。どちらも`production-batch`をworkflow_dispatchの選択肢へ追加しない。scheduled requestはEnvironmentを持たないpreflightでkill switchを判定し、無効ならSecret、依存関係install、DB接続、concurrency取得より前に`disabled`として安全終了する。`BATCH_ENVIRONMENT`が期待値と一致しない場合、または必要なSecretが未登録の場合はDB処理前に失敗する。

保持期間・cleanup flagは秘密情報ではないためEnvironment Variablesで管理する。`AUDIT_LOG_RETENTION_DAYS`の未設定・空文字・不正値は削除前に失敗する。`AUDIT_LOG_CLEANUP_ENABLED`と`REFRESH_TOKEN_CLEANUP_ENABLED`はruntime環境変数自体が省略された場合だけ`false`になるが、workflowでは未登録Variableが空文字として渡りvalidation失敗になるため、3 Environmentすべてへ両方を`false`で明示登録する。

### staging DBの初期構築

1. Supabase Dashboardでstaging専用projectを作成する。project名は`gensoko-staging`とし、productionと共用しない。
2. database passwordはpassword managerで生成・保存し、repository、文書、Issue、PR、チャットへ記載しない。
3. projectの`Connect`からSession pooler（port 5432）のURIを取得する。GitHub-hosted runnerから接続するため、IPv4対応のSession poolerを使用する。
4. GitHub repositoryのSettings > Environments > staging > Environment secretsで、URIを`DATABASE_URL`として登録する。
5. `.github/workflows/staging-database.yml`が`develop`へmergeされた後、Actions > Staging Database Setup > Run workflowで`develop`と通常の`apply`を選んで実行する。account deletion index migrationがpendingの場合は通常適用せず、T33 runbookの計測モードを使う。
6. `npx prisma migrate deploy`の成功と、適用済みmigration一覧をActions logで確認する。接続URLやpasswordをlogへ出さない。

Staging Database Setup workflowは手動実行専用で、GitHub Environmentを`staging`へ固定する。productionの選択肢、schedule、schema生成、seed処理は持たない。通常の`apply`とT33専用の`measure-account-deletion-indexes`を明示選択し、Environment識別子または`DATABASE_URL`が未設定ならmigration前に失敗する。

### 手動実行・retry

GitHub Actions の Batch Jobs workflow は workflow_dispatch に対応している。最初に`target_environment`を選び、次に`batch_job`を選ぶ。manual選択肢は`staging` / `production`だけで、`production-batch`は選択できない。T19では必ず`staging`を選択する。`production`はT20のrelease gate完了前に選択しない。

| 入力                 | 選択肢                      | 実行内容                                    |
| -------------------- | --------------------------- | ------------------------------------------- |
| `target_environment` | `staging` / `production`    | 手動実行の接続先。既定は`staging`           |
| `batch_job`          | `weekly-reset`              | 週間スコアリセット                          |
| `batch_job`          | `game-question-set-cleanup` | 期限切れ GameQuestionSet cleanup            |
| `batch_job`          | `audit-log-cleanup-dry-run` | 期限超過件数とcutoffをpreviewし、削除しない |
| `batch_job`          | `audit-log-cleanup-execute` | cleanup有効時だけ実削除する                 |

Actionsのscheduleは遅延・スキップされる可能性があるため、毎時00分付近を避けて分散している。`Batch Jobs`のscheduleは`gensoko-scheduled-batch`、`Production Database Operations`のscheduleは`gensoko-scheduled-production-database`、manual production DB操作は既存の`gensoko-batch-jobs` concurrency groupを使う。すべて`cancel-in-progress: false`を維持する。同じgroupではrunning最大1件・pending最大1件で、新しいrunが既存pendingを置き換えるが、実行中DB操作は自動中断しない。scheduled runはmanual用groupを取得しないため、manual production DB操作を待たせない。失敗時は安全ログを確認し、原因解消後もworkflow dispatch、再実行、cancelはそれぞれ明示承認を得る。

### 2026-07-31 運用再開時点

- PR #166は`develop`へmerge済みで、merge commitは`ffb66269be48897da3904308a690a9cc9913ff94`である。
- 外部設定記録のPR #168も`develop`へmerge済みで、merge commitは`4c1a3739b61698a8562fb91db425502c5fa8f872`、最終headは`d5f9d5c8f7b6d5e9495a345e403a84a2db3b1cd8`である。
- 旧run #804（ID `30419479066`）と#868（ID `30613767092`）は、jobの`steps`が空でDB処理未開始であることを確認してcancel済みである。再確認時のwaiting / queued / in-progress / pendingは0件である。
- `production-batch` Environmentはrequired reviewerなし・`develop`限定で作成済みだが、main境界への外部切替は未実施である。切替後は`main`だけを許可する。`DATABASE_URL` Secret名と、必要な4 Environment Variable名と期待値の一致を値非表示で確認した。
- repository Variable `PRODUCTION_SCHEDULED_BATCH_ENABLED`は安全側の無効設定で登録済みである。
- `staging`と`production`の`REFRESH_TOKEN_CLEANUP_ENABLED`は安全側設定で登録済みである。
- `production`のrequired reviewerは維持する。repository変更のmerge後、別承認で`production`と`production-batch`を`main`限定へ変更し、`staging`は`develop`限定を維持する。
- 外部設定後のactive Batch Jobsは0件である。kill switch有効化、workflow実行、production DB queryは行っていない。

### 2026-08-05 Production Database Operations scheduled滞留の恒久対策

read-only再確認では、`Production Database Operations`のcompleted以外のrunは0件だった。直近の滞留事象はschedule 2件で、いずれもmainの旧SHA、1時間超、production jobのstep開始0件、DB対象検証・migration・seed・容量確認などのsensitive step開始0件だった。manual runは含まれていなかった。識別子、URL、Secret、接続情報は証拠へ記録しない。

旧workflowの時系列は次のとおりだった。

1. schedule triggerを受ける。
2. Environmentを持たないbranch validationだけが成功する。
3. operation解決とkill switch判定を行わないまま、後続jobがmanualと同じ`gensoko-batch-jobs` concurrencyを取得する。
4. 後続jobがrequired reviewer付き`production` Environmentへ入り、1件がwaitingになる。
5. `cancel-in-progress: false`のためwaitingを中断せず、同じgroupの後続1件がpendingになる。
6. operation解決、Secret参照、依存導入、DB処理はEnvironment承認後のstepなので未開始のまま、manual production DB操作のgateを阻害する。

恒久修正後の時系列は次のとおりとする。

1. scheduleまたはworkflow_dispatch triggerを受ける。
2. Environment、Secret、checkout、依存導入、DB接続を持たない`validate-production-request`がevent、branch、kill switch、cron/manual operationを解決する。
3. 非main scheduleは`skipped`、kill switchが文字列`true`でないscheduleは`disabled`、未知event・cron・operationまたは非main manualは`failure`、実行可能requestだけを`ready`へ固定分類する。
4. `disabled` / `skipped`は成功終了、`failure`は固定errorで失敗し、いずれも後続jobを起動しない。summaryは分類と「Environment・Secret・依存・DB未開始」だけを記録する。
5. `ready`だけが後続jobへ進む。scheduleは`production-batch`と専用concurrency、manualはrequired reviewer付き`production`と既存manual concurrencyを使う。
6. Environment設定検証後にcheckout、必要な依存導入、DB処理へ進む。capacity/backupの外部コマンドerrorは一時fileへ隔離し、raw errorをlogへ出さず固定メッセージだけを出す。

この修正は既存runを自動cancelしない。古いSHAのrunが残る場合はjob/step到達状況を値非表示で確認し、実行中DB操作の中断影響を評価したうえで、runごとに別承認を得る。repository修正中も`PRODUCTION_SCHEDULED_BATCH_ENABLED=false`を維持し、BO15を有効化しない。read-only inventoryでは`production-batch`にscheduled backup用Secret名がまだないため、その追加は対象と影響を説明した別承認操作とし、このrepository修正では外部設定を変更しない。

### scheduled productionの軽量source contract

`production-batch`はruntime承認を持たないため、次の低コストなsource contractを維持する。

1. `.github/workflows/repository-integrity.yml`が`develop`向け全PRでpath filterなしに起動することを確認する。
2. check名`Repository Integrity / repository-integrity`を固定し、Secret・Environmentを参照せずbatchの安全境界contractだけを検証する。
3. 既存`Backend PR Quality` / `Frontend PR Quality`はpath filter付きのため、全PR共通のrequired checkへ直接指定しない。
4. `production` Environmentのrequired reviewerと`main`限定branch policyを維持する。
5. `production-batch`は`main`だけを許可し、workflow_dispatchの選択肢へ追加しない。参照元は`.github/workflows/batch.yml`と`.github/workflows/production-database.yml`のscheduled経路だけに限定する。

Gensokoはcollaboratorがowner 1名の個人ポートフォリオである。非作成者レビュー、厳格なruleset、`Repository Integrity`のrequired check化、docs-only検証PRは運用完了条件にしない。将来複数人運営へ移行する場合は、その時点の権限・費用・運用負担に応じて追加保護を別途検討する。

### v0.1のbranch昇格境界

1. feature/fix/docs変更はdevelop向けPRで統合し、staging・開発品質を確認する。
2. release branchは作成せず、review済みdevelop固定SHAからmainへの直接PRを作成する。
3. main向けPRでもBackend PR Quality、Frontend PR Quality、Repository Integrityを実行する。このPRはPreview/build確認だけでproduction deployを起動しない。
4. review後、別の明示承認でmainへmergeし、生成されたmain SHAと昇格元develop SHAのtree一致を確認する。
5. 確定main SHAでM3を再実行する。
6. 別承認で`production`だけをrequired reviewer維持のままmain限定へ変更し、さらに別承認で同じmain SHAのM1R read-only evidenceを再取得・reviewする。`production-batch`とdefault branchはM1R review完了まで変更しない。
7. M1R review後の別承認で`production-batch`をmain限定へ変更してからdefault branchをmainへ切り替える。stagingはdevelop限定、kill switchは`false`を維持する。Vercel ProductionとCloudflare productionのmain SHA基準は値非表示で確認し、M5承認前にdeployしない。
8. 通常release後のmain→develop同期は行わない。main固有hotfixがある場合だけmain→develop PRを作成する。

### v0.1公開とBO15〜BO18の実行順序

定期バッチの外部設定が完了していても、ポートフォリオ版v0.1の公開前にBO15を先行しない。次の順序を維持する。

1. main merge後の確定SHAでM3とM1Rを再固定する。
2. M5でsame-site URL、Cookie、CORS、メール送信元、production専用Secret・binding、DB target、pending migration、review済みmain SHA、rollback先を値非表示でpreflightし、別承認後にAPI、frontendの順でdeployする。
3. M6で単一synthetic Userによる登録・メール受信から退会、game、refresh、通常password verifier DO、最小429、security、User所有row cleanup、flag復旧を確認する。
4. M5/M6完了後、`production-batch`にscheduled backup用Secret名が存在することを値非表示で確認する。未登録なら対象と影響を説明し、BO15とは別の明示承認で1操作だけ追加する。
5. BO15の別承認を得て`PRODUCTION_SCHEDULED_BATCH_ENABLED=true`へ変更する。workflow_dispatchは実行しない。
6. BO16では自然発生する日次GameQuestionSet cleanup、日次audit cleanup、週次reset、production DB容量確認、暗号化backupを確認する。問題があればkill switchを`false`へ戻す。
7. 初回run確認後にBO18として計画書・進捗・runbookを実態へ同期する。

repository変更のdevelop merge、develop→main PR作成、main merge、M3、production EnvironmentのM1R前切替、M1R、production-batch・default branch・provider基準の後段切替、M5 preflight、M5 deploy、M6 smoke、BO15有効化はそれぞれ別の境界である。この文書だけを根拠にmerge、外部設定変更、deploy、workflow dispatch、production DB query、Secret値参照、kill switch有効化を行わない。

### scheduled production初回有効化

BO13の外部設定が完了していても、確定main SHAのM3/M1RとM5/M6完了、BO15の明示承認までは定期実行を有効化しない。次の順序で行う。

1. M5/M6の完了記録、review済みSHA、軽量`Repository Integrity`、`production` reviewer維持を確認する。
2. `production-batch`がrequired reviewerなし・`main`限定であり、workflow_dispatchから選択できないことを再確認する。
3. `DATABASE_URL` Secret名と必要なVariable名・期待値を値非表示で再確認する。Secret値はCLI、log、Artifact、summary、Issue、PR、文書へ出さない。
4. active Batch Jobsが0件であることを確認する。
5. `PRODUCTION_SCHEDULED_BATCH_ENABLED=false`を維持したまま停止し、有効化の別承認を得る。
6. 別承認後に`PRODUCTION_SCHEDULED_BATCH_ENABLED=true`へ変更する。
7. 最初に自然発生する日次GameQuestionSet cleanup、日次audit cleanup、週次resetについて、対象SHA、job名、status / conclusion、DB処理前validation、cleanup結果またはskip・失敗理由を簡潔に記録する。
8. Secret、PII、内部ID、raw DB errorがlogにないことを確認する。問題があれば`PRODUCTION_SCHEDULED_BATCH_ENABLED=false`へ戻す。

14日間のbaseline、オンコール、SLA、外部監視、複雑な通知は個人ポートフォリオの運用完了条件にしない。公開後にDB容量、所要時間、失敗の問題が見つかった場合だけ、必要な期間の追加観測を行う。

### scheduled production停止・rollback

1. 即時停止時は最初に`PRODUCTION_SCHEDULED_BATCH_ENABLED=false`へ戻す。
2. active scheduled runがある場合はjobとDB stepを確認し、実行中のDB stepを無条件にcancelしない。処理の冪等性と中断影響を確認する。
3. 次回scheduleがEnvironmentへ入らずskipすることを確認する。
4. code rollbackではkill switchを`false`にした後、問題commitをrevertするPRを作成する。
5. 30分cronへは戻さない。必要なcleanupは既存workflow_dispatchから対象jobを1回だけ実行する。
6. migrationなどbatchと同時実行できない作業の前も、kill switchを`false`にし、active scheduled runがないことを確認する。

### T19 staging fixtureによる境界・再実行・停止確認

`.github/workflows/staging-audit-cleanup-fixtures.yml`は手動実行専用で、GitHub Environmentを`staging`へ固定する。次の多重guardをすべて満たさない限りPrismaへ接続しない。

Batch Jobsと同じ`gensoko-batch-jobs` concurrency groupを使用し、fixture操作と監査ログcleanupを相互に直列化する。実行中のjobはcancelせず、先に開始した操作の完了を待つ。

- `BATCH_ENVIRONMENT=staging`
- `AUDIT_LOG_STAGING_FIXTURES_ENABLED=true`
- `STAGING_SUPABASE_PROJECT_REF`と`DATABASE_URL`のusername内project refが一致
- 接続先hostがSupabase poolerで、Session poolerのport 5432

fixtureは専用actionを持つ期限切れ1件と期限内1件だけである。公開API、raw SQL、実ユーザーID、メールアドレスなどのPIIは使用しない。`prepare`は既存fixtureだけを置換し、`verify-cleaned`は期限切れ0件・期限内1件を確認し、`remove`は専用fixtureだけを削除する。

T19では次の順序を変更しない。

1. `AUDIT_LOG_CLEANUP_ENABLED=false`のまま、`AUDIT_LOG_STAGING_FIXTURES_ENABLED=true`へ変更する。
2. Staging Audit Cleanup Fixturesで`prepare`を実行する。
3. Batch Jobsで`staging` / `audit-log-cleanup-dry-run`を実行し、期限超過1件・削除0件を確認する。
4. `AUDIT_LOG_CLEANUP_ENABLED=true`へ変更し、Batch Jobsで`staging` / `audit-log-cleanup-execute`を実行する。
5. Staging Audit Cleanup Fixturesで`verify-cleaned`を実行し、期限切れ0件・期限内1件を確認する。
6. Batch Jobsの同じexecuteを再実行し、削除0件を確認する。
7. `AUDIT_LOG_CLEANUP_ENABLED=false`へ戻し、executeでskipされることを確認する。
8. Staging Audit Cleanup Fixturesで`remove`を実行する。
9. `AUDIT_LOG_STAGING_FIXTURES_ENABLED=false`へ戻す。

各runのURL、cutoff、件数、終了code、秘密情報・内部ID・PII・raw errorがlogにないことを計画書へ記録する。途中失敗時は先にcleanupを`false`へ戻し、fixture workflowの`remove`を実行する。production Environmentではこのworkflowを実行できない。

### 監査ログcleanupのrelease gate

次の全項目を記録するまで、productionの`AUDIT_LOG_CLEANUP_ENABLED`を`true`にしない。

| 項目         | 現在の記録                                                      | 状態                  |
| ------------ | --------------------------------------------------------------- | --------------------- |
| 正式保持期間 | 365日                                                           | 2026-07-14承認        |
| 保持目的     | セキュリティインシデント・管理者操作の相関調査                  | 2026-07-14承認        |
| 内部ID保持   | 監査rowと同じ365日だけ`actorId`・`targetId`を保持               | 2026-07-14承認        |
| 承認者       | プロダクトオーナー`RitukoIsibasi0222`                           | 2026-07-14記録        |
| 一次対応者   | `RitukoIsibasi0222`                                             | 2026-07-14設定        |
| 通知先       | GitHub Actions failureの登録メール（failed workflowのみ）       | 2026-07-14設定        |
| 容量         | Supabase Free 500MB、警告350MB、重大425MB                       | 初回run成功・Disk 13% |
| backup/PITR  | Freeの自動backup・PITRなし。暗号化論理backupをArtifactへ7日保持 | 2026-07-14初回成功    |

保持期間・目的・承認者は上表をsource of truthとし、変更時は変更前dry-runと再承認を記録する。公開前7日baselineは2026-07-21に完了した。公開後実負荷baseline、アカウント完全削除のproduction gate、その他release gateが完了するまでcleanupを有効化しない。

### 監査ログcleanupの監視

定期jobの安全ログで次を確認する。

- 直近24時間の生成件数
- 最古・最新`occurredAt`
- cutoffより古いrowの存在
- 削除件数、実行時間、上限到達、削除後残件

正確な期限超過総件数は手動dry-runだけで取得する。全row数、`audit_logs` table・index容量、DB接続数、CPU・I/O・storage latency、backup/PITRはDB providerのDashboard・Metricsをsource of truthとし、容量取得のためのraw SQLをアプリへ追加しない。

| 項目            |                    警告 |                      重大 | 初動                                    |
| --------------- | ----------------------: | ------------------------: | --------------------------------------- |
| DB全体容量      |               quota 70% |                 quota 85% | 増加原因、cleanup結果、契約planを確認   |
| 期限超過残件    |     次回実行後も1件以上 | 最大件数到達または2回連続 | dry-run後に手動再実行し、DB負荷を確認   |
| cleanup失敗     |                     1回 |                   2回連続 | cleanupを無効化し、担当者が原因確認     |
| audit write失敗 |                     1件 |                  継続発生 | backendとDB状態を確認                   |
| 日次増加件数    | 初期7日間はbaseline収集 |          baseline後に決定 | LOGIN FAILURE急増とrate limit状態を確認 |

通知には内部ID、監査ログID、メール、username、秘密情報、生Errorを含めない。通知先が設定されるまで本番運用を完了扱いにしない。

### 監査ログcleanup runbook

1. 初回・保持期間変更前は`audit-log-cleanup-dry-run`を実行し、cutoff、期限超過件数、最古日時、最低実行回数を記録する。
2. backup/PITR、承認者、通知先を確認する。productionでは公開後実負荷baseline、アカウント完全削除のproduction gate、削除保留承認者など残るrelease gateがすべて完了済みであることも確認する。
3. Actions Variableの保持期間が承認値`365`であることを確認する。保持期間を変更する場合は、変更前dry-runとプロダクトオーナーまたはプライバシー責任者の再承認を行う。
4. 全release gateの完了記録と承認内容を再確認した後だけ、日次schedule直前を避けてmanual実行の時間を確保し、`AUDIT_LOG_CLEANUP_ENABLED=true`へ変更する。
5. `audit-log-cleanup-execute`を1回実行し、削除件数・実行時間・残件を確認する。
6. 日次scheduleの次回成功を確認する。

#### 失敗・上限到達

- raw DB errorを外部通知へ転載せず、Actionsの固定event、cutoff、件数、時間、残件状態を確認する
- 原因解消前に連続再実行しない。DB接続・負荷・設定値を確認してからdry-runする
- 最大10,000件または8分到達後も残件がある場合はworkflowが失敗する。対象外rowを削除せず、必要回数だけ手動再実行する
- cleanup本体は8分、batch実行stepは10分、依存関係install等を含むjob全体は20分で停止する。step timeoutやjob timeoutの場合はDB負荷と残件を確認し、直ちに再実行しない
- 2回連続失敗または原因不明の場合は`AUDIT_LOG_CLEANUP_ENABLED=false`へ戻す

#### 削除保留・停止

- インシデント調査や保持判断中は最初に`AUDIT_LOG_CLEANUP_ENABLED=false`へ変更する
- 保留理由、開始日時、承認者、見直し期限をこの文書へ記録する
- 全体停止だけをサポートし、個別row・ユーザー単位のlegal holdは行わない
- flagだけで不十分な場合は`.github/workflows/batch.yml`の監査cronを停止する。既存の週間・問題セットbatchは維持する

#### 誤削除・rollback

- cleanup flagを即時`false`へ戻し、監査ログへの新規書込みを継続できるか判断する
- 対象期間、cutoff、削除件数、実行者、実行時刻を安全な情報だけで記録する
- backup/PITRからの復元可否をDB担当者と判断し、無承認で本番DBを復元しない
- backendを旧versionへ戻す場合も、先にcleanupを無効化して旧codeへ日次cronが想定外実行されないようにする

### Cloudflare Workers Cron へ移行する条件

2026-07-23時点でAPI Workers基盤は整備済みだが、batchはGitHub Actions scheduleで運用する。将来Cloudflare Workers Cron Triggerへ移行する場合は別計画を作成し、以下を満たす。

- `backend/wrangler.jsonc`またはproduction生成configへ`triggers.crons`を追加する
- 既存Workers entrypointとrequest-scoped Hyperdrive接続をscheduled handlerから安全に再利用する
- GitHub Actionsとの二重実行を防ぎ、失敗通知、manual recovery、rollbackを設計する
- Workers runtime test、staging scheduled handler、Cloudflare Dashboardの実行証拠を確認する

## オブザーバビリティ設定

- 本番 API の `500` 系エラーを Sentry 等のエラートラッキング、または Cloudflare Workers の構造化ログで検知できるようにする
- API レスポンスとログを紐づけるため、リクエストごとに `requestId` を発行する
- ログには `method` / `path` / `status` / `durationMs` / `requestId` を含める
- パスワード・トークン・Cookie・メールアドレスなどの秘密情報や個人情報はログや外部監視サービスに送らない
- `500` 系エラーが発生したら開発者へ通知されるよう、通知先を設定する

---

## 本番レート制限設定

> 2026-07-23時点: Honoのpolicy・HMAC key・middleware・route配線、SQLite-backed Durable Object、Workers runtime test、staging namespace/bindingは実装・配備済みである。production entrypoint/config/dry-run契約もrepositoryに存在する。一方、rate limit専用のstaging実HTTP 429/503、WAF、DO cleanup/利用量、production実resource、監視、rollbackは未完了であり、本番適用済みとは扱わない。
>
> 本節はR7全体を完了するための公開後強化runbookである。ポートフォリオ版v0.1ではM5/M6のproduction binding、valid login、最小429、smokeだけをblockerとし、M2 staging campaign、WAF、全境界case、24/48時間観測は延期する。

R7の実行順序、decision gate、テストケース、証拠、停止条件、監視期間、rollback、production依存は
[`docs/plans/r7-rate-limit-environment-gates/plan.md`](plans/r7-rate-limit-environment-gates/plan.md)を正本とする。本節はdeployment全体からR7 runbookへ入るための要約だけを保持する。

### リリースゲート

次を確認できるまでWAF作成、production deploy、実HTTP境界試験へ進まない。

- Cloudflare zone plan、Workers plan、rule枠、field、period、action、custom responseの実account上の利用可否
- staging/production API hostname、対象zone、Custom Domain/Route、`workers.dev`を含む迂回経路
- staging/productionのDurable Object namespace、migration、`RATE_LIMIT_COUNTER` / `PASSWORD_VERIFIER` binding、Secretの分離
- Security Events、Workers metrics、Durable Objects metrics、必要な場合のWorkers Logs閲覧権限
- DO request/RPC、alarm、SQLite read/write/delete、storage、Workers Logsの想定利用量
- staging synthetic fixture、cleanup、実行時間帯、停止時の通知先
- WAF/Worker rollback権限を持つ担当者

未確認の項目がある場合、コード実装が完了していてもR7と`docs/05_progress.md`を完了`[x]`にしない。

### 二層の責務

| 層                                  | 役割                                           | 制限の性質                           |
| ----------------------------------- | ---------------------------------------------- | ------------------------------------ |
| Cloudflare WAF                      | Hono到達前に大量のIP/burstアクセスを遮断       | Honoより高い閾値の粗いedge防御       |
| Hono + SQLite-backed Durable Object | route、検証済みemail、認証済みuserを使って判定 | `docs/02_security.md` の正確なpolicy |

- productionでは`RATE_LIMIT_STORE=durable-object`を必須とし、memory storeへ暗黙fallbackしない。
- `RATE_LIMIT_KEY_SECRET`はJWTとは別の256-bit以上のランダム値をSecretとして設定し、値をログ、文書、PRへ記載しない。
- Durable Object binding名は`RATE_LIMIT_COUNTER`とし、staging/productionで異なるnamespaceへ接続する。
- productionのIP actorには検証済み`CF-Connecting-IP`だけを使い、`X-Forwarded-For`と`X-Real-IP`は無視する。
- 正式なapp policyは`docs/02_security.md`と`policies.ts`をsingle sourceとする。
- WAF edge responseはHonoの日本語JSON契約外とし、frontendの非JSON/network fallbackを維持する。

### Cloudflare現行制約

2026-07-23確認時点で、WAF Freeは1 rule、Path/Verified Bot、10秒のcounting/mitigationであり、methodを条件にできない。Proは2 rulesでcounting最大1分、Businessは5 rulesでMethod等とcounting最大10分を利用できる。実planを確認せず、古い固定候補や複数ruleを適用しない。

Free planの場合はexactな高リスクpath 1本を候補にし、OPTIONS消費と通常trafficを観測してからthresholdを決める。WAFでHonoの10分policyを再現せず、draft/disabled、利用可能ならlog、または十分高いthresholdから段階適用する。高度なWAF tuningは公開後の別taskとする。

### 適用・確認の要約

1. repository contract testと基準SHAを固定する。
2. read-onlyでplan、zone、hostname、resource分離、権限、rollbackを確認する。
3. stagingでauth 11回目、questions 31回目、game submit 21回目、`Retry-After`、resetを安全に確認する。
4. 503はrepository runtime testとconfig validationを必須にし、明示承認されたisolated canary以外でfault injectionしない。
5. DO cleanupとrequest/alarm/storage利用量、R7対象A11Yを確認する。
6. WAFを段階適用し、Security Events、client response、Worker/DO metricsを同じ時間帯で確認する。
7. R5/R14のproduction preflight、R15の共通deploy、R16の非破壊smokeへ統合する。
8. stagingを各段階24時間以上、productionを48時間以上観測し、文書を同期する。

### 障害時・ロールバック

- false positive時は最初にWAF ruleをdisableまたは以前の高い閾値へ戻し、Honoの制限は維持する。
- Hono/DO実装に問題がある場合は以前のWorker versionへ戻す。productionでmemory storeを有効にしない。
- Durable Object障害時は一般APIとquestionsをfail-open、auth/account/game submitをfail-closed 503とする。全policyを一括fail-openにしない。
- 旧Workerへ戻した直後にDO namespaceを削除しない。traffic停止とrollback安定を確認後、別作業でcleanupする。
- HMAC secretの変更は全バケットをリセットするため、緊急時以外はmaintenance承認を必須とする。

---

## M1 production初回状態read-only証拠 runbook

M1の正本は[`docs/plans/m1-production-read-only-evidence/plan.md`](plans/m1-production-read-only-evidence/plan.md)とする。`.github/workflows/production-initial-state-evidence.yml`は`workflow_dispatch`専用で、production DB・Vercel・Cloudflare・GitHubの状態を変更せずに確認し、安全なstatus markerとStep Summaryだけを残す。

実行基盤はPR [#155](https://github.com/RitukoIsibasi0222/gensoko/pull/155)のmerge commit `13e005ba8bf2670612d2ba6ce6547bd389fa3acc`として`develop`へmerge済みである。2026-07-28にM2 repository実装を含むrelease候補`7a6979761428759c744ba3bf9c1ed16527c7b33d`を固定し、M1P-15〜M1P-16を実行・reviewした。結果は後述の実行記録どおりPath Bであり、M1自体は未完了である。

### 別承認で準備する項目

review済みdevelop固定SHAの直接release PRが`main`へmergeされ、確定main SHAのM3が成功した後、次を値非表示で確認する。production Environmentだけをmain限定へ変更する承認とworkflow dispatchの承認を分ける。read-only権限、対象scope、owner attestationのいずれかを確認できない場合は準備を止め、M1を未完了のままPath Bとして扱う。

- GitHub `production` Environmentのrequired reviewer、deployment branch policy、`main`のreview済みSHA
- Variable `BATCH_ENVIRONMENT=production`
- Secret `DATABASE_URL`、`PRODUCTION_SUPABASE_PROJECT_REF`
- Secret `M1_VERCEL_ACCESS_TOKEN`、`M1_VERCEL_SCOPE_ID`、`M1_VERCEL_REPOSITORY`
- Secret `M1_CLOUDFLARE_API_TOKEN`、`M1_CLOUDFLARE_ACCOUNT_ID`、`M1_CLOUDFLARE_WORKER_NAME`
- GitHub tokenの`actions: read`、`contents: read`、`deployments: read`と、Vercel/Cloudflare credentialのread-only scope

値、DB URL、project/account/resource ID、token、メール、User IDをIssue、PR、文書、Step Summaryへ記載しない。Secret/Variableの作成・変更は本runbookのread-only観測には含めず、承認されたM1P-15でのみ行う。

owner attestationを確認できない場合はworkflowをdispatchしない。required inputにnegative/unknown用の値は設けず、placeholderや不一致の固定文字列を意図的に入力してrunを作成しない。run URLやsafe markerは作らず、確認不能という値非表示の判断根拠とPath Bを関連計画へ記録し、M1P-16は未完了のまま通常gateへ戻る。

### dispatchと確認

1. Actionsの`Production Initial State Evidence`をreview済みの`main`固定SHAから選ぶ。
2. `reviewed_sha`に実行中の`main` SHA、`confirmation`に`READ_ONLY_PRODUCTION_INITIAL_STATE`を入力する。
3. `approver`と`change_record`には正規表現で許可された非秘密識別子だけを使う。
4. 削除済みdeployment・外部backup copyがないことを確認済みの場合だけ`history_attestation=NO_DELETED_DEPLOYMENT_OR_EXTERNAL_BACKUP_COPY`を入力する。
5. M1開始からreview完了までproduction変更を凍結できることを確認済みの場合だけ`change_freeze_attestation=NO_CONCURRENT_PRODUCTION_CHANGE`を入力する。
6. production Environment approval画面でworkflow名、ref、SHA、read-only scopeを再確認して承認する。
7. workflow完了後、security/release reviewerがEnvironment approval、Step Summary、1日保持のsafe marker Artifact、run URLを確認する。

workflowはprovider履歴を先にGETで確認し、最後にSupabase接続先を値非表示で検証してPrisma `count`だけをRepeatable Read transaction内で実行する。migration、backup、cleanup、deploy、smoke、raw SQLは実行しない。404、429、timeout、認可不足、pagination不完了、schema不一致、DB target/query失敗は履歴なしと推測せず`unknown`にする。Vercel・Cloudflare・GitHubとGitHub run/job反復はmonotonic clockによる10分の総時間予算を共有し、各GETの前後で残時間を検証する。予算切れ後は追加requestを送らず未完了checkを`unknown`とし、15分のinspection step timeoutより前にsafe marker処理へ進む。

手順4または5を確認できない場合は手順6へ進まず、`Run workflow`を押さない。UI/API操作ミスで不一致のattestationを含むrunが作られた場合は、checkout・DB・provider APIより前のvalidationを失敗させ、`always()`のsafe markerを全項目`unknown`・`path-b`として保存した後にjobを失敗させる。このfallbackは誤dispatch時のfail-closed境界であり、確認不能時に意図的に実行する手順ではない。

### 判定・失効・停止

- 全11 checkが`clear`の場合だけsafe markerは`path-a`候補となる。workflow成功だけではM1を完了にしない。
- 1件でも`present`または`unknown`なら`path-b`で失敗させる。schema v1のPath Bは変更せず、親release計画でM1Rが成立しない場合はR6/R7/R9/R13〜R16の通常gateへ戻る。履歴やdataを削除してPath Aへ合わせない。
- run URL、review済みSHA、実行日時、Environment approval、各status、attestationを値非表示で関連計画へ記録した後にM1P-16を完了する。
- production state、provider scope、credential、証拠CLI、workflow SHAが変わった場合は既存証拠を失効させ、別承認で再実行する。
- timeout、cancel、Artifact欠落、summary/marker不整合、秘密・PII・identifier露出の疑いがある場合は証拠を無効にし、直ちに再実行しない。credential rotation、Artifact/log処理、incident記録が必要なら別承認する。
- nonzero終了後にcleanup、削除、deploy、backupを続けない。M1は観測だけで終了する。

### 2026-07-28 実行記録

- run: [Production Initial State Evidence #30321699906](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30321699906)
- reviewed SHA: `7a6979761428759c744ba3bf9c1ed16527c7b33d`
- executed at: `2026-07-28T02:01:26.311Z`
- preflight: `production` required reviewer、`develop` branch policy、`BATCH_ENVIRONMENT=production`、必要なSecret名の存在を値非表示で確認済み
- Environment approval: `production`承認済み
- run conclusion: `failure`（`present`を検出したfail-closed終端であり、Artifact生成・review対象stepは成功）
- exact evidence: review時点でArtifact未失効、2026-07-29T02:01:26Z失効、schema version 1、outer/evidence key完全一致、reviewed SHA完全一致、UTC millisecond timestamp、11 status allowlist、statusからのdecision再計算がすべて一致
- `clear`: production DB target、全User、legacy User、User関連row、AuditLog、Cloudflare production deployment、削除済みdeployment・外部backup copy attestation、production変更凍結attestation
- `present`: Vercel production deployment、GitHub production deployment、production backup history
- decision: schema v1はPath B。M1自体は未完了のまま維持する
- read-only境界: productionへのwrite、deploy、migration、DB更新、fixture、cleanup、backup、smokeは実施していない

### 2026-07-28 M1R owner判断

owner `RitukoIsibasi0222`は、productionを一般利用者向けに運用しておらず、一般利用者の登録および実利用者dataの保存実績がなく、3件の`present`は開発・運用準備による履歴であることを確認した。

DB target、全User、legacy User、User関連row、AuditLogが`clear`で`unknown`がないため、親release計画のM1Rとしてv0.1限定経路を再開する。M1 ArtifactをPath Aへ読み替えず、schema v2 / Path C engine、古いbackup復号、過去履歴の完全分類は行わない。DB 5項目またはowner確認が不明になった場合はM1Rを失効し、通常gateへ戻る。

M1 evidence SHA `7a6979761428759c744ba3bf9c1ed16527c7b33d`後のcommitが`docs/**`だけを変更した場合は、M3/M5/M6のreview済み実行SHAとの差分をpreflightで確認し、文書同期だけを理由にM1を再実行しない。backend、frontend、`.github/workflows`、schema/migration、lockfile、deployment configまたはproduction stateに差分があれば、この例外を使わず証拠失効条件へ戻る。

この証拠は上記application SHAと実行時点のproduction状態だけに有効である。前段の`docs/**`限定例外を除き、runtime/configを含むrelease候補差分、production state、provider scope、credential、証拠実装のいずれかが変わる場合は再利用しない。

### 2026-07-28 最新release候補のM1/M1R再確認

- run: [Production Initial State Evidence #30335685074](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30335685074)
- reviewed SHA: `c3ca68c5173c1fb586162418e839baec8cc49bf3`
- executed at: `2026-07-28T06:56:06.083Z`
- Environment approval: `production`承認済み
- concurrency: scheduled Batch Jobs #775が同じ直列実行枠で承認待ちだったため、step 0件を確認しownerの明示許可でcancelした。production DB処理は開始されていない
- run conclusion: `failure`（inspection、safe marker、Step Summary、Artifact uploadは成功し、Path Bをfail-closedで確定する最終stepだけが失敗）
- exact evidence: review時点でArtifact未失効、2026-07-29T06:56:06Z失効、schema version 1、outer/evidence key完全一致、reviewed SHA完全一致、UTC millisecond timestamp、11 status allowlist、decision再計算一致
- `clear`: production DB target、全User、legacy User、User関連row、AuditLog、Cloudflare production deployment、削除済みdeployment・外部backup copy attestation、production変更凍結attestation
- `present`: Vercel production deployment、GitHub production deployment、production backup history
- `unknown`: 0件
- decision: schema v1はPath B。M1自体は未完了のまま維持する
- Annotations: 赤2件はPath Bの想定内exit code 1。黄色1件はActions内部runtimeのNode.js 20廃止警告で、今回の証拠を無効化せず、workflow/action version更新時に再確認する
- owner再確認: owner `RitukoIsibasi0222`は、現在も一般公開・一般登録・実利用者data保存実績なしと確認した
- read-only境界: M1以外のworkflow dispatch、production DB write、backup、migration、deploy、smokeは実施していない

旧M1 ArtifactのPath Bと3件の`present`は再分類しない。最新release候補でも同じstatusとowner判断を確認できたためM1Rを完了する。M4/M5以降へ進む前に本地点で停止し、別作業・別承認とする。

---

## M2 release候補staging単一campaign runbook

M2の正本は[`docs/plans/m2-staging-release-candidate-campaign/plan.md`](plans/m2-staging-release-candidate-campaign/plan.md)とする。`.github/workflows/staging-release-candidate-campaign.yml`は`workflow_dispatch`専用で、同じreview済みSHAに対するM1 Path Aのexact safe Artifactをgateにし、通常API Worker、frontend candidate、単一synthetic campaign、main/recovery cleanup、exact allowlist証拠を順序実行する。

M1 schema v1がPath BであるためM2外部実行条件は成立していない。M1RはM2 Artifact条件を変更せず、M2P-17〜M2P-22を未完了のまま公開後へ移す。v0.1公開前はM6 production smokeで通常DO、valid login、最小429、主要導線を確認する。

2026-07-28時点ではrepository実装、TDD、厳格review、local品質gateまでを対象とし、M1P-15〜16、GitHub Environment/Secret/Variable変更、workflow dispatch、provider API request、staging deploy、DB接続・migration適用・fixture操作、staging HTTP/Playwright requestは実施していない。repository PRのmergeだけでM2を完了扱いにしない。

### 別承認前の停止gate

1. repository PRをreviewして`develop`へmergeし、40文字lowercaseのrelease候補SHAを固定する。
2. 別承認でM1P-15〜16を実行し、M1 ArtifactのSHA、Path A、run conclusion、review記録、変更凍結attestationを確認する。
3. M1 Artifact欠落・期限切れ・schema不一致、SHA不一致、Path B、`present`、`unknown`、cancel、timeoutのいずれかならM2をdispatchしない。
4. staging Environmentのrequired reviewer、`BATCH_ENVIRONMENT=staging`、M2 fixture flag、DB/provider credentialのstaging scope、通常`src/worker.ts`と`PASSWORD_VERIFIER` bindingを値非表示で確認する。
5. migrationに差分がある場合はcampaign内で適用せず、別承認のstaging DB workflowで解消してからM1/M2のSHA gateをやり直す。

### dispatchと順序

Actionsの`M2 Staging Release Candidate Campaign`へreview済みSHA、M1 run ID、固定confirmation、承認者、change record、変更凍結attestationだけを入力する。workflowはM1 runのworkflow/event/success/same SHAとArtifactを検証し、DB target/migration/fixture absence、通常API deploy、API same SHA・health/CORS/security header、frontend deploy/alias・same SHA、active SHA再確認、単一campaign、active SHA再確認、cleanup、safe evidenceの順で実行する。

campaignは固定したM2専用identityを1件だけ使い、register、verification token hash arm、verify/replay、login、refresh rotation/旧token拒否、auth 10回成功/11回目429/`Retry-After`/reset、game、keyboard、320px、本人退会、旧access/refresh/password拒否を確認する。cross-site stagingのrefreshはAPI protocol証拠だけであり、production same-site browser Cookieの証拠にはしない。

### cleanup・証拠・停止

main cleanupは常に実行し、campaign失敗またはmain cleanup不成立時だけ独立recovery cleanupを実行する。固定identityの完全一致を確認できない場合は削除せず`present`、DB/responseを分類できない場合は`unknown`にする。recoveryでfixtureを除去できても元campaignの失敗を`clear`へ戻さない。

Artifactは`m2-staging-release-candidate-evidence`という固定名のexact JSON 1 fileだけを7日保持する。SHA、時刻、allowlist status、10/11という公開境界値以外のPII、credential、cookie、token、resource ID、raw response/error/logをSummary・Artifactへ残さない。required status、cleanup、residueのいずれかが`present`/`unknown`ならworkflowを失敗させ、M2を未完了のまま最初から再実行する。rollback baseline deploy/drill、WAF、長期soak、backup複数世代、production操作はこのrunbookに含めない。

---

## 本番デプロイのチェックリスト

ポートフォリオ版v0.1の公開範囲とrelease blockerは
[`docs/plans/portfolio-release-v0-1-minimal/plan.md`](plans/portfolio-release-v0-1-minimal/plan.md)を正本とする。以下はM1R・M3・M5・M6と条件付きM4の進捗確認用であり、個別計画の全項目を公開前に完了させる一覧ではない。

```
[x] M1R: c3ca68c5173c1fb586162418e839baec8cc49bf3でDB 5項目clear・unknown 0件とowner判断を再確認
[x] M3: 3370cefbc6934e5e3d68ddf9c22eaaf4c5a634aeで最終品質gateとproduction依存監査を完了
[x] M4: backup run 30301334445確認後、対象SHA `7dbe5649a4057baa3b123aaadb6531422f96fd2f`のmigration run 30342343404と、検証run 30406227957の`indisvalid`・`indisready`値非表示確認が成功
[x] M5: URL/Cookie/CORS/メール/Secret/bindingを値非表示でpreflightし、承認後にAPI・frontend deployと両health確認を完了
[-] M6: 登録・メール認証・login・reload後の認証維持まで成功。第五回Element seedは`module_load_failure`で書込み前に停止し、元素0件・独立verify skipを維持。Prisma Client生成修正のreview・main昇格・別承認付き成功までgame以降を停止
```

2026-07-28のM3では、初回production監査で検出したbackend High 3件・Moderate 4件を関連依存の更新で解消した。PR review対応でbackendのNode runtimeを`22.x`へ固定し、CIと同じNode 22.23.1 / npm 10.9.8でlockfileを再生成した。review済み実行SHA `3370cefbc6934e5e3d68ddf9c22eaaf4c5a634ae`で`npm ci`、backend通常test 1268件・Workers test 32件、frontend test 680件、両build、lint、format、Prisma validate、Svelte checkが成功し、backend/frontendのproduction依存はCritical 0、High 0、Moderate 0、Low 0となった。Moderateの個別判断対象はない。全依存ではbackend dev-onlyの`esbuild@0.27.7`にLow 1件が残るが、`tsx`経由でproductionへ到達せず、Windows開発serverを公開しない。2026-08-31または上流修正版公開時の早い方で再確認する。

M3修正は`backend/package.json`と`backend/package-lock.json`を変更したため、旧M1 evidence SHA `7a6979761428759c744ba3bf9c1ed16527c7b33d`からのdocs-only例外を使わなかった。旧Path Bとowner判断を再分類せず、PR #160のmerge commit `c3ca68c5173c1fb586162418e839baec8cc49bf3`でM1 read-only証拠とM1Rを再確認した。M1は未完了、M1RとM3は完了している。M4はmigration run 30342343404と検証run 30406227957の成功により完了し、M5/M6は未着手である。M4 migrationによるproduction state変更とPR #162のworkflow変更があるため、M5前に旧M1 evidenceのdocs-only例外を使わず、M1Rの扱いを別承認で再reviewする。

M2 same-SHA staging campaign、WAF、24/48時間soak、全rate-limit境界、rollback baseline drill、backup 2世代目以降、restore drill、高度なA11Yは公開後の強化項目とする。ただしDB 5項目またはownerの実利用者data不存在確認が不明な場合は延期せず、通常のR計画へ戻る。
