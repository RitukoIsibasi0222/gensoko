# APIレート制限の本番設計・適用 実装計画

> 設計者ロール: シニアフルスタックエンジニア / シニアバックエンドエンジニア / Webセキュリティエンジニア / Cloudflareプラットフォームエンジニア

## 背景・目的

`docs/05_progress.md` フェーズ11の「APIレート制限の本番設計・適用（認証系 / 一般API / `POST /game/sessions`）」を実装する。

現在のHonoミドルウェアはプロセス内`Map`とIPだけを主なキーにしており、再起動・複数インスタンス・Cloudflare Workersのisolate分散をまたいでカウンターを共有できない。また、一般APIの共通制限、対象メールアドレス単位、`POST /game/sessions`のユーザーID単位が未実装で、文書値とroute値にも差がある。

本計画では、Cloudflare WAF Rate Limiting Rulesを大量アクセスの粗いエッジ防御、Honoから呼び出すSQLite-backed Durable Objectをアプリケーション文脈を含む正確な制限として組み合わせる。ローカル・unit testでは同じ契約のin-memory storeを使い、本番でプロセス内`Map`へ暗黙fallbackしない。

## レビュー結果と改善方針

### この計画のまま実装すべきではない理由

確認できた事実として、既存計画は`9aa483b`で作成済みであり、Durable Objects、WAF、HMAC、失敗時方針まで有用な設計を含む。一方で「計画書は存在しなかった」という記述が実態と矛盾し、`GET /game/questions`へのユーザー単位制限追加、複数bucketの評価・部分消費、Cloudflare zoneと`workers.dev`の関係、Durable Objectsの呼出し・alarmコスト、環境別設定の契約が十分に確定していなかった。

このまま実装すると、10分窓を表現できないCloudflare Workers Rate Limiting bindingの誤採用、`x-forwarded-for`偽装、複数isolateでの制限回避に加え、逐次middlewareで先のbucketだけを消費する挙動、未要求のpolicy追加、WAFが適用されない公開hostnameでのリリース、Free枠超過時の予期しない503が起こり得る。通常のroute testではrate limitがグローバルmockされており、配線漏れも検出できない。

### DBの整合性と負荷

| 指摘内容                                                                    | 根拠                                                                                              | 影響・リスク                                                                   | 改善案                                                                                 | 優先度 |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------ |
| PostgreSQL/Prismaを一般APIのカウンターストアにすると全APIへ書き込みが増える | 確認できた事実: 一般APIは1分60回/IPを予定し、現在の業務DBはPrisma + PostgreSQL                    | DB接続枯渇、ランキング・ゲームtransactionとの競合、不要なmigration/cleanup負荷 | 業務DBは使わず、SQLite-backed Durable Objectの強整合storageを利用する                  | High   |
| 現行`Map`は永続性・共有性がない                                             | 確認できた事実: `backend/src/middleware/rateLimit/index.ts`内のmodule-local `Map`だけで保持       | 再起動と複数instance/isolateで上限を回避できる                                 | productionではDurable Object storeを必須化し、memory storeはdevelopment/test限定       | High   |
| DB schema変更を示す要件はない                                               | 確認できた事実: rate limit状態は業務データとrelationを持たず、Durable Objectsは独立storageを持つ  | 不要なschema/migrationはデプロイとrollbackを複雑化する                         | Prisma schema/migrationは変更しない。DB追加チェックは不要と記録する                    | Medium |
| DOの高cardinality状態が残留し得る                                           | 推測: 攻撃者が多数のIP/対象を生成すると多数objectが作られる                                       | storage/cost増加                                                               | reset後alarmでcount/resetAtを削除し、生のIP/email/userIdを保存しない。利用量を監視する | Medium |
| DO呼出しとalarmも利用量へ算入される                                         | 確認できた事実: Workers FreeではDO requestが10万回/日で、RPCとalarm invocationもrequestに含まれる | 一般API1回にDO RPC、期限後にalarmが発生し、Worker本体より先にDO上限へ達し得る  | policy別RPC数を負荷試験・試算し、Free超過時の失敗modeとPaid移行条件をrunbookへ記録する | High   |

N+1、relation、unique、nullable、cascadeへの変更はないため、このタスク固有の重大な問題はない。PostgreSQLへrate limit rowを追加しない限り、既存データ移行とexpand/contract migrationも不要である。

### API・コードの整合性

| 指摘内容                                            | 根拠                                                                                                         | 影響・リスク                                                                                | 改善案                                                                                                                  | 優先度 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------ |
| 文書と`POST /game/sessions`の上限が不一致           | 確認できた事実: `docs/02_security.md`は20回/分、routeは10回/分                                               | 意図しない仕様変更、テストと運用値の不一致                                                  | 正式値を20回/分に統一し、IPとuser IDを独立bucketで評価する                                                              | High   |
| 一般API制限がない                                   | 確認できた事実: `app.ts`に共通rate limitはなく、elements/ranking/weak/admin等の多くに個別適用もない          | 読み取り・DB集計APIへの集中アクセスをHonoで抑止できない                                     | CORSの後、route mountの前に`/api/v1/*`共通60回/分/IPを置く                                                              | High   |
| 現行proxy信頼が広すぎる                             | 確認できた事実: `TRUST_PROXY=true`ではXFF先頭値を優先する。Cloudflareはoriginで`CF-Connecting-IP`参照を推奨  | client指定XFFをbucket keyにして回避される可能性                                             | Workers productionは検証済み`CF-Connecting-IP`だけ、Node developmentはsocket、testは明示resolverを使う                  | High   |
| game detail GETとPOSTが同じbucketを共有する         | 確認できた事実: `gameSessionsRateLimit`を`GET /sessions/:sessionId`と`POST /sessions`で共用                  | 結果再表示が送信枠を消費し、POST専用制限になっていない                                      | GET詳細/履歴は一般bucket、POSTだけgame-submit bucketへ分離する                                                          | High   |
| メール単位制限をvalidated payloadから安全に作れない | 確認できた事実: rate limitは`zValidator`より前、`emailSchema`はtrim/lowercase変換しない                      | 未検証body利用、平文PII保存、validationの二重実装                                           | IP制限→Zod→正規化済みemailのHMAC key→handlerの順にする                                                                  | High   |
| `PATCH /users/me`はpayload型により適用対象が異なる  | 確認できた事実: usernameとpassword変更をunionで処理し、現行はhandler内でpassword時だけ手動middleware呼び出し | middleware契約が不自然でnext/Response処理を誤りやすい                                       | Zod後にpayload predicateを使う条件付きmiddlewareへ共通化する                                                            | Medium |
| 429契約がedgeとHonoで同一とは限らない               | 確認できた事実: Honoは日本語JSON。Cloudflare WAFのcustom response/field/period/rule数はplan依存              | CORSなし・非JSON edge responseでfrontendがmessageを取得できない                             | Hono 429だけをAPI JSON契約とし、edge閾値を高くする。frontendは非JSON/ネットワークfallbackを維持する                     | High   |
| Workers Rate Limiting bindingは全要件を満たさない   | 確認できた事実: periodは10/60秒のみ、location単位、結果整合的で正確なaccounting用ではない                    | 10分10回を表現できず、拠点移動・burstで超過を許す                                           | 本タスクの正確なapp storeには使わず、Durable Objectを採用する                                                           | High   |
| rate limit設定がrouteごとに重複                     | 確認できた事実: auth/users/gameに`windowMs`/`max`/`TRUST_PROXY`が散在                                        | 文書更新漏れとroute間の値ずれ                                                               | policy ID、limit、window、failure modeを`policies.ts`に一元化する                                                       | Medium |
| 複数bucketの評価方法が未定義                        | 確認できた事実: 既存middlewareは1 requestにつき1 bucketだけを逐次更新する                                    | IP許可後にuser拒否された場合の部分消費、Retry-After、store error優先順位がrouteごとにずれる | 共通`rateLimit()`が適用bucketを全て評価し、試行として全bucketを消費、最大Retry-Afterとfail-closed優先で結果を集約する   | High   |
| `GET /game/questions`へuser policyを追加していた    | 確認できた事実: 現行は30回/分/IPのみ。文書上のuser ID必須対象は`POST /game/sessions`                         | 未要求の仕様拡張とDO RPC増加                                                                | questionsは既存30回/分/IPを共有storeへ移すだけにし、user policy追加は別タスクにする                                     | Medium |
| email正規化と認証identity正規化が混同し得る         | 確認できた事実: 現行`emailSchema`とserviceは大小文字を変換せず、DBは`email @unique`                          | rate limit導入だけで既存email検索・保存 semanticsを変えるとログイン不能や重複が起こり得る   | rate-limit grouping用にtrim+lowercaseを1回だけ行い同じ変数を検証・HMACへ使う。serviceへ渡す既存値は本タスクで変更しない | High   |

