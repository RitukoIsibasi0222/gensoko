# staging frontend/API配備基盤 実装計画

> 設計者ロール: シニアフルスタックエンジニア / Cloudflare Workersプラットフォームエンジニア / SRE

## 概要

退会時の完全削除計画T34で必要なstaging API・UI・Playwright検証を実行できるように、Cloudflare WorkersのAPIとVercel PreviewのSvelteKit frontendを、staging専用設定で再現可能に配備する基盤を整える。

この計画は「配備可能なコードとrunbookの実装」と「承認後の外部環境操作」を分離する。実装PRではstaging/productionへ接続・配備せず、Cloudflare/Vercel/Supabaseの設定変更、secret登録、migration、実データ参照を行わない。外部操作は各実行直前に対象・値の種類・rollbackを提示して承認を得る。

## 背景と現在地点

PR #107で完全削除API/UI、staging synthetic fixture、cleanup安全契約まで実装済みであり、PR #108でT33のmanaged DB判定基準を文書化した。一方、T34に必要なstagingアプリは未配備である。

確認できた現状は次のとおり。

| 項目             | 現状                                                                                  | T34への影響                                              |
| ---------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| API entrypoint   | `backend/src/index.ts`は`@hono/node-server`とmemory rate limit専用                    | Workersへ指定できない                                    |
| Workers設定      | `wrangler.toml`/`wrangler.jsonc`とWorkers型がない                                     | build・binding・deploy契約がない                         |
| rate limit       | Node用memory storeは実装済み、SQLite-backed Durable Objectは既存計画T13/T14待ち       | production runtime要件を満たせない                       |
| Prisma           | `backend/src/lib/prisma.ts`が`process.env.DATABASE_URL`からmodule-global Clientを生成 | Workersのrequest環境binding・lifecycleと不整合           |
| メール           | `nodemailer` SMTP transportをmodule-global生成                                        | Workers互換性が未検証でbundle/登録/再設定メールのblocker |
| frontend adapter | `@sveltejs/adapter-auto`                                                              | Vercel固有設定とbuild契約が固定されていない              |
| Vercel環境       | Project・branch URL・branch scoped envが未設定                                        | CORS許可originとAPI URLが未確定                          |
| E2E              | local synthetic browser回帰は実施済み、Playwright harnessは未作成                     | 実URLで再現可能な自動検証がない                          |

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

最終ローカル品質確認:

- `npm run build`: 成功。
- `npm run lint`: 成功。
- `npm run format:check`: 成功。
- `npm run test -- --run`: 86 files / 930 tests成功、外部DBを必要とする4 files / 10 testsは既定どおりskip。
- 外部接続、deploy、設定・secret変更、migration、実データ参照は未実施。

## 対象ファイル一覧

実装時に実態へ合わせて更新する。

| ファイル                                                   | 変更種別       | 内容                                                               |
| ---------------------------------------------------------- | -------------- | ------------------------------------------------------------------ |
| `backend/src/worker.ts`                                    | 新規           | Workers module entrypoint、env/binding注入                         |
| `backend/src/worker.test.ts`                               | 新規           | request scope、fail-closed、secret非露出のcontract test            |
| `backend/src/app.ts`                                       | 修正           | runtime共通app factoryとrequest dependency境界                     |
| `backend/src/lib/app-dependencies.ts`                      | 新規           | middleware・serviceを同一request依存へ束ねる共通factory            |
| `backend/src/lib/prisma-client.ts`                         | 新規           | Node/Workers共通Prisma client factory                              |
| `backend/src/lib/prisma.ts`                                | 修正           | Node client factory/singletonとWorkers client生成契約の分離        |
| `backend/src/lib/serializable-transaction-core.ts`         | 新規           | Prisma注入型Serializable transaction runner                        |
| `backend/src/lib/config.ts`                                | 修正           | Workers bindingを明示入力できる設定検証                            |
| `backend/src/lib/worker-config.ts` / `.test.ts`            | 新規           | Workers env・binding・targetの型付き契約とunit test                |
| `backend/src/lib/mail-sender.ts`                           | 新規           | runtime共通`MailSender`契約                                        |
| `backend/src/lib/mail.ts`                                  | 修正           | Node SMTP adapter                                                  |
| `backend/src/middleware/auth/index.ts`                     | 修正           | Prisma・JWT secret注入型middleware factory                         |
| `backend/src/services/*.ts`                                | 必要範囲で修正 | Prisma/mail依存の明示注入。業務ロジックは変更しない                |
| `backend/src/routes/**/*.ts`                               | 必要範囲で修正 | service dependencyを受けるrouter factory。API契約は変更しない      |
| `backend/src/cloudflare/rate-limit-counter.ts`             | 既存計画で新規 | SQLite-backed Durable Object。仕様正本はrate limit計画             |
| `backend/src/middleware/rateLimit/durable-object-store.ts` | 既存計画で新規 | DO binding adapter。仕様正本はrate limit計画                       |
| `backend/wrangler.jsonc`                                   | 新規候補       | main、compatibility、staging env、DO/Hyperdrive binding、migration |
| `backend/worker-configuration.d.ts`                        | 生成           | `wrangler types`によるbinding型。手編集しない                      |
| `backend/vitest.config.workers.ts`                         | 新規候補       | Workers runtime test分離                                           |
| `backend/package.json` / `package-lock.json`               | 修正           | Wrangler、Workers test、types/build/dev/deploy scripts             |
| `backend/.dev.vars.example`                                | 新規候補       | local Workers placeholderのみ。secret値は禁止                      |
| `backend/.env.example`                                     | 修正           | Node/Workers/mail接続責務の説明                                    |
| `frontend/svelte.config.js`                                | 修正           | `@sveltejs/adapter-vercel`固定                                     |
| `frontend/package.json` / `package-lock.json`              | 修正           | adapter-vercel追加、build/check script確認                         |
| `frontend/.env.example`                                    | 修正           | staging Preview branch scopeとAPI URL形式                          |
| `frontend/playwright.config.ts`                            | 新規候補       | 明示BASE_URL、production誤指定拒否、staging project                |
| `frontend/e2e/account-deletion.spec.ts`                    | 新規候補       | synthetic本人退会・管理者強制退会・再登録回帰                      |
| `docs/09_startup_commands.md`                              | 修正           | Workers types/test/dev/build、staging deploy前確認コマンド         |
| `docs/11_deployment.md`                                    | 修正           | 実行可能なstaging runbook、secret/binding/rollback                 |
| `docs/05_progress.md`                                      | 修正           | 本計画とT34依存の進捗同期                                          |
| `docs/plans/staging-app-deployment/plan.md`                | 修正           | 実装記録、差分、結果                                               |

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
- [ ] SD6: DO Workers testをRed化する（rate limit計画T13）
- [ ] SD7: SQLite-backed DO/store adapterを実装する（rate limit計画T14）
- [ ] SD8: `MailSender`契約とNode/Workers adapterをTDD実装する
- [ ] SD9: Wrangler staging config・types・build scriptsを実装する
- [ ] SD10: adapter-vercelとPreview build契約を実装する
- [ ] SD11: 対象test・lint・format・type/buildを実行する
- [ ] SD12: staging runbook・progress・実装記録を同期する
- [ ] SD13: Cloudflare staging resource/secretを承認後に準備する
- [ ] SD14: APIを承認後にstaging deploy・smoke・rollback確認する
- [ ] SD15: Vercel `develop` Previewを承認後に配備・CORS整合を確認する
- [ ] SD16: T34 synthetic API/UI/Playwrightを承認後に実行する
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
