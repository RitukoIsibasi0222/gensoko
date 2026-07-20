# staging frontend/API配備基盤 実装計画

> 設計者ロール: シニアフルスタックエンジニア / Cloudflare Workersプラットフォームエンジニア / SRE

## 概要

退会時の完全削除計画T34で必要なstaging API・UI・Playwright検証を実行できるように、Cloudflare WorkersのAPIとVercel PreviewのSvelteKit frontendを、staging専用設定で再現可能に配備する基盤を整える。

この計画は「配備可能なコードとrunbookの実装」と「承認後の外部環境操作」を分離する。実装PRではstaging/productionへ接続・配備せず、Cloudflare/Vercel/Supabaseの設定変更、secret登録、migration、実データ参照を行わない。外部操作は各実行直前に対象・値の種類・rollbackを提示して承認を得る。

## 背景と現在地点

PR #107で完全削除API/UI、staging synthetic fixture、cleanup安全契約まで実装済みであり、PR #108でT33のmanaged DB判定基準を文書化した。その後staging API/frontendと基本synthetic導線を配備・確認し、T34はsynthetic Admin強制退会Playwrightだけを残している。

確認できた現状は次のとおり。

| 項目             | 現状                                                                          | T34への影響                   |
| ---------------- | ----------------------------------------------------------------------------- | ----------------------------- |
| API entrypoint   | `backend/src/index.ts`は`@hono/node-server`とmemory rate limit専用            | Workersへ指定できない         |
| Workers設定      | staging Worker・DO・Hyperdrive・7 secretsを配備済み                           | production resourceは未作成   |
| rate limit       | SQLite-backed Durable Objectをstaging bindingで稼働                           | production/WAF確認は別タスク  |
| Prisma           | Supabase staging Session Poolerをcache無効Hyperdriveへ登録しmigration current | production DBは操作していない |
| メール           | Resend allowlistで確認メール2通・resetメール1通を確認                         | production送信は未実施        |
| frontend adapter | `@sveltejs/adapter-vercel`、Node.js 22、固定API URL/CORSを配備・確認済み      | production配備は未実施        |
| Vercel環境       | Hobby project、`develop` Preview、branch scoped API URL、固定aliasを配備済み  | Production deploymentは未実施 |
| E2E              | synthetic本人導線を実機確認し、Admin強制退会Playwright codeを実装             | manual workflow実行は承認待ち |

## 目的と完了条件

### コード基盤の完了条件

- Node開発entrypointを維持し、Workers専用module entrypointを追加する。
- Workersの環境変数・secret・Durable Object bindingを型付きで受け、production相当runtimeで未設定時にfail-fastする。
- PrismaをWorkers requestごとに環境bindingから構築し、request終了後の切断方針を公式推奨と実測に合わせる。module import時にstaging secretへ依存しない。
- 既存のrate limit計画T13/T14で実装するSQLite-backed Durable Objectを利用し、同じ責務をこの計画へ複製しない。
- SMTP依存をruntime adapter境界へ分離し、Workers bundleに未対応のNode transportを暗黙に含めない。
- frontendを`@sveltejs/adapter-vercel`で再現可能にbuildできる。
- Workers runtime test、Node回帰test、frontend build/check、対象Playwrightのlocal/synthetic前提checkが成功する。
- stagingとproductionの名前・binding・secret・DB targetを分離し、stagingコマンドからproductionを選べない契約testを持つ。

### 外部環境を含む完了条件

- Vercel `develop` Previewの固定branch URLとCloudflare staging API URLを記録する。
- frontend branch URLだけをAPIの`FRONTEND_URL`へ設定し、wildcard CORSを使わない。
- staging APIがstaging DBだけを参照することを既存のdatabase target validatorで確認する。
- health、CORS、login、game、本人退会、管理者強制退会、メール経路をsynthetic accountだけで確認する。
- T34のPlaywrightを配備済みfrontend/APIへ実行し、退会後の再認証拒否・関連データ削除・UI遷移を確認する。
- rollbackとして直前のWorker versionとVercel deploymentへ戻せることを確認する。

コード基盤だけが完了しても、外部環境の確認が終わるまでT34と本計画を完了扱いにしない。

## 非スコープ

- T35のlegacy cleanup dry-run/execute/再実行、削除flag変更
- production DB/Worker/Vercelへの配備、production migration、WAF本番適用
- Prisma schema・PostgreSQL migration・account deletion仕様の変更
- privacy、監査保持、backup/replay、production cleanup体制の承認代行
- 本番CI/CDの自動化。staging初回配備とrollback確認後に別タスクで扱う

## 前提条件・依存関係

### 既存の公開インターフェース

**`backend/src/app.ts`**

- `createApp(options: CreateAppOptions)` — Hono appを構築し、CORS・security・rate limit・routeを配線する。
- `CreateAppOptions.rateLimit: RateLimitDependencies` — runtime固有store・HMAC secret・IP resolverを注入する。

**`backend/src/middleware/rateLimit/store.ts`**

- `RateLimitStore.consume(input): Promise<RateLimitResult>` — memory/DOが共通で満たすstore契約。
- `RateLimitDependencies` — appへstore factory、secret、IP resolverを注入する契約。

**`backend/src/lib/config.ts`**

- `getFrontendUrl(options): string` — productionでは単一のHTTP(S) originを必須化する。
- `getRateLimitConfig(options): RateLimitConfig` — productionでは`durable-object`以外を拒否する。

**`frontend/src/lib/api/config.ts`**

- `API_BASE_URL: string` — `VITE_API_BASE_URL`を全API clientで共有するsingle source。

**関連計画**

- [`api-rate-limit-production`](../api-rate-limit-production/plan.md) T13/T14 — Workers testとSQLite-backed Durable Object/store adapter。本計画のAPI deploy前提。
- [`account-data-complete-deletion`](../account-data-complete-deletion/plan.md) T34 — 本計画のstaging配備後に実行するAPI/UI/Playwright検証。
- [`account-data-complete-deletion`](../account-data-complete-deletion/plan.md) T35 — T34成功後も別承認が必要なstaging cleanup。配備成功だけで実行しない。

### 外部判断が必要な前提

| 判断                                                            | 必要時点                              | 未決時の扱い                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Cloudflare account/plan、staging Worker名、route/domain         | `wrangler deploy --env staging`前     | deployしない                                                                                                       |
| Supabase stagingをHyperdriveへ接続するorigin endpoint・接続上限 | SD13のresource作成前                  | codeはcache無効Hyperdrive bindingを採用し、外部採用はSerializable transactionと接続上限のstaging実測まで確定しない |
| Workers対応メール配送方式・staging宛先制限                      | Workers bundleのGreen後、外部deploy前 | 登録・forgot-passwordを本番公開可能と扱わない                                                                      |
| Vercel project、production branch、`develop` Preview branch URL | frontend外部deploy前                  | CORS originを推測で設定しない                                                                                      |
| staging synthetic account/fixture実行承認                       | T34直前                               | 実データを参照・変更しない                                                                                         |

## 重要な設計判断

### 1. staging frontendはVercel Previewを使う

- VercelのCustom EnvironmentはPro/Enterprise向けであるため、無料/Hobby前提では`develop`のPreview deploymentをstagingとして扱う。
- Git branch URLは同じbranchの最新deploymentを指し続けるため、`develop`の固定branch URLをCORS originに使う。commit固有URLやwildcard originは使わない。
- `VITE_API_BASE_URL`はPreviewかつ`develop` branch scopeへ限定する。変更は既存deploymentへ遡及しないため、設定後に再deployしてbuild成果物を確認する。

### 2. NodeとWorkersのentrypointを分離する

- `backend/src/index.ts`はlocal/Docker用Node entrypointとして維持する。
- `backend/src/worker.ts`をmodule Worker entrypointとして新設し、`export default { fetch }`と必要なDurable Object class exportだけを公開する。
- `@hono/node-server`、`getConnInfo`、memory store、Node socket IP解決をWorkers bundleへ含めない。
- Workersでは検証済み`CF-Connecting-IP`だけをrate limit IP候補にし、`X-Forwarded-For`/`X-Real-IP`を信頼しない。

### 3. Workers環境値を`env`から明示注入する

- `DATABASE_URL`、`JWT_SECRET`、`RATE_LIMIT_KEY_SECRET`等をmodule import時の`process.env`へ暗黙依存させない。
- config parserは`Readonly<Record<string, string | undefined>>`等の明示environmentを受け、Nodeでは`process.env`、Workersではbindingを渡す。
- secretの値、接続host、内部ID、raw errorをlog・response・test snapshotへ出さない。
- production/staging runtimeでは必須値の欠落・不正値をrequest処理前に安全な固定messageで失敗させる。

### 4. Prismaはrequest単位のlifecycleを採用する

- Prisma公式のWorkers向け推奨に従い、Workerの`fetch`でcacheを無効にした`env.HYPERDRIVE.connectionString`からadapter/Clientを生成する。Hyperdrive resource・origin endpointはSD13で承認後に作成する。
- 現在のservice/middlewareがmodule-global `prisma`をimportする構造はWorkers request境界と整合しないため、route/serviceへ明示的にPrisma dependencyを渡すfactory方式へ段階的に移す。
- Node entrypointは既存singletonを利用できるが、同じservice公開契約を通し、runtimeごとに業務ロジックを複製しない。
- account deletionの`Serializable` transaction、interactive transaction、cascade、明示`select`がWorkers接続方式でも同じ結果になることを専用integrationで確認する。
- HyperdriveではrequestごとにClientを生成し、invocation終了時の自動cleanupへ委ねる。requestごとの`$disconnect()`は行わず、Client/driver poolをmodule-globalへ保持しない。
- Prisma schema/migrationはこの基盤のために変更しない。Client generator/runtime変更が必要な場合はNode/CLI/Workersを同一schemaから生成できる最小構成を別コミットで検証する。

### 5. Durable Object実装は既存rate limit計画を正本にする

- counter、alarm、failure mode、HMAC key、policy値は`api-rate-limit-production`計画T13/T14で実装する。
- 本計画はWorkers entrypointへのbinding注入、staging/production namespace分離、deploy前contract testだけを担当する。
- 新規namespaceはSQLite-backed Durable Objectとして`new_sqlite_classes` migrationを使う。stagingとproductionでnamespaceを共用せず、各Worker環境のmigration履歴を別々に確認する。
- DO未実装時にmemory storeへfallbackしてstagingを配備しない。