認証・認可、Zod validation、既存の日本語エラー形式自体には重大な問題はない。rate limitは認証の代替にせず、既存auth/admin middlewareを維持する。

### UI / A11Y

| 指摘内容                          | 根拠                                                                                                                   | 影響・リスク                             | 改善案                                                                 | 優先度 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- | ------ |
| 専用UI追加は不要                  | 確認できた事実: loginは`role="alert"`と二重送信防止、game playは`aria-busy`、error時`role="alert"`と再送信ボタンを持つ | UIを作り直すとscopeが拡大する            | 既存画面とAPI clientの回帰確認を基本とし、失敗時だけ最小修正する       | Low    |
| edge 429はHono JSONを保証できない | 推測: plan/response header設定によりブラウザでは非JSONまたはCORS network errorになり得る                               | 支援技術へ具体的な待ち時間を伝えられない | 既存fallbackを画面内alertで表示し、Hono 429では日本語messageを優先する | Medium |
| Retry後のfocus方針が未固定        | 確認できた事実: gameは再送信ボタンを持つがrate limit専用focus移動はない                                                | 自動focus移動がかえって操作文脈を壊す    | focusを強制移動せず、live regionで通知し、disabled中も状態文言を出す   | Low    |

キーボード操作、label、色だけに依存しない表示について、現行の対象画面に本タスク起因の重大な問題はない。新規UIを追加しないため、A11Yは回帰確認を中心とする。

### テストの妥当性

| 指摘内容                                    | 根拠                                                              | 影響・リスク                                                       | 改善案                                                                                    | 優先度 |
| ------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------ |
| 通常route testがrate limitを通していない    | 確認できた事実: `backend/src/test-setup.ts`が全testでmoduleをmock | middleware順序、route分類、429 body/headerの配線漏れを検知できない | unit testに加え、mock解除またはdependency injectionした専用app integration testを追加する | High   |
| 現行unit testは単一process Mapだけを検証    | 確認できた事実: max、window、IP差、store上限が中心                | HMAC key、複数bucket、store障害、DO原子性を検証できない            | policy/key/middleware/store/Workers integrationを分層してテストする                       | High   |
| 同時実行境界が未検証                        | 確認できた事実: 逐次requestのみ                                   | read-modify-write競合で上限を超える可能性                          | DOに上限付近の並行consumeを送り、成功件数がlimitを超えないことを確認する                  | High   |
| frontendは一部429を確認するがedge相当が不足 | 確認できた事実: usersは429 JSON、共通helperは非JSONを扱う         | login/gameで非JSON/CORS相当の表示回帰が残る                        | login/game API・pageのJSON 429、非JSON 429、network errorを確認する                       | Medium |

### 外部基盤・リリース

| 指摘内容                                 | 根拠                                                                                                                        | 影響・リスク                                                                 | 改善案                                                                                                                     | 優先度 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------ |
| Workers本番基盤が未整備                  | 確認できた事実: `wrangler.toml`、Workers entrypoint、Cloudflare Prisma adapterはフェーズ12未実装                            | DO配線とWAF実機確認なしで「本番適用完了」と誤認する                          | app層を先行可能に分離するが、Workers/DO/WAF実機確認まで進捗を`[x]`にしない                                                 | High   |
| WAFのrule数・利用field・periodはplan依存 | 確認できた事実: Freeは1 rule/10秒かつpath中心、Proは2 rules/最大1分だがmethod不可、Businessは5 rules/最大10分でmethod利用可 | 契約未確認の設計ではOPTIONS除外やroute別ruleをdeployできない                 | planを確認し、最低1本のpath-based coarse API ruleを必須、methodを使う追加rulesはBusiness以上に限定する                     | High   |
| edge counterも厳密ではない               | 確認できた事実: Cloudflare WAFは反映遅延があり、正確な到達数保証ではない                                                    | edgeだけではburstを完全に止められない                                        | edgeは大量遮断、DOをapp上限判定と明確に分担する                                                                            | Medium |
| WAF適用hostnameが未確定                  | 確認できた事実: WAF Rate Limiting Rulesはzone単位。`docs/11_deployment.md`は`workers.dev` URL例と独自domain案を併記する     | 実公開hostnameが対象zoneに属さない場合、想定したWAF ruleを適用できない可能性 | Cloudflare account、zone、custom domain/route、実hostnameをフェーズ12担当と確認し、WAFが実際に通る経路をrelease gateにする | High   |
| custom JSON responseは全plan共通でない   | 確認できた事実: WAFのcustom responseはPro以上。Freeのedge responseはHono JSON契約外                                         | FreeでJSON/CORSを前提にするとfrontend表示が崩れる                            | edgeは非JSON/network errorを許容する契約とし、Pro以上でのみcustom JSONを任意設定する                                       | Medium |

## スコープ

- rate limit policy、key、store、middlewareの共通化
- development/test用in-memory storeとproduction用Durable Object store adapter
- SQLite-backed Durable Objectの原子的fixed-window counterと期限後cleanup
- 一般API、認証系、対象email、account-sensitive、game submitへの適用、および既存`GET /game/questions` 30回/分/IPの共有store移行
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

### 文書と実装の差分

| 項目             | 確認できた事実                                                                    | 採用方針                                                                    |
| ---------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 認証系値         | `docs/02_security.md`と`docs/12_task_guide.md`は10回/10分。auth/users routeも同値 | 値は維持し共通policy化。対象endpointとkeyを明文化                           |
| game submit値    | security/task guideは20回/分、routeは10回/分                                      | 文書値20へ修正し、IP/user独立bucketにする                                   |
| general値        | security/task guideは60回/分、app/多くのrouteは未適用                             | CORS後・route mount前のapp-level policyで統一                               |
| 進捗責務         | `docs/05_progress.md`はCloudflare+Hono、gameはuser ID/IP                          | 二層を維持し、複合keyではなく独立bucketと明記                               |
| deployment       | `docs/11_deployment.md`はWorkers/WAF方針を記すがwrangler/entrypoint未作成         | Hono先行範囲とフェーズ12依存を分離し、実機前は未完了                        |
| task guide phase | `docs/12_task_guide.md`はデプロイをフェーズ11、progressはフェーズ12と呼ぶ         | 参照先は`docs/05_progress.md`のフェーズ12に統一し、必要時にtask guideを修正 |
| email正規化      | backend schema/serviceはtrim/lowercaseしない。login UIはtrimのみ                  | rate-limit grouping専用の正規化に限定し、認証identityは変更しない           |

### 確定route分類

全ての非除外`/api/v1/*`は`GENERAL_API_IP`を消費し、下表のspecialized policyを追加で消費する。

| route                                                                | general | specialized                               | 認証・認可                                     |
| -------------------------------------------------------------------- | ------- | ----------------------------------------- | ---------------------------------------------- |
| `POST /auth/register`                                                | IP      | `AUTH_IP` + `AUTH_EMAIL(register)`        | 不要                                           |
| `POST /auth/login`                                                   | IP      | `AUTH_IP` + `AUTH_EMAIL(login)`           | 不要                                           |
| `POST /auth/forgot-password`                                         | IP      | `AUTH_IP` + `AUTH_EMAIL(forgot-password)` | 不要                                           |
| `POST /auth/reset-password`                                          | IP      | `AUTH_IP`                                 | 不要。tokenをkeyにしない                       |
| `POST /auth/verify-email`, `/refresh`, `/logout`                     | IP      | なし                                      | 既存Cookie/token契約を維持                     |
| `PATCH /users/me` username branch                                    | IP      | なし                                      | auth必須                                       |
| `PATCH /users/me` password branch                                    | IP      | `ACCOUNT_IP` + `ACCOUNT_USER`             | auth必須、Zod後にbranch選択                    |
| `DELETE /users/me`                                                   | IP      | `ACCOUNT_IP` + `ACCOUNT_USER`             | auth必須                                       |
| `GET /game/questions`                                                | IP      | `GAME_QUESTIONS_IP`                       | auth必須、既存30回/分/IP維持                   |
| `POST /game/sessions`                                                | IP      | `GAME_SUBMIT_IP` + `GAME_SUBMIT_USER`     | auth必須                                       |
| `GET /game/sessions`, `GET /game/sessions/:sessionId`                | IP      | なし                                      | auth必須。submit bucketを消費しない            |
| `/elements/*`, `/ranking/*`, その他`/users/*`, `/weak/*`, `/admin/*` | IP      | なし                                      | 既存optional/auth/admin middleware維持         |
| 未知の`/api/v1/*`                                                    | IP      | なし                                      | general消費後に既存404                         |
| `/`, `/api/v1/health`, 全`OPTIONS`                                   | 除外    | なし                                      | root/health/監視/preflightをrate limitから除外 |

