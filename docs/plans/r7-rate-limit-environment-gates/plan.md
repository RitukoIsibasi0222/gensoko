# R7 app rate limit 実環境gate 実行計画

> 設計者ロール: シニアフルスタックエンジニア / Webセキュリティエンジニア / Cloudflareプラットフォームエンジニア
>
> この文書はR7の実環境gateと証拠管理の正本である。レート制限の設計、コード実装、TDD、Durable Object実装の履歴は
> [`../api-rate-limit-production/plan.md`](../api-rate-limit-production/plan.md)を参照する。

## 概要

Hono + SQLite-backed Durable Objectによるアプリレベルrate limitは実装済みであり、stagingのDurable Object namespace/bindingも稼働している。一方、rate limit専用のstaging実HTTP境界、WAF、監視、production resource分離、最小smoke、rollbackの実環境証拠が揃っていない。

本計画では、既存実装を作り直さず、R7を完了と判断するための安全な実行順序、停止条件、承認境界、証拠形式を定義する。コード実装完了とR7完了を分け、一般導線の成功やrepository testだけで実環境gateを完了扱いにしない。

## 文書の責務

| 文書                                                                           | 正本とする内容                                                                                             |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| [`../api-rate-limit-production/plan.md`](../api-rate-limit-production/plan.md) | 設計、Hono実装、TDD履歴、Durable Object実装、当時の判断                                                    |
| 本計画                                                                         | staging実HTTP、WAF、Cloudflare実resource、R7対象A11Y、監視、rollback、production preflight/smoke、完了証拠 |
| [`../../05_progress.md`](../../05_progress.md)                                 | 全体進捗の要約                                                                                             |
| [`../../11_deployment.md`](../../11_deployment.md)                             | 共通deployment runbookとR7計画への入口                                                                     |
| [`../portfolio-release-v0-1/plan.md`](../portfolio-release-v0-1/plan.md)       | R1〜R18のrelease順序と最終release判定                                                                      |

## 現状再監査

- 再監査日: 2026-07-23
- 基準branch: `develop`
- 基準commit: `fbec33b`（PR #138 merge）
- 計画branch: `docs/plan-r7-rate-limit-environment-gates`
- Cloudflare公式仕様確認日: 2026-07-23
- 実環境操作: 未実施

### 確認済み事実

| 領域            | 現在の事実                                                                                              | 根拠                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Hono rate limit | 一般API、auth IP、操作別email、account IP/user、questions IP、game submit IP/userを実装済み             | PR #87、`backend/src/middleware/rateLimit/`、各route    |
| actor key       | HMAC-SHA-256、IPv6 `/64`、raw actor非保存を実装済み                                                     | `key.ts`、`key.test.ts`                                 |
| failure mode    | general/questionsはfail-open、auth/account/game submitはfail-closed 503                                 | `policies.ts`、middleware test、API文書                 |
| API契約         | Hono 429は日本語JSONと`Retry-After`、sensitive store障害は日本語JSON 503                                | `docs/04_api.md`、app integration test                  |
| Durable Object  | SQLite、同期transaction、request時reset、alarm cleanup、eviction後永続性、並行境界を実装済み            | PR #113、Workers runtime test                           |
| staging Worker  | Workers entrypoint、Wrangler構成、DO binding/migration、Hyperdrive、Secret設定済み                      | `backend/wrangler.jsonc`、staging配備計画               |
| staging一般導線 | health、CORS、OPTIONS、登録・認証・ゲーム等のsynthetic導線は成功済み                                    | staging配備計画に記録された確認結果                     |
| frontend        | loginはJSON 429/503・非JSON 429・network error、gameは429 alertとretryを自動test済み                    | frontend API/page test                                  |
| production構成  | production entrypoint、構成生成、custom domain、`workers_dev: false`、DO binding契約、dry-runを実装済み | PR #136、`worker-production.ts`、production config test |
| 業務DB          | rate limit counter用Prisma model/tableは存在しない                                                      | `backend/prisma/schema.prisma`                          |

### 証拠不足

- stagingでpolicy上限の直前・ちょうど・超過を確認した実HTTP証拠
- stagingでのHono 429本文、`Retry-After`、CORS/security headers
- stagingでのcounter reset後の再許可
- safeなsensitive store障害503の実環境証拠
- Durable Object alarm実行、期限切れrow削除、request/alarm/storage利用量
- staging/productionのCloudflare plan、zone、公開hostname、WAF権限
- WAF rule設定、Security Events、origin到達減少
- `workers.dev`やpreview URLを含むWAF迂回経路の閉鎖
- production専用namespace、binding、Secret、migrationの実resource証拠
- production最小smoke、観測、rollbackの実施証拠
- login/gameのR7対象手動A11Y証拠
- R7専用のGitHub Actions runまたは手動実行記録

### 既存計画の監査結果

| 計画書の主張・領域                  | 現在のコード・証拠                                | 判定             | 必要な修正                           |
| ----------------------------------- | ------------------------------------------------- | ---------------- | ------------------------------------ |
| 現行storeはmodule-local `Map`       | store抽象化とDurable Objectを実装済み             | 実装と矛盾       | 記録日時点の背景として保存           |
| Workers基盤が未実装                 | staging/production entrypointとWrangler契約が存在 | 実装と矛盾       | 現行entrypointへ参照を修正           |
| 一般/auth/game/account policy       | 現在の`policies.ts`と一致                         | 現在も正しい     | 設計不変条件として維持               |
| HMAC、IPv6 `/64`、PII非保存         | 実装・test済み                                    | 現在も正しい     | security gateへ転記                  |
| 業務DBをcounter storeにしない       | Prismaにrate limit modelなし                      | 現在も正しい     | DB変更禁止を維持                     |
| T13/T14 DO実装                      | PR #113とWorkers testで完了                       | 現在も正しい     | 歴史的TDD記録として維持              |
| T15 staging WAF/DO/429/503          | DO bindingは稼働、実HTTP/WAFは未確認              | 一部だけ正しい   | resource配備と検証を分割             |
| T17 frontend/A11Y                   | 自動testは実装済み、手動A11Yは未実施              | 一部だけ正しい   | 手動確認だけをR7へ移管               |
| T18 production deploy/監視/rollback | repository構成は準備済み、実resource証拠なし      | 一部だけ正しい   | R5/R13〜R16依存を明示                |
| T19全体実装完了                     | コード実装完了とR7 gate未完了が混在               | 古い             | R7完了記録を本計画へ分離             |
| T21 push/PR                         | 過去の実装PRはmerge済み                           | 古い             | 過去実績としてのみ保持               |
| staging一般導線成功でT15完了        | rate limit境界を試していない                      | 証拠不足         | R7専用証拠を取得                     |
| WAF複数rule・method条件             | planにより利用不可。Freeは1 ruleでmethod不可      | 古い             | 実plan確認後に再設計                 |
| WAFとHonoが同じ429契約              | edge responseはHono契約外                         | 実装と矛盾       | 証拠とUX判定を分離                   |
| production resourceは未実施         | repository構成はあるが実resourceは証拠不足        | 一部だけ正しい   | config準備済み・外部gate未完了と記録 |
| 高度なWAF tuningをR7で完了          | release計画では公開後の別task                     | 対象外になった   | R7は最小の外周防御とrollbackだけ     |
| monitoring/費用/迂回経路            | 既存実行証拠なし                                  | 新たな対応が必要 | R7のdecision gateへ追加              |

### T1〜T21の現在の扱い

| 旧タスク | 現在の扱い                                                                    |
| -------- | ----------------------------------------------------------------------------- |
| T1〜T12  | PR #87のHono・frontend先行実装記録として完了済み                              |
| T13〜T14 | PR #113のDurable Object/TDD記録として完了済み                                 |
| T15      | DO resource配備済み部分と、実HTTP/WAF未完了部分を分け、未完了分を本計画へ移管 |
| T16      | 当時の品質gate完了記録として保持。R7実行時は基準SHAでcontract testを再確認    |
| T17      | 自動A11Y testは完了。R7影響導線の手動確認だけ本計画へ移管                     |
| T18      | repository構成準備と実環境gateを分け、実環境分を本計画へ移管                  |
| T19      | コード実装記録は既存計画、R7完了記録は本計画で管理                            |
| T20〜T21 | 過去のcommit/PR履歴として保持。R7実行PRは別に管理                             |

## Cloudflare現行仕様と採用方針

公式資料は変更され得るため、実行日にも再確認する。表の値は2026-07-23確認時点である。