### 6. メール送信をruntime adapterへ分離する

- `auth.service.ts`が直接module-global `nodemailer` transportを参照する構造を、`MailSender`相当の小さいinterface注入へ変更する。
- Node localでは既存Mailpit/SMTP adapterを維持する。
- Workersではprovider SDKを前提にせず、native `fetch`を使うHTTPS API adapterを採用し、endpoint・秘密鍵をbindingから渡す。provider固有payloadはadapter内へ閉じ込める。
- Nodemailer/SMTPはWorkers import graphへ含めない。Node `net`/`tls`互換やSMTP port差をrelease契約にせず、provider選定・sandbox送信は外部deploy前の別承認とする。
- stagingは許可済みtest宛先以外へ送信しない。宛先allowlistまたはprovider sandboxをrelease gateにする。
- メール送信失敗時の登録補償削除、再登録token無効化、forgot-passwordの列挙耐性を既存testのまま維持する。

### 7. production deployはこの計画のstaging検証後に分離する

- `wrangler deploy --env staging`とproduction deployを別script・別approvalにする。
- 初回stagingでは自動deploy workflowを先に作らず、review済みcommitを手動で配備し、target/secret/binding/rollbackを確認する。
- staging安定後にCI/CDを別タスクで設計し、production migration→API→frontendの順序・backup gateを統合する。
- T34成功はT35 cleanup execute、production rollout、contract migrationの承認を意味しない。

## SD1 Workers / Prisma / mail互換性spike・採用記録

実施日: 2026-07-18。外部環境、DB、SMTP、mail providerへ接続せず、repository内の依存と一時bundle entryだけで確認した。一時entryとbundle成果物はGit差分へ残していない。

### 確認したversionと現行graph

| 対象                 | 確認値                                          | 結果                                                                                                              |
| -------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Hono                 | `4.12.17`                                       | 最小Worker target bundle成功                                                                                      |
| Prisma               | `@prisma/client` / `@prisma/adapter-pg` `7.8.0` | 生成Clientは`workerd` exportとWASM loaderを持つ。現行appはNode builtin/WASMを処理しない素のbrowser bundleでは失敗 |
| PostgreSQL driver    | `pg 8.20.0`                                     | CloudflareのHyperdrive要件`pg >= 8.13.0`を満たす。Workersでは`nodejs_compat`が必要                                |
| Nodemailer           | `8.0.7`                                         | Worker target bundleは`events`、`http`、`https`、`net`、`tls`、`child_process`等のNode依存で失敗                  |
| HTTPS mail prototype | native `fetch`のみ                              | Worker target bundle成功                                                                                          |

現行`backend/src/app.ts`のWorker target bundleは、serviceからmodule-global`prisma` / `mailer`を辿るため失敗した。加えて`crypto` / `node:crypto`も含むが、Prisma/`pg`と共通で`nodejs_compat`を有効にするため、暗号処理だけを理由に業務ロジックを複製しない。

### ローカルbundle spike結果

| entry                    | target             | 結果                                               | 判断                                                               |
| ------------------------ | ------------------ | -------------------------------------------------- | ------------------------------------------------------------------ |
| 最小Hono app             | browser/worker条件 | 成功、58.4 KB                                      | Hono app factoryは共有可能                                         |
| 現行Prisma + `PrismaPg`  | browser/worker条件 | 失敗。`pg`のNode builtinとPrisma WASM loaderを検出 | Wrangler + `nodejs_compat` + workerd/WASM処理をSD9の必須gateにする |
| 現行Prisma + `PrismaPg`  | Node               | 成功、5.3 MB                                       | Node entrypoint/CLIは現行adapterで維持可能                         |
| Nodemailer SMTP          | browser/worker条件 | 53件の解決不能Node builtinを検出して失敗           | Worker graphから除外                                               |
| Nodemailer SMTP          | Node               | 成功、413.7 KB                                     | local Mailpit/SMTP専用adapterとして維持                            |
| provider非依存HTTPS mail | browser/worker条件 | 成功、548 B                                        | Workers mail方式に採用                                             |

素のesbuildはWranglerのNode polyfill、Workers runtime、Prisma WASM asset処理を再現しない。そのためPrismaの失敗は`nodejs_compat`が不要という反証ではなく、Wrangler dry-run/runtime testを省略できないという結果として扱う。

### 採用方式

1. **Workers runtime**
   - `nodejs_compat`を必須とし、`compatibility_date`はCloudflareの`pg`要件を満たす`2024-09-23`以降でSD9実装日の固定値にする。
   - `process.env`自動populateへ依存せず、Worker bindingをrequest境界から明示注入する。

2. **Prisma / PostgreSQL**
   - `@prisma/adapter-pg`と`pg`を維持し、Workersはcache無効Hyperdrive bindingを第一経路にする。
   - 初期staging APIは認証、権限、token rotation、ゲーム状態、削除直後確認を同じClient graphで扱うため、Hyperdrive query cacheを全面無効にする。cache有効/無効Clientの二重化は、cache許容queryを別計画で分類するまで行わない。
   - Workerの`fetch`ごとに`env.HYPERDRIVE.connectionString`から`PrismaPg` / `PrismaClient`を作り、request-scoped dependencyとしてapp/service/middlewareへ渡す。module import時に接続文字列を読まず、module-global Client/Poolを作らない。
   - Hyperdrive invocation終了時のcleanupへ委ね、Worker requestの`finally`で`$disconnect()`しない。Node CLI/batchは従来どおり明示`$disconnect()`する。
   - 現行`prisma-client-js`は生成済みClientに`workerd` exportを持つためSD2〜SD8では維持し、SD9のWrangler dry-run・Workers runtime testを採用gateにする。失敗した場合だけ`prisma-client` + `runtime = "cloudflare"` + 明示`output`へ隔離変更し、Node/CLI/Workersを同一schemaから生成・buildできることを同じコミットで証明する。
   - Hyperdriveはtransaction poolingかつtransaction中は同じorigin connectionを保持する。既存`Serializable` / P2034 retryを維持し、bcryptやmail等の外部I/Oをtransactionへ入れない。

3. **Supabase origin / fallback**
   - CloudflareがSupabaseをHyperdrive対応providerとして明記しているため、app codeはHyperdriveだけを見る。
   - Hyperdrive resourceが接続するSupabaseのdirect endpoint / Session pooler / Transaction poolerは、SD13直前にprojectのIP到達性、prepared statement、接続上限、費用を確認して決める。codeやrunbookへhost、project ref、credentialを記録しない。
   - WorkersからSupabaseへ直接`DATABASE_URL`で接続する経路は初期採用しない。Hyperdriveが`Serializable` transaction、接続上限、latencyのstaging gateを満たさない場合だけfallbackとして再レビューする。

4. **mail**
   - 業務層は小さい`MailSender.send(message): Promise<void>`だけへ依存させる。
   - Node adapterはNodemailer + Mailpit/SMTPを維持し、Workers adapterはnative`fetch`のHTTPS API方式にする。provider SDKとNodemailerをWorker entrypointからimportしない。
   - provider名、endpoint、credential、sandbox/allowlist方式は外部deploy前の承認事項として未確定を維持する。secret未設定、宛先allowlist外、非2xx、非JSON/不正JSON、timeout時はPII・provider body・raw errorを返さない固定日本語errorへ変換する。
   - 登録送信失敗時の新規User補償削除、再登録token無効化、forgot-passwordの列挙耐性はadapter外の既存契約として維持する。

### 不採用・保留

| 方式                                  | 扱い                 | 理由                                                                                 |
| ------------------------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| Hyperdrive query cache有効            | 不採用               | writeでcache invalidationされず、認証・権限・削除後readへstale結果を返し得る         |
| module-global Prisma Client/`pg.Pool` | 不採用               | Workersのrequest間I/O共有とlifecycleに不整合                                         |
| requestごとの`$disconnect()`          | Hyperdriveでは不採用 | invocation終了時にedge connectionがcleanupされ、origin poolはHyperdriveが維持する    |
| Workers direct`DATABASE_URL`          | fallback保留         | connection setup・上限を各isolateへ負わせ、採用済みpooling境界を失う                 |
| Workers Nodemailer/SMTP               | 不採用               | Worker bundleへ広いNode/SMTP依存を持ち込み、provider/API方式より検証・運用面が大きい |
| `@prisma/ppg`                         | 不採用               | Prisma Postgres専用かつEarly Accessで、既存Supabase PostgreSQLの要件に合わない       |

### SD2以降の検証gate

- SD2: `HYPERDRIVE`、mail binding、rate limit DO等の欠落・環境混同をsecret値なしでRed化する。
- SD3/SD4: requestごとに別Prisma/Mail dependencyが渡り、別requestへ漏れないことをunit testで固定する。
- SD8: Node/Workers adapterの同一`MailSender`契約、allowlist、timeout、safe error、登録補償をTDD実装する。
- SD9: Wrangler、Workers types/test toolをdependencyへ明示追加し、`nodejs_compat`、workerd/WASM bundle、`pg`、Worker graphのNodemailer不在をdry-run/runtime testで証明する。
- SD13/SD14: 承認後だけcache無効Hyperdrive resourceを作成し、staging synthetic fixtureで`Serializable` transaction、P2034、接続上限、read-after-write、latencyを確認する。失敗時はdeployせず接続方式を再レビューする。

## SD2 Workers env / binding / staging target契約のRed記録

実施日: 2026-07-18。外部環境、DB、mail provider、Cloudflare resourceへ接続せず、pure unit testだけで確認した。

- `getWorkerRuntimeConfig({ expectedTarget, environment })`を公開契約とし、Workersでは`process.env`ではなくrequest境界から渡す明示environmentだけを参照する。
- stagingでは`DEPLOYMENT_ENVIRONMENT=staging`、`DATABASE_TARGET=staging`、`NODE_ENV=production`、`RATE_LIMIT_STORE=durable-object`の同時一致を必須とし、production binding混同とmemory fallbackを拒否する。
- 必須文字列は`FRONTEND_URL`、`JWT_SECRET`、`RATE_LIMIT_KEY_SECRET`、HTTPS mail API設定、送信元、staging宛先制限とする。resource bindingは`HYPERDRIVE.connectionString`と`RATE_LIMIT_COUNTER`のDurable Object APIを必須とする。
- config errorは`Workers runtime設定が不正です`へ固定し、secret、接続URL、host、binding内部値を含めない。
- Hyperdrive bindingからorigin DBを判別できないため、`DATABASE_TARGET`はruntimeの非secret環境識別子として使う。実際のSupabase originは既存`validateStagingDatabaseTarget`をSD13のHyperdrive resource作成直前に実行して照合し、runtime markerだけで外部採用を承認しない。