### 既存公開インターフェース

**`backend/src/middleware/rateLimit/index.ts`**

- `rateLimit(options: RateLimitOptions): MiddlewareHandler` — module-local Mapによるfixed window制限
- options: `windowMs`, `max`, `maxStoreSize?`, `trustProxy?`
- 超過: 429 `{ "error": "リクエストが多すぎます。しばらく待ってから再試行してください" }`

**`backend/src/middleware/auth/index.ts`**

- `authMiddleware` — JWT/DB状態検証後に`c.set("user", { id, role })`
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
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/): Workers FreeでもSQLite-backed DOを利用できる。Freeは10万request/日で、RPC sessionとalarm invocationもrequestに含まれ、上限超過時は該当operationが失敗する。
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/): FreeのSQLite storageはaccount 5GB、class 100、object数は無制限。高cardinalityとstorage cleanupは監視が必要。
- [WAF custom response](https://developers.cloudflare.com/waf/rate-limiting-rules/create-zone-dashboard/): custom JSON responseはPro以上。Freeではedge responseをHono JSON契約に含めない。

## 前提条件・依存関係

### 必須依存

- フェーズ12のCloudflare Workers entrypoint、採用するDO/Prisma adapterと互換性があるWrangler、Workers用Prisma接続が利用可能になること
- Cloudflare account/zone/Workers planとWAF rule枠を実装前に確認すること
- productionではWorkers経由以外のbackend直接到達を許可しないこと
- DO namespace migrationとbindingをproduction/stagingで分離すること
- HMAC key生成用`RATE_LIMIT_KEY_SECRET`をWrangler Secretとして管理すること

### 確認事項

以下はリポジトリだけでは確定できないため、実装開始時のT1で確認し、未確認のまま本番設定を断定しない。

- Cloudflareの実契約: zone plan（Free/Pro/Business/Enterprise）とWorkers plan（Free/Paid）は別契約であるため、双方を確認する。
- 本番API hostname: `workers.dev`、custom domain、Workers routeのどれを使うか。WAF Rate Limiting Rulesを設定するzoneと実traffic経路が一致するか。
- WAF rule枠、利用可能field、period、custom response、draft/preview相当機能、Security Eventsの閲覧権限。
- Workers entrypoint、Wrangler設定形式（`wrangler.toml`/`wrangler.jsonc`）、DO migration tag、binding名。現時点ではいずれも未作成であり、ファイル名を断定しない。
- stagingとproductionのnamespace、secret、hostname、WAF ruleを分離できるか。
- 想定trafficから算出した1request当たりDO RPC数、alarm数、Free枠余裕、Paid移行の承認者と費用上限。
- IPv6 `/64`集約を実装するためのWorkers互換IP parser。新規dependencyを採用する場合はlicense・保守状況・bundle影響を確認する。
- Pro未満でedge custom JSON/CORSを保証できない前提をプロダクト側が受け入れるか。

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

| Policy ID           | 対象                            |     limit/window | key                           | failure mode                          |
| ------------------- | ------------------------------- | ---------------: | ----------------------------- | ------------------------------------- |
| `GENERAL_API_IP`    | `/api/v1/*`、health/OPTIONS除外 |          60/60秒 | IP                            | fail-open（WAFを残し固定eventを記録） |
| `AUTH_IP`           | register/login/forgot/reset     |         10/600秒 | IP                            | fail-closed 503                       |
| `AUTH_EMAIL`        | register/login/forgot           | 操作ごと10/600秒 | 操作scope + 正規化emailのHMAC | fail-closed 503                       |
| `ACCOUNT_IP`        | password変更/account削除        |         10/600秒 | IP                            | fail-closed 503                       |
| `ACCOUNT_USER`      | password変更/account削除        |         10/600秒 | user IDのHMAC                 | fail-closed 503                       |
| `GAME_QUESTIONS_IP` | GET game/questions              |          30/60秒 | IP                            | fail-open（既存値維持）               |
| `GAME_SUBMIT_IP`    | POST game/sessions              |          20/60秒 | IP                            | fail-closed 503                       |
| `GAME_SUBMIT_USER`  | POST game/sessions              |          20/60秒 | user IDのHMAC                 | fail-closed 503                       |

`AUTH_IP`は4 endpointで共有するが、`AUTH_EMAIL`は`register`、`login`、`forgot-password`の操作scopeごとに独立させる。別操作を悪用して正規利用を止めるtargeted rate-limit DoSを避けるためである。`verify-email`、`refresh`、`logout`、game履歴/詳細は`GENERAL_API_IP`のみとする。`GET /game/questions`は既存30回/分/IPを共有storeへ移すだけで、未要求のuser policyを追加しない。将来の実測で追加policyが必要なら、同一タスクへ暗黙追加せず`docs/02_security.md`と本計画を更新する。

`POST /game/sessions`の「ユーザーID + IP」は複合key 1個ではなく、IP bucketとuser bucketを独立して両方評価する。両方を20回/分とするのは現行文書値を最も厳密に解釈した初期値である。これによりIP切替にはuser bucket、複数account切替にはIP bucketが効く。NAT巻き添えが観測された場合は、user上限を維持したままIP上限だけを変更する設計変更として、計測根拠・`docs/02_security.md`・policy testを同時更新する。

同じmiddleware段階で複数bucketを評価する場合は、全bucketを試行として消費して結果を集約する。1つのbucketが超過していても他bucketの試行を取り消さない。異なる段階のbucket（general→specialized IP→auth→user）は防御順序上、前段だけが消費されることを仕様とし、rollbackしない。これにより不正tokenや不正bodyを変えて前段の防御を回避できない。

### middleware順序

1. logger
2. security headers
3. CORS（preflightはここで終了）
4. `GENERAL_API_IP`
5. route固有IP policy（未認証・不正tokenもここで遮断）
6. auth middleware（user IDが必要なroute）
7. user policy（bodyに依存しない場合）
8. Zod validation
9. validated payloadに依存するemail/account policy
10. handler/service

例外:

- register/login/forgotは`GENERAL_API_IP`→`AUTH_IP`→Zod→`AUTH_EMAIL`→handler。
- resetはemailを持たないため`GENERAL_API_IP`→`AUTH_IP`→Zod→handler。tokenをbucket keyにしない。
- game submitは`GENERAL_API_IP`→`GAME_SUBMIT_IP`→auth→`GAME_SUBMIT_USER`→Zod→handler。未認証・不正tokenはIP bucketを消費し、user bucketは消費しない。認証済みの不正bodyはuser bucketも消費する。
- password変更はgeneral→auth→Zod後、payloadがpassword variantの場合だけ`ACCOUNT_IP`と`ACCOUNT_USER`を同一段階で評価する。username variantはaccount bucketを消費しない。
- account削除はgeneral→auth→`ACCOUNT_IP`と`ACCOUNT_USER`→Zod→handler。認証済み削除試行はbody不正でもaccount bucketを消費する。
- questionsはgeneral→`GAME_QUESTIONS_IP`→auth→Zod→handler。既存の30回/分/IPを維持し、user bucketは追加しない。

### keyと個人情報

- production WorkersはHonoのCloudflare Workers adapterが参照する`CF-Connecting-IP`の単一値だけを採用し、XFF/x-real-ipをfallbackにしない。実公開経路がCloudflareを必ず通ることをrelease gateにする。
- development Nodeはsocket address、testは明示fixture resolverを使う。
- productionでIPが欠損/不正ならspecialized policyは503、general policyはfail-openとする。全員を`unknown` bucketへ集約しない。
- IPv4は正規化した単一address、IPv6はprivacy address切替による回避を抑えるため正規化した`/64` prefixをHonoのIP actor値とする。IPv4-mapped IPv6の扱いも1箇所で定義し、WAF側のIP特性とは完全一致しないことを記録する。
- emailはZod成功後の値から`const normalizedRateLimitEmail = email.trim().toLowerCase()`を1回だけ計算し、同じ変数をrate-limit actor validationとHMAC生成へ渡す。これはrate limit grouping専用で、serviceへ渡すemailやDB検索・保存semanticsを本タスクで暗黙変更しない。
- store/object nameは`HMAC-SHA-256`のhex digestを使う。入力は単純連結せず、version付きtuple`[version, policyId, operationScope, actorType, canonicalValue]`を曖昧性のないcanonical serializationへ変換する。
- raw IP/email/user ID、Authorization、Cookie、body、digestをapplication logへ出さない。
- secret rotationは全bucket resetになるため、緊急時以外はdeployment runbookに従う。
- development/testは明示注入した固定fixture secretを使い、production secretの暗黙fallbackは設けない。

### fixed-windowとcleanup

- stateは`count`, `resetAt`だけとし、actor値は保存しない。
- `now >= resetAt`で新windowへ切り替える。
- read/increment/resetをSQLite-backed DOの同期storage transactionまたは同等のserialized sequenceで実装し、同一keyへの並行requestで許可件数がlimitを超えないことをWorkers runtime testで証明する。
- reset時刻にalarmを設定し、期限後stateを削除する。
- clientからlimit/window/時刻を自由指定させず、共通policy IDからserver側設定を解決し、DO自身のclockで判定する。
- sliding window logは正確だがrequest履歴とwrite量が増え、token bucketは文書の「N回/期間」とsemanticsが変わるため初期採用しない。fixed windowは境界で最大2倍のburstを許し得るため、そのリスクをWAFの短時間burst ruleと監視で補い、境界testを必須にする。
- objectは`policyId + keyDigest`ごとに分散し、global singleton hot spotを作らない。stateには`count`と`resetAt`だけを保存し、alarmで`deleteAll`相当のcleanupを行う。alarm遅延中も`now >= resetAt`ならrequest処理内でresetする。

## Cloudflare WAF方針

### 最低構成

- WAFが実公開hostnameのzoneへ適用できることを先に実HTTPで証明する。`workers.dev`でzone ruleが効くと推測せず、必要ならフェーズ12のcustom domain/Workers routeを依存条件にする。
- 全zone planで、利用可能な最低1 ruleをpath条件`/api/v1/*`（`/api/v1/health`除外）へ適用する。
- Free/Proはrate limit expressionでmethodを使えないため、`OPTIONS`もedge countへ含まれ得る。Hono側ではcount対象外を維持する。
- Free plan想定の最低構成は40 requests/10秒/IP、10秒blockとし、preflightを数えても通常のapp上限より余裕を持たせる。
- これは一般API 60/分の正確な代替ではなく、短時間burstの粗い遮断である。

### rule枠に余裕がある場合

app上限よりedgeを厳しくしない。

| zone plan    | Rule        | match                           |  edge上限案 | 備考                                         |
| ------------ | ----------- | ------------------------------- | ----------: | -------------------------------------------- |
| Free         | general     | `/api/v1/*`, health除外         |  40/10秒/IP | 1 rule、pathのみ、OPTIONS込み得る            |
| Pro          | general     | `/api/v1/*`, health除外         | 240/60秒/IP | 1本目、method不可                            |
| Pro          | auth        | 4 auth pathのOR                 |  20/60秒/IP | 2本目。10分窓は表現できないためburst防御のみ |
| Business以上 | general     | `/api/v1/*`, health/OPTIONS除外 | 120/60秒/IP | method利用可                                 |
| Business以上 | auth        | 4 auth path + POST              | 20/600秒/IP | Hono 10/600より余裕を持たせる                |
| Business以上 | game submit | POST `/api/v1/game/sessions`    |  40/60秒/IP | Hono各20/60より余裕を持たせる                |

- exact plan、rule expression、rule order、mitigation timeoutを`docs/11_deployment.md`へ記録する。
- custom JSON 429はPro以上でのみ候補とし、CORS headerを含め契約どおりかstagingで確認する。Freeを含め保証できない場合、edge responseは非JSON/network errorとして扱う。
- rate limiting ruleに汎用のlog-only/previewがあると仮定しない。Dashboardでdraft保存し、staging hostnameへ安全な高閾値でdeployしてSecurity Eventsとorigin到達を確認後、計画値へ下げる。
- Dashboard手作業だけで終わらせず、rule名、zone、expression、characteristics、period、requests、mitigation timeout、action、rule order、設定者、確認日、rollback手順を`docs/11_deployment.md`へ転記する。secret値、account ID、zone ID、tokenは記載しない。

## API変更方針

### Hono 429

Status: `429 Too Many Requests`

```json
{
  "error": "リクエストが多すぎます。しばらく待ってから再試行してください"
}
```

- `Retry-After: <resetまでの秒数を切り上げた整数>`を必須とする。
- 複数bucketのうち失敗したbucketの最大待ち時間を使う。
- `RateLimit`/`RateLimit-*`系headerと成功responseのremaining/resetは初期リリースで採用しない。複数bucketとedgeを合わせた正確な残数を単一値で表現できないためで、`Retry-After`だけを公開契約にする。
- security headersとCORSは既存middleware順序により維持する。

### store障害時503

fail-closed policyだけ次を返す。

```json
{
  "error": "一時的に利用できません。しばらく待ってから再試行してください"
}
```

- statusは503、`Retry-After: 60`。
- raw errorをresponse/logへ出さず、policy IDだけを含む固定event名を記録する。
- general policyはfail-openし、WAF防御を維持する。
- 同一段階の複数bucketでstore errorとlimit超過が混在した場合、fail-closed errorを503として優先する。fail-open bucketのerrorだけなら他bucketの判定を維持する。

### Cloudflare edge response

- Hono JSON/CORS/security header契約の保証対象外と明記する。
- custom JSONが使える場合も同じ日本語文言と429を設定する。
- frontendはJSON、非JSON、CORS network errorのいずれでも画面内fallbackを表示する。

## 設計上の決定事項

1. **CloudflareとHonoの責務**: WAFはHono到達前の粗いIP/burst防御、Honoはroute・email・user文脈を使う正確な契約とする。edgeだけではper-colo/反映遅延があるためである。
2. **Hono本番store**: SQLite-backed Durable Objectsを採用する。Workers Rate Limiting bindingは10/60秒・location単位・eventually consistent、KVは原子的上限判定に不向き、PostgreSQLは全API write負荷となるため採用しない。
3. **store抽象化**: `RateLimitStore`とfactoryを設け、development/testはin-memory/fake、productionはDOのみとする。production memory fallbackは拒否する。
4. **原子性・TTL**: actor+policyごとのDOでfixed-windowをserialized transactionとして更新し、alarmとrequest時期限判定の両方でcleanupする。
5. **具体値**: auth 10/600秒、general 60/60秒、game submit IP/user各20/60秒、account IP/user各10/600秒、questions既存IP 30/60秒を採用する。
6. **route分類**: 非除外`/api/v1/*`へgeneralを適用し、確定route分類表の対象だけspecializedを重ねる。未知APIもgeneral対象とする。
7. **IP信頼境界**: productionはCloudflare Workers adapterの`CF-Connecting-IP`のみ。XFF/x-real-ipは無視し、WAFを通る公開経路をrelease gateにする。
8. **IPv4/IPv6/欠損**: IPv4は正規address、IPv6は/64、mapped addressは共通規則で正規化する。欠損時はgeneral fail-open、sensitive fail-closedで`unknown`共有bucketは作らない。
9. **email key**: Zod成功後にtrim+lowercaseを1回だけ実行し、同じ変数をactor validationとHMACへ使う。生emailは保存せず、認証identity semanticsは変えない。
10. **game submit key**: 複合key 1個ではなくIP/user独立bucketを両方評価する。Cloudflareは別の高いIP閾値で大量trafficを遮断する。
11. **auth/rate limit順序**: gameはgeneral→submit IP→auth→user→Zod、未認証でもIP防御が効く順序とする。
12. **PATCH users/me**: auth→Zodでunion branchを確定し、password branchだけaccount IP/userを消費する。username変更は消費しない。
13. **edge余裕**: WAFはHonoより高い閾値とし、通常の制限超過はHono日本語JSONへ到達させる。
14. **algorithm**: 初期実装はfixed window。sliding logのwrite量とtoken bucketのsemantics変更を避け、境界burstはWAFと監視で補う。
15. **store障害**: general/questionsはfail-open、auth/account/game submitはfail-closed 503とする。認証情報・ゲーム結果改ざん防止を可用性より優先する。
16. **429/header**: Honoは日本語`{ error }`と`Retry-After`を返す。複数bucket/edgeで残数が一意でないためRateLimit系headerは初期採用しない。
17. **除外**: `/`、`/api/v1/health`、`OPTIONS`をHono limiterから除外する。WAFでOPTIONS除外できないplanでは高い閾値で吸収する。
18. **設定一元化**: policy値は`policies.ts`、env validationは`config.ts`、store構築はfactoryへ集約し、routeへ数値・header・error生成を複製しない。
19. **観測可能性**: policy ID、outcome、status、timestampだけを集計し、IP/email/userId/digest/body/token/Cookie/Authorizationを記録しない。
20. **frontend**: 新規UIは作らない。既存JSON message保持・非JSON fallback・`role=alert`・二重送信防止を回帰確認し、失敗時だけ最小修正する。
21. **DB migration**: Prisma schema/migrationは不要。DO migrationはCloudflare stateとしてフェーズ12設定と分離する。
22. **完了条件**: Hono先行実装だけでは未完了。Workers/DO/WAFのstaging・production実機確認、監視、rollback、文書更新まで完了後に`docs/05_progress.md`を`[x]`へする。

## 公開インターフェース案

実装コードではなく責務とsignatureを示す。

```ts
export type RateLimitPolicyId =
  | "GENERAL_API_IP"
  | "AUTH_IP"
  | "AUTH_EMAIL"
  | "ACCOUNT_IP"
  | "ACCOUNT_USER"
  | "GAME_QUESTIONS_IP"
  | "GAME_SUBMIT_IP"
  | "GAME_SUBMIT_USER";

export type RateLimitFailureMode = "fail-open" | "fail-closed";

export type RateLimitPolicy = Readonly<{
  id: RateLimitPolicyId;
  limit: number;
  windowMs: number;
  failureMode: RateLimitFailureMode;
}>;

export type RateLimitKeyContext = Readonly<{
  ip: string | null;
  userId: string | null;
  normalizedEmail: string | null;
  operationScope: string | null;
}>;

export type RateLimitResult = Readonly<{
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;
  retryAfterSec: number;
}>;

export interface RateLimitStore {
  consume(input: {
    policyId: RateLimitPolicyId;
    keyDigest: string;
  }): Promise<RateLimitResult>;
}

export type RateLimitStoreFactory = (context: Context) => RateLimitStore;
export type RateLimitBucket = Readonly<{
  policyId: RateLimitPolicyId;
  keyContext: RateLimitKeyContext;
}>;

export type RateLimitBucketResolver = (
  context: Context,
) => Promise<readonly RateLimitBucket[]>;

export function rateLimit(options: {
  getStore: RateLimitStoreFactory;
  resolveBuckets: RateLimitBucketResolver;
  when?: (context: Context) => boolean | Promise<boolean>;
}): MiddlewareHandler;

export function resolveClientIp(input: {
  context: Context;
  runtime: "node" | "cloudflare-workers";
}): string | null;
export function normalizeIpActor(ip: string): string | null;
export function normalizeRateLimitEmail(email: string): string;
export function createIpRateLimitKey(
  context: RateLimitKeyContext,
): Promise<string | null>;
export function createUserRateLimitKey(
  context: RateLimitKeyContext,
): Promise<string | null>;
export function createEmailRateLimitKey(
  context: RateLimitKeyContext,
): Promise<string | null>;
export function createRateLimitKeyDigest(input: {
  secret: string;
  policyId: RateLimitPolicyId;
  operationScope: string | null;
  actorType: "ip" | "email" | "user";
  value: string;
}): Promise<string>;

export function createRateLimitStoreFactory(input: {
  runtime: "development" | "test" | "production";
  durableObjectNamespace?: DurableObjectNamespace;
}): RateLimitStoreFactory;

export function createRateLimitExceededResponse(
  context: Context,
  result: RateLimitResult,
): Response;
export function createRateLimitStoreUnavailableResponse(
  context: Context,
): Response;

export const RATE_LIMIT_POLICIES: Readonly<
  Record<RateLimitPolicyId, RateLimitPolicy>
>;
```

- `remaining`と`retryAfterSec`は0以上、`resetAtMs`はUnix epoch milliseconds。
- key欠損は`null`で表し、空文字や`"unknown"`を有効keyにしない。
- optional bindingは`undefined`、actor値の欠損は`null`で表し、意味を混在させない。
- `rateLimit()`は同一段階の複数policyを共通評価し、routeから429/503生成、HMAC、store error集約を重複実装させない。
- interface、JSDoc、default値のnullabilityを一致させる。

## 設定・環境変数案

| 設定                             | development      | test                           | production                       | 管理場所                                                          |
| -------------------------------- | ---------------- | ------------------------------ | -------------------------------- | ----------------------------------------------------------------- |
| policy limit/window/failure mode | 本番と同じ定数   | test fixtureを明示注入         | 本番定数                         | `policies.ts`のみ。route/envへ数値を重複させない                  |
| store                            | in-memory        | fake/in-memory/Workers runtime | SQLite-backed Durable Object必須 | store factoryとWorkers binding                                    |
| `RATE_LIMIT_KEY_SECRET`          | `.env`の開発用値 | testから固定fixture注入        | Wrangler Secret必須              | `config.ts`で形式・長さ検証。値は記録しない                       |
| `RATE_LIMIT_STORE`               | `memory`         | 原則注入                       | `durable-object`以外を拒否       | `config.ts`。productionの暗黙memory fallback禁止                  |
| DO binding名候補                 | なし             | Workers fixture                | `RATE_LIMIT_COUNTER`             | Wrangler設定。フェーズ12の命名規則確認後に確定                    |
| `TRUST_PROXY`                    | 廃止予定         | 使用しない                     | 使用しない                       | rate limitのIP取得には使わず、関連文書・Composeから除去可否を確認 |

- productionでrate limit全体を無効化する環境変数は設けない。
- limit/windowを個別環境変数化しない。値変更はcode review、policy test、security/API/deployment文書更新を伴うversioned changeとする。
- testの小さい上限値はproduction環境変数を書き換えず、policy/store dependency injectionで与える。
- `.env.example`には変数名とplaceholderのみを記載し、実secret、email、IP、token、account/zone IDを含めない。
- `RATE_LIMIT_KEY_SECRET`はHMAC専用の独立した256-bit以上のランダム値をbase64等の確定形式で受け、`config.ts`でdecode後のbyte長まで検証する。JWT secretを流用しない。
- `RATE_LIMIT_KEY_SECRET`変更は全bucket resetになるため、通常rotationはmaintenance/runbook承認を必須にする。

## 対象ファイル一覧

実装時に実態へ合わせて更新する。

### 変更予定ファイル

| ファイル                                                   | 変更種別                   | 内容                                                         |
| ---------------------------------------------------------- | -------------------------- | ------------------------------------------------------------ |
| `backend/src/lib/config.ts`                                | 修正                       | production secret/runtime要件のfail-fast validation          |
| `backend/src/lib/config.test.ts`                           | 修正                       | rate limit設定の環境差・未設定test                           |
| `backend/src/types/index.ts`                               | 修正                       | Hono Bindings/Variablesのrate limit型                        |
| `backend/src/middleware/rateLimit/policies.ts`             | 新規                       | policy値・failure modeの一元管理                             |
| `backend/src/middleware/rateLimit/key.ts`                  | 新規                       | IP/email/user keyのcanonicalize/HMAC                         |
| `backend/src/middleware/rateLimit/store.ts`                | 新規                       | store契約とdecision型                                        |
| `backend/src/middleware/rateLimit/in-memory-store.ts`      | 新規                       | development/test用fixed-window store                         |
| `backend/src/middleware/rateLimit/durable-object-store.ts` | 新規                       | DO binding adapter                                           |
| `backend/src/middleware/rateLimit/index.ts`                | 修正                       | 共通middleware、429/503、Retry-After                         |
| `backend/src/middleware/rateLimit/*.test.ts`               | 新規/修正                  | policy/key/store/middleware unit test                        |
| `backend/src/cloudflare/rate-limit-counter.ts`             | 新規（フェーズ12依存）     | SQLite-backed DO counter/RPC/alarm                           |
| `backend/src/cloudflare/rate-limit-counter.test.ts`        | 新規（フェーズ12依存）     | Workers poolで原子性・永続化・alarm test                     |
| `backend/src/app.ts`                                       | 修正                       | general limiterの配置、runtime依存注入                       |
| `backend/src/app.test.ts`                                  | 修正                       | health/OPTIONS除外、security/CORS/429順序                    |
| `backend/src/routes/auth/index.ts`                         | 修正                       | auth IP/email policyとmiddleware順序                         |
| `backend/src/routes/auth/*test.ts`                         | 修正                       | 429/503/validation順序integration                            |
| `backend/src/routes/users/index.ts`                        | 修正                       | password/deleteの条件付きIP/user policy                      |
| `backend/src/routes/users/*test.ts`                        | 修正                       | username非消費、password/delete制限                          |
| `backend/src/routes/game/index.ts`                         | 修正                       | questions、submit、GET bucket分離                            |
| `backend/src/routes/game/*test.ts`                         | 修正                       | IP/user独立bucket、GET非干渉                                 |
| `backend/src/test-setup.ts`                                | 修正                       | 全体mock依存を縮小し、専用integrationを可能にする            |
| `backend/vitest.config.ts`                                 | 必要時修正                 | Workers testとの分離                                         |
| `backend/wrangler.toml`または`backend/wrangler.jsonc`      | 新規候補（フェーズ12依存） | 現在は未作成。採用形式確定後にDO namespace/binding/migration |
| `backend/package.json`                                     | 必要時修正                 | Wrangler/Workers test依存とscript                            |
| `backend/package-lock.json`                                | 必要時修正                 | dependency追加時のみlock更新                                 |
| `backend/.env.example`                                     | 修正                       | store種別・HMAC secret名のplaceholder                        |
| `docker-compose.yml`                                       | 修正                       | local memory store設定、不要になった`TRUST_PROXY`の整理      |
| `frontend/src/lib/api/errors.test.ts`                      | 確認/必要時修正            | JSON/非JSON 429/503の保持                                    |
| `frontend/src/lib/api/game.test.ts`                        | 修正                       | submit 429/503/非JSON回帰                                    |
| `frontend/src/routes/login/+page.svelte`                   | 確認/必要時修正            | 429/503/network errorのalert表示                             |
| `frontend/src/routes/(app)/game/play/+page.svelte`         | 確認/必要時修正            | 再送信、aria-live、disabled回帰                              |
| `docs/02_security.md`                                      | 修正                       | 二層責務、policy/key、正式値                                 |
| `docs/04_api.md`                                           | 修正                       | 全対象の429/503/Retry-After                                  |
| `docs/10_dev_setup.md`                                     | 修正                       | local memory storeとsecret/runtime設定                       |
| `docs/11_deployment.md`                                    | 修正                       | WAF/DO/runbook/rollback/監視                                 |
| `docs/09_startup_commands.md`                              | 修正                       | Workers test、wrangler dev、手動rate limit確認コマンド       |
| `docs/05_progress.md`                                      | 修正                       | 実装中/完了と計画書リンク                                    |
| `docs/plans/api-rate-limit-production/plan.md`             | 修正                       | checkboxと実装完了記録                                       |

### 確認のみのファイル

| ファイル                                                                                                                  | 確認内容                                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `AGENTS.md`、`docs/07_testing_flow.md`、`docs/08_conventions.md`、`docs/13_codex_editing.md`                              | workflow、TDD、命名、編集方法。仕様変更がなければ変更しない                          |
| `docs/12_task_guide.md`                                                                                                   | 制限値とフェーズ番号の整合。矛盾が残る場合だけ変更候補へ移す                         |
| `backend/prisma/schema.prisma`、`backend/src/lib/prisma.ts`                                                               | 業務DBをstoreへ使わずschema変更不要であること                                        |
| `backend/src/middleware/auth/index.ts`、`backend/src/middleware/admin/index.ts`                                           | auth/user設定と認可順序。rate limitのために認証・認可を弱めない                      |
| `backend/src/routes/elements/index.ts`、`ranking/index.ts`、`weak/index.ts`、`admin/index.ts`                             | app-level general policyで覆われ、route個別定数を追加しないこと                      |
| `frontend/src/lib/api/*.ts`、`frontend/src/routes/login/+page.svelte`、`frontend/src/routes/(app)/game/play/+page.svelte` | 429日本語JSON、非JSON fallback、二重送信防止、A11Y。回帰失敗時だけ変更する           |
| `.github/workflows/batch.yml`                                                                                             | 既存batch workflowのみでdeploy workflowではないこと。rate limit taskで無断変更しない |

### リポジトリ外設定

| 対象                                     | 変更種別               | 内容                                                                      |
| ---------------------------------------- | ---------------------- | ------------------------------------------------------------------------- |
| Cloudflare zone WAF Rate Limiting Rules  | 新規/修正              | planに応じたgeneral/auth/game rule、順序、action、mitigation、staging確認 |
| Workers DO namespace/binding/migration   | 新規（フェーズ12依存） | staging/production分離、SQLite-backed class、binding                      |
| Wrangler Secret                          | 新規                   | `RATE_LIMIT_KEY_SECRET`。値は計画・ログ・PRへ記録しない                   |
| Workers custom domain/route              | 確認/必要時新規        | zone WAFを通る本番hostnameの確保。Workers移行全体はフェーズ12範囲         |
| Cloudflare Observability/Security Events | 設定                   | 429、DO error、WAF blockを観測し通知条件を定義                            |

## DB変更方針

- `backend/prisma/schema.prisma`とmigrationは変更しない。
- rate limit状態をUser等へrelationで追加しない。
- rate limit判定はPrisma queryを追加しないため、業務DBのindex、N+1、unique、nullable、cascade、relation、既存データへ影響しない。`User.email @unique`の大小文字semanticsも本タスクでは変更しない。
- PostgreSQL tableをstoreへ流用しないため、API requestごとのDB write、TTL cleanup query、index肥大化、connection pool枯渇を発生させない。
- DO stateは業務DBバックアップ/Prisma migrateの対象外であり、消失しても認証・ゲームデータは失わない。
- DO class追加時のWrangler migrationはCloudflare state migrationであり、Prisma migrationとは分離して記録する。
- rollbackでDO namespaceを即削除せず、旧Workerへ戻した後にtrafficがないことを確認してからcleanupする。
- 実装中にPostgreSQL利用へ変更する必要が生じた場合は、本計画を再レビューし、負荷試験、index、TTL cleanup、migration、rollback、Playwrightを追加する。

## UI / A11Y方針

- 新規画面と専用countdownは作らない。
- backendの具体的日本語messageを上書きしない。
- 非JSON/edge/network errorは既存default messageを使う。
- loginは`role="alert"`、game submit errorは`role="alert"`/assertive、loadingは`aria-busy`を維持する。
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
| memory/DO | window境界直前/直後                    | fixed-windowの境界burst特性を仕様どおり再現                  |
| memory/DO | 大量並行consume                        | success件数がlimitを超えない                                 |
| memory/DO | restart/別isolate相当                  | 同じkeyのcountを共有                                         |
| memory/DO | alarm                                  | reset後stateが削除される                                     |
| memory/DO | timeout/接続失敗                       | policy別fail-open/fail-closedになりraw errorを返さない       |
| memory/DO | 同一段階でallow/limited/error混在      | 全bucketを試行し、503優先または最大Retry-Afterで集約         |
| key       | 同一emailの大小文字                    | 同じdigest                                                   |
| key       | 前後空白                               | validated/canonical値から同じdigest。未検証bodyは使わない    |
| key       | 空/null/undefined                      | key欠損として扱い、`unknown`へ集約しない                     |
| key       | 異なるpolicy                           | 同じactorでも異なるdigest/bucket                             |
| key       | raw PII                                | store/log/responseにIP/email/userIdを残さない                |
| IP        | production CF header                   | 単一の有効IPを採用                                           |
| IP        | spoofed XFF                            | production keyに使わない                                     |
| IP        | IPv4/IPv6                              | IPv4は正規address、IPv6は同一/64が同じdigest                 |
| IP        | IPv4-mapped IPv6                       | 1つの共通ルールで正規化される                                |
| IP        | 欠損/不正                              | generalはfail-open、specializedは503                         |
| IP        | 偽装XFF/x-real-ip                      | production resolverは無視する                                |
| IP        | 信頼できるCF-Connecting-IP             | Workers adapter経由で採用し、値を検証する                    |
| general   | elements/ranking/weak/admin/users/game | 60/分/IPを共通適用                                           |
| general   | `/`, health, OPTIONS                   | countせず正常応答、preflight header維持                      |
| auth      | register/login/forgot/reset IP         | 10/10分、11回目429                                           |
| auth      | login/register/forgot同一email         | 操作ごとに独立したemail bucketを消費し、別操作をlockしない   |
| auth      | invalid JSON/email                     | IP bucketは消費、email bucketは消費しない                    |
| auth      | verify/refresh/logout                  | generalのみ、auth-specialized非消費                          |
| auth      | register/login/forgot/reset各route     | 各endpointで11回目が429になり日本語body/headerが一致         |
| account   | username変更                           | account bucketを消費しない                                   |
| account   | password変更                           | IP/user双方を消費し、片方超過でも429                         |
| account   | delete                                 | IP/user双方、invalid bodyもIP/user試行としてcount            |
| account   | password branchのinvalid JSON          | generalのみ消費し、未分類payloadはaccount bucketを使わない   |
| game      | GET questions                          | IP 30/分を維持し、user bucketは追加しない                    |
| game      | POST sessions                          | IP/user 20/分、片方超過でも429                               |
| game      | 同じIPから複数user                     | 共有IP bucketと独立user bucketの双方が効く                   |
| game      | 同じuserが複数IP                       | user bucketが共有され、IP切替で上限回避できない              |
| game      | 未認証submit                           | general/game IPは消費、user bucketは未消費、401または先行429 |
| game      | 不正token submit                       | general/game IPは消費、user bucketは未消費                   |
| game      | 認証済みvalidation error               | general/game IP/userを消費し、handler/DBへ到達しない         |
| game      | GET detail/history                     | POST bucketを消費しない                                      |
| route     | GET/POST/DELETEの一般API               | methodに関係なく分類表どおりgeneralを消費                    |
| route     | admin API                              | auth/admin認可を維持したままgeneralを消費                    |
| route     | unknown `/api/v1/*`                    | generalを消費した後に既存404 JSON                            |
| response  | Hono 429                               | 日本語JSON、Retry-After整数、security/CORS header            |
| response  | store failure sensitive                | 503、日本語JSON、Retry-After 60、handler未実行               |
| response  | store failure general                  | request継続、固定event、raw error/PIIなし                    |
| response  | 個人情報を含まないlog                  | email/IP/userId/digest/token/Cookie/bodyを出力しない         |
| frontend  | JSON 429/503                           | backend messageを画面内alertへ保持                           |
| frontend  | 非JSON429/502/504                      | default message、crashなし                                   |
| frontend  | CORS/network error                     | network fallback、再試行可能                                 |
| A11Y      | login/game keyboard                    | 送信、retry、戻るがkeyboardだけで完結                        |
| A11Y      | loading/error                          | `aria-busy`/live region/alertで認識可能                      |
| A11Y      | 送信中の連打/Enter                     | 二重送信せずbutton disabledと状態文言を維持                  |
| WAF       | threshold未満/超過                     | 超過時edge block、origin到達減少                             |
| WAF       | Hono 429との差                         | edgeは非JSON/CORSなしを許容、Honoは日本語JSON/Retry-After    |
| WAF       | zone/hostname経路                      | 実公開hostnameが対象WAF ruleを必ず通る                       |
| WAF       | false positive                         | 正常ゲーム/ログイン導線がedgeで遮断されない                  |
| quality   | backend quality                        | lint、format:check、全test、buildが成功                      |
| quality   | frontend回帰                           | 変更時のみlint、format、test、checkが成功                    |
| quality   | Docker local                           | memory storeで主要routeと429を再現                           |

## リリース・移行方針

1. `docs/05_progress.md`を`[-]`へ更新する。
2. policy/key/memory store/middlewareをdependency injectionで先行実装する。production無効化flagやmemory fallbackは作らない。
3. route integrationとfrontend回帰を完了する。
4. フェーズ12のWorkers entrypointを取り込み、staging DO namespace/migration/bindingを作る。
5. stagingでHono limiterを有効化し、WAFはdraft→安全な高閾値→計画値の順で適用する。
6. 正常導線、429、503、DO alarm、Security Eventsを確認する。
7. Security Eventsとorigin到達を確認し、WAFを計画値のblockへ切り替える。
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
| IPv6 privacy addressでIP回避 | IP bucket分散                | HonoはIPv6 /64へ集約し、user/email独立bucketも使う           |
| clientによるIP header偽装    | bucketを分散して回避         | productionはCF-Connecting-IPのみ、公開経路と値を検証         |
| HMAC secret漏えい            | actor辞書攻撃補助            | Wrangler Secret、log禁止、JWT secretと分離                   |
| emailによる存在推測          | 特定accountの有無を推測      | operation scope付きHMAC、同一429、forgot既存200契約を維持    |
| raw email/IPの漏えい         | 個人情報漏えい               | HMAC化、store/log/metricsへraw値・digestを出さない           |
| DO hot key                   | 特定actorへの集中でlatency増 | actor+policyごとにobject分散、global singleton禁止           |
| DO storage/cost増            | 高cardinality攻撃            | alarm cleanup、監視、WAF先行遮断                             |
| alarm/TTL cleanup漏れ        | storageと費用が増え続ける    | reset alarm、request時期限判定、staging cleanup確認          |
| 非原子的read-modify-write    | 同時requestが上限を突破      | DO serialized transactionと並行test                          |
| edge/Hono二重遮断            | frontendが非JSONedge error   | edge閾値を2倍目安、Honoを通常契約とする                      |
| store outage                 | sensitive API停止            | 503/Retry-After、general fail-open、WAF維持                  |
| game middleware順序の誤り    | 未認証防御低下・認証回避     | IP→auth→user→Zodをintegration testで固定                     |
| 一般制限が通常gameを阻害     | 問題取得/送信/履歴が429      | staging実測、一般60/分、questions既存30/分を回帰確認         |
| WAF plan/hostname不一致      | edge防御が未適用             | zone/plan/hostnameの実HTTP release gate                      |
| Dashboard設定drift           | 文書と本番値が乖離           | rule全項目・設定者・日付をrunbookへ記録し定期照合            |
| edge非JSON 429               | frontendが具体messageを失う  | 共通fallbackとrole=alert、custom JSONはPro以上で任意         |
| global test mock継続         | wiring regression            | 専用real-middleware integrationを必須化                      |
| Workers基盤PR競合            | wrangler/entrypoint二重変更  | フェーズ12依存を明示しPR順序を固定                           |
| Workers未整備で完了不能      | 進捗の誤完了                 | app先行完了と本番適用完了を分け、実機前は`[x]`にしない       |
| 値だけ変更しdocs不一致       | 運用判断不能                 | policyをsingle sourceにしdocs/testを同時更新                 |

## 作業手順・タスクリスト

実装開始時にAGENTS.mdのタスクリストレビューを次の順で記録する。

1. v1: 文書、全route、middleware、frontend、Cloudflare、フェーズ12依存からsubtaskを列挙する。
2. v2: error、型、入力検証、認証・認可、PII、複数bucket、fail modeをレビューする。
3. v3: 既存実装、DB非変更、テスト、Cloudflare plan/費用、説明と値の整合をレビューする。
4. v4: scope creepを除き、以下の表を確定する。表はPR本文へタブ区切りでも転記する。

| ID  | 内容                                   | 対象ファイル                                                              | 完了条件                                                 | 優先度 |
| --- | -------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- | ------ |
| T1  | 仕様・全route・Cloudflare planを再確認 | docs、routes、Cloudflare account                                          | 事実/未確認、正式値、rule枠、依存PRを確定                | High   |
| T2  | 進捗を実装中へ更新                     | `docs/05_progress.md`                                                     | 対象が`[-]`、plan linkあり                               | Medium |
| T3  | API/security/dev/deploy契約を先に更新  | `docs/02_security.md`, `04_api.md`, `10_dev_setup.md`, `11_deployment.md` | policy、429/503、二層責務、local設定、runbookが一致      | High   |
| T4  | policy/config testをRed化              | config/policy test                                                        | 全limit/window/failure mode、production必須値が失敗      | High   |
| T5  | policy/configを実装                    | config、`policies.ts`                                                     | 重複定数がなくtest通過                                   | High   |
| T6  | key/resolver testをRed化               | `key.test.ts`                                                             | HMAC、email、IPv4/6、XFF無視、欠損を網羅                 | High   |
| T7  | key/resolverを実装                     | `key.ts`                                                                  | raw PIIを保持せずtest通過                                | High   |
| T8  | memory store/middleware testをRed化    | rateLimit tests                                                           | boundary、複数bucket、Retry-After、fail modeを網羅       | High   |
| T9  | store契約/memory/middlewareを実装      | rateLimit配下                                                             | Node testが通り、production暗黙memory fallbackなし       | High   |
| T10 | app/route integrationをRed化           | app/auth/users/game tests                                                 | general、email/user、順序、GET非干渉を検出               | High   |
| T11 | app/auth/users/gameへ配線              | app/routes                                                                | policy matrixどおり、旧重複定義削除                      | High   |
| T12 | frontend回帰testを追加                 | errors/game/login関連                                                     | JSON/非JSON/networkを検証し、実装変更は失敗時のみ        | Medium |
| T13 | DO testをRed化                         | Cloudflare test config/DO test                                            | 並行性、永続化、alarm、別instance相当が失敗              | High   |
| T14 | SQLite-backed DO/store adapterを実装   | cloudflare/adapter/wrangler                                               | Workers runtime test通過                                 | High   |
| T15 | staging WAF/DOを適用                   | Cloudflare設定、`docs/11_deployment.md`                                   | draft→高閾値→計画値、正常/429/503を実HTTP確認            | High   |
| T16 | format/lint/test/build                 | backend/frontend                                                          | backend全通過、frontend変更時のみfrontend全通過          | High   |
| T17 | 手動A11Y・主要導線確認                 | login/game/一般API                                                        | keyboard、live region、false positiveなし                | High   |
| T18 | production deploy/監視/rollback確認    | Cloudflare/runbook                                                        | metrics正常、rollback手順確認                            | High   |
| T19 | plan/progress実装完了更新              | docs                                                                      | 実変更表、判断差分、PR、結果、`[x]`                      | Medium |
| T20 | 変更種別ごとにcommit分割               | git                                                                       | dependency/config、backend、frontend、docsを混在させない | Medium |
| T21 | pushして詳細PRを作成                   | GitHub                                                                    | TDD記録、test表、Cloudflare手作業、フェーズ12依存を記載  | Medium |

- [ ] T1: 仕様・全route・Cloudflare planを再確認する
- [x] T2: `docs/05_progress.md`を実装中へ更新する
- [x] T3: API/security/dev/deploy契約を先に更新する
- [x] T4: policy/config testをRed化する
- [x] T5: policy/configを実装する
- [x] T6: key/resolver testをRed化する
- [x] T7: key/resolverを実装する
- [x] T8: memory store/middleware testをRed化する
- [x] T9: store契約/memory/middlewareを実装する
- [x] T10: app/route integrationをRed化する
- [x] T11: app/auth/users/gameへ配線する
- [x] T12: frontend回帰testを追加する
- [ ] T13: Durable Object testをRed化する
- [ ] T14: SQLite-backed Durable Object/store adapterを実装する
- [ ] T15: staging WAF/DOを適用する
- [x] T16: format/lint/test/buildを通す
- [ ] T17: 手動A11Y・主要導線を確認する
- [ ] T18: production deploy/監視/rollbackを確認する
- [ ] T19: plan/progressを実装完了へ更新する
- [x] T20: 変更種別ごとにcommitを分割する
- [ ] T21: pushして詳細PRを作成する

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

## Hono・フロントエンド先行実装完了

- 記録日: 2026-07-12
- 実装ブランチ: `feature/api-rate-limit-production`
- PR: 未作成（ユーザー指示によりチャット確認まで作成しない）
- 全体ステータス: 実装中。本番Durable Object・WAF・実機確認前のため完了扱いにしない

### 完了範囲

- 8 policyの値・failure modeとproduction必須env validation
- email/IP/userの正規化とHMAC-SHA-256 key生成
- development/test用fixed-window in-memory store
- 複数bucket評価、429、fail-open/fail-closed 503を扱うHono middleware
- 一般API、認証、ゲーム、アカウント操作への順序付きroute配線
- JSON・非JSON・network errorのフロントエンド回帰テスト
- Node開発環境のmemory storeとsocket IP resolver

### TDD記録

- Red: policy/config、key/IP、memory store/middleware、app/route integrationの順に失敗を確認した。app integrationは10件すべてRedから開始した。
- Green: backendのレート制限・影響route 190件を通し、最終的に全546件を通した（実DB専用1件は既存条件によりskip）。
- Frontend regression: 429/503 JSON、非JSON 429、network errorを9件追加し、既存実装のままGreenだったため製品コードは変更しなかった。全457件を通した。
- Refactor: policy、設定、key生成、validated JSON型境界、store factoryを共通化し、route内の数値・IP header処理・手動middleware実行を削除した。

### 計画からの変更点

- 既存テストがimportするrouter定数を維持するため、router factory化ではなくapp単位の依存をHono contextへ注入した。module-global counterは使用していない。
- Node entrypointはdevelopment用memory storeだけを構築し、`durable-object`指定時は起動を拒否する。Workers専用entrypointはフェーズ12へ引き継ぐ。
- IP正規化には自作パーサーを増やさず、MIT・runtime依存なしの`ipaddr.js`を採用した。
- Workers基盤が存在しないため、T13〜T15をこのブランチで推測実装せず、依存PR後の別PRへ分離する。

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
| --- | --- | --- |
| `backend/package.json`, `backend/package-lock.json` | 修正 | `ipaddr.js`依存を追加 |
| `backend/.env.example`, `docker-compose.yml` | 修正 | development用rate limit設定を追加し`TRUST_PROXY`を廃止 |
| `backend/src/lib/config.ts`, `config.test.ts` | 修正 | store・HMAC secretの環境別検証 |
| `backend/src/middleware/rateLimit/policies.ts`, `policies.test.ts` | 新規 | policyのsingle sourceと契約test |
| `backend/src/middleware/rateLimit/key.ts`, `key.test.ts` | 新規 | actor正規化、IP信頼境界、HMAC key |
| `backend/src/middleware/rateLimit/store.ts` | 新規 | store・bucket・依存注入契約 |
| `backend/src/middleware/rateLimit/in-memory-store.ts`, `in-memory-store.test.ts` | 新規 | development/test用fixed-window store |
| `backend/src/middleware/rateLimit/buckets.ts` | 新規 | IP/email/user bucket resolver |
| `backend/src/middleware/rateLimit/index.ts`, `rateLimit.test.ts` | 修正 | 複数bucket・429/503・failure mode |
| `backend/src/app.ts`, `app.test.ts`, `app.rate-limit.test.ts` | 修正・新規 | app依存注入、general policy、実middleware統合test |
| `backend/src/index.ts`, `backend/src/types/index.ts` | 修正 | Node store/IP resolverとHono context型 |
| `backend/src/routes/auth/index.ts` | 修正 | IP・操作別email policyを配線 |
| `backend/src/routes/game/index.ts` | 修正 | questionsとsubmit IP/user policyを配線 |
| `backend/src/routes/users/index.ts` | 修正 | password変更・退会のIP/user policyを配線 |
| `frontend/src/lib/api/errors.test.ts`, `game.test.ts` | 修正 | JSON・非JSON・network回帰test |
| `frontend/src/routes/login/login-page.test.ts` | 修正 | 429/networkの`role=alert`表示test |
| `docs/02_security.md`, `04_api.md`, `05_progress.md` | 修正 | security/API/進捗契約を更新 |
| `docs/10_dev_setup.md`, `11_deployment.md` | 修正 | local設定、本番二層防御、フェーズ12引き継ぎ |
| `docs/plans/api-rate-limit-production/plan.md` | 修正 | task実績と先行実装記録を更新 |

### 検証結果

- Backend: format、lint、format check、build成功。57 test files / 546 tests成功、実DB専用1 testは既存条件によりskip。
- Frontend: format、lint、Svelte check成功。42 test files / 457 tests成功。
- Workers runtime test: 未実施（Workers test基盤未実装）。
- staging/production、WAF、A11Y、監視、rollback: 未実施。T13〜T15・T17〜T19としてフェーズ12基盤後に行う。

### フェーズ12引き継ぎ

1. Workers専用entrypoint、Cloudflare Prisma adapter、Wrangler設定を先に実装する。
2. SQLite-backed Durable ObjectとWorkers runtime testをT13・T14として実装する。
3. staging/productionでnamespace、migration、binding、secretを分離する。
4. 実公開hostnameとCloudflare planを確認し、WAF ruleをstagingの高閾値から段階適用する。
5. 実HTTP、A11Y、監視、rollback確認後にT1・T13〜T19を完了し、`docs/05_progress.md`を`[x]`へ更新する。

## 手動確認項目

- [ ] root/health/OPTIONSがrate limit対象外で、preflightが成功する
- [ ] elements/ranking/weak/users/admin/game GETが一般制限対象になる
- [ ] auth 11回目、game submit 21回目でHono 429と`Retry-After`
- [ ] game questions 31回目で既存30回/分/IPの429になり、user bucketは追加されていない
- [ ] 同じIPの別user、同じuserの別IPで独立bucketが期待どおり動く
- [ ] game detail/historyがsubmit枠を消費しない
- [ ] username変更がaccount枠を消費しない
- [ ] login/register/forgotの同一emailが操作別target bucketになり、別操作をlockしない
- [ ] XFFを変更してもproduction bucketを回避できない
- [ ] IPv6 privacy addressを同一/64内で変更してもHono bucketを回避できない
- [ ] Hono 429にsecurity/CORS headerが付く
- [ ] edge blockがHono到達前に作動し、通常操作を遮断しない
- [ ] 実公開hostnameが対象Cloudflare zoneのWAF ruleを通り、Workers direct/bypass経路がない
- [ ] login/gameのJSON 429、edge非JSON/network errorが画面内に表示される
- [ ] keyboardだけでlogin、game retry、戻る操作が完結する
- [ ] loading/errorがscreen readerで認識可能で、色だけに依存しない
- [ ] log/DO storage/Cloudflare eventにraw IP/email/userId/digest/token/Cookie/Authorization/bodyがない
- [ ] DO障害時にgeneralとsensitiveのfailure modeが分かれる
- [ ] DO request/alarm/storage利用量が想定と合い、Free/Paid閾値とalertが設定されている
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