| 項目               | 公式仕様の確認結果                                                                          | R7での採用                                                             |
| ------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| WAF Free           | 1 rule、rule expressionはPath/Verified Bot、counting 10秒、mitigation 10秒                  | exact path中心の粗い防御候補。method/OPTIONS除外を前提にしない         |
| WAF Pro            | 2 rules、Host/URI/Path/Full URI/Query等、counting最大1分                                    | 実planがProなら一般/authの分離を再検討                                 |
| WAF Business       | 5 rules、Method/Source IP/User Agent等、counting最大10分                                    | 実planがBusiness以上の場合だけmethod条件を候補にする                   |
| WAF Block response | status 400〜499、既定429、JSON等のcustom bodyを設定可能                                     | 実accountで利用可否を確認し、利用不可でもfrontend fallbackを必須にする |
| WAF計数            | 検出反映に遅延があり、originへ正確な件数だけ通す用途ではない                                | WAFを粗い外周防御、DOを正確なapp判定とする                             |
| Security Events    | mitigated requestをservice/action/path等で確認。Sampled logsには限界がある                  | rule発火証拠に使うが、全件監査の代替にしない                           |
| DO Free compute    | request 100,000/日、duration 13,000 GB-s/日                                                 | 予測値と実測値を記録し、超過時失敗を停止条件にする                     |
| DO Free SQLite     | read 5,000,000行/日、write 100,000行/日、保存5 GB                                           | `consume`、alarm、deleteを含むwrite量を確認                            |
| DO課金単位         | HTTP request、RPC session、alarm invocationをrequestへ算入。`setAlarm`やdeleteはwriteへ算入 | policy別呼出し数とcleanupを別々に記録                                  |
| Workers Logs Free  | 200,000 event/日、保持3日。observability設定が必要                                          | 有効化の承認、sampling、PII非保存をdecision gateにする                 |
| routing            | productionは`workers.dev`よりRoute/Custom Domainを推奨。Custom Domainにはactive zoneが必要  | 公開hostnameとWAF対象zoneを一致させ、`workers_dev: false`を実機確認    |

参照:

- [WAF Rate Limiting Rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Rate limiting parameters](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/)
- [Request rate calculation](https://developers.cloudflare.com/waf/rate-limiting-rules/request-rate/)
- [Security Events](https://developers.cloudflare.com/waf/analytics/security-events/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Durable Objects metrics](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/)
- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Workers metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)
- [Workers routes and domains](https://developers.cloudflare.com/workers/configuration/routing/)
- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

## 前提条件・依存関係

### 既存の公開インターフェース

**`backend/src/middleware/rateLimit/policies.ts`**

- `RATE_LIMIT_POLICIES` — policy ID、limit、window、failure modeのsingle source。

**`backend/src/middleware/rateLimit/store.ts`**

- `RateLimitStore.consume(input)` — actor digest単位のfixed-window消費契約。

**`backend/src/middleware/rateLimit/durable-object-store.ts`**

- Durable Object bindingを使い、productionでmemoryへfallbackしないstore adapter。

**`backend/src/lib/config.ts`**

- `RATE_LIMIT_STORE`、`RATE_LIMIT_KEY_SECRET`を含む実行時設定の検証。

**`backend/src/worker-handler.ts`**

- Workers request、Cloudflare IP、binding、request-scoped dependencyをHonoへ接続する。

**`backend/src/lib/production-worker-config.ts`**

- production Worker configを生成し、Custom Domain、`workers_dev: false`、DO binding/migrationを固定する。

**`frontend/src/lib/api/errors.ts`**

- `parseErrorResponse()` — JSONエラーを保持し、非JSON時はfallbackを使う。
- `ApiError` — HTTP/network表示契約。

### 重要な依存関係

- R5のproduction auth構成とhostname/site境界が確定してからproduction gateへ進む。
- R13のproduction DB判断をR7で代行しない。
- R14 preflightでresource/Secret/configを確認する。
- R15の共通deploy順序へ統合し、R7専用production deployを重複実装しない。
- R16 production smokeの一部として非破壊rate limit確認を記録する。
- R8のうち429/503、CORS/security headers、PII非保存log、WAF/DO監視だけ連携する。
- R10のうちlogin/gameのalert、keyboard retry、待機表示だけ連携する。

## スコープ

- 現行実装・Cloudflare resource・証拠の再確認
- stagingでのHono 429境界、`Retry-After`、reset、header確認
- 安全な503確認方法の選定と、許可された場合の隔離検証
- DO alarm/storage/利用量確認
- R7対象のlogin/game手動A11Y
- WAFのplan/zone/hostname確認、段階適用、Security Events確認
- production namespace/binding/Secret分離のpreflight
- R16へ統合するproduction最小smoke
- 監視、停止条件、rollback、残余リスク、証拠記録
- 関連文書の同期

## 非スコープ

- rate limit policy値、middleware、store、routeの再実装
- Prisma schema/migration、業務DBへのcounter table追加
- Redis、KV、PostgreSQLへのstore変更
- 共有stagingのDO bindingやSecretを故意に破壊する試験
- productionで各閾値まで大量requestを送る境界試験
- production deploy、migration、DB操作をR7だけで独立実行すること
- 高度なWAF tuning、Bot Management、Turnstile、API Shield
- R8全体のsecurity headers/CORS/log最終監査
- R10全体のresponsive/A11Y監査
- R13〜R16の完了処理
- dependency update
- 長期SIEM、Logpush、Sentry、requestId基盤の新規実装

## 対象ファイル一覧

### 本計画作成で変更するファイル

| ファイル                                             | 変更種別 | 内容                                             |
| ---------------------------------------------------- | -------- | ------------------------------------------------ |
| `docs/plans/r7-rate-limit-environment-gates/plan.md` | 新規     | R7実環境gateの正本                               |
| `docs/plans/api-rate-limit-production/plan.md`       | 修正     | 現状再監査、歴史的責務、R7計画へのリンク         |
| `docs/plans/portfolio-release-v0-1/plan.md`          | 修正     | R7正本・依存関係の同期                           |
| `docs/05_progress.md`                                | 修正     | 実装済み範囲と未完了gateの同期                   |
| `docs/11_deployment.md`                              | 修正     | 古いWAF候補を除き、本計画へのrunbookリンクへ整理 |

### R7実行時に参照するrepository file

| ファイル                                                           | 用途                                     |
| ------------------------------------------------------------------ | ---------------------------------------- |
| `backend/wrangler.jsonc`                                           | staging binding/migration/entrypoint確認 |
| `backend/src/worker.ts`                                            | staging entrypoint                       |
| `backend/src/worker-production.ts`                                 | production entrypoint                    |
| `backend/src/worker-handler.ts`                                    | runtime dependencyとIP source            |
| `backend/src/lib/production-worker-config.ts`                      | production routing/resource contract     |
| `backend/src/cloudflare/rate-limit-counter.ts`                     | SQLite/alarm実装                         |
| `backend/src/middleware/rateLimit/`                                | policy/key/store/failure mode            |
| `backend/src/app.rate-limit.test.ts`                               | Hono契約                                 |
| `backend/src/app.rate-limit-route-matrix.test.ts`                  | route/middleware順序                     |
| `backend/src/cloudflare/rate-limit-counter.test.ts`                | DO並行性・永続化・cleanup                |
| `backend/src/cloudflare/worker-production.test.ts`                 | production相当429/503                    |
| `frontend/src/lib/api/errors.test.ts`                              | JSON/非JSON 429/503                      |
| `frontend/src/routes/login/login-page.test.ts`                     | login alert/retry                        |
| `frontend/src/routes/(app)/game/play/game-play-rate-limit.test.ts` | game alert/retry                         |

### R7 staging実HTTP証拠の実行準備で変更するファイル

| ファイル                                                    | 変更種別 | 内容                                                        |
| ----------------------------------------------------------- | -------- | ----------------------------------------------------------- |
| `.github/workflows/staging-rate-limit-evidence.yml`         | 新規     | 1実行1caseのmanual staging証拠workflowとfixture回収         |
| `backend/package.json`                                      | 修正     | staging証拠runnerのCLI script追加                           |
| `backend/src/jobs/stagingRateLimitEvidence.ts`              | 新規     | auth・questions・game submit境界と429 header/body契約の確認 |
| `backend/src/jobs/stagingRateLimitEvidence.cli.ts`          | 新規     | 機密を含めず安全な証拠要約だけを出力するCLI                 |
| `backend/src/jobs/stagingRateLimitEvidence.cli.test.ts`     | 新規     | CLI終了code・固定失敗文言・機密非出力のunit test            |
| `backend/src/jobs/stagingRateLimitEvidence.test.ts`         | 新規     | 環境guard・境界回数・429契約・機密非出力のunit test         |
| `backend/src/jobs/stagingRateLimitEvidenceWorkflow.test.ts` | 新規     | manual限定・fixture cleanup・credential取扱いの契約test     |
| `docs/plans/r7-rate-limit-environment-gates/plan.md`        | 修正     | 実装準備・TDD結果・実環境未実施状態の同期                   |
| `docs/05_progress.md`                                       | 修正     | staging証拠workflow実装済み、実環境証拠待ちを同期           |

## 外部resource

実在ID、Secret値、token、account ID、zone IDは文書へ記載しない。

| Resource                     | staging                          | production                 | R7 gate                                |
| ---------------------------- | -------------------------------- | -------------------------- | -------------------------------------- |
| Worker                       | 配備済み                         | repository構成のみ確認済み | name/version/dateをDashboardで確認     |
| Public hostname              | `workers.dev` endpointの記録あり | 未確認                     | zone/Custom Domain/迂回経路を確認      |
| DO namespace                 | binding稼働記録あり              | 証拠不足                   | 環境分離、class、migrationを確認       |
| `RATE_LIMIT_COUNTER` binding | 稼働記録あり                     | 証拠不足                   | binding先とenvironmentを二者確認       |
| `RATE_LIMIT_KEY_SECRET`      | 設定済み記録あり                 | 証拠不足                   | presenceのみ確認。値は表示・保存しない |
| Hyperdrive                   | staging稼働済み                  | R5/R14依存                 | R7では変更しない                       |
| WAF rate limiting rule       | 未適用                           | 未適用/証拠不足            | plan/zone/hostname確認後に段階適用     |
| Security Events              | 未確認                           | 未確認                     | 権限とsamplingを確認                   |
| Workers/DO metrics           | 未確認                           | 未確認                     | baselineと試験時間帯を記録             |
| Workers Logs                 | 有効化状態不明                   | 有効化状態不明             | PII/費用/保持を承認後に利用            |

## Decision gate

| Gate | 決定内容                                           | 判断者・承認者                              | 未承認時                                                |
| ---- | -------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| G1   | Cloudflare zone plan、Workers plan                 | Cloudflare account管理者 / repository owner | WAF/費用試験を開始しない                                |
| G2   | staging/production公開hostnameとzone               | Cloudflare account管理者 / R5担当           | WAFを作成しない                                         |
| G3   | WAF rule枠、field、period、action、custom response | Webセキュリティ担当 / account管理者         | 候補値を確定しない                                      |
| G4   | Security Events、Workers/DO metrics閲覧権限        | account管理者                               | 観測gateを開始しない                                    |
| G5   | staging synthetic fixture、送信元IP、実行時間帯    | staging運用責任者                           | 実HTTP境界試験を開始しない                              |
| G6   | email送信・refresh token・game session cleanup方法 | staging運用責任者 / DB責任者                | 副作用を伴うcaseを実行しない                            |
| G7   | 503証拠方式                                        | Webセキュリティ担当 / staging運用責任者     | repository runtime testを代替証拠とし、残余リスクを記録 |
| G8   | isolated canary Worker/専用test namespace作成      | Cloudflare account管理者                    | 共有stagingへfault injectionしない                      |
| G9   | production namespace/binding/Secret分離            | R14承認者 / Cloudflare account管理者        | deployへ進まない                                        |
| G10  | production最小smokeとrollback window               | R15/R16承認者                               | production requestを送らない                            |

## セキュリティ・PII不変条件

- productionのIPは`CF-Connecting-IP`だけを信頼し、XFF/X-Real-IPをactorにしない。
- raw IP、email、user ID、HMAC digest、token、Cookie、Authorization、password、request bodyを証拠・ログへ保存しない。
- email/userを含むfixture名はsynthetic IDへ置換する。
- Secretは存在確認だけとし、Dashboard/API/CLI出力を貼り付けない。
- HMAC Secret rotationは全bucket resetになるため、R7試験の手段にしない。
- productionで`RATE_LIMIT_STORE=memory`を許可しない。
- 503試験のために共有namespace、binding、Secretを変更しない。
- WAF edge responseとHono JSON responseを同一契約として扱わない。
- WAFを戻してもHono/DO制限を維持する。
- rollback直後にDO namespaceを削除しない。

## R7完了条件

以下をすべて満たしたときだけR7を完了`[x]`にする。

1. 基準commit、実行環境、Cloudflare plan/zone/hostname、承認者を記録している。
2. stagingの実HTTPでauth 11回目、game submit 21回目、questions 31回目のHono 429を安全に確認している。
3. Hono 429の日本語JSON、`Retry-After`、CORS/security headers、reset後再許可を確認している。
4. actor/bucket分離の実施可能caseをstagingで確認し、実施不能caseはrepository contract testと残余リスクを記録している。
5. sensitive store障害503を、共有環境を壊さない証拠方式で確認している。
6. DO alarm/storage cleanupとrequest/alarm/storage利用量を確認している。
7. login/gameのR7対象手動A11Yを確認している。
8. 最小WAF ruleを段階適用し、Security Events、false positive、origin到達への影響、edge fallbackを確認している。
9. 公開hostnameがWAF対象zoneを通り、productionで`workers.dev`等の迂回経路がない。
10. production namespace/binding/Secretがstagingと分離され、memory fallbackが拒否される。
11. R15/R16の順序に統合したproduction最小smokeが成功している。
12. 観測期間を完了し、停止条件・alert・通知先・責任者・rollback結果を記録している。
13. `docs/05_progress.md`、`docs/11_deployment.md`、portfolio release計画、本計画の証拠が一致している。

## 実行順序

```text
repository証拠固定
  -> Decision gate G1〜G7
  -> staging fixture/canary準備
  -> Hono 429境界
  -> reset・bucket・header
  -> 503代替証拠/隔離canary
  -> DO cleanup・利用量
  -> R7対象A11Y
  -> WAF disabled/high-threshold
  -> WAF enforce・Security Events
  -> staging観測
  -> R5/R14 production preflight
  -> R15共通deploy
  -> R16最小smoke
  -> production観測・rollback確認
  -> 文書同期・R7完了判定
```

## Repository contract test

外部操作の前にrelease候補SHAで実行する。既存testを証拠として利用し、R7だけのために同等testを複製しない。

| 契約                                    | 主なtest                              |
| --------------------------------------- | ------------------------------------- |
| policy値・failure mode                  | `policies.test.ts`                    |
| HMAC、IPv6 `/64`、spoof header          | `key.test.ts`、worker adapter test    |
| 429/503、`Retry-After`、header          | `app.rate-limit.test.ts`              |
| route/middleware順序                    | `app.rate-limit-route-matrix.test.ts` |
| DO並行境界・永続化・alarm               | `rate-limit-counter.test.ts`          |
| production相当DO 429/503                | `worker-production.test.ts`           |
| production config、`workers_dev: false` | `production-worker-config.test.ts`    |
| login/game/API error A11Y               | frontend rate limit関連test           |

実行候補:

```bash
cd backend
npm run test -- --run src/app.rate-limit.test.ts src/app.rate-limit-route-matrix.test.ts
npm run test:workers
npm run workers:build
npm run workers:production:dry-run

cd ../frontend
npm run test -- --run src/lib/api/errors.test.ts src/routes/login/login-page.test.ts "src/routes/(app)/game/play/game-play-rate-limit.test.ts"
```

外部gateを開始する最終release候補では、AGENTS.mdのbackend/frontend品質gateをR11の実行と重複させず、R11の証拠を参照する。

## staging実HTTP計画

### 事前準備

- 実行日時、送信元、担当者、承認者を記録する。
- 共有利用者が少ない時間帯を選ぶ。
- 専用synthetic userを最低2名用意し、実在メールを使わない。
- メール送信を伴うcaseはstaging sinkとcleanupが確認できる場合だけ実行する。
- refresh tokenとgame sessionのcleanup手順を確認する。
- 各test group間に対象windowのresetを確保し、別groupのbucket消費を混ぜない。
- HTTP body、Cookie、Authorization、raw actorをcaptureへ残さない。
- scriptはstatus、必要なresponse header、redact済みbody要約だけを出力する。
- 実行中に一般利用者の429/503、login成功率低下が見えたら停止する。

### manual証拠workflow

- `.github/workflows/staging-rate-limit-evidence.yml`は`workflow_dispatch`のみとし、`develop`とstaging Environmentに限定する。
- fixture作成前にreview済み40桁SHAと実行SHAの一致、固定確認文字列、承認者、change recordを検証する。承認者とchange recordは改行やMarkdown記号を許可しない形式に限定する。
- `auth`、`questions`、`game-submit`はpolicy windowと共通bucketを混ぜないよう、必ず1caseずつ別workflow runで実行する。
- workflowは既存の完全一致synthetic Admin/User fixtureをephemeral passwordで再作成し、成功・失敗を問わずcleanupする。main jobが非成功なら独立recovery jobも実行する。
- runnerはstatus、観測policy ID、許可件数、制限request番号、`Retry-After`、429本文・credentialed CORS（origin/credentials）・security headerの契約判定だけを出力する。token、Cookie、Authorization、password、email/user ID、question/session ID、response bodyは出力しない。
- 全HTTP requestはredirectを追跡せず、固定10秒timeoutで停止する。許可応答もstatus・JSON Content-Type・公開response shapeをruntime検証し、429ではpolicy window内の`Retry-After`とproduction security header一式を確認する。
- `game-submit`は公開questions responseの各問題について先頭choiceを回答として使い、正解情報やDB直読み取りへ依存しない。各submit用に新しいquestion setを取得する。route順序上、同じlimit値ではIP middlewareがuser middlewareより先に429を返すため、本workflowの観測policyは`GAME_SUBMIT_IP`とする。`GAME_SUBMIT_USER`のbucket分離はR7-08で別証拠化する。
- 既存fixture flag、固定staging API URL、固定frontend originのguardを通過しない限りHTTP requestを開始しない。
- workflowのrepository実装完了はR7-04〜R7-07の完了を意味しない。G5/G6、実行時間帯、停止時通知先の承認後に実行し、結果を別Evidenceとして記録する。

### 実HTTPテストケース

| ID  | 対象                     | 手順                                             | 期待結果                                                      | 安全策                                         |
| --- | ------------------------ | ------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------- |
| S01 | root/health/OPTIONS      | 少数request                                      | rate limit対象外、CORS/security headers正常                   | 境界回数を送らない                             |
| S02 | general API              | limit未満だけ確認                                | 2xx/認証上の通常status、429なし                               | 60回境界は共有stagingで原則省略                |
| S03 | auth IP                  | synthetic userで正しいloginを10回、その直後に1回 | 1〜10許可、11回目Hono 429                                     | 失敗login lockを使わず、refresh tokenをcleanup |
| S04 | auth reset               | `Retry-After`後に1回                             | 再許可                                                        | 10分待機を別実行記録に分ける                   |
| S05 | questions IP             | 30回後に1回                                      | 1〜30許可、31回目429                                          | 問題bodyを保存しない                           |
| S06 | game submit IP/user      | isolated question setで20回後に1回               | 1〜20許可、21回目429                                          | synthetic sessionをcleanup、事前にDB負荷承認   |
| S07 | same IP / different user | user Aでuser bucketを消費し、user Bを確認        | user bucketは独立、IP bucketは共有                            | 2 synthetic user限定                           |
| S08 | same user / different IP | 承認済みの2送信元から確認                        | user bucket共有、IP bucket独立                                | 送信元制御できない場合は実行しない             |
| S09 | operation別email         | register/login/forgot等の対象操作を分離して確認  | 操作別bucket                                                  | mail/DB副作用を承認できるcaseだけ              |
| S10 | IPv6 `/64`               | 同一`/64`の2 addressで確認                       | 同一IP actor bucket                                           | IPv6環境がなければcontract testへ代替          |
| S11 | spoof header             | XFF/X-Real-IPだけを変更                          | bucket回避不可                                                | `CF-Connecting-IP`はclientから偽装しない       |
| S12 | Hono 429 contract        | S03/S05/S06の429を確認                           | 日本語JSON、`Retry-After`、credentialed CORS/security headers | responseからPIIを除外                          |
| S13 | reset                    | window経過後に再度1回                            | 許可される                                                    | 長時間sleepせず別時刻に再実行                  |
| S14 | general store failure    | 代替証拠またはisolated canary                    | fail-open                                                     | 共有bindingを変更しない                        |
| S15 | sensitive store failure  | 代替証拠またはisolated canary                    | 日本語JSON 503                                                | 共有bindingを変更しない                        |

### 共有stagingで省略できる境界

次はrepository contract testを必須証拠とし、実環境を安全に制御できない場合は無理に実行しない。

- general API 61回目
- 同一user・別IP
- IPv6 `/64`
- operation別emailで外部メールやuser作成が過剰になるcase
- general/sensitive store fault injection

省略時は、理由、代替test、実環境との差、残余リスク、承認者を記録する。

## 503試験の安全性

| 方法                                       | 安全性   | 実環境性                                    | 採用方針                                   |
| ------------------------------------------ | -------- | ------------------------------------------- | ------------------------------------------ |
| repository Workers runtime test            | 高       | production相当runtime、外部resourceではない | 必須の基本証拠                             |
| production config validation/dry-run       | 高       | binding契約を確認、実障害ではない           | 必須のpreflight証拠                        |
| isolated canary Worker +専用test namespace | 高       | Cloudflare実resource                        | G8承認時の推奨追加証拠                     |
| scoped fault injection機構                 | 設計次第 | 実環境                                      | 既存機構がないためR7で安易に新規実装しない |
| 共有staging binding/Secret破壊             | 低       | 実環境                                      | 禁止                                       |
| production公開hostnameで障害注入           | 低       | 本番                                        | 禁止                                       |

R7の必須条件は、repository runtime test、production config validation、共有環境がfail-closed設定である証拠を組み合わせることとする。承認済みisolated canaryを作成できる場合のみ、追加で実503を確認する。canaryを作れない場合はR7承認者が残余リスクを明示的に受容するまで完了にしない。

## Durable Object cleanup・費用確認

1. test専用actorでcounterを作成する。
2. reset時刻とalarm予定をPIIなしで記録する。
3. reset後、request-time cleanupまたはalarmにより状態が期限切れになることを確認する。
4. 早期alarm時に次回alarmが再設定されるcontract testを参照する。
5. Dashboardのnamespace metricsでrequest、error、storage、alarm相当の利用量を試験時間帯に絞って確認する。
6. Hono request当たりのDO呼出し数をpolicy別に記録する。
7. 高cardinality時のobject/storage増加を試算する。
8. Free枠の50%、80%を運用上の見直し候補とし、実traffic baseline後に正式値を承認する。

費用試算へ含めるもの:

- Worker request
- DO HTTP/RPC request
- alarm invocation
- SQLite row read/write/delete
- `setAlarm`
- 保存容量
- Workers Logs event

## R7対象A11Y確認

R10全体へ拡張せず、rate limit応答に直接関係する導線だけ確認する。

| 画面           | ケース             | 確認内容                                             |
| -------------- | ------------------ | ---------------------------------------------------- |
| login          | Hono JSON 429      | API日本語message、`role="alert"`、送信ボタン再有効化 |
| login          | Hono JSON 503      | message保持、再試行可能                              |
| login          | edge非JSON 429     | fallback表示、network errorとの区別                  |
| login          | network/CORS error | 接続確認message、操作不能にならない                  |
| game questions | 429                | alert通知、native retry button、keyboard操作         |
| game submit    | 429                | alert通知、再送信/新規開始button、keyboard操作       |
| 共通           | loading/wait       | `aria-busy`または状態文言、二重送信防止              |
| 共通           | focus              | 不自然な自動focus移動なし、現在位置を失わない        |
| 共通           | visual             | 色だけに依存せず、textとcontrolで状態を伝える        |
| 共通           | screen reader      | alert/statusが一度だけ理解可能に通知される           |

## WAF段階適用

### WAF設計原則

- Hono/DOを正確なpolicyの正本とし、WAFは大量burstの粗い防御にする。
- WAF閾値をHonoより通常操作へ厳しくしない。
- Free planでmethod、複数rule、custom responseを推測しない。
- pathだけでOPTIONSを除外できないplanではpreflight消費を考慮する。
- rule orderと既存security ruleの衝突を確認する。
- Security Eventsはsampledであり、origin到達数やHono 429の唯一の証拠にしない。
- edge responseはHono日本語JSON契約外とする。

### 段階

| 段階 | 設定                                                                              | 完了条件                                                                    |
| ---- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| W0   | plan、zone、hostname、rule枠、既存rule、権限をread-only確認                       | G1〜G4承認                                                                  |
| W1   | rule draft/disabledを記録。draft不可なら作成前レビュー                            | expression、characteristics、period、threshold、action、order、rollback承認 |
| W2   | log actionが利用可能ならlog。利用不可ならHonoより十分高いthresholdで短時間enforce | 通常trafficを遮断しない                                                     |
| W3   | synthetic trafficで発火                                                           | Security Events、client response、origin/Worker metricsを時刻で相関         |
| W4   | baselineを踏まえた最終の粗いthresholdへ調整                                       | false positiveなし、Hono制限維持                                            |
| W5   | staging観測                                                                       | login/game成功率、429/503、WAF block、DO errorが停止条件未満                |
| W6   | production preflight後に同じ手順                                                  | R15/R16承認内で実施                                                         |

### Free plan時の最低候補

- 1 ruleをexactな高リスクpathへ使う。
- 第一候補は`/api/v1/auth/login`だが、methodを条件にできずOPTIONSも計数され得るため、実preflight trafficを確認してから決定する。
- counting/mitigationは10秒固定として設計する。
- thresholdはtraffic baseline後に決定し、Honoの10回/10分をWAFで再現しようとしない。
- 複数auth pathのORはcounter共有と副作用をレビューし、安易に採用しない。
- 高度なpath別tuningはportfolio release計画の公開後taskへ残す。

## 監視計画

### 観測期間

- staging Hono境界試験: 実行中から終了後30分
- staging WAF高閾値: 最低24時間
- staging WAF最終候補: 最低24時間
- production preflight: deploy直前
- production最小smoke: R16 window内
- production初期観測: 最低48時間

### 指標

| 指標                     | 情報源                                       | baseline    | 停止候補                   |
| ------------------------ | -------------------------------------------- | ----------- | -------------------------- |
| Hono 429数/率            | redact済みHTTP結果、利用可能ならWorkers Logs | WAF前24時間 | 通常操作で想定外429        |
| WAF block数              | Security Events                              | W2開始前    | synthetic以外の急増        |
| DO error                 | DO metrics/Workers Logs                      | 試験前      | 1件でも原因不明なら停止    |
| 503数/率                 | redact済みHTTP結果/ログ                      | 0           | canary以外で1件以上        |
| login成功率              | synthetic結果/既存観測                       | WAF前       | baselineから有意低下       |
| game submit成功率        | synthetic結果/既存観測                       | WAF前       | baselineから有意低下       |
| DO request/write/storage | DO metrics                                   | 試験前      | 想定の2倍、Free枠50%到達   |
| Workers Logs event       | Logs usage                                   | 有効化前    | Free枠50%到達またはPII検出 |

正式alert閾値はtraffic baseline後に決定し、根拠なく固定値を作らない。

### 責任

- 観測責任者: repository ownerまたは指名された運用担当
- WAF判断: Webセキュリティ担当 + Cloudflare account管理者
- Worker/DO判断: Cloudflareプラットフォーム担当
- production継続/停止: R15/R16承認者
- 通知先: 実行前に確認し、個人連絡先を文書へ直接記載しない

## 停止条件

次のいずれかで新規requestと次段階への移行を停止する。

- synthetic以外の利用者に429/503が発生した疑い
- login/game成功率の想定外低下
- DO error、binding error、Secret/config error
- WAF ruleが想定外path、OPTIONS、healthを遮断
- CORS/security headersが欠落
- PII、Secret、digest、token、Cookie、Authorization、bodyがlog/証拠へ出力
- request/alarm/storage/log利用量が見積りの2倍
- Free枠50%到達または課金見込みが承認値を超過
- 公開hostname、zone、environmentの取り違え
- rollback担当者または権限が不在
- 証拠の時刻・基準commit・対象environmentを確定できない

## Rollback

### WAF

1. 対象ruleだけをdisableするか、直前の安全な高thresholdへ戻す。
2. Hono/DO制限は維持する。
3. Security Eventsと通常導線を再確認する。
4. false positiveのpath/action/rule orderを記録する。

### Worker

1. Cloudflareのreview済み直前versionへrollbackする。
2. productionでmemory fallbackが有効になっていないことを確認する。
3. health、CORS、auth、gameの最小確認を行う。
4. rollback直後にDO namespace/migrationを削除しない。

### Durable Object/Secret

- namespace削除はtraffic停止とrollback安定後の別承認作業とする。
- bindingを共有stagingで切り替えて障害試験しない。
- HMAC Secret rotationを通常rollbackに使わない。
- 緊急rotation時は全bucket reset、影響範囲、実施者、時刻を記録する。

## production preflight

R14へ統合し、次をread-onlyまたはdry-runで確認する。

- release候補SHAとproduction Worker configの一致
- `worker-production.ts`がentrypoint
- `workers_dev: false`
- Custom Domain/Routeと対象zone
- stagingと異なるDO namespace/binding
- SQLite migration classとtag
- `RATE_LIMIT_STORE=durable-object`
- `RATE_LIMIT_KEY_SECRET`のpresence
- Hyperdrive/DB targetはR5/R13〜R15証拠を参照
- WAF rule、order、rollback権限
- Security Events、Workers/DO metrics閲覧権限
- 旧Worker versionとrollback手順

Secret値、resource ID、DB URLはartifactやstep summaryへ出力しない。

## production最小smoke

R16へ統合し、境界までrequestを送らない。

1. healthとOPTIONSを各1回確認する。
2. synthetic userでloginを1回確認する。
3. game questionsを1回確認する。
4. 許可済みならgame submitを1回確認する。
5. response headersと通常成功を確認する。
6. Worker/DO metricsでrequestが想定resourceへ到達したことを確認する。
7. memory fallbackが使われていないことをconfig/metricsで確認する。
8. WAF false positiveとSecurity Eventsを確認する。

productionのauth 11回目、game submit 21回目、questions 31回目は実施しない。staging境界、repository contract test、production resource/config証拠を組み合わせる。

## 証拠記録形式

```markdown
### R7 Evidence E-XX

- 実行日時: YYYY-MM-DD HH:mm JST
- environment: staging / production-canary / production
- 基準commit:
- 対象Worker version:
- 対象policy/rule:
- 実行者:
- 承認者:
- 事前gate:
- 手順:
- 期待結果:
- 実結果:
- status/header/body要約:
- Cloudflare metrics/Security Events確認時間帯:
- cleanup:
- rollback:
- 判定: pass / fail / blocked / substituted
- 代替証拠:
- 残余リスク:
- 添付先:

PII・Secret確認:

- [ ] raw IPなし
- [ ] email/user IDなし
- [ ] digestなし
- [ ] token/Cookie/Authorizationなし
- [ ] password/bodyなし
- [ ] account/zone/resource IDなし
```

run URL、PR、commitは実在を確認できた値だけを記録する。Dashboard screenshotはSecret/resource IDをredactし、必要最小限の時間帯と集計値だけを残す。

## Release依存関係

| Release task          | R7との関係                                       | R7で完了させるか |
| --------------------- | ------------------------------------------------ | ---------------- |
| R5 production auth    | hostname/site/refresh構成の前提                  | いいえ           |
| R8 security最終確認   | 429/503、CORS/security headers、safe logだけ共有 | いいえ           |
| R10 A11Y              | login/game rate limit導線だけ共有                | いいえ           |
| R13 production DB判断 | production targetの前提                          | いいえ           |
| R14 preflight         | DO/WAF/config確認を統合                          | いいえ           |
| R15 deploy            | Worker/DO/WAF適用順序を統合                      | いいえ           |
| R16 production smoke  | 非破壊最小smokeを統合                            | いいえ           |
| 高度なWAF tuning      | 公開後trafficに基づく別task                      | いいえ           |

## 残余リスク

| リスク                             | 対策                                             | 受容条件                |
| ---------------------------------- | ------------------------------------------------ | ----------------------- |
| WAF counterは厳密でない            | DOを正確な判定に維持                             | WAFを外周防御と明記     |
| Free planは1 rule/method不可       | exact path、高threshold、OPTIONS観測             | false positiveなし      |
| Security Eventsはsampled           | client結果、Worker/DO metricsと相関              | 全件監査に使わない      |
| 503を共有環境で再現できない        | runtime test、config validation、optional canary | 明示承認                |
| IPv6/複数IPを用意できない          | contract testへ代替                              | 差分と残余リスクを記録  |
| 高cardinalityでDO storage増加      | alarm cleanup、利用量観測                        | Paid移行/停止条件を承認 |
| Secret rotationでbucket reset      | rotation禁止、緊急手順                           | maintenance承認         |
| `workers.dev` bypass               | productionでdisable、Custom Domain確認           | 公開経路がzoneを通る    |
| rollbackで旧WorkerとDO契約がずれる | namespaceを保持、version互換をpreflight          | rollback smoke成功      |

## 文書同期先

R7実行ごとに次を同期する。

- 本計画: evidence、task checkbox、decision、残余リスク
- `docs/05_progress.md`: 要約とR7状態
- `docs/11_deployment.md`: 実resourceの非秘密設定、監視、rollback
- portfolio release計画: R7完了条件とR14〜R16依存
- 既存API計画: 新しい実装履歴が生じた場合だけ追記
- `docs/04_api.md`: API契約が変わった場合だけ更新
- `docs/02_security.md`: policy値が変わった場合だけ更新

## タスクリストレビュー

### v1: 必要作業

- 現行実装・PR・staging記録・Cloudflare仕様を固定する。
- plan/zone/hostname/resource/権限を確認する。
- staging 429境界、reset、bucket、headerを確認する。
- 503、DO cleanup、費用、A11Yを確認する。
- WAFを段階適用する。
- production preflight/smokeへ統合する。
- 監視・rollback・証拠・文書同期を完了する。

### v2: security・PII・error・権限・費用レビュー

- raw actor、digest、Secret、token、bodyを証拠へ残さないtaskを追加した。
- 共有binding/Secret破壊を禁止し、503を代替証拠またはisolated canaryへ変更した。
- Cloudflare権限、判断者、承認者を各decision gateへ追加した。
- DO request/RPC/alarm/row write/storage、Workers Logsを費用確認へ追加した。
- Hono 429/503とedge responseを別契約に分けた。

### v3: 現行実装・Cloudflare制約・実HTTP・rollbackレビュー

- 完了済みHono/DO/frontendを再実装taskから除外した。
- Free planの1 rule、path中心、10秒、method不可を反映した。
- productionで境界まで送らず、stagingとcontract testを主証拠にした。
- IPv6、別IP、email副作用は安全に準備できる場合だけ実行する。
- WAF rollbackをWorker rollbackより先にし、DO namespaceを保持する順序へ固定した。
- R5、R13〜R16との重複deploy/smokeを除外した。

### v4: 確定

- 高度なWAF tuning、全体A11Y/security監査、DB変更、dependency updateを除外した。
- R7の完了を「コード実装」ではなく「実環境証拠と承認」に限定した。
- 実行不能caseは代替証拠・残余リスク・承認を必須にした。

## staging証拠workflow実装記録

- 実装日: 2026-07-23
- 実装ブランチ: `feature/r7-rate-limit-environment-gates`
- 実装commit: `d007d3f`
- PR: [#140](https://github.com/RitukoIsibasi0222/gensoko/pull/140)
- TDD Red: runner moduleとworkflowが未作成であることを理由に対象2 filesが失敗
- TDD Green: runner・CLI・manual workflow実装後、2 files / 13 tests成功
- Refactor: 未使用response bodyの破棄と検証済みchoiceの型明示後、再利用fixtureを含む4 files / 30 tests成功
- PR #140初回実装commit時点の最終品質gate: backend 103 files / 1057 tests成功（外部DB用10 tests skip）、Workers runtime 2 files / 15 tests成功、Node/Workers TypeScript build・ESLint・Prettier check成功
- 実環境実行: 未実施。レビュー・merge・G5/G6承認後にcaseごとに別実行する

### 設計判断

- 長時間sleepをworkflowへ入れず、reset確認は別時刻・別実行のR7-08証拠に分離した。
- `auth`、`questions`、`game-submit`を1runにまとめず、共通`GENERAL_API_IP`やpolicy windowの相互干渉を避けた。
- 新しいfixtureを増やさず、完全一致識別・collision停止・冪等cleanupが既にtest済みのstaging synthetic Admin/User fixtureを再利用した。
- APIの公開契約とpolicy値は変更せず、`docs/04_api.md`と`docs/02_security.md`は変更対象外とした。

### 厳格レビュー後の改善記録

- 改善日: 2026-07-23
- TDD Red: redirect拒否、request timeout、全security header、policy ID、runtime validation、CLI失敗契約、workflow承認gateを追加し、対象3 filesで22 tests失敗・13 tests成功を確認
- TDD Green: 共通HTTP helper、許可応答validator、429 validator、CLI終了code、manual workflow gateを実装し、対象3 files / 35 tests成功
- Copilot review対応 Red/Green: `Access-Control-Allow-Credentials`欠落を1 test失敗・25 tests成功で再現し、credentialed CORSのorigin/credentials両方を必須化して対象26 tests成功
- Copilot review対応commit: `51bed34`（2件のCORS指摘を1つの契約修正として対応）
- Copilot再レビュー対応 Red/Green: gate通過後の後続失敗でも監査summaryを残す契約を1 test失敗・6 tests成功で再現し、検証済みgate outputで`always()`を制限して対象7 tests成功。無条件`always()`は未検証入力のMarkdown出力を防ぐため採用しない
- Copilot再レビュー対応commit: `57eb0ce`（監査summaryとPR参照の2指摘を一括対応）
- 追加TDD Red/Green: 承認gate失敗時にもcleanup recoveryがstaging DBへ触れる問題を1 test失敗・6 tests成功で再現し、fixture lifecycle開始後だけmain cleanup/recoveryを許可して7 tests成功
- security: `fetch`の既定redirect追跡によるephemeral password POST bodyの転送を防ぐため、全requestへ`redirect: "error"`を固定した
- operations: 個々のrequestへ10秒timeoutを付け、5分のworkflow step timeoutまで無応答のまま待たない構造にした
- contract: 429のJSON Content-Type、policy window内かつsafe integerの`Retry-After`、credentialed CORS（`Access-Control-Allow-Origin`と`Access-Control-Allow-Credentials: true`）、production security header一式、`X-Powered-By`非露出を必須化した
- audit: workflow実行前のreview済みSHA・確認文字列・承認者・change recordを必須化する。全gate通過後はsetup・prepare・runnerの成功/失敗を問わず、秘密値なしのJob Summaryへ記録する。gate不成立時は未検証入力を記録しない
- cleanup: prepare直前にfixture lifecycle markerを設定し、markerがないgate失敗ではmain cleanupと独立recoveryの両方を実行しない。prepare開始後の失敗では従来どおり二重の回収経路を維持する
- PR #140 merge時点の最終品質gate: backend 104 files / 1080 tests成功（外部DB用10 tests skip）、Workers runtime 2 files / 15 tests成功、Node/Workers TypeScript build・ESLint・Prettier check成功
- 実環境実行: 未実施のまま。R7-04〜R7-08の完了状態は変更しない

### 初回auth実環境runと安全な失敗分類

- 実行日: 2026-07-23
- 実行SHA: `823798385b8ca10a45f64bb94709e31b2b9664f4`
- workflow run: [30004874751](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30004874751)
- G5/G6: `auth` 1回、synthetic fixture作成・cleanup、flagの一時`true`化と`false`復旧、staging DB操作、正しいlogin 10回と11回目429、cascade cleanup、R7-02 blockedのままHono境界だけを取得することを承認
- 実結果: branch/SHA/Environment/DB target gateとfixture作成は成功したが、auth境界runner stepは固定失敗eventで終了した。request段階・request番号・status・契約分類は当時のCLI出力だけでは特定できず、429契約の証拠は成立していない
- cleanup: main cleanupは固定fixture 2件を削除して成功し、独立recovery cleanupも追加削除0件で成功した
- 復旧: `STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED=false`をGitHub APIで読み取り確認した
- 停止判断: 同一条件で再実行せず、追加の直接DB操作、production操作、deploymentを行わなかった。R7-04/R7-05は未完了を維持する
- 診断実装branch: `feature/r7-auth-evidence-diagnostics`
- TDD Red 1: request段階・番号・statusの安全な分類を要求し、対象2 filesで4 tests失敗・28 tests成功
- TDD Green 1: raw例外を保持しない分類errorとCLI metadataを実装し、対象2 files / 32 tests成功
- TDD Red 2: Retry-After・CORS・security header等の固定契約名を要求し、対象2 filesで4 tests失敗・28 tests成功
- TDD Green 2 / Refactor: header値やbodyを出さず、固定enumの`failedContract`だけを追加し、Prettier後も対象2 files / 32 tests成功
- PR #141 review対応 Red/Green: validatorの予期しない失敗時に未消費response bodyを解放する契約を1 test失敗・28 tests成功で再現し、best-effort cancelとcancel失敗時の安全な分類error維持を実装して対象29 tests成功
- PR #141追加review対応 Red/Green: 許可/制限requestのstatus・Content-Type不一致時にcancel拒否で固定契約分類を失う問題を4 tests失敗・29 tests成功で再現し、4箇所の直接cancelをbest-effort helperへ統一して対象33 tests成功
- PR #141追加review対応後の最終品質gate: backend 104 files / 1088 tests成功（外部DB用10 tests skip）、Workers runtime 2 files / 15 tests成功、Node/Workers TypeScript build・ESLint・Prettier check成功
- security: raw例外message/cause、response body、header値、credential、識別子、URLをerror metadataへ保持しない
- 診断merge後の実環境再実行: run [30010266297](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30010266297)を別runとして1回実施し、auth許可request 5回目の503で安全に停止した。詳細はR7 Evidence E-04へ記録する

### 第二run後の503安全分類実装

- 実装日: 2026-07-23
- 実装branch: `feature/r7-auth-503-safe-classification`
- base `develop` SHA: `647ea6b17c6994e2e953b6c26224173d658eac5c`
- commit: `0247510`（Red contract test）、`a9cb3db`（Green/Refactor実装）
- PR: [#144](https://github.com/RitukoIsibasi0222/gensoko/pull/144)（review待ち）
- TDD Red: runner 49 tests中18 testsが固定class欠如とbody二重cancelを理由に失敗し、CLI 4 tests中1 testが固定class未出力を理由に失敗した
- TDD Green/Refactor: 完全なHono 503公開契約だけを`SAFE_JSON_503_CONTRACT`、非JSONまたは契約不一致503を`EDGE_OR_UNCLASSIFIED_503`、その他の想定外statusを`OTHER_UNEXPECTED_STATUS`へ分類する。request失敗はclass `null`を維持する
- 回帰確認: runner/CLI/workflow 3 files / 60 tests成功。backend 104 files / 1104 tests成功（外部DB用10 tests skip）、Workers runtime 2 files / 15 tests、Node/Workers TypeScript build、ESLint、Prettier check成功
- security: bodyは分類中だけmemory上で検証し、error/CLIへ保持しない。header値、URL、credential、識別子、raw例外も保持・出力しない。固定classはresponse契約一致を示すだけで、DO/adapter/edge等の原因を断定しない
- 非変更範囲: workflow、API、Worker、rate-limit middleware、Durable Object、DB、Cloudflare設定、frontend、production resourceを変更していない
- 実環境操作: staging HTTP request、fixture、Environment Variable、DB、workflow dispatchを行っておらず、第三runは未実施
- 判定: 過去のrun 30010266297はbody/headerを記録していないため新classを遡及適用できない。R7-04/R7-05、R7-02、R7-06以降、R7全体は未完了を維持する

#### 初回失敗後の診断変更ファイル

| ファイル | 変更種別 | 内容 |
| --- | --- | --- |
| `backend/src/jobs/stagingRateLimitEvidence.ts` | 修正 | auth requestの安全な失敗段階・番号・status・固定契約名を分類 |
| `backend/src/jobs/stagingRateLimitEvidence.cli.ts` | 修正 | 既知の分類metadataだけを固定失敗eventへ追加 |
| `backend/src/jobs/stagingRateLimitEvidence.test.ts` | 修正 | raw例外・body非保持とauth段階・契約分類のcontract test |
| `backend/src/jobs/stagingRateLimitEvidence.cli.test.ts` | 修正 | CLIの安全なmetadata出力と機密非出力test |
| `docs/plans/r7-rate-limit-environment-gates/plan.md` | 修正 | 初回run、cleanup、flag復旧、TDD、残余リスクを記録 |
| `docs/05_progress.md` | 修正 | R7-04/R7-05未完了と診断実装待ちへ同期 |
| `docs/plans/portfolio-release-v0-1/plan.md` | 修正 | 実際に変わったR7の状態だけを同期 |

### 実際の変更ファイル

| ファイル                                                    | 変更種別 | 内容                                 |
| ----------------------------------------------------------- | -------- | ------------------------------------ |
| `.github/workflows/staging-rate-limit-evidence.yml`         | 新規     | manual-only staging証拠workflow      |
| `backend/package.json`                                      | 修正     | `staging:rate-limit-evidence` script |
| `backend/src/jobs/stagingRateLimitEvidence.ts`              | 新規     | 3境界caseと安全な429契約要約         |
| `backend/src/jobs/stagingRateLimitEvidence.cli.ts`          | 新規     | 環境guardと固定文言のCLI             |
| `backend/src/jobs/stagingRateLimitEvidence.cli.test.ts`     | 新規     | CLI終了codeと機密非出力のunit test   |
| `backend/src/jobs/stagingRateLimitEvidence.test.ts`         | 新規     | runnerのunit test                    |
| `backend/src/jobs/stagingRateLimitEvidenceWorkflow.test.ts` | 新規     | workflowのrepository contract test   |
| `docs/plans/r7-rate-limit-environment-gates/plan.md`        | 修正     | 実装準備と実環境未実施状態を同期     |
| `docs/05_progress.md`                                       | 修正     | R7進捗要約を同期                     |

## 最終タスクリスト

| タスクID | 内容                                     | 主な対象                  | 優先度 | 完了条件                     |
| -------- | ---------------------------------------- | ------------------------- | ------ | ---------------------------- |
| R7-01    | 基準SHAとrepository contract testを固定  | backend/frontend test     | 高     | test結果とSHAを記録          |
| R7-02    | Cloudflare plan/zone/hostname/権限を確認 | Dashboard/API read-only   | 高     | G1〜G4承認                   |
| R7-03    | staging resource分離とconfigを確認       | Worker/DO/Secret presence | 高     | environment誤接続なし        |
| R7-04    | synthetic fixtureとcleanupを承認         | staging                   | 高     | G5/G6承認                    |
| R7-05    | auth 11回目を確認                        | staging login             | 高     | 429/Retry-After/header       |
| R7-06    | questions 31回目を確認                   | staging game questions    | 高     | 429/Retry-After/header       |
| R7-07    | game submit 21回目を確認                 | staging game submit       | 高     | 429/Retry-After/header       |
| R7-08    | resetと安全なbucket分離caseを確認        | staging                   | 高     | 再許可・独立性               |
| R7-09    | spoof/IPv6を確認または代替証拠化         | staging/contract test     | 高     | bypass不可                   |
| R7-10    | 503証拠方式を決定                        | runtime/canary            | 高     | G7/G8、共有環境非破壊        |
| R7-11    | DO cleanup・alarm・利用量を確認          | DO metrics/storage        | 高     | cleanupと費用記録            |
| R7-12    | login/game手動A11Yを確認                 | frontend                  | 中     | alert/keyboard/retry         |
| R7-13    | WAF rule設計を承認                       | WAF                       | 高     | plan制約、order、rollback    |
| R7-14    | WAFを段階適用しSecurity Eventsを確認     | staging WAF               | 高     | false positiveなし           |
| R7-15    | stagingを24時間以上観測                  | metrics/logs              | 高     | 停止条件なし                 |
| R7-16    | production resource preflightへ統合      | R5/R14                    | 高     | namespace/binding/Secret分離 |
| R7-17    | production deploy順序へ統合              | R15                       | 高     | 独立deployなし               |
| R7-18    | production最小smokeへ統合                | R16                       | 高     | 境界requestなしで正常        |
| R7-19    | productionを48時間以上観測しrollback確認 | metrics/runbook           | 高     | 停止条件なし                 |
| R7-20    | 証拠・進捗・release文書を同期            | docs                      | 中     | R7完了条件13項目一致         |

### チェックリスト

- [x] R7-01: 基準SHAとrepository contract testを固定する
- [ ] R7-02: Cloudflare plan/zone/hostname/権限を確認する
- [x] R7-03: staging resource分離とconfigを確認する
- [ ] R7-04: synthetic fixtureとcleanupを承認する
- [ ] R7-05: auth 11回目を確認する
- [ ] R7-06: questions 31回目を確認する
- [ ] R7-07: game submit 21回目を確認する
- [ ] R7-08: resetと安全なbucket分離caseを確認する
- [ ] R7-09: spoof/IPv6を確認または代替証拠化する
- [ ] R7-10: 503証拠方式を決定する
- [ ] R7-11: DO cleanup・alarm・利用量を確認する
- [ ] R7-12: login/game手動A11Yを確認する
- [ ] R7-13: WAF rule設計を承認する
- [ ] R7-14: WAFを段階適用しSecurity Eventsを確認する
- [ ] R7-15: stagingを24時間以上観測する
- [ ] R7-16: production resource preflightへ統合する
- [ ] R7-17: production deploy順序へ統合する
- [ ] R7-18: production最小smokeへ統合する
- [ ] R7-19: productionを48時間以上観測しrollback確認する
- [ ] R7-20: 証拠・進捗・release文書を同期する

### タブ区切り

```tsv
タスクID	タスク内容	対象	優先度
R7-01	基準SHAとrepository contract testを固定	backend/frontend test	高
R7-02	Cloudflare plan・zone・hostname・権限を確認	Dashboard/API read-only	高
R7-03	staging resource分離とconfigを確認	Worker/DO/Secret presence	高
R7-04	synthetic fixtureとcleanupを承認	staging	高
R7-05	auth 11回目を確認	staging login	高
R7-06	questions 31回目を確認	staging game questions	高
R7-07	game submit 21回目を確認	staging game submit	高
R7-08	resetと安全なbucket分離caseを確認	staging	高
R7-09	spoof・IPv6を確認または代替証拠化	staging/contract test	高
R7-10	503証拠方式を決定	runtime/canary	高
R7-11	DO cleanup・alarm・利用量を確認	DO metrics/storage	高
R7-12	login・game手動A11Yを確認	frontend	中
R7-13	WAF rule設計を承認	WAF	高
R7-14	WAFを段階適用しSecurity Eventsを確認	staging WAF	高
R7-15	stagingを24時間以上観測	metrics/logs	高
R7-16	production resource preflightへ統合	R5/R14	高
R7-17	production deploy順序へ統合	R15	高
R7-18	production最小smokeへ統合	R16	高
R7-19	productionを48時間以上観測しrollback確認	metrics/runbook	高
R7-20	証拠・進捗・release文書を同期	docs	中
```

## 再着手条件

次を満たしてからR7実行へ着手する。

- [x] R7計画PRがreviewされ`develop`へmerge済み（PR #139、merge commit `fe431d1`）
- [ ] G1〜G6の判断者と承認者が確定
- [x] release候補SHAまたはstaging検証SHAが固定（`fe431d1adcc077382e73484a3c9704ed18b69f7e`）
- [ ] synthetic fixtureとcleanupが承認済み
- [x] Cloudflare read-only確認権限がある（OAuthのaccount/zone readとDashboard閲覧を確認）
- [ ] WAF/Worker rollback権限を持つ担当者が同席
- [ ] 実行時間帯と停止時の通知先が確定
- [x] 証拠のPII/Secret redaction方法が確認済み（CLI/Dashboard出力を保存前にredact）

## 実行証拠

### R7 Evidence E-01

- 実行日時: 2026-07-23 15:13〜15:18 JST
- environment: repository local / Workers local runtime
- 基準commit: `fe431d1adcc077382e73484a3c9704ed18b69f7e`
- 対象Worker version: repository source（Cloudflare実resourceは未使用）
- 対象policy/rule: 全Hono rate limit policy / Durable Object / frontend 429・503契約
- 実行者: Codex
- 承認者: repository owner（R7作業開始指示）
- 事前gate: PR #139が`develop`へmerge済みであることをGitHubとlocal fast-forwardで確認
- 手順:
  - Hono 429・503・route matrixの対象testを実行
  - Durable Objectとproduction相当Worker graphのWorkers runtime testを実行
  - policy・actor key・production configの対象testを実行
  - frontend API error・login・game rate limitの対象testを実行
  - Workers type生成差分・typecheck・staging dry-run bundleを確認
- 期待結果: 既存contract testとdeployを伴わないWorkers buildがすべて成功する
- 実結果:
  - backend Hono contract: 2 files / 24 tests成功
  - Workers runtime: 2 files / 15 tests成功
  - backend policy・key・production config: 3 files / 33 tests成功
  - frontend rate limit contract: 3 files / 28 tests成功
  - Workers build: types check・typecheck・staging dry-run成功
- status/header/body要約: repository testでHono 429・503、日本語JSON、`Retry-After`、CORS/security headersを確認
- Cloudflare metrics/Security Events確認時間帯: 未実施（R7-02、R7-11、R7-14以降）
- cleanup: local test runtime終了。追跡対象の生成差分なし
- rollback: repository code・Cloudflare resourceの変更なし
- 判定: pass
- 代替証拠: なし
- 残余リスク: staging実HTTP、Cloudflare実resource、production dry-runは未確認。production dry-runは実hostname・resource分離値を確認するR7-16で実施する
- 添付先: 本節

PII・Secret確認:

- [x] raw IPなし
- [x] email/user IDなし
- [x] digestなし
- [x] token/Cookie/Authorizationなし
- [x] password/bodyなし
- [x] account/zone/resource IDなし

### R7 Evidence E-02

- 実行日時: 2026-07-23 15:20〜15:28 JST
- environment: Cloudflare account / staging（read-only）
- 基準commit: `fe431d1adcc077382e73484a3c9704ed18b69f7e`
- 対象Worker version: `gensoko-api-staging` / `ab420f62`表示を確認
- 対象policy/rule: Worker・Durable Object・Hyperdrive・Secret presence・zone/WAF前提
- 実行者: Codex
- 承認者: repository owner（R7作業開始指示）
- 事前gate: Cloudflare OAuth認証済み。account/zone read権限を確認し、Dashboard操作をread-onlyへ限定
- 手順:
  - Workers planを確認
  - domain/zone一覧を確認
  - Workers一覧、staging Worker概要、binding、変数とSecret presenceを確認
  - WAF利用前提とObservability状態を確認
- 期待結果: staging resourceの接続先が一致し、plan・zone・hostname・WAF権限の判断材料が揃う
- 実結果:
  - Workers planはFree
  - domain/zoneは0件
  - Workerは`gensoko-api-staging`の1件だけで、production Workerは未作成
  - staging公開hostnameは`gensoko-api-staging.rituko-labs.workers.dev`。custom domainとrouteは未設定
  - Hyperdrive binding `HYPERDRIVE`はstaging resourceへ接続
  - Durable Object binding `RATE_LIMIT_COUNTER`はstaging `RateLimitCounter`へ接続
  - `DEPLOYMENT_ENVIRONMENT=staging`、`DATABASE_TARGET=staging`、`NODE_ENV=production`、`RATE_LIMIT_STORE=durable-object`を確認
  - `RATE_LIMIT_KEY_SECRET`、`JWT_SECRET`、mail/frontend系Secretは値を開かずpresenceだけ確認
  - Workers Logs、Traces、Export、samplingは無効
  - account-level WAFはEnterprise add-on案内のみ。zoneがないためzone WAF rate limiting ruleとSecurity Eventsを検証不能
- status/header/body要約: 対象外（Dashboard/APIのread-only inventory）
- Cloudflare metrics/Security Events確認時間帯: Worker概要の直近24時間表示を確認。zone Security Eventsは対象zone不在のため未確認
- cleanup: Dashboard/CLIの設定変更なし。browser controlを解放
- rollback: resource変更なし
- 判定: R7-03 pass / R7-02 blocked
- 代替証拠: repository production config contractはE-01で成功
- 残余リスク: G2の公開hostname/zoneが未確定。zone WAF、Security Events、WAF迂回経路閉鎖、production resource分離は確認できない
- 添付先: 本節

PII・Secret確認:

- [x] raw IPなし
- [x] email/user IDなし
- [x] digestなし
- [x] token/Cookie/Authorizationなし
- [x] password/bodyなし
- [x] account/zone/resource IDなし

### R7 Evidence E-03

- 実行日時: 2026-07-23 20:54:11〜20:55:20 JST
- environment: staging
- 基準commit: `823798385b8ca10a45f64bb94709e31b2b9664f4`
- 対象Worker version: staging Worker（versionは本runで再取得していない）
- 対象policy/rule: auth / 期待policy `AUTH_IP`
- 実行者: Codex
- 承認者: `ritukodayo40`（チャットでG5/G6を明示承認）
- 変更記録: `R7-G5-G6-20260723-2052`
- 事前gate: `develop` SHA一致、workflow active、実行履歴0件、branch policy `develop`、staging Environment/DB target/Secret presence、concurrency競合なし、fixture flag `false`を確認後に一時`true`化
- 手順:
  - `case=auth`を`develop` refから1回だけdispatch
  - exact synthetic Admin/User fixtureをprepare
  - auth境界runnerを実行
  - main cleanupと非成功時recovery cleanupを確認
  - fixture flagを`false`へ復旧して読み取り確認
- 期待結果: 正しいlogin 1〜10回目を許可し、11回目で`AUTH_IP`のHono 429契約を確認する
- 実結果:
  - branch/SHA/Environment/DB target gate成功
  - fixture prepare成功
  - auth境界runner step失敗
  - 当時の安全なCLI出力は固定失敗eventだけで、request段階・request番号・status・契約分類は特定不能
  - main cleanup成功、固定fixture 2件削除
  - recovery cleanup成功、追加削除0件
- status/header/body要約: 429、`Retry-After`、CORS/security header、日本語単一error契約は未確認。response bodyは記録していない
- Cloudflare metrics/Security Events確認時間帯: 未実施。R7-02 blockedを維持
- cleanup: main/recoveryとも成功。workflow上のexact fixture残存なし
- rollback: fixture flagを`false`へ復旧し、GitHub APIで読み取り確認
- 判定: fail
- 代替証拠: repository contract testはE-01で成功しているが、staging実HTTP成功証拠の代替にはしない
- 残余リスク: 初回失敗の具体的な段階・契約分類が不明。安全な分類metadataのreview・merge後、再承認された別runが必要
- 添付先: [GitHub Actions run 30004874751](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30004874751)
- production操作: URL、DB、Cloudflare binding/Secret、WAF、deploymentを変更していない

PII・Secret確認:

- [x] raw IPなし
- [x] email/user IDなし
- [x] digestなし
- [x] token/Cookie/Authorizationなし
- [x] password/bodyなし
- [x] account/zone/resource IDなし

### R7 Evidence E-04

- 実行日時: 2026-07-23 22:13:24〜22:14:47 JST
- 承認実行時間帯: 2026-07-23 22:12:15〜22:27:15 JST
- environment: staging
- 基準commit: `2a90be3248e08da00361719f4b5d36472fda5508`
- 対象Worker version: staging Worker（versionは本runで再取得していない）
- 対象policy/rule: auth / 期待policy `AUTH_IP`。429へ到達していないため観測policyは未成立
- 実行者: Codex
- 承認者: `RitukoIsibasi0222`（チャットで実行内容を明示承認し、残る入力設定を委任）
- 変更記録: `PR-141-R7-AUTH-20260723-2212`
- 事前gate:
  - PR #141 merge commitと最新`develop` SHAが一致
  - PR #141のbackend/Vercel check成功、workflow active、前回run以外の履歴なし
  - default branchとstaging Environment許可branchはいずれも`develop`
  - `BATCH_ENVIRONMENT=staging`、fixture flag `false`、必要なEnvironment Secret名のpresenceを確認。Secret値は取得していない
  - repository全体でqueued/in-progress Actions runなし、`gensoko-batch-jobs`競合なし
  - fixture flagを一時`true`化し、読み取り確認後に1回だけdispatch
- 手順:
  - `case=auth`、最新40桁SHA、固定confirmation、承認者、変更記録を入力し、`develop` refから1回だけdispatch
  - exact synthetic Admin/User fixtureをprepare
  - auth境界runnerを実行
  - main cleanupと非成功時recovery cleanupを確認
  - fixture flagを`false`へ復旧してGitHub APIで読み取り確認
- 期待結果: 正しいlogin 1〜10回目を許可し、11回目で`AUTH_IP`のHono 429契約を確認する
- 実結果:
  - branch/SHA/approval/Environment/DB target gate成功
  - fixture prepare成功、2件作成・置換0件
  - auth許可request 1〜4回目はvalidatorを通過
  - 5回目で`AUTH_ALLOWED_REQUEST` / `RESPONSE_CONTRACT_FAILED` / status 503 / `EXPECTED_STATUS`として安全に停止
  - 11回目へ到達せず、429と`AUTH_IP`観測証拠は未成立
  - main cleanup成功、固定fixture 2件削除
  - recovery cleanup成功、追加削除0件
- status/header/body要約: 許可request 5回目のstatus 503だけを記録。response body、header値、credential、識別子は取得・記録していない。429契約は未評価
- Cloudflare metrics/Security Events確認時間帯: 未実施。R7-02 blockedを維持
- cleanup: main/recoveryとも成功。workflow上のexact fixture残存なし
- rollback: fixture flagを`false`へ復旧し、GitHub APIで読み取り確認
- 停止通知: 本チャットへ即時報告。外部メール送信は行っていない
- 判定: fail
- 再実行判断: 想定外503の停止条件に該当するため、同一条件で第三runを行わない
- 代替証拠: repository contract testは成功しているが、staging実HTTP成功証拠の代替にはしない
- 残余リスク: 許可request 5回目の503原因は未特定。R7-04/R7-05は未完了を維持し、読み取り調査または別TDD修正タスクのreview後に新しい承認で別runを検討する
- 次工程: [`r7-auth-503-safe-classification`](../r7-auth-503-safe-classification/plan.md) — safe JSON 503とedge/non-JSONまたは契約不一致503を固定enumで区別するTDD実装は完了し、PR #144でreview待ち。過去runへの遡及判定はせず、mergeと新しい実環境承認まで第三runは行わない
- 添付先: [GitHub Actions run 30010266297](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30010266297)
- production操作: URL、DB、Cloudflare binding/Secret、WAF、deploymentを変更していない

PII・Secret確認:

- [x] raw IPなし
- [x] email/user IDなし
- [x] digestなし
- [x] token/Cookie/Authorizationなし
- [x] password/bodyなし
- [x] account/zone/resource IDなし

## R7完了記録

R7-01〜R7-20と13個の完了条件が揃うまで、このセクションへ完了日を記載しない。

```markdown
### 実行結果

- 完了日:
- 基準commit:
- 実行branch/PR:
- Cloudflare plan:
- staging Worker version:
- production Worker version:
- 承認者:

### 証拠

| Evidence ID | Gate | environment | 結果 | 記録先 |
| ----------- | ---- | ----------- | ---- | ------ |

### 計画からの変更点

- なし / 変更理由と承認者

### 残余リスク

- なし / 受容内容と承認者

### 文書同期

- [ ] `docs/05_progress.md`
- [ ] `docs/11_deployment.md`
- [ ] `docs/plans/portfolio-release-v0-1/plan.md`
- [ ] `docs/plans/r7-rate-limit-environment-gates/plan.md`
```