Red実行結果:

- コマンド: `npm run test -- --run src/lib/worker-config.test.ts`
- 結果: 1 file / 24 testsがすべて失敗。
- 失敗理由: `getWorkerRuntimeConfig`は型付きskeletonのみで、検証実装が未実装。
- Green担当: SD4/SD5。SD2ではWorker entrypoint、Prisma接続、DO store、mail送信を実装しない。

マージ可能な増分にするため、Red確認後にcontract parserだけをGreenへ進めた。既存`getFrontendUrl`は明示environmentを受けられるようにし、Node呼び出しの`process.env`既定値は維持した。Workers parserは設定値を正規化し、production相当のtarget、HTTPS、secret長、rate limit設定、binding形状、staging allowlistを検証してから固定型を返す。

- Greenコマンド: `npm run test -- --run src/lib/worker-config.test.ts src/lib/config.test.ts`
- Green結果: 2 files / 102 tests成功（Workers contract 40件、既存config回帰62件）。
- SD5との境界: 型付きconfig parserだけを先行実装した。Worker entrypoint、Cloudflare生成型、request dependency配線、resource binding実体は未実装であり、SD5は未完了のままとする。

## SD3〜SD5 request dependency境界・共通factory・Workers entrypoint実装記録

SD3のRedでは、requestごとのadapter生成、別request間でのPrisma非共有、request終了時に`$disconnect()`しない契約、adapter未実装時のfail-closed、設定不正時のsecret非露出を`backend/src/worker.test.ts`へ先行追加した。

- Redコマンド: `npm run test -- --run src/worker.test.ts`
- Red結果: 1 file失敗、test収集前に`./worker.js`が存在しないため失敗。
- Greenコマンド: `npm run test -- --run src/worker.test.ts`
- Green結果: 1 file / 3 tests成功。

SD4では、Prisma client生成、`MailSender`、Serializable transaction runner、認証middleware、route、serviceを明示依存factoryへ分離した。Node entrypointだけがNode用Prisma singleton、Nodemailer adapter、memory rate limitを組み立て、共有app・route・service graphは`process.env`やNode singletonを直接参照しない。CLI専用の`admin-create.service.ts`はWorkers graphから参照されないNode専用実装として維持する。

SD5では、型付き`WorkerRuntimeEnvironment`を受け取る`backend/src/worker.ts`を追加した。Worker handlerはrequestごとにadapter factoryを呼び、同じrequestのPrisma・mail・rate limitを共通app factoryへ渡す。Prisma client/poolはmodule-globalへ保存せず、request終了時の`$disconnect()`も行わない。

DO store adapterとfetch mail adapterはSD7/SD8の責務であるため、既定のstaging Worker entrypointは現時点ではmemory/SMTPへfallbackせず503で閉じる。SD7/SD8完了時に`createRequestAdapters`の実体を接続する。

### PR #112 review対応記録

review対応のRedでは、Node用`DATABASE_URL`の未設定・空値、Worker config/adapter/application構築例外のsafe log、早期500/503のsecurity header・no-store・単一origin CORS、adapter障害中のpreflight、実app graphへ渡るrequest-scoped Prismaを追加確認した。

- Redコマンド: `npm run test -- --run src/lib/config.test.ts src/worker.test.ts`
- Red結果: 2 files / 74 tests中9 tests失敗。未実装のconfig validator、CORS/header、safe log、application構築例外境界で失敗。
- Greenコマンド: `npm run test -- --run src/lib/config.test.ts src/worker.test.ts src/app.test.ts`
- Green結果: 3 files / 85 tests成功。

`DATABASE_URL`はNode用config境界で空白を正規化してfail-fastし、Worker bindingやHyperdrive接続経路とは分離した。Workerの早期エラーは共通CORS/security middlewareを再利用し、検証済みfrontend originだけを許可する。ログは固定日本語eventのみとし、raw例外、secret、接続URLを記録しない。adapter未実装を表す`null`は意図的fail-closedのためerror logを出さない。

### PR #112 再review・追加改善記録

再reviewで、早期error responseごとに`new Hono()`とmiddleware登録を繰り返す点が指摘された。既定WorkerはSD7/SD8完了まで全requestを意図的に503へ閉じるため、この処理は稀な例外経路ではなくstagingのhot pathになる。不要なallocationとroute/middleware再登録を避けるため、同じstatus・固定message・検証済みfrontend originのerror appをWorker handler単位で再利用する。

cacheはRequest、ExecutionContext、env object、Prisma、mail、rate limit adapterを保持しない。保存するのはsecretを含まない固定error定義と検証済みfrontend originだけであり、Honoのrequest contextは`fetch`ごとに新規生成される。Cloudflare bindingは同一deployment中に不変であるため、request間のdependency漏洩を起こさずfail-closedの継続コストだけを削減できる。

- Redコマンド: `npm run test -- --run src/worker.test.ts src/lib/prisma.test.ts`
- Red結果: 2 files / 11 tests中、cache未実装を示す1 test失敗。Prisma wiring 2 testsは成功。
- Green結果: 2 files / 11 tests成功。

`backend/src/lib/prisma.test.ts`は、validator単体では検出できないmodule wiringの回帰を防ぐため追加した。`prisma.ts`が必ず`getDatabaseUrl()`の検証済み値を`createPrismaClient()`へ渡すこと、検証失敗時はclient factoryを呼ばないことをmodule isolationで固定する。これにより、将来`process.env.DATABASE_URL!`の直接参照へ戻してもtestで検出できる。

### PR #112 追加review対応記録

review 4728144581で、Workers runtime設定全体の検証に失敗した場合、別項目だけが不正でも有効な`FRONTEND_URL`を早期500へ渡しておらず、browserからerror bodyを読めない点が指摘された。`FRONTEND_URL`だけを既存`getFrontendUrl()`で独立検証し、通常のWorkers contractと同じHTTPS origin条件を満たす場合に限って早期error appへ渡す。path付き、不正URL、HTTP originは反映せず、他のenv値やsecretを部分的に取り出さない。

- Redコマンド: `npm run test -- --run src/worker.test.ts`
- Red結果: 1 file / 11 tests中2 tests失敗。有効originのCORS header欠落とpreflightの500を再現。
- Greenコマンド: `npm run test -- --run src/worker.test.ts src/lib/config.test.ts src/app.test.ts`
- Green結果: 3 files / 88 tests成功。

test fixtureのbase64生成は、backend testの実行runtimeを明示するため`btoa()`から`Buffer.from(...).toString("base64")`へ変更した。これはtest環境のNode version差による収集時失敗を避ける互換性修正であり、Workers production codeへ`Buffer`依存を追加する変更ではない。

`backend/src/services/game.service.ts`の`node:crypto` `randomInt()`は意図的に維持する。SD1で`pg`/PrismaをWorkers上で動かすため`nodejs_compat`採用を決定済みであり、SD9でWrangler config、workerd/WASM、bundle/runtimeを採用gateとして検証する。`Math.random()`への変更は`pg`/Prisma側の`nodejs_compat`要件を解消せず、偏りを避ける既存の整数乱数契約だけを弱めるため行わない。SD9のgateを通るまでWorkerを配備可能とは扱わない。

今回意図的に残す改善:

- Worker logのreason code・相関ID・samplingは、Cloudflare上の観測基盤とログ保持方針を決めてから実装する。raw例外を出さない固定log契約は維持する。
- 既存test suite全体の`as never`除去は、今回追加・変更したroute helperの範囲を超えるため、独立したtest infrastructure refactorとして扱う。
- Wrangler/workerd bundle・runtime検証とCloudflare生成型は、正本task順どおりSD9の採用gateで実施する。

最終ローカル品質確認:

- `npm run build`: 成功。
- `npm run lint`: 成功。
- `npm run format:check`: 成功。
- `npm run test -- --run`: 87 files / 945 tests成功、外部DBを必要とする4 files / 10 testsは既定どおりskip。
- 外部接続、deploy、設定・secret変更、migration、実データ参照は未実施。

## SD6〜SD7 Durable Object rate limit実装記録

- 記録日: 2026-07-18
- 実装ブランチ: `feature/staging-app-deployment-sd6-sd7`
- PR: #113
- 仕様正本: [`api-rate-limit-production`](../api-rate-limit-production/plan.md) T13/T14

### TDD記録

- Red: Workers runtime testを先行追加し、未実装counter/store adapterの明示的な例外により1 file / 8 testsすべての失敗を確認した。
- Green: SQLite-backed `RateLimitCounter`と`RateLimitStore` adapterを実装し、並行consume、SQLite永続化、instance eviction、期限切れrequest内reset、alarm cleanup、早期alarm、policy/key分離、入力・RPC結果検証の1 file / 12 testsが成功した。
- Refactor/review: HMAC-SHA-256 digestとpolicy IDのvalidatorを既存rate limit契約へ共通化し、RPCのnon-object結果、不正な`remaining`、拒否時の非正`retryAfterSec`を固定日本語エラーで拒否する。Workers testをbackend PR CIへ追加した。

### 実装判断

1. count更新はSQLite storageの`transactionSync`内でread/reset/incrementを完結させ、clientからlimit/window/時刻を受け取らない。stateは内部primary keyを除き`count`と`resetAtMs`だけを保持する。
2. object名は`[policyId, keyDigest]`の曖昧性のないJSON tupleとし、raw IP/email/user IDやdigestをlogへ出さない。
3. alarmが期限前に起動した場合は現在の`resetAtMs`へ再設定し、遅延時は期限到達rowだけを削除する。alarm遅延中も次の`consume`が新windowへ切り替える。
4. SD7ではDO class/store adapterとlocal Workers test contractまでを実装する。production `worker.ts`のadapter graphはSD8のfetch mail adapterとSD9のWrangler production graphが揃うまで接続せず、memory/SMTPへfallbackしない503 fail-closedを維持する。
5. SD8はmail provider、宛先allowlist、timeout、送信失敗時の補償境界を持ち、rate limit counterとは独立してrollbackできるため別PR候補のままとする。
6. `wrangler.test.jsonc`はlocal test用class migration/bindingだけを持ち、外部resource ID、secret、Hyperdrive、deploy設定を含めない。dotenv自動読込もtest scriptで無効化する。

