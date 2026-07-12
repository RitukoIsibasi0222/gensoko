# APIレート制限の本番設計・適用 実装計画

> 設計者ロール: シニアフルスタックエンジニア / Webセキュリティエンジニア / Cloudflareプラットフォームエンジニア

## 背景・目的

`docs/05_progress.md` フェーズ11の「APIレート制限の本番設計・適用（認証系 / 一般API / `POST /game/sessions`）」を実装する。

現在のHonoミドルウェアはプロセス内`Map`とIPだけを主なキーにしており、再起動・複数インスタンス・Cloudflare Workersのisolate分散をまたいでカウンターを共有できない。また、一般APIの共通制限、対象メールアドレス単位、`POST /game/sessions`のユーザーID単位が未実装で、文書値とroute値にも差がある。

本計画では、Cloudflare WAF Rate Limiting Rulesを大量アクセスの粗いエッジ防御、Honoから呼び出すSQLite-backed Durable Objectをアプリケーション文脈を含む正確な制限として組み合わせる。ローカル・unit testでは同じ契約のin-memory storeを使い、本番でプロセス内`Map`へ暗黙fallbackしない。

## レビュー結果と改善方針

### この計画のまま実装すべきではない理由

レビュー対象として提示された内容は計画書作成用プロンプトであり、`docs/plans/api-rate-limit-production/plan.md`は存在しなかった。プロンプトには候補技術と確認観点はあったが、本番store、Cloudflareの制約、route分類、複数bucketの意味、middleware順序、store障害時挙動、Workers未整備タスクとの完了境界が未確定だった。

このまま実装すると、10分窓を表現できないCloudflare Workers Rate Limiting bindingの誤採用、`x-forwarded-for`偽装、複数isolateでの制限回避、NAT利用者の過剰遮断、`PATCH /users/me`のユーザー名変更まで認証系bucketを消費する事故が起こり得る。さらに通常のroute testではrate limitがグローバルmockされており、配線漏れを検出できない。

### DBの整合性と負荷

| 指摘内容                                                                    | 根拠                                                                                             | 影響・リスク                                                                   | 改善案                                                                                 | 優先度 |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------ |
| PostgreSQL/Prismaを一般APIのカウンターストアにすると全APIへ書き込みが増える | 確認できた事実: 一般APIは1分60回/IPを予定し、現在の業務DBはPrisma + PostgreSQL                   | DB接続枯渇、ランキング・ゲームtransactionとの競合、不要なmigration/cleanup負荷 | 業務DBは使わず、SQLite-backed Durable Objectの強整合storageを利用する                  | High   |
| 現行`Map`は永続性・共有性がない                                             | 確認できた事実: `backend/src/middleware/rateLimit/index.ts`内のmodule-local `Map`だけで保持      | 再起動と複数instance/isolateで上限を回避できる                                 | productionではDurable Object storeを必須化し、memory storeはdevelopment/test限定       | High   |
| DB schema変更を示す要件はない                                               | 確認できた事実: rate limit状態は業務データとrelationを持たず、Durable Objectsは独立storageを持つ | 不要なschema/migrationはデプロイとrollbackを複雑化する                         | Prisma schema/migrationは変更しない。DB追加チェックは不要と記録する                    | Medium |
| DOの高cardinality状態が残留し得る                                           | 推測: 攻撃者が多数のIP/対象を生成すると多数objectが作られる                                      | storage/cost増加                                                               | reset後alarmでcount/resetAtを削除し、生のIP/email/userIdを保存しない。利用量を監視する | Medium |

N+1、relation、unique、nullable、cascadeへの変更はないため、このタスク固有の重大な問題はない。PostgreSQLへrate limit rowを追加しない限り、既存データ移行とexpand/contract migrationも不要である。

### API・コードの整合性

| 指摘内容                                            | 根拠                                                                                                         | 影響・リスク                                                    | 改善案                                                                                                 | 優先度 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| 文書と`POST /game/sessions`の上限が不一致           | 確認できた事実: `docs/02_security.md`は20回/分、routeは10回/分                                               | 意図しない仕様変更、テストと運用値の不一致                      | 正式値を20回/分に統一し、IPとuser IDを独立bucketで評価する                                             | High   |
| 一般API制限がない                                   | 確認できた事実: `app.ts`に共通rate limitはなく、elements/ranking/weak/admin等の多くに個別適用もない          | 読み取り・DB集計APIへの集中アクセスをHonoで抑止できない         | CORSの後、route mountの前に`/api/v1/*`共通60回/分/IPを置く                                             | High   |
| 現行proxy信頼が広すぎる                             | 確認できた事実: `TRUST_PROXY=true`ではXFF先頭値を優先する。Cloudflareはoriginで`CF-Connecting-IP`参照を推奨  | client指定XFFをbucket keyにして回避される可能性                 | Workers productionは検証済み`CF-Connecting-IP`だけ、Node developmentはsocket、testは明示resolverを使う | High   |
| game detail GETとPOSTが同じbucketを共有する         | 確認できた事実: `gameSessionsRateLimit`を`GET /sessions/:sessionId`と`POST /sessions`で共用                  | 結果再表示が送信枠を消費し、POST専用制限になっていない          | GET詳細/履歴は一般bucket、POSTだけgame-submit bucketへ分離する                                         | High   |
| メール単位制限をvalidated payloadから安全に作れない | 確認できた事実: rate limitは`zValidator`より前、`emailSchema`はtrim/lowercase変換しない                      | 未検証body利用、平文PII保存、validationの二重実装               | IP制限→Zod→正規化済みemailのHMAC key→handlerの順にする                                                 | High   |
| `PATCH /users/me`はpayload型により適用対象が異なる  | 確認できた事実: usernameとpassword変更をunionで処理し、現行はhandler内でpassword時だけ手動middleware呼び出し | middleware契約が不自然でnext/Response処理を誤りやすい           | Zod後にpayload predicateを使う条件付きmiddlewareへ共通化する                                           | Medium |
| 429契約がedgeとHonoで同一とは限らない               | 確認できた事実: Honoは日本語JSON。Cloudflare WAFのcustom response/field/period/rule数はplan依存              | CORSなし・非JSON edge responseでfrontendがmessageを取得できない | Hono 429だけをAPI JSON契約とし、edge閾値を高くする。frontendは非JSON/ネットワークfallbackを維持する    | High   |
| Workers Rate Limiting bindingは全要件を満たさない   | 確認できた事実: periodは10/60秒のみ、location単位、結果整合的で正確なaccounting用ではない                    | 10分10回を表現できず、拠点移動・burstで超過を許す               | 本タスクの正確なapp storeには使わず、Durable Objectを採用する                                          | High   |
| rate limit設定がrouteごとに重複                     | 確認できた事実: auth/users/gameに`windowMs`/`max`/`TRUST_PROXY`が散在                                        | 文書更新漏れとroute間の値ずれ                                   | policy ID、limit、window、failure modeを`policies.ts`に一元化する                                      | Medium |

