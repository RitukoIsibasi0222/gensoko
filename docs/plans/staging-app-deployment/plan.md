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

| 判断                                                                                 | 必要時点                              | 未決時の扱い                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------- |
| Cloudflare account/plan、staging Worker名、route/domain                              | `wrangler deploy --env staging`前     | deployしない                                               |
| Supabase stagingへのWorkers接続方式（Hyperdrive推奨を第一候補、direct poolerを比較） | Prisma実装確定前                      | Serializable transactionと接続上限を実測するまで採用しない |
| Workers対応メール配送方式・staging宛先制限                                           | Workers bundleのGreen後、外部deploy前 | 登録・forgot-passwordを本番公開可能と扱わない              |
| Vercel project、production branch、`develop` Preview branch URL                      | frontend外部deploy前                  | CORS originを推測で設定しない                              |
| staging synthetic account/fixture実行承認                                            | T34直前                               | 実データを参照・変更しない                                 |

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

- Prisma公式のWorkers向け推奨に従い、Workerの`fetch`で`env.DATABASE_URL`または承認済みHyperdrive bindingからadapter/Clientを生成する。
- 現在のservice/middlewareがmodule-global `prisma`をimportする構造はWorkers request境界と整合しないため、route/serviceへ明示的にPrisma dependencyを渡すfactory方式へ段階的に移す。
- Node entrypointは既存singletonを利用できるが、同じservice公開契約を通し、runtimeごとに業務ロジックを複製しない。
- account deletionの`Serializable` transaction、interactive transaction、cascade、明示`select`がWorkers接続方式でも同じ結果になることを専用integrationで確認する。
- Prisma schema/migrationはこの基盤のために変更しない。Client generator/runtime変更が必要な場合はNode/CLI/Workersを同一schemaから生成できる最小構成を別コミットで検証する。

### 5. Durable Object実装は既存rate limit計画を正本にする

- counter、alarm、failure mode、HMAC key、policy値は`api-rate-limit-production`計画T13/T14で実装する。
- 本計画はWorkers entrypointへのbinding注入、staging/production namespace分離、deploy前contract testだけを担当する。
- 新規namespaceはSQLite-backed Durable Objectとして`new_sqlite_classes` migrationを使う。stagingとproductionでnamespaceを共用せず、各Worker環境のmigration履歴を別々に確認する。
- DO未実装時にmemory storeへfallbackしてstagingを配備しない。

### 6. メール送信をruntime adapterへ分離する

- `auth.service.ts`が直接module-global `nodemailer` transportを参照する構造を、`MailSender`相当の小さいinterface注入へ変更する。
- Node localでは既存Mailpit/SMTP adapterを維持する。
- Workersでは採用を承認したHTTPS API型mail providerを第一候補とし、秘密鍵をbindingから渡す。SMTPを採用する場合も、Workers TCP/port制約とNodemailer bundle互換性をruntime test・staging送信で証明するまで有効化しない。
- stagingは許可済みtest宛先以外へ送信しない。宛先allowlistまたはprovider sandboxをrelease gateにする。
- メール送信失敗時の登録補償削除、再登録token無効化、forgot-passwordの列挙耐性を既存testのまま維持する。

### 7. production deployはこの計画のstaging検証後に分離する

- `wrangler deploy --env staging`とproduction deployを別script・別approvalにする。
- 初回stagingでは自動deploy workflowを先に作らず、review済みcommitを手動で配備し、target/secret/binding/rollbackを確認する。
- staging安定後にCI/CDを別タスクで設計し、production migration→API→frontendの順序・backup gateを統合する。
- T34成功はT35 cleanup execute、production rollout、contract migrationの承認を意味しない。

## 対象ファイル一覧

実装時に実態へ合わせて更新する。

| ファイル                                                   | 変更種別       | 内容                                                               |
| ---------------------------------------------------------- | -------------- | ------------------------------------------------------------------ |
| `backend/src/worker.ts`                                    | 新規           | Workers module entrypoint、env/binding注入                         |
| `backend/src/app.ts`                                       | 修正           | runtime共通app factoryとrequest dependency境界                     |
| `backend/src/lib/prisma.ts`                                | 修正           | Node client factory/singletonとWorkers client生成契約の分離        |
| `backend/src/lib/config.ts`                                | 修正           | Workers bindingを明示入力できる設定検証                            |
| `backend/src/lib/mail.ts`                                  | 修正           | `MailSender`契約、Node SMTP adapter                                |
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

- [ ] SD1: Workers/Prisma/mail互換性spikeと採用方式を記録する
- [ ] SD2: Workers env・binding・staging target contractをRed化する
- [ ] SD3: request-scoped Prisma dependency境界をRed化する
- [ ] SD4: Node/Workers共通dependency factoryを実装する
- [ ] SD5: Workers専用entrypointと型付きenvを実装する
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
- [Cloudflare Workers: TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [Cloudflare Durable Objects migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [SvelteKit: adapter-vercel](https://svelte.dev/docs/kit/adapter-vercel)
- [Vercel: environments](https://vercel.com/docs/deployments/environments)
- [Vercel: generated branch URLs](https://vercel.com/docs/deployments/generated-urls)
- [Vercel: managing environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables)