### SD6〜SD7の実際の変更ファイル

| ファイル                                                             | 変更種別   | 内容                                                              |
| -------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------- |
| `backend/src/cloudflare/rate-limit-counter.ts`                       | 新規       | SQLite-backed fixed-window counterとalarm cleanup                 |
| `backend/src/cloudflare/rate-limit-counter.test.ts`                  | 新規       | Workers runtimeの並行性・永続化・eviction・alarm・adapter境界test |
| `backend/src/cloudflare/rate-limit-worker.test-entry.ts`             | 新規       | local Workers test専用entrypoint                                  |
| `backend/src/middleware/rateLimit/durable-object-store.ts`           | 新規       | typed DO namespace/RPC adapterと入力・結果検証                    |
| `backend/src/middleware/rateLimit/policies.ts`、`store.ts`           | 修正       | policy IDとHMAC digest validatorの共通化                          |
| `backend/wrangler.test.jsonc`、`vitest.config.workers.ts`            | 新規       | 外部resource不要のSQLite DO Workers test設定                      |
| `backend/vitest.config.ts`、`tsconfig.json`、`tsconfig.workers.json` | 修正・新規 | Node/Workers test・型check境界                                    |
| `backend/package.json`、`package-lock.json`                          | 修正       | Workers test/build scriptと公式test runtime依存                   |
| `.github/workflows/backend-pr-quality.yml`                           | 修正       | PRでNode testに加えてWorkers runtime testを実行                   |

最終確認は`npm run lint`、`npm run format:check`、変更config/docsを含むPrettier check、`npm run build`、`git diff --check`が成功した。Node testは87 files / 945 tests成功、外部DBを必要とする4 files / 10 testsは既定どおりskip、Workers runtime testは1 file / 12 tests成功した。

Prisma schema/migrationと公開APIは変更していない。Cloudflare/Vercel/Supabaseへの接続、resource作成、secret参照、deploy、migration適用、実データ参照は実施していない。

## SD8 MailSender / Workers fetch mail adapter実装記録

- 記録日: 2026-07-18
- 実装ブランチ: `feature/staging-app-deployment-sd8`
- PR: #115（作成済み）

### TDD記録

- Red: `fetch-mail-sender.test.ts`、`mail.test.ts`、`worker-config.test.ts`を先行追加・更新し、未実装module、Node factory欠落、timeout契約不一致により3 files / 47 tests中8 tests失敗・39 tests成功を確認した。
- Green: provider request/response schema、HTTPS fetch、staging allowlist、AbortController timeout、固定safe error、Node factory、型付きtimeout configを実装し、3 files / 57 testsが成功した。
- Refactor: register、未認証再登録、forgot-password、Worker fail-closedを含む直接影響6 files / 86 testsが成功した。追加review後のfetch adapter・Worker testは2 files / 22 testsが成功した。
- 厳格review Red（2026-07-19）: productionで明示したallowlistが無視される問題、mail configの形式未検証、非2xx body未cleanup、空白provider ID受理、response body待機timeout未完了をtest先行で固定し、3 files / 66 tests中7 tests失敗・59 tests成功を確認した。Node Nodemailer reject伝播testは追加時点からGreenだった。
- 厳格review Green/Refactor: productionの明示allowlist適用、config境界のメール形式検証・正規化、共通HTTPS/mail validation、response body cancel、fetchとresponse body全体のtimeout、空白provider ID拒否を実装し、対象3 files / 66 tests、直接影響6 files / 95 testsが成功した。

### 実装判断

1. 共通業務層は既存の`MailSender.send(message): Promise<void>`だけへ依存し、provider APIのrequest `{ from, to, subject, text, html? }`とresponse `{ id: string }`はfetch adapter内のZod境界へ閉じ込める。
2. Workers adapterは型付き`WorkerRuntimeConfig`のtargetとmail設定だけを明示注入し、Bearer credential付きHTTPS POSTをnative `fetch`で実行する。request、env、secret、message、AbortControllerをmodule-global mutable stateへ保存しない。
3. timeoutはconfigで既定5,000ms、上限30,000msの正整数とし、送信ごとの`AbortController`と固定errorの`Promise.race`でfetch・response body検証全体へ適用する。timeout、network error、非2xx、非JSON、不正responseはすべて「メールを送信できませんでした」へ変換し、raw provider error、API key、本文、宛先、tokenをerrorやlogへ含めない。
4. stagingは空でないallowlistをWorker configで必須化する。productionはallowlist未設定の`null`だけを制限なしとして許容し、配列が設定された場合はtargetを問わず正規化した完全一致をprovider呼出し前に強制する。
5. messageの送信元は型付きconfigの`MAIL_FROM`と一致する場合だけ送信し、provider payloadにはconfig値を使う。Nodeは既存Nodemailer transportを`createNodeMailSender`経由で維持する。
6. 登録送信失敗時の新規User補償削除、未認証再登録時の最新確認token無効化、forgot-password失敗時のreset token削除と常時200の列挙耐性は既存service/route契約のまま維持する。
7. SD9のWrangler staging/production graphと実binding接続は先取りしない。既定WorkerはSD9まで503 fail-closedを維持し、SMTP、memory、module-global adapterへfallbackしない。
8. HTTPS endpointとメールアドレスのruntime validationは共通pure helperへ集約する。Worker configは送信元とallowlistを検証・正規化して保持し、adapterは防御的に再検証しつつ境界ごとの固定errorへ変換する。
9. provider非2xx bodyは内容を解析せずcancelし、2xx responseの`id`は空白だけの値を拒否する。Bearer認証とprovider payload/response schemaはprovider固有境界としてadapter内だけに閉じ込める。

### SD8の実際の変更ファイル

| ファイル                                        | 変更種別   | 内容                                                                     |
| ----------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| `backend/src/lib/fetch-mail-sender.ts`          | 新規       | HTTPS fetch adapter、provider schema、allowlist、timeout、固定safe error |
| `backend/src/lib/fetch-mail-sender.test.ts`     | 新規       | request/response、allowlist、network/非2xx/JSON、timeout、秘密非露出test |
| `backend/src/lib/mail-runtime-validation.ts`    | 新規       | HTTPS endpointとメールアドレスの共通runtime validation                   |
| `backend/src/lib/mail.ts` / `mail.test.ts`      | 修正・新規 | 既存Nodemailer transportのMailSender factoryと契約test                   |
| `backend/src/lib/worker-config.ts` / `.test.ts` | 修正       | 型付きmail timeoutの既定値・範囲検証・明示注入                           |
| `backend/src/worker.ts`                         | 修正       | SD9まで503 fail-closedを維持する境界コメントを実態へ同期                 |
| `docs/05_progress.md`                           | 修正       | SD8完了、SD9以降未着手へ進捗同期                                         |
| `docs/plans/staging-app-deployment/plan.md`     | 修正       | SD8判断、対象ファイル、TDD結果、task状態を同期                           |

### 最終品質確認

- `npm run build`: Node/Workers TypeScript build成功。初回はtimeout testのcallback内代入がTypeScriptで`never`へnarrowingされるtest型だけが失敗し、fetch mock実引数から`AbortSignal`を取得する形へ修正後に成功した。
- `npm run lint`、`npm run format:check`、更新docsのPrettier check、`git diff --check`: 成功。
- 対象・直接影響test: 最終追加review前は6 files / 86 tests、追加review後は2 files / 22 tests、build修正後はadapter 1 file / 11 testsが成功した。
- Node全test: `npm run test -- --run --maxWorkers=1`で89 files / 963 tests成功。外部DB専用4 files / 10 testsは既定どおりskipした。
- Workers test: `npm run test:workers`で1 file / 12 tests成功した。
- 既定並列のNode全testは2回ともSD8外の既存`deleteLegacySoftDeletedUsers.cli.test.ts` 1件だけが、固定1秒の`vi.waitFor`に対して1,016ms / 1,025msかかり失敗した。同file単体は29 testsすべて成功し、単一workerの全suiteでも成功したため、SD8で既存test timeoutは変更していない。
- 厳格review改善後の最終gate（2026-07-19）: `npm run build`、`npm run lint`、`npm run format:check`、更新docsのPrettier check、`git diff --check`が成功した。Node全testは単一workerで89 files / 971 tests成功、外部DB専用4 files / 10 testsはskip、Workers testは1 file / 12 tests成功した。

公開API、Prisma schema/migration、SD7 Durable Object実装は変更していない。実mail provider、SMTP、DB、Cloudflare/Vercel/Supabaseへ接続せず、secret操作、resource作成、deploy、migration、実データ参照も実施していない。

## SD9 Wrangler staging config・production相当Worker graph実装記録

- 記録日: 2026-07-19
- 実装ブランチ: `feature/staging-app-deployment-sd9`
- PR: #116

### TDD記録

1. config・generated types・request adapter・bundle contractのRedとして3 test filesを先行追加した。
   - Redコマンド: `npm run test -- --run src/worker-config-files.test.ts src/lib/worker-request-adapters.test.ts src/lib/worker-bundle-contract.test.ts`
   - Red結果: 3 files失敗。Wrangler staging設定・scripts・生成型が未存在で4 tests失敗し、request adapterとbundle contractはmodule未存在で収集失敗した。
2. production相当Worker runtimeのRedとしてhealth testを先行追加した。
   - Redコマンド: `npm run test:workers -- src/cloudflare/worker-production.test.ts`
   - Red結果: 1 file / 1 test失敗。SD8までの既定503 entrypointではhealth routeが404となった。
3. Greenではstaging Wrangler設定、型生成、request-scoped adapter graph、bundle contract、Wrangler生成bundleを使うWorkers runtime testを実装した。
   - 対象・直接影響test: 8 files / 103 tests成功。
   - production相当Workers runtime test: 1 file / 1 test成功。
   - `npm run workers:typecheck`、`npm run workers:types:check`、`npm run workers:dry-run`: 成功。

### 厳格review改善記録

1. Redでは公開500/503応答、bundle metadata validation、PR CI、生成binding型接続を先行testで固定した。
   - Redコマンド: `npm run test -- --run src/worker.test.ts src/worker-config-files.test.ts src/lib/worker-bundle-metadata.test.ts src/jobs/backendPrQualityWorkflow.test.ts`
   - Red結果: 4 files失敗。公開503の`Retry-After`欠落と内部用文言露出で3 tests、生成binding型接続で1 test、PR CIのWorkers build欠落で1 testが失敗し、metadata moduleは未存在で収集失敗した。