認証・認可、Zod validation、既存の日本語エラー形式自体には重大な問題はない。rate limitは認証の代替にせず、既存auth/admin middlewareを維持する。

### UI / A11Y

| 指摘内容                          | 根拠                                                                                                                       | 影響・リスク                             | 改善案                                                                 | 優先度 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- | ------ |
| 専用UI追加は不要                  | 確認できた事実: loginは`role=\"alert\"`と二重送信防止、game playは`aria-busy`、error時`role=\"alert\"`と再送信ボタンを持つ | UIを作り直すとscopeが拡大する            | 既存画面とAPI clientの回帰確認を基本とし、失敗時だけ最小修正する       | Low    |
| edge 429はHono JSONを保証できない | 推測: plan/response header設定によりブラウザでは非JSONまたはCORS network errorになり得る                                   | 支援技術へ具体的な待ち時間を伝えられない | 既存fallbackを画面内alertで表示し、Hono 429では日本語messageを優先する | Medium |
| Retry後のfocus方針が未固定        | 確認できた事実: gameは再送信ボタンを持つがrate limit専用focus移動はない                                                    | 自動focus移動がかえって操作文脈を壊す    | focusを強制移動せず、live regionで通知し、disabled中も状態文言を出す   | Low    |

キーボード操作、label、色だけに依存しない表示について、現行の対象画面に本タスク起因の重大な問題はない。新規UIを追加しないため、A11Yは回帰確認を中心とする。

### テストの妥当性

| 指摘内容                                    | 根拠                                                              | 影響・リスク                                                       | 改善案                                                                                    | 優先度 |
| ------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------ |
| 通常route testがrate limitを通していない    | 確認できた事実: `backend/src/test-setup.ts`が全testでmoduleをmock | middleware順序、route分類、429 body/headerの配線漏れを検知できない | unit testに加え、mock解除またはdependency injectionした専用app integration testを追加する | High   |
| 現行unit testは単一process Mapだけを検証    | 確認できた事実: max、window、IP差、store上限が中心                | HMAC key、複数bucket、store障害、DO原子性を検証できない            | policy/key/middleware/store/Workers integrationを分層してテストする                       | High   |
| 同時実行境界が未検証                        | 確認できた事実: 逐次requestのみ                                   | read-modify-write競合で上限を超える可能性                          | DOに上限付近の並行consumeを送り、成功件数がlimitを超えないことを確認する                  | High   |
| frontendは一部429を確認するがedge相当が不足 | 確認できた事実: usersは429 JSON、共通helperは非JSONを扱う         | login/gameで非JSON/CORS相当の表示回帰が残る                        | login/game API・pageのJSON 429、非JSON 429、network errorを確認する                       | Medium |

### 外部基盤・リリース

| 指摘内容                                 | 根拠                                                                                                                        | 影響・リスク                                                 | 改善案                                                                                                 | 優先度 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------ |
| Workers本番基盤が未整備                  | 確認できた事実: `wrangler.toml`、Workers entrypoint、Cloudflare Prisma adapterはフェーズ12未実装                            | DO配線とWAF実機確認なしで「本番適用完了」と誤認する          | app層を先行可能に分離するが、Workers/DO/WAF実機確認まで進捗を`[x]`にしない                             | High   |
| WAFのrule数・利用field・periodはplan依存 | 確認できた事実: Freeは1 rule/10秒かつpath中心、Proは2 rules/最大1分だがmethod不可、Businessは5 rules/最大10分でmethod利用可 | 契約未確認の設計ではOPTIONS除外やroute別ruleをdeployできない | planを確認し、最低1本のpath-based coarse API ruleを必須、methodを使う追加rulesはBusiness以上に限定する | High   |
| edge counterも厳密ではない               | 確認できた事実: Cloudflare WAFは反映遅延があり、正確な到達数保証ではない                                                    | edgeだけではburstを完全に止められない                        | edgeは大量遮断、DOをapp上限判定と明確に分担する                                                        | Medium |

## スコープ

- rate limit policy、key、store、middlewareの共通化
- development/test用in-memory storeとproduction用Durable Object store adapter
- SQLite-backed Durable Objectの原子的fixed-window counterと期限後cleanup
- 一般API、認証系、対象email、account-sensitive、game questions、game submitへの適用
- Cloudflare WAFの最低限ruleとplan別追加ruleの設定手順
- 429/503契約、`Retry-After`、固定イベントログ、運用確認
- backend unit/integration/Workers runtime test
- frontendの429/非JSON/network error/A11Y回帰確認
- `docs/02_security.md`、`docs/04_api.md`、`docs/10_dev_setup.md`、`docs/11_deployment.md`、`docs/05_progress.md`の整合