2. Greenでは500/503文言と503 retry値を共通化し、production entrypointで生成`CloudflareBindings`から必須runtime envへの代入を型検査する。Durable Object namespaceの実型をhandlerまで伝播し、production codeの二重型アサーションを削除した。
3. Wrangler metafileは共通Zod境界で非object・配列・空inputs・production entrypoint欠落を拒否し、dry-run検証とWorkers test準備の双方で再利用する。backend PR CIには`npm run workers:build`を追加し、生成型差分、Workers typecheck、staging dry-run bundle contractを必須化した。
4. production bundleをworkerdで実行し、healthに加えて`CF-Connecting-IP`からHMAC key、Durable Object、認証routeへ到達する429経路と、forwarded headerへfallbackしない503 fail-closed経路を確認した。
   - 対象・直接影響test: 8 files / 55 tests成功。
   - production相当Workers runtime test: 2 files / 15 tests成功。
   - Node全test: 93 files / 986 tests成功。外部DB専用4 files / 10 testsは既定どおりskipした。

### PR #116 review・CI改善記録

1. `DurableObjectNamespaceBindingConstraint.get`の`never[]`は、具体的なDurable Object ID引数型をgenericへ保持しつつcallableであることだけを制約する意図的な型と確認した。constraint経由で`get`を呼ばないことをコメントへ明記し、実`DurableObjectNamespace<RateLimitCounter>`を使うWorkers typecheck成功を再確認した。
2. PR作成後も残っていた`PR: 未作成`を`PR: #116`へ修正した。
3. 初回GitHub Actionsは、既存legacy cleanup CLI testがmodule import後の`void main()`完了を1秒pollingしており、並列CIでdynamic importが遅延して1 test失敗した。CLI execution Promiseを明示exportし、test helperが直接awaitするよう修正した。timeout延長やCIの直列化は行っていない。
4. CIと同じ`npm test -- --run`で93 files / 986 tests成功、対象CLI testは1 file / 29 tests成功を確認した。
5. 追加reviewのRedでは、正規表現によるJSONC末尾カンマ除去がcommentを扱えず、文字列内の`,}`も破壊することと、`./node_modules/.bin/wrangler`がWindowsで直接起動できないことを先行testで再現した。
   - Redコマンド: `npm run test -- --run src/worker-config-files.test.ts src/lib/wrangler-dry-run.test.ts`
   - Red結果: 2 files / 2 tests失敗、5 tests成功。JSONC commentのparse errorとPOSIX固有CLI pathが意図した理由で失敗した。
6. GreenではTypeScript公式の`parseConfigFileTextToJson`でJSONCを解釈し、Wrangler packageから`bin/wrangler.js`を解決して`process.execPath`・`shell: false`で起動するcross-platform境界へ変更した。対象testは2 files / 7 tests成功し、実`npm run workers:dry-run`も成功した。

### 実装判断

1. production entrypointは`backend/src/worker.ts`へ固定し、共有handlerを`worker-handler.ts`へ分離した。entrypointは`RateLimitCounter`とstaging handlerだけをexportし、Node entrypoint、Nodemailer、memory store、Node用Prisma singletonへ依存しない。
2. `compatibility_date`は実装日に利用したWrangler/workerdが受理する固定値`2026-07-18`、互換flagは`nodejs_compat`とした。staging configのHyperdrive IDは全ゼロplaceholderで、実resource、接続URL、secret名・値を保存しない。
3. `wrangler types`はstaging configとsecret値を含まない`.dev.vars.example`から`CloudflareBindings`を生成し、差分check、Workers専用TypeScript check、staging dry-runをlocal buildとbackend PR CIのgateへ追加した。Node用`process.env`は必要キーだけを明示する既定値へ狭め、Workers bindingへ`DATABASE_URL`を混入させない。
4. requestごとにHyperdrive connection stringからPrisma Client、HTTPS fetch mail sender、Durable Object storeを新規構築する。同じrequest内だけで共有し、module-globalへ保持せず、request終了時に`$disconnect()`しない。IP候補は検証済み`CF-Connecting-IP`だけとする。
5. Wrangler dry-runはbinding値を標準出力へ出さないwrapperで実行し、runtime validation済みmetafileからproduction entrypoint存在とNode専用依存の不在を検証する。Workers Vitestは同じWrangler生成bundleをworkerdへ渡し、外部DB・mail providerへ接続しないhealth pathとproduction DO rate limit pathで起動、CORS、security header、fail-closedを確認する。
6. config、binding、adapter、app構築の失敗はAPI共通の固定日本語500/503応答へ閉じ、503には`Retry-After: 60`を付与する。内部用ログ文言や例外詳細は公開せず、memory/SMTP/Node singletonへfallbackしない。

### SD9の実際の変更ファイル

| ファイル                                                                                         | 変更種別   | 内容                                                                    |
| ------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------- |
| `backend/wrangler.jsonc` / `.dev.vars.example`                                                   | 新規       | staging main・compatibility・placeholder bindingと型生成用の値なし契約  |
| `backend/worker-configuration.d.ts`                                                              | 生成       | Wrangler生成`CloudflareBindings`                                        |
| `backend/src/worker.ts` / `worker-handler.ts`                                                    | 修正・新規 | production entrypointと共有handlerの分離                                |
| `backend/src/lib/worker-request-adapters.ts` / `.test.ts`                                        | 新規       | request-scoped Prisma・mail・DO adapter graphとunit test                |
| `backend/src/lib/worker-bundle-contract.ts` / `.test.ts`                                         | 新規       | production bundleのNode専用依存拒否contract                             |
| `backend/src/lib/worker-bundle-metadata.ts` / `.test.ts`                                         | 新規       | Wrangler metafileの共通runtime validationと境界値test                   |
| `backend/src/lib/http-error-messages.ts`                                                         | 新規       | API共通500/503文言と503 retry値                                         |
| `backend/src/lib/wrangler-dry-run.ts` / `.test.ts` / `backend/src/scripts/*Worker*.cli.ts`       | 新規       | cross-platform出力抑止dry-run、unit test、metafile検証、test bundle準備 |
| `backend/src/cloudflare/worker-production.test.ts`                                               | 新規       | Wrangler bundleのhealth・DO rate limit・fail-closed runtime test        |
| `backend/src/worker-config-files.test.ts`                                                        | 新規       | JSONC runtime解釈、staging設定・secret不在・生成型・build scripts test  |
| `backend/wrangler.test.jsonc` / `vitest.config.workers.ts`                                       | 修正       | production相当local fixtureと生成bundle実行                             |
| `backend/package.json` / `tsconfig.json` / `tsconfig.workers.json`                               | 修正       | Node/Workers型境界、types・typecheck・dry-run・runtime test gate        |
| `backend/src/lib/config.ts` / `backend/src/worker.test.ts`                                       | 修正       | Node env型境界とhandler分離への追従                                     |
| `backend/src/app.ts` / `middleware/rateLimit/index.ts`                                           | 修正       | API共通500/503文言と503 retry値を利用                                   |
| `backend/src/jobs/deleteLegacySoftDeletedUsers.cli.ts` / `.test.ts`                              | 修正       | CLI execution完了を直接awaitして並列CIのpolling timeoutを解消           |
| `.github/workflows/backend-pr-quality.yml` / `backend/src/jobs/backendPrQualityWorkflow.test.ts` | 修正       | PRでWorkers generated types・typecheck・dry-runを必須化                 |
| `.gitignore`                                                                                     | 修正       | local Wrangler生成物を除外                                              |

endpointと成功responseの公開仕様、Prisma schema/migration、frontendは変更していない。Worker起動前の500/503 responseだけを既存API共通契約へ揃えた。実DB・mail provider・Cloudflare/Vercel/Supabaseへ接続せず、resource/binding作成、secret操作、deploy、migration、実データ参照も実施していない。

### 最終品質確認

- Node全test: CIと同じ`npm test -- --run`で94 files / 989 tests成功。外部DB専用4 files / 10 testsは既定どおりskipした。
- Workers runtime test: `npm run test:workers`で2 files / 15 tests成功。production相当health、production DO rate limit経路、SQLite-backed Durable Objectを同じWrangler生成bundleで確認した。
- `npm run build`、`npm run workers:build`、`npm run lint`、`npm run format:check`、更新config/docsのPrettier check、`git diff --check`: 成功。
- 初回全testではPrettierがJSONCへ付与した合法な末尾カンマを新規test helperが`JSON.parse`できず1件失敗した。helperをJSONC対応後、全suiteでGreenを再確認した。
- 初回buildではNode `tsc`がproduction entrypoint経由でCloudflare専用型を辿ったため失敗した。Node configからWorkers専用entrypoint/adapterを除外し、同filesをWorkers専用configで必須checkする契約をtestで固定後、両buildを再確認した。

## SD10〜SD12 adapter-vercel・Preview build契約・runbook同期記録

- 記録日: 2026-07-19
- 実装ブランチ: `feature/staging-app-deployment-sd10`
- PR: #117

### TDD記録

1. RedではVercel adapter、直接依存lock、Preview公開envの3契約を先行追加した。
   - Redコマンド: `npm run test:run -- src/build-config.test.ts`
   - Red結果: 1 file / 3 tests失敗。`adapter-auto`が選択され、`adapter-vercel`依存がなく、`.env.example`に`develop` Preview・公開値・secret禁止の契約がないため意図どおり失敗した。
   - 初回コマンドの末尾引用符混入と、Vitest変換後の`import.meta.url`による収集失敗は仕様Redではない。対象pathを修正し、build設定testをNode環境へ限定してから上記Redを記録した。
2. Greenでは`@sveltejs/adapter-vercel` 6.3系を直接devDependencyへ固定し、`svelte.config.js`と`.env.example`を同期した。
   - Green結果: 1 file / 3 tests成功。
3. RefactorではPrettier適用後、新規契約testと既存API client testを実行した。
   - Refactor結果: 8 files / 165 tests成功。
4. Preview相当buildでは外部接続しない`https://staging-api.example.invalid/api/v1`を使い、`.vercel/output/config.json` version 3、全route、SSR catch-all、公開API URLのclient埋め込みを確認した。

### 実装判断

1. `adapter-auto`のbuild時自動検出に依存せず、公式推奨どおり`adapter-vercel`を明示lockする。Docker、`@types/node`、GitHub Actionsと合わせてFunction runtimeをNode.js 22へ固定し、region・ISR等はVercel project未確定の段階で推測設定しない。
2. `VITE_API_BASE_URL`は`frontend/src/lib/api/config.ts`をsingle sourceとし、共通pure parserでbuild/runtimeの両境界を検証する。Viteの`VITE_` prefixはbrowser公開値であり、secret、token、DB接続情報を禁止する。
3. staging API URLはVercel Previewかつ`develop` branch scopeで外部設定し、実URLをrepositoryへ保存しない。production値との共用、backend内部URL、commit固有URL、wildcard CORSを禁止する。
4. config import、package/lock、env templateをunit契約で固定し、`build:preview`でVercel Build Output version、SSR catch-all、Node runtime、公開API URL、secret非混入を自動検証する。frontend PR CIで同じ契約を継続実行する。
5. Cloudflare/Vercel/Supabase resource、secret、deploy、実DB、migration、実データ操作はSD13以降へ残し、費用・影響・rollbackを提示した直前承認なしに実行しない。

### SD10〜SD12の実際の変更ファイル

| ファイル                                                                                                | 変更種別   | 内容                                                                           |
| ------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------ |
| `frontend/svelte.config.js`                                                                             | 修正       | `adapter-vercel`とNode.js 22 Function runtimeを明示使用                        |
| `frontend/package.json` / `package-lock.json`                                                           | 修正       | adapter、Node engines、build/品質script、安全なframework/build依存をlock       |
| `frontend/src/build-config.test.ts`                                                                     | 新規       | adapter・依存lock・Preview公開env・secret非登録の契約test                      |
| `frontend/src/lib/api/config.ts` / `config.test.ts`                                                     | 修正・新規 | 検証済みAPI base URLを公開し、空白のみの未設定警告を回帰test                   |
| `frontend/src/lib/api/base-url.ts` / `.test.ts`                                                         | 新規       | API URLの正規化、fail-fast、Preview HTTPS契約                                  |
| `frontend/scripts/vercel-build-contract.mjs` / `vercel-build-env.mjs` / `check-vercel-build-output.mjs` | 新規       | Build Output・Node runtime・Vite互換env・公開URL・secret非混入検証             |
| `frontend/src/vercel-build-output.test.ts`                                                              | 新規       | Build Output、失敗診断、Vite env優先順位の正常系・異常系test                   |
| `frontend/src/frontend-pr-quality.test.ts`                                                              | 新規       | frontend PR workflow・Node 22・品質command契約test                             |
| `frontend/vite.config.ts` / `eslint.config.js`                                                          | 修正       | build時API URL検証とscripts/configを含むlint境界                               |
| `.github/workflows/frontend-pr-quality.yml`                                                             | 新規       | test・audit・lint・check・format・Preview build gate                           |
| `frontend/.env.example`                                                                                 | 修正       | local値、`develop` Preview branch scope、公開値/secret分離を明記               |
| `docs/09_startup_commands.md`                                                                           | 修正       | frontend test/check/Vercel buildのローカルコマンドを追加                       |
| `docs/11_deployment.md`                                                                                 | 修正       | SD9〜SD12現在地点、Preview env、外部操作の費用・影響・rollback・承認境界を同期 |
| `docs/05_progress.md`                                                                                   | 修正       | SD10〜SD12完了、SD13以降未実施へ同期                                           |
| `docs/plans/staging-app-deployment/plan.md`                                                             | 修正       | 対象ファイル、判断、TDD・品質・未実施事項を同期                                |

### SD11品質確認

- frontend全test: 45 files / 494 tests成功。
- `npm run lint`: 成功。
- `npm run check`: 0 errors / 0 warnings。
- `npm run format`: 変更対象を整形し、既存ファイルは新規test以外unchanged。
- Preview相当`npm run build`: 成功。`@sveltejs/adapter-vercel`で`.vercel/output`を生成。
- backend/schema/migrationは未変更のため、backend全test・Workers test・実DBtestは再実行していない。
- 初回read-onlyの`npm audit`は既存framework/build依存に7件（low 1 / moderate 3 / high 3）を報告した。

### 厳格review改善記録

1. API URL・Build Output契約のRedでは3 test filesが失敗した。未実装parser/validatorのmodule解決失敗と、Node/runtime/build script未固定が意図した理由だった。
2. GreenではAPI URL parser、build時fail-fast、Node.js 22、Build Output/secret validatorを実装し、3 files / 25 testsが成功した。空の`VITE_API_BASE_URL`によるPreview build失敗と、fixtureを使う`build:preview`成功を実buildで確認した。
3. 依存更新はdry-runで対象を確認後、SvelteKit 2.70.1、Svelte 5.56.6、Vite 8.1.5、devalue 5.8.1、undici 7.28.0、brace-expansion 5.0.7へ更新した。auditはhigh/moderate 0、上流SvelteKitの`cookie 0.6.0`由来low 3だけとなった。破壊的な旧版への`--force` downgradeは行わない。
4. frontend CIのRedではworkflow未作成・非破壊script未定義により1 file / 3 testsが失敗し、GreenではNode.js 22上のtest/audit/lint/check/format/Preview build workflowを追加して3 testsが成功した。
5. code、依存更新、CI、docsは責務ごとに別コミットとし、Cloudflare/Vercel/Supabase/DBを含む外部操作とPR作成は行っていない。
6. 初回最終品質gateはfrontend 48 files / 519 tests、`npm run lint`、`npm run check`（0 errors / 0 warnings）、`npm run format:check`、`npm audit --audit-level=moderate`、`npm run build:preview`、`git diff --check`が成功した。Node.js 22のDocker環境でも対象25 testsとPreview build契約を確認した。
7. PR review対応では、空白のみのAPI URL未設定警告を正規化後の値で判定し、build契約失敗時はstack traceを出さず固定契約の`Error.message`だけを表示した。不定形のthrow値は「不明なエラー」へ固定し、機密値をログへ展開しないtestを追加した。
8. `.env`読込のRedでは、後続検証スクリプトが`process.env`だけを参照し、Viteが読み込んだ値と一致しない問題を再現した。Greenでは`loadEnv('production', frontendRoot, 'VITE_')`へ統一し、`.env.production`のみのローカル値と明示環境変数優先の2ケースを追加した。
9. review対応後の最終品質gateはfrontend 49 files / 523 tests、`npm run lint`、`npm run check`（0 errors / 0 warnings）、`npm run format:check`、明示環境変数を外したローカル`.env`のみの`npm run build:preview`、`git diff --check`が成功した。

## 対象ファイル一覧

実装時に実態へ合わせて更新する。