## 非スコープ

- PostgreSQL/Prisma schemaまたはmigrationの追加
- Redis、Workers KV、DB tableをrate limit storeにする実装
- CAPTCHA、Turnstile、Bot Management、API Shieldの導入
- login失敗5回/15分lockの仕様変更
- requestId・Sentry・構造化ログ基盤全体の導入
- Workers用Prisma接続、Supabase作成、CI/CD全体の実装
- フロントエンド画面の再設計
- DDoSをHono middlewareだけで防ぐこと

## 現状調査結果

### 既存適用マトリクス

| 対象                                    |    現行値 | 現行key/store              | 問題                              |
| --------------------------------------- | --------: | -------------------------- | --------------------------------- |
| register/login/forgot/reset             | 10回/10分 | IP / route moduleごとのMap | email keyなし、複数instance非共有 |
| verify-email/refresh/logout             |      なし | なし                       | 一般制限も未適用                  |
| password変更                            | 10回/10分 | IP / users moduleのMap     | handler内手動呼び出し             |
| account削除                             | 10回/10分 | IP / users moduleの同じMap | password変更とbucket共有          |
| GET game/questions                      |   30回/分 | IP / Map                   | DB write APIだがuser keyなし      |
| POST game/sessions                      |   10回/分 | IP / Map                   | 文書は20、user keyなし            |
| GET game/sessions/:id                   |   10回/分 | POSTと同じIP bucket        | GETがPOST枠を消費                 |
| GET game/sessions                       |   60回/分 | IP / Map                   | general policyと重複定義          |
| elements/ranking/weak/admin/users GET等 |      なし | なし                       | 一般API制限未適用                 |
| health/root/OPTIONS                     |      なし | なし                       | 原則として除外を維持              |

### 既存公開インターフェース

**`backend/src/middleware/rateLimit/index.ts`**

- `rateLimit(options: RateLimitOptions): MiddlewareHandler` — module-local Mapによるfixed window制限
- options: `windowMs`, `max`, `maxStoreSize?`, `trustProxy?`
- 超過: 429 `{ \"error\": \"リクエストが多すぎます。しばらく待ってから再試行してください\" }`

**`backend/src/middleware/auth/index.ts`**

- `authMiddleware` — JWT/DB状態検証後に`c.set(\"user\", { id, role })`
- `optionalAuthMiddleware` — tokenが有効な場合だけuserを設定

**`frontend/src/lib/api/errors.ts`**

- `parseErrorBody(response): Promise<ErrorBody>` — 非JSON時`null`
- `parseErrorResponse(response, defaultMessage): Promise<never>` — backend messageを保持して`ApiError`
- `ApiError.status: number`, `ApiError.body: unknown | null`

### 外部仕様確認（2026-07-12）