| ファイル                                                                | 変更種別       | 内容                                                                   |
| ----------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------- |
| `backend/src/worker.ts` / `backend/src/worker-handler.ts`               | 新規・修正     | Workers production entrypointと共有request handler                     |
| `backend/src/worker.test.ts`                                            | 新規           | 実app graphのrequest scope、fail-closed、CORS、secret非露出test        |
| `backend/src/app.ts`                                                    | 修正           | runtime共通app factoryとrequest dependency境界                         |
| `backend/src/lib/app-dependencies.ts`                                   | 新規           | middleware・serviceを同一request依存へ束ねる共通factory                |
| `backend/src/lib/prisma-client.ts`                                      | 新規           | Node/Workers共通Prisma client factory                                  |
| `backend/src/lib/prisma.ts`                                             | 修正           | Node client factory/singletonとWorkers client生成契約の分離            |
| `backend/src/lib/prisma.test.ts`                                        | 新規           | Node singletonが検証済みDATABASE_URLだけを使うmodule wiring test       |
| `backend/src/lib/serializable-transaction-core.ts`                      | 新規           | Prisma注入型Serializable transaction runner                            |
| `backend/src/lib/config.ts` / `.test.ts`                                | 修正           | Workers binding明示入力とNode DATABASE_URLのfail-fast                  |
| `backend/src/lib/worker-config.ts` / `.test.ts`                         | 新規・修正     | Workers env・binding・target・mail timeoutの型付き契約とunit test      |
| `backend/src/lib/mail-sender.ts`                                        | 新規           | runtime共通`MailSender`契約                                            |
| `backend/src/lib/mail.ts` / `mail.test.ts`                              | 修正・新規     | Node Nodemailer adapter factoryと共通契約test                          |
| `backend/src/lib/fetch-mail-sender.ts` / `.test.ts`                     | 新規           | Workers HTTPS mail adapterとprovider境界・allowlist・timeout test      |
| `backend/src/lib/mail-runtime-validation.ts`                            | 新規           | HTTPS endpointとメールアドレスの共通runtime validation                 |
| `backend/src/middleware/auth/index.ts`                                  | 修正           | Prisma・JWT secret注入型middleware factory                             |
| `backend/src/middleware/cors/index.ts`                                  | 新規           | appとWorker早期エラーで共有する単一origin CORS設定                     |
| `backend/src/services/*.ts`                                             | 必要範囲で修正 | Prisma/mail依存の明示注入。業務ロジックは変更しない                    |
| `backend/src/routes/**/*.ts`                                            | 必要範囲で修正 | service dependencyを受けるrouter factory。API契約は変更しない          |
| `backend/src/cloudflare/rate-limit-counter.ts`                          | 新規           | SQLite-backed Durable Object。仕様正本はrate limit計画                 |
| `backend/src/cloudflare/rate-limit-counter.test.ts`                     | 新規           | Workers runtimeで並行性・永続化・eviction・alarmを検証                 |
| `backend/src/cloudflare/rate-limit-worker.test-entry.ts`                | 新規           | local Workers test専用entrypoint                                       |
| `backend/src/middleware/rateLimit/durable-object-store.ts`              | 新規           | DO binding adapter。仕様正本はrate limit計画                           |
| `backend/wrangler.jsonc`                                                | 新規           | main、compatibility、staging env、DO/Hyperdrive placeholder、migration |
| `backend/worker-configuration.d.ts`                                     | 生成           | `wrangler types`によるbinding型。手編集しない                          |
| `backend/wrangler.test.jsonc`                                           | 新規・修正     | production相当local bundle・SQLite DO fixture。外部接続しない          |
| `backend/vitest.config.workers.ts`                                      | 新規           | Workers runtime test分離とdotenv読込拒否                               |
| `backend/tsconfig.json` / `tsconfig.workers.json`                       | 修正・新規     | Node/Workers型check境界                                                |
| `backend/package.json` / `package-lock.json`                            | 修正           | Wrangler、Workers test、types/build/test scripts                       |
| `.github/workflows/backend-pr-quality.yml`                              | 修正           | PRでWorkers runtime testを実行                                         |
| `backend/.dev.vars.example`                                             | 新規           | 型生成用placeholder名のみ。secret値は禁止                              |
| `backend/.env.example`                                                  | 修正           | Node/Workers/mail接続責務の説明                                        |
| `frontend/svelte.config.js`                                             | 修正           | `@sveltejs/adapter-vercel`・Node.js 22固定                             |
| `frontend/package.json` / `package-lock.json`                           | 修正           | adapter、Node engines、build/品質script、安全な依存をlock              |
| `frontend/.env.example`                                                 | 修正           | staging Preview branch scopeとAPI URL形式                              |
| `frontend/src/build-config.test.ts`                                     | 新規           | Vercel adapter・依存lock・Preview公開env・Node/build設定契約test       |
| `frontend/src/lib/api/config.ts`                                        | 修正           | 検証済みAPI base URLのsingle source                                    |
| `frontend/src/lib/api/base-url.ts` / `.test.ts`                         | 新規           | API URL fail-fast・Preview HTTPS契約                                   |
| `frontend/scripts/*.mjs`                                                | 新規           | Build Output・runtime・公開URL・secret非混入検証                       |
| `frontend/src/vercel-build-output.test.ts`                              | 新規           | Vercel成果物validator契約test                                          |
| `frontend/src/frontend-pr-quality.test.ts`                              | 新規           | frontend PR workflow契約test                                           |
| `frontend/vite.config.ts` / `eslint.config.js`                          | 修正           | build時API URL検証とlint対象境界                                       |
| `.github/workflows/frontend-pr-quality.yml`                             | 新規           | frontend test/audit/lint/check/format/Preview build gate               |
| `backend/src/jobs/stagingSyntheticAdminE2eFixtures.ts` / `.test.ts`     | 新規           | 完全一致synthetic Admin/Userの作成・cleanupと衝突拒否契約              |
| `backend/src/jobs/stagingSyntheticAdminE2eFixtures.cli.ts` / `.test.ts` | 新規           | 環境変数credentialだけを受ける安全なprepare/remove CLI                 |
| `backend/src/jobs/stagingSyntheticAdminE2eWorkflow.test.ts`             | 新規           | manual・develop・staging・always cleanup workflow契約                  |
| `backend/package.json`                                                  | 修正           | staging synthetic fixture CLI script                                   |
| `.github/workflows/staging-synthetic-admin-e2e.yml`                     | 新規           | staging Environment限定のmanual Playwright workflow                    |
| `frontend/playwright.config.ts`                                         | 新規           | 固定staging URL、単一Chromium、artifact無効化                          |
| `frontend/e2e/staging-config.ts` / `.test.ts`                           | 新規           | production・任意URLとsynthetic識別子差替えを拒否する設定guard          |
| `frontend/e2e/admin-force-delete.spec.ts`                               | 新規           | Admin login・synthetic User強制退会・再認証401                         |
| `frontend/src/staging-playwright-contract.test.ts`                      | 新規           | Vitest分離、credential artifact禁止、E2E導線のsource契約               |
| `frontend/package.json` / `package-lock.json`                           | 修正           | Playwright依存とstaging E2E script                                     |
| `frontend/vite.config.ts` / `.gitignore`                                | 修正           | Playwright specのVitest除外とlocal output除外                          |
| `docs/09_startup_commands.md`                                           | 修正           | Workers types/test/dev/build、staging deploy前確認コマンド             |
| `docs/11_deployment.md`                                                 | 修正           | 実行可能なstaging runbook、secret/binding/rollback                     |
| `docs/05_progress.md`                                                   | 修正           | 本計画とT34依存の進捗同期                                              |
| `docs/plans/staging-app-deployment/plan.md`                             | 修正           | 実装記録、差分、結果                                                   |

## API仕様

公開APIのpath、status、bodyは変更しない。Workers版も[`docs/04_api.md`](../../04_api.md)を満たす。

staging smokeで最低限確認するendpointは次のとおり。

| メソッド | path                           | 確認内容                                         |
| -------- | ------------------------------ | ------------------------------------------------ |
| `GET`    | `/api/v1/health`               | DB非依存、rate limit非消費、security/CORS header |
| `POST`   | `/api/v1/auth/login`           | Cookie/Access Token、429/503、日本語error        |
| `POST`   | `/api/v1/auth/register`        | mail adapter、補償削除、rate limit               |
| `POST`   | `/api/v1/auth/forgot-password` | 列挙耐性、mail adapter                           |
| `GET`    | `/api/v1/game/questions`       | Prisma読取、DO IP bucket                         |
| `POST`   | `/api/v1/game/sessions`        | Prisma transaction、IP/user bucket               |
| `DELETE` | `/api/v1/users/me`             | Serializable物理削除、Cookie削除、再認証拒否     |
| `DELETE` | `/api/v1/admin/users/:userId`  | actor再確認、last-admin、物理削除                |

## 環境分離とsecret契約

| 値/binding                | local Node                 | local Workers                    | staging                 | production        |
| ------------------------- | -------------------------- | -------------------------------- | ----------------------- | ----------------- |
| `NODE_ENV`                | development/test           | development                      | production相当          | production        |
| `DATABASE_URL`/Hyperdrive | local Docker               | local専用                        | staging DBのみ          | production DBのみ |
| `FRONTEND_URL`            | localhost                  | localhost                        | `develop`固定branch URL | production origin |
| `RATE_LIMIT_STORE`        | memory                     | durable-object（test namespace） | durable-object          | durable-object    |
| `RATE_LIMIT_KEY_SECRET`   | local専用                  | local専用                        | staging専用             | production専用    |
| `JWT_SECRET`              | local専用                  | local専用                        | staging専用             | production専用    |
| mail credential           | Mailpit                    | provider sandbox/test            | staging専用・宛先制限   | production専用    |
| DO namespace              | memoryまたはtest namespace | local state                      | staging専用             | production専用    |

- secret値は`.env.example`、Wrangler config、GitHub Actions、PR本文、Artifact、logへ記録しない。
- `wrangler secret list`等の名前だけを確認し、値を読み戻す操作はrunbookに含めない。
- staging deploy前にdatabase target validatorを実行し、production host/database名を拒否する。
- production用flag、cleanup execute flag、contract migrationはstagingアプリ配備時に変更しない。

## テスト方針

### Red

1. Workers env未設定、staging/production binding混同、memory fallbackを拒否するcontract testを追加する。
2. requestごとに正しいPrisma dependencyがserviceへ渡り、別request/環境へ漏れないtestを追加する。
3. Node SMTPとWorkers mail adapterが同じ`MailSender`契約を満たし、raw provider errorを露出しないtestを追加する。
4. DOの並行consume、永続化、alarm、namespace bindingを既存rate limit計画T13でRed化する。
5. adapter-vercel未導入状態のproduction build差分を確認し、設定testまたはbuild gateを追加する。

### Green

1. Workers entrypoint・dependency factory・Prisma lifecycleを実装する。
2. 既存rate limit計画T14のDO/store adapterを実装してWorkers runtime testを通す。
3. mail adapter境界を実装し、Nodeの既存認証testを維持する。
4. adapter-vercelへ切り替え、frontend build/checkを通す。
5. Wranglerのtypes/build/dry-run相当と、秘密を使わないlocal Workers smokeを通す。

### Refactor

- Node/Workers間でapp、route、service、validation、error messageを複製しない。
- runtime分岐はentrypoint/adapter/configへ閉じ込める。
- request-scoped dependencyをmodule-global mutable stateへ保存しない。
- format後に対象test、lint、type/buildを再実行する。

### 必要最小限の検証

| 変更範囲          | 検証                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| config/env        | `config.test.ts`、Workers entrypoint contract test、backend lint/build             |
| Prisma dependency | 影響service/route test、account deletion専用unit/integration、Workers runtime test |
| mail adapter      | register/forgot-password test、adapter unit test                                   |
| DO                | rate limit Workers test、app integration                                           |
| Vercel adapter    | frontend `check`、production build、既存API config test                            |
| docsのみ          | Prettier check、`git diff --check`                                                 |

backend全体testはPrisma/service/router dependency境界を広く変更する最終PRでのみ必要とし、実行前に理由を説明する。DB schema/migrationを変更しないため、この計画だけを理由に`prisma migrate deploy`や実DB全体検証を行わない。

## staging適用手順と承認境界

各段階を別の承認単位にする。

1. **コード基盤PR**: Workers/Vercel adapter、test、runbookを実装。外部接続なし。
2. **Cloudflare resource準備**: staging Worker、SQLite-backed DO namespace、必要ならHyperdriveを作成。実行直前に名前、account、DB target、費用、rollbackの承認を得る。
3. **secret登録**: staging専用値だけを登録。値自体をチャット・logへ出さない。登録前に対象Worker/envの承認を得る。
4. **API staging deploy**: review済みcommit SHAをstagingへ配備。health/CORS/DO/DB targetを確認し、異常時は直前versionへrollbackする。
5. **Vercel Preview準備**: project rootを`frontend`、production branchを`main`、`develop`をPreviewとして接続。固定branch URLを確定する。
6. **CORS/API URL設定**: Workerの`FRONTEND_URL`とVercel branch scoped `VITE_API_BASE_URL`を相互に固定し、両方を再deployする。
7. **staging smoke/T34**: synthetic fixtureだけでAPI/UI/Playwrightを実行する。実在ユーザー・production DBを参照しない。
8. **結果記録**: commit、URLのorigin部分、実行時刻、test結果、rollback確認を文書へ記録する。secret、token、email、内部IDは記録しない。

T35 cleanup execute、flag変更、migration、production deployはこの手順に含めず、別途直前承認を得る。

## SD13・SD15 実環境準備記録（2026-07-20）

- Cloudflare Workers Freeを確認し、staging専用HyperdriveをSupabase Session Pooler（PostgreSQL、port 5432、SSL require、cache無効、origin接続上限20）へ作成した。credentialはCloudflareだけで管理し、値を読み戻していない。
- Hyperdrive binding IDを`backend/wrangler.jsonc`へ反映した。staging Worker `gensoko-api-staging`、SQLite-backed Durable Object、Hyperdrive binding、7件のWorker secretを作成・登録し、APIを公開した。secret値は読み戻し・記録していない。
- Resend Free accountでMFAを有効化し、sending access限定API keyをWorkerへ登録した。`onboarding@resend.dev`と宛先allowlistだけを使い、確認メール2通とpassword resetメール1通の送受信を確認した。最初に画像へ写った旧keyは削除済みであり、現在値は取得・表示・記録しない。
- Resend REST APIの必須`User-Agent`を`fetch-mail-sender`へTDD追加した。Redは1件だけ意図どおり失敗し、Greenは15 tests、関連contractは合計20 tests成功、`workers:build`も成功した。
- Vercel Hobbyの`gensoko-frontend-staging`へ`develop` Previewを配備し、固定aliasを`https://gensoko-frontend-staging-develop.vercel.app`、branch scoped `VITE_API_BASE_URL`をstaging Worker予定originへ設定した。Ignored Build Stepは`VERCEL_GIT_COMMIT_REF=develop`のときだけbuildするCustom commandへ変更し、feature branchと`main`をskipする。Production deployは行っていない。
- Staging Database Setupで全migration currentを確認した。health 200、CORS、OPTIONS 204、Hyperdrive経由の元素118件を確認した。
- synthetic accountだけで登録・メール認証・login・本人退会・削除後login拒否を確認した。別accountでは初級ゲーム10問、score 500、password reset、旧password拒否、新password login、履歴を持つ本人退会、削除後login拒否を確認し、終了時に一時passwordを破棄した。
- production resource・production deploy・production DB操作は行っていない。

### 現時点の変更ファイル

| ファイル                                    | 変更種別 | 内容                                                  |
| ------------------------------------------- | -------- | ----------------------------------------------------- |
| `backend/wrangler.jsonc`                    | 修正     | staging Hyperdrive bindingへ実resource IDを反映       |
| `backend/src/worker-config-files.test.ts`   | 修正     | 実Hyperdrive binding IDの設定契約へ同期               |
| `backend/src/lib/fetch-mail-sender.ts`      | 修正     | HTTPS mail provider requestへ必須User-Agentを追加     |
| `backend/src/lib/fetch-mail-sender.test.ts` | 修正     | User-Agent request契約をTDD追加                       |
| `docs/11_deployment.md`                     | 修正     | Vercel・Hyperdrive・Resendの実施済み/未実施範囲を同期 |
| `docs/05_progress.md`                       | 修正     | staging配備とVercel Previewの進捗を同期               |
| `docs/plans/staging-app-deployment/plan.md` | 修正     | SD13/SD15実環境準備、判断、テスト、変更ファイルを記録 |

## SD16 synthetic Admin Playwrightコード基盤（2026-07-20）

- staging専用の固定Admin/User識別子を予約し、ID・username・email・role・verified/active状態が完全一致するrowだけを置換・cleanupする。1項目でも衝突した既存Userは削除せず処理を停止する。
- 既存のstaging DB target validatorをprepare/removeの両方で必須化し、明示enable flag、`BATCH_ENVIRONMENT=staging`、staging project ref一致が揃わない限りPrismaを読み込まない。
- credentialはworkflow内で`crypto.randomBytes`から生成し、mask後に`GITHUB_ENV`だけでCLIとPlaywrightへ渡す。値をCLI引数、log、artifactへ出さず、trace・screenshot・videoも無効にする。
- workflowは`workflow_dispatch`、`develop`、GitHub `staging` Environment、共通batch concurrencyへ限定する。prepare後はPlaywrightの成功・失敗・cancelにかかわらず`always()`で完全一致fixtureをcleanupする。
- Playwrightは固定Vercel URLからAdmin login、対象synthetic Userの強制退会、対象Userの旧credentialによるlogin 401を確認する。固定Worker API URL以外とproduction・任意URLは設定guardで拒否する。
- Redではfixture/CLI/workflow/Playwright設定の未実装、password正規化漏れ、fixture直接呼出し時の同一password拒否漏れを対象testで確認した。Green/Refactorではbackend対象4 files・23 tests、frontend対象2 files・13 testsが成功し、Playwright `--list`で1 specを収集した。
- 最終品質gateはbackend通常97 files・1004 tests成功（外部DB integration 10 tests skip）、Workers 2 files・15 tests、build、lint、format checkが成功した。frontendは51 files・536 tests、lint、Svelte check（0 errors / 0 warnings）、format check、外部接続しないPreview build契約が成功した。
- 本turnでは外部workflow、staging/production DB、実メール、再配備を実行していない。実staging E2Eとrun IDの記録は別途承認後のSD16後半へ残す。

## 危険性と安全策

| 危険                                | 影響                         | 安全策                                                                |
| ----------------------------------- | ---------------------------- | --------------------------------------------------------------------- |
| staging Workerがproduction DBを参照 | 実データ変更・削除           | env分離、target validator、synthetic ID限定、直前承認                 |
| Vercel commit URL変動でCORS不一致   | UI全API失敗                  | 固定branch URLを単一originとして使用                                  |
| DO未配備でmemory fallback           | 分散rate limit回避           | production相当runtimeで起動拒否、contract test                        |
| Prisma client/connection増加        | Supabase接続枯渇・遅延       | request lifecycle、Hyperdrive比較、staging負荷/transaction確認        |
| SMTP/Node依存でWorker障害           | bundle失敗、登録/再設定不能  | adapter分離、Workers runtime test、provider sandbox                   |
| secret/log露出                      | 認証・DB侵害                 | binding、固定safe log、値の読み戻し禁止                               |
| Previewが公開される                 | 未公開機能への第三者アクセス | Vercel protection可否確認、synthetic data限定、不要deployment cleanup |
| deployでcleanup flagが有効化        | legacy userの不可逆削除      | account deletion flagsはfalse固定、deploy checklistで確認             |

## タスクリスト（v4確定）

v1でWorkers/API、Vercel/frontend、外部適用に分解した。v2でDB target誤接続、secret、SMTP、DO fallbackを追加し、v3で既存rate limit計画との重複とT34/T35承認境界を除去・整理した。v4ではproduction自動化を非スコープに保ち、staging配備に必要な最小順序へ確定した。

```text
タスクID	タスク内容	ファイル	優先度
SD1	Workers/Prisma/mail互換性spikeと採用方式を記録	plan・検証test	高
SD2	Workers env・binding・staging target contractをRed化	backend Workers/config tests	高
SD3	request-scoped Prisma dependency境界をRed化	backend service/route tests	高
SD4	Node/Workers共通dependency factoryを実装	backend app/lib/services/routes	高
SD5	Workers専用entrypointと型付きenvを実装	backend/src/worker.ts	高
SD6	DO Workers testをRed化（rate limit計画T13）	backend Cloudflare tests	高
SD7	SQLite-backed DO/store adapterを実装（rate limit計画T14）	backend cloudflare/rateLimit/wrangler	高
SD8	MailSender契約とNode/Workers adapterをTDD実装	backend lib/auth tests	高
SD9	Wrangler staging config・types・build scriptsを実装	backend config/package	高
SD10	adapter-vercelとPreview build契約を実装	frontend config/package	高
SD11	対象test・lint・format・type/buildを実行	backend/frontend	高
SD12	staging runbook・progress・実装記録を同期	docs	中
SD13	Cloudflare staging resource/secretを承認後に準備	外部環境	高
SD14	APIを承認後にstaging deploy・smoke・rollback確認	外部環境	高
SD15	Vercel develop Previewを承認後に配備・CORS整合	外部環境	高
SD16	T34 synthetic API/UI/Playwrightを承認後に実行	staging	高
SD17	結果を記録しT34と本計画の完了可否を判定	plan/progress/deployment	中
```

- [x] SD1: Workers/Prisma/mail互換性spikeと採用方式を記録する
- [x] SD2: Workers env・binding・staging target contractをRed化する
- [x] SD3: request-scoped Prisma dependency境界をRed化する
- [x] SD4: Node/Workers共通dependency factoryを実装する
- [x] SD5: Workers専用entrypointと型付きenvを実装する
- [x] SD6: DO Workers testをRed化する（rate limit計画T13）
- [x] SD7: SQLite-backed DO/store adapterを実装する（rate limit計画T14）
- [x] SD8: `MailSender`契約とNode/Workers adapterをTDD実装する
- [x] SD9: Wrangler staging config・types・build scriptsを実装する
- [x] SD10: adapter-vercelとPreview build契約を実装する
- [x] SD11: 対象test・lint・format・type/buildを実行する
- [x] SD12: staging runbook・progress・実装記録を同期する
- [x] SD13: Cloudflare staging resource/secretを承認後に準備する
- [-] SD14: APIを承認後にstaging deploy・smokeを実施済み。rollback確認を残す
- [x] SD15: Vercel `develop` Previewを承認後に配備・CORS整合を確認する
- [-] SD16: T34 synthetic API/UI/Playwrightの安全なfixture・manual workflow・E2E基盤を実装し、承認後に実行する
- [ ] SD17: 結果を記録しT34と本計画の完了可否を判定する

## 参照した公式文書

- [Hono: Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers)
- [Prisma ORM: Cloudflare Workers](https://docs.prisma.io/docs/guides/deployment/cloudflare-workers)
- [Cloudflare Workers: database connections](https://developers.cloudflare.com/workers/databases/connecting-to-databases/)
- [Cloudflare Workers: Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [Cloudflare Workers: TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [Cloudflare Hyperdrive: PostgreSQL drivers](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/)
- [Cloudflare Hyperdrive: query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)
- [Cloudflare Hyperdrive: connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/)
- [Cloudflare Hyperdrive: supported databases and providers](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/)
- [Cloudflare Durable Objects migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [Prisma ORM: generators](https://www.prisma.io/docs/orm/prisma-schema/overview/generators)
- [Supabase: database connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [SvelteKit: adapter-vercel](https://svelte.dev/docs/kit/adapter-vercel)
- [Vercel: environments](https://vercel.com/docs/deployments/environments)
- [Vercel: generated branch URLs](https://vercel.com/docs/deployments/generated-urls)
- [Vercel: managing environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables)
- [Resend: Send Email API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend: API authentication and User-Agent](https://resend.com/docs/api-reference/introduction)
- [Resend: pricing](https://resend.com/pricing)