- [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/): periodは10秒または60秒、location単位、結果整合的で正確なaccounting用途ではない。本計画の正確なapp storeには採用しない。
- [WAF Rate Limiting Rules](https://developers.cloudflare.com/waf/rate-limiting-rules/): planごとにrule数、利用field、最大periodが異なり、超過検出には遅延があり得る。
- [Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/): originで元IPを読む場合は一貫した単一値の`CF-Connecting-IP`を推奨する。
- [Durable Objects overview](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/): globally addressableな単一instance、transactional/strongly consistent storageを提供する。
- [SQLite-backed Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/): storage operationはatomic/isolationを持ち、新規namespaceはSQLite backendを使う。

## 前提条件・依存関係

### 必須依存

- フェーズ12のCloudflare Workers entrypoint、採用するDO/Prisma adapterと互換性があるWrangler、Workers用Prisma接続が利用可能になること
- Cloudflare account/zone/Workers planとWAF rule枠を実装前に確認すること
- productionではWorkers経由以外のbackend直接到達を許可しないこと
- DO namespace migrationとbindingをproduction/stagingで分離すること
- HMAC key生成用`RATE_LIMIT_KEY_SECRET`をWrangler Secretとして管理すること

### 完了境界

- Workers基盤が未整備でもpolicy、memory store、middleware、route配線、unit testまでは先行可能。
- ただしDO migration/binding、WAF rule、staging実機testが未完なら`docs/05_progress.md`を`[x]`にしない。
- フェーズ12ブランチと競合する場合は、entrypoint/`wrangler.toml`を無断で重複実装せず、依存PRの順序を固定する。

## 実装方針

### 二層の責務

1. Cloudflare WAF
   - IP単位で大量アクセスをHono到達前に遮断する。
   - app上限より高い閾値にし、通常の429はHono JSONから返す。
   - WAFだけで正確な10分窓、email/user ID制限を実現しない。
2. Hono + Durable Object
   - validated email、認証済みuser ID、route policyを使う。
   - fixed windowを強整合storage上で原子的に判定する。
   - 既存日本語JSON契約と`Retry-After`を返す。

### アプリケーションpolicy

複数行に該当するrequestは全bucketを独立評価し、どれか1つでも超過したら拒否する。複合文字列1bucketだけにはしない。

| Policy ID             | 対象                            |     limit/window | key                           | failure mode                          |
| --------------------- | ------------------------------- | ---------------: | ----------------------------- | ------------------------------------- |
| `GENERAL_API_IP`      | `/api/v1/*`、health/OPTIONS除外 |          60/60秒 | IP                            | fail-open（WAFを残し固定eventを記録） |
| `AUTH_IP`             | register/login/forgot/reset     |         10/600秒 | IP                            | fail-closed 503                       |
| `AUTH_EMAIL`          | register/login/forgot           | 操作ごと10/600秒 | 操作scope + 正規化emailのHMAC | fail-closed 503                       |
| `ACCOUNT_IP`          | password変更/account削除        |         10/600秒 | IP                            | fail-closed 503                       |
| `ACCOUNT_USER`        | password変更/account削除        |         10/600秒 | user IDのHMAC                 | fail-closed 503                       |
| `GAME_QUESTIONS_IP`   | GET game/questions              |          30/60秒 | IP                            | fail-closed 503                       |
| `GAME_QUESTIONS_USER` | GET game/questions              |          30/60秒 | user IDのHMAC                 | fail-closed 503                       |
| `GAME_SUBMIT_IP`      | POST game/sessions              |          20/60秒 | IP                            | fail-closed 503                       |
| `GAME_SUBMIT_USER`    | POST game/sessions              |          20/60秒 | user IDのHMAC                 | fail-closed 503                       |

`AUTH_IP`は4 endpointで共有するが、`AUTH_EMAIL`は`register`、`login`、`forgot-password`の操作scopeごとに独立させる。別操作を悪用して正規利用を止めるtargeted rate-limit DoSを避けるためである。`verify-email`、`refresh`、`logout`、game履歴/詳細は`GENERAL_API_IP`のみとする。将来の実測で追加policyが必要なら、同一タスクへ暗黙追加せず`docs/02_security.md`と本計画を更新する。

### middleware順序

1. logger
2. security headers
3. CORS（preflightはここで終了）
4. `GENERAL_API_IP`
5. route固有IP policy
6. auth middleware（user IDが必要なroute）
7. Zod validation
8. validated emailまたはuser ID policy
9. handler/service

例外:

- register/login/forgotは`GENERAL_API_IP`→`AUTH_IP`→Zod→`AUTH_EMAIL`→handler。
- resetはemailを持たないため`GENERAL_API_IP`→`AUTH_IP`→Zod→handler。tokenをbucket keyにしない。
- game submitは`GENERAL_API_IP`→`GAME_SUBMIT_IP`→auth→Zod→`GAME_SUBMIT_USER`→handler。
- password変更はauth→Zod後、payloadがpassword variantの場合だけ`ACCOUNT_IP`と`ACCOUNT_USER`を評価する。
- account削除はauth→`ACCOUNT_IP`→`ACCOUNT_USER`→Zod→handler。invalid bodyをcountするかは「パスワード試行を伴う前に遮断」を優先してcount対象とする。

### keyと個人情報

- production IPは`CF-Connecting-IP`の単一値だけを採用し、XFFをfallbackにしない。
- development Nodeはsocket address、testは明示fixture resolverを使う。
- productionでIPが欠損/不正ならspecialized policyは503、general policyはfail-openとする。全員を`unknown` bucketへ集約しない。
- emailはZod成功後の値を`trim().toLowerCase()`で一度だけcanonicalizeする。これはrate limit grouping専用で、認証DB検索の値を暗黙変更しない。
- store/object nameは`HMAC-SHA-256(RATE_LIMIT_KEY_SECRET, policyId + operationScope + actorType + canonicalValue)`のhex digestを使う。
- raw IP/email/user ID、Authorization、Cookie、body、digestをapplication logへ出さない。
- secret rotationは全bucket resetになるため、緊急時以外はdeployment runbookに従う。
- development/testは明示注入した固定fixture secretを使い、production secretの暗黙fallbackは設けない。

### fixed-windowとcleanup

- stateは`count`, `resetAt`だけとし、actor値は保存しない。
- `now >= resetAt`で新windowへ切り替える。
- read/increment/resetを1 transactionまたはinterleaveされないstorage sequenceとして実装する。
- reset時刻にalarmを設定し、期限後stateを削除する。
- clientからlimit/window/時刻を自由指定させず、共通policy IDからserver側設定を解決し、DO自身のclockで判定する。

## Cloudflare WAF方針

### 最低構成

- 全planで、利用可能な1 ruleをpath条件`/api/v1/*`（`/api/v1/health`除外）へ適用する。
- Free/Proはrate limit expressionでmethodを使えないため、`OPTIONS`もedge countへ含まれ得る。Hono側ではcount対象外を維持する。
- Free plan想定の最低構成は40 requests/10秒/IP、10秒blockとし、preflightを数えても通常のapp上限より余裕を持たせる。
- これは一般API 60/分の正確な代替ではなく、短時間burstの粗い遮断である。

### rule枠に余裕がある場合

app上限よりedgeを厳しくしない。

| Rule        | match                        |                                                  edge上限案 | 備考                                          |
| ----------- | ---------------------------- | ----------------------------------------------------------: | --------------------------------------------- |
| general     | `/api/v1/*`, health除外      | 240/60秒/IP（method不可）または120/60秒/IP（OPTIONS除外可） | preflight count有無で余裕を調整               |
| auth        | register/login/forgot/reset  |                                                 20/600秒/IP | methodと600秒periodが使えるBusiness以上を前提 |
| game submit | POST `/api/v1/game/sessions` |                                                  40/60秒/IP | methodが使えるBusiness以上を前提              |

- exact plan、rule expression、rule order、mitigation timeoutを`docs/11_deployment.md`へ記録する。
- custom JSON 429とCORS headerが契約どおり返せるかstagingで確認する。保証できない場合、edge responseは非JSONとして扱う。
- rule変更はlog/preview相当でfalse positiveを確認してからblockへ切り替える。

## API変更方針

### Hono 429

Status: `429 Too Many Requests`

```json
{
  \"error\": \"リクエストが多すぎます。しばらく待ってから再試行してください\"
}
```

- `Retry-After: <resetまでの秒数を切り上げた整数>`を必須とする。
- 複数bucketのうち失敗したbucketの最大待ち時間を使う。
- 成功responseへremaining/reset headerは付けない。複数bucketとedgeを合わせた正確な残数を表現できないため。
- security headersとCORSは既存middleware順序により維持する。

### store障害時503

fail-closed policyだけ次を返す。

```json
{
  \"error\": \"一時的に利用できません。しばらく待ってから再試行してください\"
}
```

- statusは503、`Retry-After: 60`。
- raw errorをresponse/logへ出さず、policy IDだけを含む固定event名を記録する。
- general policyはfail-openし、WAF防御を維持する。

### Cloudflare edge response

- Hono JSON/CORS/security header契約の保証対象外と明記する。
- custom JSONが使える場合も同じ日本語文言と429を設定する。
- frontendはJSON、非JSON、CORS network errorのいずれでも画面内fallbackを表示する。

## 公開インターフェース案

実装コードではなく責務とsignatureを示す。

```ts
export type RateLimitPolicyId =
  | \"GENERAL_API_IP\"
  | \"AUTH_IP\"
  | \"AUTH_EMAIL\"
  | \"ACCOUNT_IP\"
  | \"ACCOUNT_USER\"
  | \"GAME_QUESTIONS_IP\"
  | \"GAME_QUESTIONS_USER\"
  | \"GAME_SUBMIT_IP\"
  | \"GAME_SUBMIT_USER\";

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

export interface RateLimitStore {
  consume(input: {
    policyId: RateLimitPolicyId;
    keyDigest: string;
  }): Promise<RateLimitDecision>;
}

export type RateLimitKeyResolver = (context: Context) => Promise<string | null>;

export function createRateLimitMiddleware(options: {
  policyId: RateLimitPolicyId;
  getStore: (context: Context) => RateLimitStore;
  resolveKey: RateLimitKeyResolver;
}): MiddlewareHandler;

export function canonicalizeRateLimitEmail(email: string): string;
export function createRateLimitKeyDigest(input: {
  secret: string;
  policyId: RateLimitPolicyId;
  operationScope: string;
  actorType: \"ip\" | \"email\" | \"user\";
  value: string;
}): Promise<string>;
```

- `remaining`は0以上、`resetAt`はUnix epoch milliseconds。
- key欠損は`null`で表し、空文字や`\"unknown\"`を有効keyにしない。
- interface、JSDoc、default値のnullabilityを一致させる。

## 対象ファイル一覧

実装時に実態へ合わせて更新する。

| ファイル                                                   | 変更種別                   | 内容                                                             |
| ---------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| `backend/src/lib/config.ts`                                | 修正                       | production secret/runtime要件のfail-fast validation              |
| `backend/src/lib/config.test.ts`                           | 修正                       | rate limit設定の環境差・未設定test                               |
| `backend/src/types/index.ts`                               | 修正                       | Hono Bindings/Variablesのrate limit型                            |
| `backend/src/middleware/rateLimit/policies.ts`             | 新規                       | policy値・failure modeの一元管理                                 |
| `backend/src/middleware/rateLimit/key.ts`                  | 新規                       | IP/email/user keyのcanonicalize/HMAC                             |
| `backend/src/middleware/rateLimit/store.ts`                | 新規                       | store契約とdecision型                                            |
| `backend/src/middleware/rateLimit/in-memory-store.ts`      | 新規                       | development/test用fixed-window store                             |
| `backend/src/middleware/rateLimit/durable-object-store.ts` | 新規                       | DO binding adapter                                               |
| `backend/src/middleware/rateLimit/index.ts`                | 修正                       | 共通middleware、429/503、Retry-After                             |
| `backend/src/middleware/rateLimit/*.test.ts`               | 新規/修正                  | policy/key/store/middleware unit test                            |
| `backend/src/cloudflare/rate-limit-counter.ts`             | 新規（フェーズ12依存）     | SQLite-backed DO counter/RPC/alarm                               |
| `backend/src/cloudflare/rate-limit-counter.test.ts`        | 新規（フェーズ12依存）     | Workers poolで原子性・永続化・alarm test                         |
| `backend/src/app.ts`                                       | 修正                       | general limiterの配置、runtime依存注入                           |
| `backend/src/app.test.ts`                                  | 修正                       | health/OPTIONS除外、security/CORS/429順序                        |
| `backend/src/routes/auth/index.ts`                         | 修正                       | auth IP/email policyとmiddleware順序                             |
| `backend/src/routes/auth/*test.ts`                         | 修正                       | 429/503/validation順序integration                                |
| `backend/src/routes/users/index.ts`                        | 修正                       | password/deleteの条件付きIP/user policy                          |
| `backend/src/routes/users/*test.ts`                        | 修正                       | username非消費、password/delete制限                              |
| `backend/src/routes/game/index.ts`                         | 修正                       | questions、submit、GET bucket分離                                |
| `backend/src/routes/game/*test.ts`                         | 修正                       | IP/user独立bucket、GET非干渉                                     |
| `backend/src/test-setup.ts`                                | 修正                       | 全体mock依存を縮小し、専用integrationを可能にする                |
| `backend/vitest.config.ts`                                 | 必要時修正                 | Workers testとの分離                                             |
| `backend/wrangler.toml`                                    | 新規（フェーズ12側と調整） | 現在は未作成。Workers entrypointとDO namespace/binding/migration |
| `backend/package.json`                                     | 必要時修正                 | Wrangler/Workers test依存とscript                                |
| `frontend/src/lib/api/errors.test.ts`                      | 確認/必要時修正            | JSON/非JSON 429/503の保持                                        |
| `frontend/src/lib/api/game.test.ts`                        | 修正                       | submit 429/503/非JSON回帰                                        |
| `frontend/src/routes/login/+page.svelte`                   | 確認/必要時修正            | 429/503/network errorのalert表示                                 |
| `frontend/src/routes/(app)/game/play/+page.svelte`         | 確認/必要時修正            | 再送信、aria-live、disabled回帰                                  |
| `docs/02_security.md`                                      | 修正                       | 二層責務、policy/key、正式値                                     |
| `docs/04_api.md`                                           | 修正                       | 全対象の429/503/Retry-After                                      |
| `docs/10_dev_setup.md`                                     | 修正                       | local memory storeとsecret/runtime設定                           |
| `docs/11_deployment.md`                                    | 修正                       | WAF/DO/runbook/rollback/監視                                     |
| `docs/05_progress.md`                                      | 修正                       | 実装中/完了と計画書リンク                                        |
| `docs/plans/api-rate-limit-production/plan.md`             | 修正                       | checkboxと実装完了記録                                           |

## DB変更方針

- `backend/prisma/schema.prisma`とmigrationは変更しない。
- rate limit状態をUser等へrelationで追加しない。
- DO stateは業務DBバックアップ/Prisma migrateの対象外であり、消失しても認証・ゲームデータは失わない。
- rollbackでDO namespaceを即削除せず、旧Workerへ戻した後にtrafficがないことを確認してからcleanupする。
- 実装中にPostgreSQL利用へ変更する必要が生じた場合は、本計画を再レビューし、負荷試験、index、TTL cleanup、migration、rollback、Playwrightを追加する。

## UI / A11Y方針

- 新規画面と専用countdownは作らない。
- backendの具体的日本語messageを上書きしない。
- 非JSON/edge/network errorは既存default messageを使う。
- loginは`role=\"alert\"`、game submit errorは`role=\"alert\"`/assertive、loadingは`aria-busy`を維持する。
- 送信中はbuttonをdisabledにし、Enter/連打による二重送信を防ぐ。
- error発生時に自動focus移動は追加せず、現在の操作位置と再試行導線を維持する。
- Retry-Afterをcountdown表示しない。時刻ずれ・edge差・複数bucketで不正確になるため。
- キーボードだけでretry/戻る/新規開始が完結し、色だけで429を表現しないことを手動確認する。

## テスト方針

### Red

- policy値、HMAC key、IP resolver、fixed-window境界、Retry-Afterを先にtest化する。
- route integrationでgeneral/auth/email/userの配線と順序が失敗することを確認する。
- Workers test poolで同一DOへの並行consumeがlimitを超えないRedを確認する。

### Green

- memory storeとmiddlewareを実装し、Node unit/route integrationを通す。
- DO adapter/counterを実装し、Workers runtime testを通す。
- WAF/DOをstagingへ適用して実HTTP確認を行う。

### Refactor

- route内の重複policy値、key計算、429/503生成を削除する。
- 全routeの命名、import、JSDoc/nullabilityを整合させる。
- format後にbackend/frontendの全testを再実行する。

### テスト分離

- memory store unit testはfake timerを使い実時間待機しない。
- route testはreset可能なfake storeをdependency injectionし、test間でcounterを共有しない。
- 少なくとも1つの専用app integrationではrate limit moduleをmockせず、実middleware順序を確認する。
- DO testは`@cloudflare/vitest-pool-workers`等の公式対応手段を採用し、Node Vitestと設定を分ける。
- WAFはunit testで代替せず、stagingのSecurity Events/HTTP responseで確認する。

## テストケース一覧

| 区分      | ケース                                 | 期待結果                                                     |
| --------- | -------------------------------------- | ------------------------------------------------------------ |
| memory/DO | limit未満、ちょうど、超過              | 許可件数がlimitと一致し、その後429                           |
| memory/DO | `now === resetAt`                      | 新windowとして許可                                           |
| memory/DO | 大量並行consume                        | success件数がlimitを超えない                                 |
| memory/DO | restart/別isolate相当                  | 同じkeyのcountを共有                                         |
| memory/DO | alarm                                  | reset後stateが削除される                                     |
| key       | 同一emailの大小文字                    | 同じdigest                                                   |
| key       | 前後空白                               | validated/canonical値から同じdigest。未検証bodyは使わない    |
| key       | 空/null/undefined                      | key欠損として扱い、`unknown`へ集約しない                     |
| key       | 異なるpolicy                           | 同じactorでも異なるdigest/bucket                             |
| key       | raw PII                                | store/log/responseにIP/email/userIdを残さない                |
| IP        | production CF header                   | 単一の有効IPを採用                                           |
| IP        | spoofed XFF                            | production keyに使わない                                     |
| IP        | IPv4/IPv6                              | 有効値として安定したdigest                                   |
| IP        | 欠損/不正                              | generalはfail-open、specializedは503                         |
| general   | elements/ranking/weak/admin/users/game | 60/分/IPを共通適用                                           |
| general   | `/`, health, OPTIONS                   | countせず正常応答、preflight header維持                      |
| auth      | register/login/forgot/reset IP         | 10/10分、11回目429                                           |
| auth      | login/register/forgot同一email         | 操作ごとに独立したemail bucketを消費し、別操作をlockしない   |
| auth      | invalid JSON/email                     | IP bucketは消費、email bucketは消費しない                    |
| auth      | verify/refresh/logout                  | generalのみ、auth-specialized非消費                          |
| account   | username変更                           | account bucketを消費しない                                   |
| account   | password変更                           | IP/user双方を消費し、片方超過でも429                         |
| account   | delete                                 | IP/user双方、invalid bodyもIP/user試行としてcount            |
| game      | GET questions                          | IP/user 30/分、二重取得対策を維持                            |
| game      | POST sessions                          | IP/user 20/分、片方超過でも429                               |
| game      | 未認証submit                           | general/game IPは消費、user bucketは未消費、401または先行429 |
| game      | GET detail/history                     | POST bucketを消費しない                                      |
| response  | Hono 429                               | 日本語JSON、Retry-After整数、security/CORS header            |
| response  | store failure sensitive                | 503、日本語JSON、Retry-After 60、handler未実行               |
| response  | store failure general                  | request継続、固定event、raw error/PIIなし                    |
| frontend  | JSON 429/503                           | backend messageを画面内alertへ保持                           |
| frontend  | 非JSON429/502/504                      | default message、crashなし                                   |
| frontend  | CORS/network error                     | network fallback、再試行可能                                 |
| A11Y      | login/game keyboard                    | 送信、retry、戻るがkeyboardだけで完結                        |
| A11Y      | loading/error                          | `aria-busy`/live region/alertで認識可能                      |
| WAF       | threshold未満/超過                     | 超過時edge block、origin到達減少                             |
| WAF       | false positive                         | 正常ゲーム/ログイン導線がedgeで遮断されない                  |

## リリース・移行方針

1. `docs/05_progress.md`を`[-]`へ更新する。
2. policy/key/memory store/middlewareをfeature flagまたはdevelopment wiringで実装する。
3. route integrationとfrontend回帰を完了する。
4. フェーズ12のWorkers entrypointを取り込み、staging DO namespace/migration/bindingを作る。
5. stagingでHono limiterを有効化し、WAFはlog/preview相当から開始する。
6. 正常導線、429、503、DO alarm、Security Eventsを確認する。
7. WAFをblockへ切り替える。
8. production DO migration/binding、Worker deploy、WAF ruleの順に適用する。
9. 429率、5xx、login成功率、game submit成功率を確認する。
10. docs/plan/progressを実態に合わせて更新し、全条件を満たした場合だけ`[x]`にする。

DOはschemaを`new_sqlite_classes` migrationとして追加し、stagingとproductionでnamespaceを分離する。migration tag/nameはフェーズ12の既存規則を確認して確定する。

## ロールバック方針

- false positive時は最初にWAF ruleをdisable/logへ戻し、Hono app制限は維持する。
- Hono不具合時は前Worker versionへrollbackする。productionでin-memory fallbackを有効化しない。
- DO障害時はgeneral fail-open、sensitive fail-closedの既定挙動を維持し、全policyを一括fail-openにしない。
- 緊急の一時緩和はpolicy上限のversioned変更として行い、理由・開始/終了時刻をrunbookへ記録する。
- 旧Workerへ戻してもDO namespaceは削除しない。traffic停止とrollback安定を確認後に別作業でcleanupする。
- HMAC secretを戻す必要がある場合は旧secretを復元する。secret変更はbucket全resetになる点を記録する。

## 監視・運用方針

- 最低限、policy ID、outcome（allowed/limited/store_error）、status、timestampを集計可能にする。
- IP/email/userId、digest、body、token、Cookie、Authorizationは記録しない。
- `Cf-Ray`はrequest correlation用途を検討するが、唯一性を前提にしない。
- Hono 429率、WAF block件数、DO error、503率、login/game成功率を監視する。
- WAF Security Eventsはsamplingされ得るため、正確な請求/accounting用途にしない。
- 閾値変更はdocs、policy test、WAF runbookを同じPRで更新する。

## リスクと対策

| リスク                       | 影響                         | 対策                                                         |
| ---------------------------- | ---------------------------- | ------------------------------------------------------------ |
| NAT/共有IPの巻き添え         | 学校・携帯網の利用者が429    | appではuser/email bucketを併用し、edgeは高い閾値、実測で調整 |
| IPv6 privacy addressでIP回避 | IP bucket分散                | user/email独立bucketを必須にする                             |
| HMAC secret漏えい            | actor辞書攻撃補助            | Wrangler Secret、log禁止、JWT secretと分離                   |
| DO hot key                   | 特定actorへの集中でlatency増 | actor+policyごとにobject分散、global singleton禁止           |
| DO storage/cost増            | 高cardinality攻撃            | alarm cleanup、監視、WAF先行遮断                             |
| edge/Hono二重遮断            | frontendが非JSONedge error   | edge閾値を2倍目安、Honoを通常契約とする                      |
| store outage                 | sensitive API停止            | 503/Retry-After、general fail-open、WAF維持                  |
| global test mock継続         | wiring regression            | 専用real-middleware integrationを必須化                      |
| Workers基盤PR競合            | wrangler/entrypoint二重変更  | フェーズ12依存を明示しPR順序を固定                           |
| 値だけ変更しdocs不一致       | 運用判断不能                 | policyをsingle sourceにしdocs/testを同時更新                 |

## 作業手順・タスクリスト

| ID  | 内容                                   | 対象ファイル                                           | 完了条件                                            | 優先度 |
| --- | -------------------------------------- | ------------------------------------------------------ | --------------------------------------------------- | ------ |
| T1  | 仕様・全route・Cloudflare planを再確認 | docs、routes、Cloudflare account                       | 事実/未確認、正式値、rule枠、依存PRを確定           | High   |
| T2  | 進捗を実装中へ更新                     | `docs/05_progress.md`                                  | 対象が`[-]`、plan linkあり                          | Medium |
| T3  | API/security/deploy契約を先に更新      | `docs/02_security.md`, `04_api.md`, `11_deployment.md` | policy、429/503、二層責務、runbookが一致            | High   |
| T4  | policy/config testをRed化              | config/policy test                                     | 全limit/window/failure mode、production必須値が失敗 | High   |
| T5  | policy/configを実装                    | config、`policies.ts`                                  | 重複定数がなくtest通過                              | High   |
| T6  | key/resolver testをRed化               | `key.test.ts`                                          | HMAC、email、IPv4/6、XFF無視、欠損を網羅            | High   |
| T7  | key/resolverを実装                     | `key.ts`                                               | raw PIIを保持せずtest通過                           | High   |
| T8  | memory store/middleware testをRed化    | rateLimit tests                                        | boundary、複数bucket、Retry-After、fail modeを網羅  | High   |
| T9  | store契約/memory/middlewareを実装      | rateLimit配下                                          | Node testが通り、production暗黙memory fallbackなし  | High   |
| T10 | app/route integrationをRed化           | app/auth/users/game tests                              | general、email/user、順序、GET非干渉を検出          | High   |
| T11 | app/auth/users/gameへ配線              | app/routes                                             | policy matrixどおり、旧重複定義削除                 | High   |
| T12 | frontend回帰testを追加                 | errors/game/login関連                                  | JSON/非JSON/network、A11Y状態が通る                 | Medium |
| T13 | DO testをRed化                         | Cloudflare test config/DO test                         | 並行性、永続化、alarm、別instance相当が失敗         | High   |
| T14 | SQLite-backed DO/store adapterを実装   | cloudflare/adapter/wrangler                            | Workers runtime test通過                            | High   |
| T15 | staging WAF/DOを適用                   | Cloudflare設定、`docs/11_deployment.md`                | log→block、正常/429/503を実HTTP確認                 | High   |
| T16 | format/lint/test/build                 | backend/frontend                                       | 全command通過                                       | High   |
| T17 | 手動A11Y・主要導線確認                 | login/game/一般API                                     | keyboard、live region、false positiveなし           | High   |
| T18 | production deploy/監視/rollback確認    | Cloudflare/runbook                                     | metrics正常、rollback手順確認                       | High   |
| T19 | plan/progress実装完了更新              | docs                                                   | 実変更表、判断差分、PR、結果、`[x]`                 | Medium |

- [ ] T1: 仕様・全route・Cloudflare planを再確認する
- [ ] T2: `docs/05_progress.md`を実装中へ更新する
- [ ] T3: API/security/deploy契約を先に更新する
- [ ] T4: policy/config testをRed化する
- [ ] T5: policy/configを実装する
- [ ] T6: key/resolver testをRed化する
- [ ] T7: key/resolverを実装する
- [ ] T8: memory store/middleware testをRed化する
- [ ] T9: store契約/memory/middlewareを実装する
- [ ] T10: app/route integrationをRed化する
- [ ] T11: app/auth/users/gameへ配線する
- [ ] T12: frontend回帰testを追加する
- [ ] T13: Durable Object testをRed化する
- [ ] T14: SQLite-backed Durable Object/store adapterを実装する
- [ ] T15: staging WAF/DOを適用する
- [ ] T16: format/lint/test/buildを通す
- [ ] T17: 手動A11Y・主要導線を確認する
- [ ] T18: production deploy/監視/rollbackを確認する
- [ ] T19: plan/progressを実装完了へ更新する

## 品質チェックコマンド

```bash
cd backend
npm run format
npm run lint
npm run format:check
npm run test -- --run
npm run build

cd ../frontend
npm run format
npm run lint
npm run test -- --run
npm run check
```

Workers test scriptと`wrangler dev`確認コマンドは、フェーズ12で採用したconfig/script名を`docs/09_startup_commands.md`へ追記して実行する。

## 手動確認項目

- [ ] root/health/OPTIONSがrate limit対象外で、preflightが成功する
- [ ] elements/ranking/weak/users/admin/game GETが一般制限対象になる
- [ ] auth 11回目、game submit 21回目でHono 429と`Retry-After`
- [ ] 同じIPの別user、同じuserの別IPで独立bucketが期待どおり動く
- [ ] game detail/historyがsubmit枠を消費しない
- [ ] username変更がaccount枠を消費しない
- [ ] login/register/forgotの同一emailが操作別target bucketになり、別操作をlockしない
- [ ] XFFを変更してもproduction bucketを回避できない
- [ ] Hono 429にsecurity/CORS headerが付く
- [ ] edge blockがHono到達前に作動し、通常操作を遮断しない
- [ ] login/gameのJSON 429、edge非JSON/network errorが画面内に表示される
- [ ] keyboardだけでlogin、game retry、戻る操作が完結する
- [ ] loading/errorがscreen readerで認識可能で、色だけに依存しない
- [ ] log/DO storage/Cloudflare eventにraw email/token/bodyがない
- [ ] DO障害時にgeneralとsensitiveのfailure modeが分かれる
- [ ] rollbackで旧Workerへ戻せる

## 実装完了時の更新ルール

実装完了時は対象ファイル一覧と実差分を照合し、未実装項目を隠さない。Workers/DO/WAF実機確認前に進捗を完了へしない。

追記テンプレート:

```markdown
## 実装完了

- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/...
- PR: #N
- Cloudflare plan: ...
- App store: SQLite-backed Durable Object / その他（変更理由必須）

### TDD記録

- Red:
- Green:
- Refactor:

### 最終policy

| Policy ID | 対象 | limit/window | key | failure mode |
| --------- | ---- | -----------: | --- | ------------ |

### 計画からの変更点

- なし / 変更内容と理由

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
| -------- | -------- | ---- |

### リポジトリ外設定

- DO namespace/binding/migration:
- WAF rule ID/expression/threshold:
- Secret設定（値は記載しない）:
- 設定確認者/確認日:

### 検証結果

- backend format/lint/test/build:
- frontend format/lint/test/check:
- Workers runtime test:
- staging実HTTP:
- production smoke test:
- A11Y:
- 監視:
- rollback:

### 残課題・フェーズ12引き継ぎ

- なし / 内容
```
