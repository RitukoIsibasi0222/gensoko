# R5 production認証・refresh構成 実装計画

> 設計者ロール: シニアフルスタックエンジニア / セキュリティエンジニア / リリースマネージャー

## 概要

Release Task R5「認証・refreshのproduction構成を確定する」では、Vercel frontendとCloudflare Workers APIをCookie上のsame-site、HTTPS上のcross-originとして配備し、`HttpOnly`・`Secure`・`SameSite=Strict`を維持したままlogin、full reload後のrefresh、rotation、logout、旧token拒否を成立させる。

本計画は、コード変更、外部設定、production deploy、production smokeを明確に分離する。実装PRではproduction resource・DNS・Secret・DBへ触れず、review済みコードと非秘密の設定契約だけを作る。R5はコードがmergeされただけでは完了にせず、R14のpreflight、R15の承認付きdeploy、R16のproduction smokeから必要な証拠が揃った時点で完了へ更新する。

## 現状と確認済み事実

調査基点は2026-07-22の`develop`、commit `873bf04`である。PR #134のR9日次backup実装はmerge済みであり、R9は日次schedule 2回と未失効Artifact 2世代の観測待ちである。

| 領域               | 確認済み事実                                                                                        | R5への影響                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| staging hostname   | frontendは`vercel.app`、APIは`workers.dev`でcross-site                                              | stagingのSPA成功をfull reload後refreshの証拠にできない            |
| Cookie             | `refreshToken`は`HttpOnly`、`SameSite=Strict`、`Path=/api/v1/auth`相当、7日。productionでは`Secure` | 属性は弱めず、production hostnameをsame-siteにする                |
| CORS               | `FRONTEND_URL`の単一origin、credentials有効、`Content-Type`・`Authorization`を許可                  | production frontendの完全一致originだけを設定する                 |
| frontend           | login・refresh・logoutは`credentials: "include"`。refreshはbrowser初期化で実行                      | SSRでrefreshせず、hydration後のbrowser初期化を正本にする          |
| frontend競合       | `authStore.refresh()`は先行refreshをabortする。管理画面だけが独自single-flightを持つ                | token rotationと同時401を全画面共通のsingle-flightへ統合する      |
| refresh API        | raw tokenをSHA-256で検索し、旧row削除と新row作成を同一transactionで実行                             | 単回使用は実装済み。winner/loserとCookie上書き競合を追加検証する  |
| logout             | Cookieを両Pathで削除し、DB tokenをhash指定で`deleteMany`する                                        | 成功後のrefresh 401と旧token拒否をproductionで確認する            |
| Workers            | runtime validatorは`staging`/`production`両targetを扱える                                           | production専用binding・targetの基礎はある                         |
| Workers entrypoint | `src/worker.ts`は`expectedTarget: "staging"`に固定                                                  | 現状のままproduction deployしてはならない                         |
| Wrangler           | `wrangler.jsonc`は`env.staging`だけを持つ                                                           | production env、custom domain、別DO/Hyperdrive、dry-run契約が必要 |
| Vercel             | `develop` PreviewだけをbuildするIgnored Build Stepを運用                                            | `main` production branchとProduction scopeの契約追加が必要        |
| frontend URL       | `VITE_API_BASE_URL`は`/api/v1`を含むHTTPS URLをbuild時検証                                          | production API originとの対応をpreflightで照合する                |
| backend URL        | production `FRONTEND_URL`はHTTPS origin形式をfail-fast検証                                          | Vercel production originと完全一致させる                          |
| DB                 | `RefreshToken.tokenHash`は主キー、`userId` indexとcascadeあり                                       | token lookup、user単位revoke、rotationに必要なindexはある         |
| DB cleanup         | `expiresAt` indexと期限切れrefresh token cleanupがない                                              | productionでrowが無制限に残るため追加設計が必要                   |
| 文書               | `docs/02_security.md`と`docs/11_deployment.md`後半に旧token方式・旧platform記述が残る               | 実装時に現行Hono/Vercel/Workers契約へ同期する                     |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`backend/src/lib/config.ts`**

- `getFrontendUrl(options): string` — productionでHTTPSを含む単一HTTP(S) originを必須化する。
- `getRateLimitConfig(options): RateLimitConfig` — productionでDurable Object storeを必須化する。

**`backend/src/lib/worker-config.ts`**

- `getWorkerRuntimeConfig({ expectedTarget, environment }): WorkerRuntimeConfig` — deployment、DB、CORS、JWT、rate limit、mail、bindingを値非表示で検証する。

**`backend/src/lib/refresh-token-cookie.ts`**

- `getRefreshTokenCookieBasePath(path): string` — auth Cookieのbase pathを求める。
- `getRefreshTokenCookieOptions(secure, path)` — `HttpOnly`・`Secure`・`SameSite=Strict`・7日を返す。
- `clearRefreshTokenCookies(context, requestPath): void` — 現行Pathとlegacy Pathを削除する。

**`backend/src/services/auth.service.ts`**

- `login(input): Promise<LoginResult>` — 15分access tokenと7日refresh tokenを発行する。
- `refreshAccessToken(rawToken): Promise<RefreshResult>` — refresh tokenを単回使用でrotationする。
- `logout(rawToken): Promise<void>` — hash一致refresh tokenを削除する。

**`frontend/src/lib/stores/auth.svelte.ts`**

- `initialize(): Promise<void>` — browserで保存状態を読み、refreshを試行する。
- `refresh(): Promise<boolean>` — Cookieを送ってaccess tokenを更新する。
- `login(user, accessToken): void` / `logout(): Promise<void>` — local stateとserver tokenを更新する。

**`frontend/src/lib/api/config.ts`**

- `API_BASE_URL: string` — `VITE_API_BASE_URL`の唯一のruntime参照点。

### release task依存

| task | R5との関係                                                                    |
| ---- | ----------------------------------------------------------------------------- |
| R7   | R5で確定したproduction API hostnameをWAF/DO実環境gateに使う                   |
| R8   | R5の完全一致CORS、Cookie、safe error、非秘密logを横断確認する                 |
| R9   | schedule観測待ちとR5のコード・計画作業は別branchで並行できる                  |
| R11A | 依存調査は並行可能。package更新はR5構成確定後を基本とする                     |
| R11  | R5・R9・R11Aを含むrelease候補SHAで最終品質gateを実行する                      |
| R12  | stagingは回帰確認に使うが、cross-siteのためproduction refresh証拠を代替しない |
| R14  | hostname、DNS、Environment、binding、rollback先を値非表示でpreflightする      |
| R15  | review済みrelease候補を承認付きでproductionへdeployする                       |
| R16  | 本計画のproduction auth smokeを実行しR5の実環境証拠を確定する                 |

### 重要な制約

- `SameSite=Lax`または`SameSite=None`へ変更しない。
- Cookie、token、Authorization、password、Secret、DB URL、raw errorをlog、Artifact、trace、screenshot、文書、PRへ記録しない。
- stagingとproductionでURL、Secret、Vercel scope、Worker、DO namespace、Hyperdrive、DB、mail設定を共用しない。
- production deploy、Environment変更、custom domain、DNS、Secret操作、production DB query/migrationは本計画PRで実行しない。
- production hostnameは所有状況を確認するまで具体値を推測しない。
- API/DB/frontendの片側だけを非互換状態で先行公開しない。

## 対象外

- `SameSite=None`前提のthird-party Cookie対応
- OAuth/OIDC、複数identity provider、長期session管理の新規導入
- access tokenをCookieへ移す認証方式の全面変更
- 共通HTTP clientへの全API移行。R5では401→refresh→1回retryの認証coordinationだけを共通化する
- package更新。R11Aで別PRとする
- productionの自動deploy。R15までは手動承認gateを維持する
- production DBの実行、migration、cleanup。コードとrunbookを作り、実行は別承認にする

## 実装前の意思決定gate

custom domainの所有状況とproduction hostnameはrepositoryから確認できない。次をプロダクトオーナー兼domain管理者が承認し、値は公開hostnameだけを記録する。未決の間はproduction configを確定、deploy、R5完了としてはならない。

| Gate | 確認事項                   | 候補                                   | 推奨                                            | 判断者                 | 未決時                            |
| ---- | -------------------------- | -------------------------------------- | ----------------------------------------------- | ---------------------- | --------------------------------- |
| G1   | 所有済みregistrable domain | 所有済みdomain / 新規取得              | 所有・更新責任が明確な1 domain                  | プロダクトオーナー     | 実装はfixture値まで、外部設定停止 |
| G2   | frontend hostname          | apex / `www` / `app`                   | apexまたは`www`の1 canonical origin             | domain管理者           | `FRONTEND_URL`を設定しない        |
| G3   | API hostname               | `api.<domain>`                         | frontendと同じscheme・registrable domainの`api` | domain管理者           | Worker custom domainを作らない    |
| G4   | Vercel production branch   | `main` / release branch                | release戦略と一致する`main`                     | release manager        | Production deployを作らない       |
| G5   | Cloudflare zone・routing   | Custom Domain / Route                  | WorkerがoriginのためCustom Domain               | infra owner            | DNS/routeを変更しない             |
| G6   | `workers.dev`公開          | 有効 / 無効                            | productionは無効、custom domainだけ公開         | security owner         | WAF迂回確認を合格にしない         |
| G7   | production smoke account   | 専用account / 公開登録で都度作成       | 削除・rotationを安全に反復できる専用account     | product/security owner | auth smokeを開始しない            |
| G8   | rollback先                 | API version、Vercel deployment、schema | 互換性matrix付き直前正常version                 | release manager        | deployしない                      |

Gate記録形式:

```text
確認日: YYYY-MM-DD
確認者: <GitHub user等の非秘密識別子>
frontend origin: https://<approved-host>
API origin: https://<approved-api-host>
registrable domain一致: yes/no
Vercel production branch: main
Worker routing: custom domain
workers.dev production公開: disabled
rollback API version / frontend deployment ID: <非秘密metadata>
Secret値・Cookie値・token値: 記録禁止
```

## production hostname候補比較

| 案                          | 例                                          | Cookie site                                | CORS                   | 運用                                         | 判断                   |
| --------------------------- | ------------------------------------------- | ------------------------------------------ | ---------------------- | -------------------------------------------- | ---------------------- |
| A. 兄弟custom hostname      | `https://<domain>` + `https://api.<domain>` | HTTPSかつregistrable domain一致でsame-site | cross-originのため必要 | Vercel/Workersの責務が明確                   | **推奨**               |
| B. 同一origin reverse proxy | `https://<domain>` + `/api/v1`              | same-origin                                | 原則不要               | proxy、cache、障害、version couplingが増える | 将来候補。R5では不採用 |
| C. provider発行domain       | `vercel.app` + `workers.dev`                | cross-site                                 | 必要                   | `Strict` Cookieが送られない                  | 不採用                 |
| D. 異なる独自domain         | `example-a` + `example-b`                   | cross-site                                 | 必要                   | `None`への弱体化が必要                       | 不採用                 |

案Aではoriginは異なるがsiteは同じである。site判定はschemeとregistrable domainに基づくため、frontend/APIの両方をHTTPSに固定し、同じregistrable domain配下に置く。APIが発行するCookieはDomain属性を省略したhost-only Cookieとし、frontend hostnameや他のsubdomainへCookie自体を配布しない。

## 推奨構成と根拠

```text
Browser
  ├─ document/navigation → https://<frontend-host>     (Vercel Production / main)
  └─ fetch credentials   → https://api.<domain>/api/v1 (Cloudflare Worker production)
                              ├─ host-only refresh Cookie
                              ├─ exact FRONTEND_URL CORS
                              ├─ production-only DO / Hyperdrive / Secrets
                              └─ production DB
```

| 設定           | production契約                                                                            |
| -------------- | ----------------------------------------------------------------------------------------- |
| frontend       | `https://<approved-frontend-host>`の1 canonical origin                                    |
| API            | `https://<approved-api-host>/api/v1`                                                      |
| Cookie         | host-only、`Path=/api/v1/auth`、`HttpOnly`、`Secure`、`SameSite=Strict`、`Max-Age=604800` |
| frontend fetch | login、refresh、logoutは`credentials: "include"`                                          |
| CORS           | `Access-Control-Allow-Origin: <exact frontend origin>`、credentials true、wildcardなし    |
| Vercel         | Production scope、production branch `main`、production専用`VITE_API_BASE_URL`             |
| Workers        | `env.production`、production専用name、custom domain、`workers_dev: false`                 |
| resources      | production専用DO namespace、Hyperdrive、DB、mail、Secret                                  |

根拠:

- MDNは、`SameSite=Strict` Cookieをsame-site requestだけへ送ること、siteがschemeとregistrable domainで決まることを説明している。[Using HTTP cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies)
- Domain省略時はhost-onlyとなり、他subdomainへ広がらない。[Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- cross-originでCookieを送受信するfetchは`credentials: "include"`が必要で、serverは明示originとcredentialsを返し、`*`を使えない。[Using Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)、[CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)
- Vercel custom domainは通常production deploymentへ向き、production branchのcommitがproduction deploymentになる。[Working with domains](https://vercel.com/docs/domains/working-with-domains)、[Deploying Git Repositories](https://vercel.com/docs/git)
- Cloudflare Workers Custom DomainはWorkerをoriginとしてDNS recordと証明書を管理できる。Wrangler environmentのbinding・vars・routeは環境ごとに分離する。[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)、[Environments](https://developers.cloudflare.com/workers/wrangler/environments/)

## 設計上の決定事項

1. **production frontend/APIをどのhostname構成にするか**
   - 選択: G1〜G3で承認した同一registrable domain配下の兄弟hostname。
   - 根拠: provider発行domainを跨がず`SameSite=Strict`を維持できる。

2. **Cookie上のsame-siteが成立する根拠は何か**
   - 選択: 両originをHTTPSに固定し、registrable domainが一致する証拠をpreflightへ残す。
   - 根拠: schemeful siteのschemeとregistrable domainが一致する。

3. **frontendとAPIのoriginが異なる場合のCORS設定**
   - 選択: `FRONTEND_URL`の完全一致1 originだけを許可し、credentials true、method/headerを明示する。
   - 根拠: credentialed CORSでwildcardは利用できない。

4. **CookieのDomain属性を設定するか**
   - 選択: 設定せずhost-onlyを維持する。
   - 根拠: refresh endpoint以外のhostへCookieを広げず、subdomainによるsession fixation面を縮小する。

5. **Cookie属性**
   - 選択: `Path=/api/v1/auth`、`Secure`、`HttpOnly`、`SameSite=Strict`、`Max-Age=604800`、Domainなし。
   - legacy `Path=/api/v1/auth/refresh`は発行せず、login/refresh/logoutで削除だけ継続する。

6. **refresh endpointのcredentials**
   - 選択: browser fetchで`credentials: "include"`を明示する。tokenをbody、query、Authorizationへ複製しない。

7. **SSRとbrowser初期化のどちらでrefreshするか**
   - 選択: hydration後のbrowser初期化だけでrefreshする。
   - 根拠: API host-only CookieはVercel SSR requestへ渡らず、SSR proxyを新設するとCookie境界と障害点が増える。SSRは`initializing`の非認証表示を返す。

8. **同時refresh、rotation競合、二重送信**
   - 選択: `authStore`に同一tab single-flightを実装し、browser間はWeb Locks等の同一origin lockを使える場合は直列化する。APIは旧hash削除count=1をwinner条件とし、loserは新tokenを発行しない。
   - loser responseがwinnerの新Cookieを削除しないよう、競合errorとCookie削除条件をtestで固定する。401後retryは1回だけで、書き込みAPIも認証middlewareで拒否された場合に限る。

9. **refresh失敗時のauth state**
   - 401/403、invalid response: access token、user、storageをclearしてanonymousにする。
   - network、非JSON 502/504、500/503: stale access tokenを利用不能にし、`unavailable`相当のfail-closed stateと`role=alert`を表示する。認証失敗と通信障害を混同せず、明示retryで再初期化できるようにする。

10. **logout後の旧refresh token拒否**
    - 選択: DB hash row削除成功後に204、Cookieは現行/legacy両Pathで削除。logout後refreshは401。
    - DB削除が失敗した場合は500を返し、clientはlocal stateをclearするがserver revoke未確認として運用errorを検知する。

11. **frontend/APIの片側だけをdeployした場合の互換性**
    - 選択: refresh response拡張は既存fieldを維持するadditive変更とし、API先行→smoke→frontendの順でrolloutする。
    - frontendは旧API responseと新API responseの互換期間をtestで定義し、非互換変更を1回の片側deployへ混ぜない。

12. **rollback時にCookie・CORS・hostnameを戻す方法**
    - 選択: schemaはexpand-only、APIはadditive、Cookie名/Domain/Pathは現行維持。API versionを先に戻し、health/CORS/auth互換を確認後frontendを戻す。
    - custom domainと`FRONTEND_URL`を片側だけ戻さない。DNS TTL、Vercel deployment ID、Worker version IDをpreflightで記録する。

13. **stagingのcross-site制約をproduction証拠の代替にしない方法**
    - 選択: stagingはunit/integration/SPA回帰まで。same-site reload、rotation、logoutはapproved production hostnameでR16 smokeを行う。

14. **production smokeでCookie値を表示せず確認する方法**
    - 選択: Playwrightは`context.cookies()`、`storageState()`、trace、screenshot、videoを使用しない。login→reload→認証維持→logout→refresh拒否という結果を確認する。
    - 属性はsource/unit contractと、raw `Set-Cookie`を出力しないredaction済みpreflight helperでbooleanだけ記録する。`document.cookie`にrefresh Cookie名が現れないことをHttpOnlyのbrowser側補助証拠とする。

## API仕様案

| method | path                   | request credential           | response                                 | 主なerror                   |
| ------ | ---------------------- | ---------------------------- | ---------------------------------------- | --------------------------- |
| POST   | `/api/v1/auth/login`   | JSON、`credentials: include` | `{ accessToken, user }` + Cookie         | 400/401/403/409/429/500/503 |
| POST   | `/api/v1/auth/refresh` | host-only Cookie             | `{ accessToken, user }` + rotated Cookie | 401/403/409/500             |
| POST   | `/api/v1/auth/logout`  | Cookie、access tokenは不要   | 204 + Cookie削除                         | 500                         |

`refresh` responseへruntime検証可能な`user`をadditiveに含める案を採用する。これによりfull reload時にsessionStorageのuserを信頼せず、serverの最新role/account stateから認証状態を再構築できる。実装時に`docs/04_api.md`を更新する。

```typescript
type RefreshResponse = {
  accessToken: string;
  user: {
    id: string;
    username: string;
    role: "USER" | "ADMIN";
  };
};
```

logoutは現行どおりrefresh Cookieだけでrevokeできるため、route自体へaccess token認証middlewareを追加しない。API一覧の`🔒`表記は実装と整合するよう修正する。

## 公開インターフェース案

```typescript
export type AuthStatus = "initializing" | "authenticated" | "anonymous" | "unavailable";

refresh(): Promise<boolean>;

requestWithReauthentication<T>(
  request: (accessToken: string) => Promise<T>,
): Promise<T>;

getWorkerRuntimeConfig(options: WorkerRuntimeConfigOptions): WorkerRuntimeConfig;

cleanupExpiredRefreshTokens(options: {
  now: Date;
  batchSize: number;
  maxDeleted: number;
}): Promise<{ cutoff: Date; deletedCount: number; limitReached: boolean }>;
```

## 対象ファイル一覧

計画時点の候補である。実装完了時に実変更へ同期する。

| ファイル                                                                             | 変更種別     | 内容                                                              |
| ------------------------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------- |
| `backend/src/lib/refresh-token-cookie.ts`                                            | 修正         | Cookie属性・削除条件・共通helperを一元化                          |
| `backend/src/lib/refresh-token-cookie.test.ts`                                       | 修正         | production属性、Domainなし、Path、Max-Age契約                     |
| `backend/src/routes/auth/index.ts`                                                   | 修正         | refresh user response、競合時Cookie削除、helper利用               |
| `backend/src/routes/auth/login.test.ts`                                              | 修正         | production Cookie属性と秘密非出力                                 |
| `backend/src/routes/auth/refresh.test.ts`                                            | 修正         | rotation、reuse、同時refresh、Cookie競合、error                   |
| `backend/src/routes/auth/logout.test.ts`                                             | 修正         | revoke、両Path削除、旧token拒否                                   |
| `backend/src/services/auth.service.ts`                                               | 修正         | refresh user情報、競合結果、transaction契約                       |
| `backend/src/lib/worker-config.ts` / test                                            | 必要時修正   | production hostname/target、staging混同、不正URLのfail-fast       |
| `backend/src/worker.ts`                                                              | 修正         | staging entrypoint責務を明示                                      |
| `backend/src/worker-production.ts`                                                   | 新規         | `expectedTarget: "production"`専用entrypoint                      |
| `backend/src/worker-config-files.test.ts`                                            | 修正         | production env、別binding、route、workers.dev無効契約             |
| `backend/src/worker.test.ts` / `backend/src/cloudflare/worker-production.test.ts`    | 修正         | production runtime/CORS/safe error回帰                            |
| `backend/wrangler.jsonc` / `backend/worker-configuration.d.ts`                       | 修正         | production Worker、custom domain、別DO/Hyperdrive                 |
| `backend/package.json`                                                               | 修正         | production type/dry-run/build script。package versionは変更しない |
| `backend/prisma/schema.prisma`                                                       | 修正         | `RefreshToken(expiresAt, tokenHash)` cleanup index                |
| `backend/prisma/migrations/<timestamp>_add_refresh_token_expiry_index/migration.sql` | 新規         | expand-only index                                                 |
| `backend/src/jobs/cleanupExpiredRefreshTokens.ts` / test                             | 新規         | 固定batch cleanupと境界test                                       |
| `backend/src/jobs/scheduled.ts` / `.github/workflows/batch.yml`                      | 修正         | environment分離済みscheduleへcleanupを追加                        |
| `frontend/src/lib/stores/auth.svelte.ts` / test                                      | 修正         | browser refresh、single-flight、401/5xx state、共通retry          |
| `frontend/src/routes/+layout.svelte`                                                 | 修正         | unavailable表示とretry/focus契約                                  |
| `frontend/src/routes/login/+page.svelte`                                             | 修正         | login response runtime validation                                 |
| `frontend/src/routes/(app)/**/+page.svelte`                                          | 必要箇所修正 | 局所401 retryを共通coordinationへ統合                             |
| `frontend/e2e/production-auth.spec.ts`                                               | 新規         | 値非表示production auth smoke                                     |
| `frontend/e2e/production-config.ts` / test                                           | 新規         | approved hostnameだけを許すfail-fast設定                          |
| `frontend/playwright.production.config.ts`                                           | 新規         | trace/screenshot/video/storageState禁止、1 worker                 |
| `frontend/scripts/*vercel*` / build contract tests                                   | 修正         | Preview/Production scope、main branch、API URL成果物契約          |
| `.github/workflows/production-auth-smoke.yml`                                        | 新規         | production Environment承認付きR16 smoke。自動起動禁止             |
| `docs/02_security.md`                                                                | 修正         | 現行access + HttpOnly refresh方式、CSRF、storage方針へ同期        |
| `docs/03_data_model.md`                                                              | 修正         | 実際のrefresh token index/cleanup契約へ同期                       |
| `docs/04_api.md`                                                                     | 修正         | refresh response、Cookie、logout認証表記、競合error               |
| `docs/05_progress.md`                                                                | 修正         | R5状態と実装/証拠linkを同期                                       |
| `docs/09_startup_commands.md`                                                        | 修正         | production dry-run/smokeコマンドと禁止事項                        |
| `docs/11_deployment.md`                                                              | 修正         | current Vercel/Workers hostname、rollout/rollback、旧節整理       |
| `docs/plans/portfolio-release-v0-1/plan.md`                                          | 修正         | R5/R14/R15/R16の証拠境界を同期                                    |
| `docs/plans/production-auth-refresh/plan.md`                                         | 修正         | 実装記録と完了証拠                                                |

## DB整合性・負荷評価

### 現行評価

- `tokenHash`主キーによりrefresh/logout lookupはindex lookupであり妥当。
- `userId` indexによりpassword reset、account deletion、admin revokeの`deleteMany`は妥当。
- refreshはuserを1回includeし、transactionで旧token deleteと新token createを行う。1 request内の固定query数でN+1はない。
- 同時refreshは`deleteMany.count === 1`だけをwinnerにできるが、frontend競合とloser responseのCookie処理まで含むbrowser契約が不足している。
- 期限切れrowはそのtokenが再提示された場合しか削除されず、未使用tokenが累積する。

### DB変更判断

**migrationは必要**とする。production cleanupをtable scanにしないため、`@@index([expiresAt, tokenHash])`をexpand-onlyで追加する。migration SQLは`CREATE INDEX CONCURRENTLY`を明示し、既存rowへの書込みlockを抑える。token column、主キー、relation、既存dataは変更しない。

cleanupは`expiresAt < cutoff`を`expiresAt, tokenHash`順で固定batch選択し、選択したhashだけを`deleteMany`する。同時workerが選択rowを先に削除してcount=0になっても、その時点で全件完了とは判定せず後続batchを確認する。1回上限と時間上限を持ち、残件があればfailureまたは`limitReached`を通知する。token hashやIDをlogしない。再実行可能で、現在有効なtokenとcutoff同時刻のrowを削除しない。

### migration rollout/rollback

- expand: concurrent index追加→`indisvalid=true`確認→query plan/時間確認→cleanup code有効化の順。
- 既存data変換は不要。`CREATE INDEX CONCURRENTLY`はtransaction外で実行し、production row数の承認付き集計とmaintenance windowで実行時間を判断する。
- migration失敗またはinvalid indexが残った場合はcleanup/API rolloutを停止する。対象名を完全一致確認し、別承認でinvalid indexだけを`DROP INDEX CONCURRENTLY`してからmigrationを再試行する。
- rollbackはcleanup scheduleを先に停止し、codeを戻してからindexをdropする。indexだけ残ってもauth correctnessへ影響しないため、緊急rollbackでdropを急がない。

## セキュリティ評価

| 脅威                 | 対策                                                      | 証拠                                        |
| -------------------- | --------------------------------------------------------- | ------------------------------------------- |
| CSRF                 | Strict、host-only、auth Path、JSON、完全一致CORS          | Cookie/CORS unit + production outcome       |
| token theft          | HttpOnly、Secure、raw token DB非保存、HTTPS               | source/unit、production HTTPS               |
| token replay         | SHA-256 lookup、単回rotation、旧hash削除、logout revoke   | service/integration、production logout後401 |
| session fixation     | Domain省略、login時新token発行、legacy Path削除           | Set-Cookie contract                         |
| refresh race         | single-flight、optional cross-tab lock、DB winner count   | concurrency tests                           |
| wildcard CORS        | single `FRONTEND_URL`、unmatched originにallow headerなし | app/Worker/preflight tests                  |
| configuration mix-up | target/database/binding/name/routeをenv別にfail-fast      | Wrangler/config contract                    |
| secret leakage       | fixed error、raw error非出力、trace/storageState禁止      | negative source/log tests                   |
| proxy 502/504        | JSON前にstatus確認、parse failureを安全に分類             | frontend tests                              |

`SameSite=Lax`/`None`は採用しない。採用が必要になるのは、所有domainを用意できずcross-siteを恒久採用する場合だけである。その場合はR5を停止し、CSRF token、Origin/Referer検証、Cookie partitioning/third-party制限、browser互換、代替proxy案、残存リスクを別設計・owner承認する。計画段階でCookie属性を変更してはならない。

### rate limitとの関係

現行ではregister/login/forgot-password/reset-passwordだけが認証系専用bucketを使い、refresh/logoutには共通の`GENERAL_API_IP`（60 requests / 60 seconds）が適用される。R5ではこの保護を外さず、frontendのsingle-flightとDBの単回rotationを主防御として維持する。production観測なしにrefresh専用bucketを追加して正当なreloadを阻害しない。実装testではrefresh/logoutにも共通rate limitが到達すること、429が日本語の固定errorであること、refresh token・Cookie・Authorizationをrate-limit keyやlogへ含めないことを確認する。R16の値非表示metricsで濫用または競合が確認された場合だけ、専用bucketの閾値と識別子を別設計・security承認で追加する。

## 外部設定とコード変更の分離

| Phase             | 実施内容                                                                | production変更       | 実行者/承認          |
| ----------------- | ----------------------------------------------------------------------- | -------------------- | -------------------- |
| A 計画            | 本文書、progress link                                                   | なし                 | docs review          |
| B 実装            | test、code、migration file、config contract、runbook                    | なし                 | feature PR review    |
| C preflight (R14) | domain所有、DNS候補、Environment key名、resource ID存在、rollback先確認 | read-only/値非表示   | infra + security承認 |
| D 外部設定 (R15)  | custom domain、production env/binding/Secret、deploy                    | あり                 | 直前承認必須         |
| E smoke (R16)     | approved hostでauth/browser/preflight確認                               | synthetic auth副作用 | 直前承認必須         |
| F 証拠docs        | run ID、SHA、status、属性boolean、rollback結果                          | なし                 | release review       |

### production Environment・Secret・binding名

値は本文、PR、Actions logへ記録しない。production用の同名keyはstagingと値・resource・権限を共有せず、R14では存在とscopeだけを確認し、R15で承認後に設定する。

| 配置先                        | 種別              | key / binding名                                                                                 | production契約                                         |
| ----------------------------- | ----------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Vercel Production             | public build env  | `VITE_API_BASE_URL`                                                                             | approved API origin。credential、path、query、hashなし |
| Cloudflare Worker             | vars              | `DEPLOYMENT_ENVIRONMENT`、`DATABASE_TARGET`、`NODE_ENV`、`RATE_LIMIT_STORE`                     | すべてproduction guardと一致                           |
| Cloudflare Worker             | non-secret config | `FRONTEND_URL`、`MAIL_API_URL`、`MAIL_FROM`、必要時`MAIL_ALLOWED_RECIPIENTS`、`MAIL_TIMEOUT_MS` | approved origin/config。Secret値を混在させない         |
| Cloudflare Worker             | encrypted secrets | `JWT_SECRET`、`RATE_LIMIT_KEY_SECRET`、`MAIL_API_KEY`                                           | stagingと別値。値・fingerprintを証拠へ出さない         |
| Cloudflare Worker             | resource bindings | `HYPERDRIVE`、`RATE_LIMIT_COUNTER`                                                              | production専用DB/DOへ接続し、staging IDを拒否          |
| GitHub Production Environment | smoke secrets     | `PRODUCTION_SMOKE_EMAIL`、`PRODUCTION_SMOKE_PASSWORD`                                           | 専用最小権限account。workflowは値を出力しない          |
| GitHub Production Environment | vars              | `PRODUCTION_FRONTEND_URL`、`PRODUCTION_API_URL`                                                 | G1〜G3で承認したoriginと完全一致                       |

`DATABASE_URL`をWorkerへ直接配布せず、production `HYPERDRIVE` bindingの接続先を使う。実装時にruntimeで本当に参照するkeyを再棚卸しし、未使用keyは追加しない。key名を変更した場合はcode、Wrangler type、runbook、contract testを同じPRで同期する。

## rollout

1. G1〜G8を確定し、公開hostnameと判断者だけを記録する。
2. Red→Green→Refactorでbackend/frontend/config/migration/smoke codeを実装する。
3. migration fileは作成・local専用DB検証までとし、productionへ適用しない。
4. release候補SHAでbackend/frontend/Workers/Vercel buildの品質gateを完了する。
5. R14でVercel production branch、Cloudflare zone/custom domain、`workers_dev: false`、別DO/Hyperdrive、Environment key名、rollback IDを値非表示で確認する。
6. 直近backup gate後、承認付きproduction migrationを先に適用する。index追加だけを確認し、cleanupはまだ有効化しない。
7. additive APIをdeployし、health、CORS、login/refresh互換を確認する。
8. production API URLを埋め込んだVercel frontendをdeploy/promoteする。
9. production auth smokeを1回実行する。成功後だけcleanup scheduleを別承認で有効化する。
10. R5/R14/R15/R16の証拠を同期し、R5完了条件を再判定する。

## rollback

停止条件: login/refresh/logout失敗、Cookie属性欠落、unexpected origin許可、rotation race、safe error違反、API/frontend version不一致、DB latency増加、hostname/WAF迂回を検出した場合。

1. 新規deploy/promoteとcleanupを停止する。
2. APIを直前のadditive互換versionへ戻す。custom domainとCORSを片側だけ切り替えない。
3. health、許可/不許可preflight、旧frontendとのlogin/refreshを確認する。
4. Vercelを互換な直前deploymentへ戻す。
5. Cookie名/Domain/Pathは変更しないため、browser Cookieの緊急migrationは行わない。
6. indexはauth結果に影響しないため原則残す。DB原因と確認できた場合だけ別承認でdropする。
7. rollback smokeを値非表示で行い、R5を未完了へ戻して原因・version ID・再着手条件を記録する。

## TDD計画

### Red

- production Cookieの全属性、Domainなし、現行/legacy Path削除を先行testで固定する。
- refresh response user、期限切れ、不正、DB不存在、revoke、reuse、同時winner/loser、logout後拒否を追加する。
- production Worker entrypoint、Wrangler production env、別resource、custom domain、`workers_dev: false`のcontract testを先に失敗させる。
- auth storeのreload、single-flight、401 1回retry、5xx/network、logout競合を先行testで失敗させる。
- expiry indexとcleanup jobのschema/source/integration testを先行する。
- production Playwright configがCookie/credentialをArtifactへ保存しないsource contractを追加する。

### Green

- Cookie helperとroute/serviceを最小変更しbackend auth testを通す。
- production Worker/configをstaging非回帰のまま追加する。
- auth storeへ共通coordinationを実装し、管理画面の局所実装を置き換える。
- expand-only indexとbatch cleanupを実装する。
- production config/smoke codeをapproved placeholder fixtureで外部接続なしに通す。

### Refactor

- Cookie削除、response validation、refresh coordination、URL validationの重複を共通化する。
- auth対象pageと既存API clientの公開signatureを必要以上に変更しない。
- 対象testと直接影響test後にPrettierを適用する。
- 文書の旧platform/旧token記述を正本へ同期する。

## テストケース一覧

| 分類     | ケース                 | 期待結果                                                  |
| -------- | ---------------------- | --------------------------------------------------------- |
| 正常     | login成功              | 200、access/user、production Cookie属性                   |
| 正常     | access token期限切れ後 | 401を契機にrefresh 1回、最新tokenで元request 1回retry     |
| 正常     | full reload            | browser refresh 200、認証済み画面を維持                   |
| 正常     | rotation               | 旧row削除、新row作成、Cookie更新、旧token拒否             |
| 正常     | logout                 | DB revoke、204、Cookie削除、local anonymous               |
| 正常     | logout後refresh        | 401、旧tokenで成功しない                                  |
| 異常     | Cookieなし             | 401、内部情報なし                                         |
| 異常     | 形式不正token          | 401、Cookie clear、安全な日本語error                      |
| 異常     | 期限切れtoken          | row削除、401、Cookie clear                                |
| 異常     | revoke済みtoken        | 401、新tokenを作らない                                    |
| 異常     | DB不存在token          | 401、新tokenを作らない                                    |
| 境界     | 同一token再利用        | 初回だけ成功、再利用拒否                                  |
| 境界     | 同時refresh            | 1 winner、重複新tokenなし、winner Cookieをloserが消さない |
| 境界     | 複数tab refresh        | 直列化または安全なloser処理、最終Cookieで再refresh成功    |
| CORS     | exact frontend origin  | allow-origin一致、credentials true                        |
| CORS     | frontend origin不一致  | allow-originなし、responseをbrowserが利用不可             |
| CORS     | 不許可preflight        | wildcard/不許可originなし                                 |
| proxy    | 非JSON 502/504         | parse例外を露出せずunavailable表示                        |
| 障害     | API停止                | stale tokenを保護APIへ使わず、retry可能なfail-closed表示  |
| version  | API新/frontend旧       | additive responseでlogin/refresh継続                      |
| version  | API旧/frontend新       | 定義した互換期間または安全な停止message                   |
| config   | 必須env欠落/空白       | build/request前にfixed errorでfail-fast                   |
| config   | 不正URL                | credential/path/query/hash/httpを拒否                     |
| config   | staging/production混同 | target/database/resource/name guardで拒否                 |
| security | Cookie/token/Auth/log  | value、raw header、bodyを出力しない                       |
| security | wildcard検索           | runtime/config/docsの実設定に`*` originなし               |
| security | error response         | stack、DB error、内部pathなし                             |
| DB       | expiry index           | schema/migration一致、既存row変換なし                     |
| DB       | cleanup cutoff         | `< cutoff`だけ削除、同時刻/有効token保持                  |
| DB       | cleanup上限            | batch/max/time上限、再実行可能、ID非出力                  |
| A11Y     | auth error             | `role=alert`等で認識可能                                  |
| A11Y     | redirect/failure       | focusが見出しまたはalertへ移る                            |
| A11Y     | keyboard               | login、retry、logoutをkeyboardで完了                      |

## production smoke手順

実行はR15 deploy後、R16の直前承認を得た1回に限定する。

1. run対象SHA、approved frontend/API origin、Environment名、production branch、rollback IDを値非表示で照合する。
2. API health 200とHTTPSを確認する。
3. 許可origin preflightはexact allow-origin、credentials true、明示method/headerを返すことを確認する。
4. 不許可origin preflightはallow-originを返さず、`*`を返さないことを確認する。
5. 専用production smoke accountでloginする。response body、Authorization、Cookieをlogしない。
6. 認証済み画面へ到達し、keyboard操作と見出しを確認する。
7. `page.reload()`し、refresh 200のstatusだけを観測して認証済み画面が維持されることを確認する。
8. もう一度reloadまたは明示refreshを行い、rotation後のCookieでも成功することを結果で確認する。
9. logoutし、未認証表示、focus、alertを確認する。
10. logout後refreshが401で、認証画面へ戻らないことを確認する。
11. trace、screenshot、video、storageState、Cookie一覧を保存していないことを確認する。
12. Workers/Vercel/Actions logを値非表示のnegative patternで確認し、Secret/token/Cookie/Authorization/raw errorがないことを記録する。

stagingの同一手順はcross-siteのためreload成功を期待せず、production成功証拠に数えない。

## 秘密情報を表示しない証拠記録形式

```text
run URL / run ID:
head SHA:
frontend origin一致: true/false
API origin一致: true/false
HTTPS: true/false
same registrable domain: true/false
CORS exact allow-origin: pass/fail
CORS wildcard absent: pass/fail
allow-credentials: pass/fail
Cookie HttpOnly/Secure/Strict/Path/Max-Age contract: pass/fail
login: pass/fail
reload refresh: pass/fail
second rotation: pass/fail
logout: pass/fail
logout後refresh 401: pass/fail
trace/screenshot/video/storageStateなし: pass/fail
secret/token/Cookie/Authorization/raw error非出力: pass/fail
rollback確認: pass/fail/not-run
確認日時・確認者:

禁止: Cookie値、Set-Cookie raw header、access/refresh token、Authorization、password、Secret、DB URL、個人情報
```

## R5完了条件

- [ ] G1〜G8が判断者付きで確定している。
- [ ] frontend/APIがHTTPSかつsame registrable domainである。
- [ ] host-only、HttpOnly、Secure、SameSite=Strict、auth Path、7日が維持されている。
- [ ] production Worker entrypoint/config/resourceがstagingと分離されている。
- [ ] `VITE_API_BASE_URL`と`FRONTEND_URL`がapproved pairと一致する。
- [ ] exact origin CORS、credentials、preflightがproductionで成功する。
- [ ] login、full reload refresh、rotation、logout、旧token拒否がproductionで成功する。
- [ ] concurrent refreshで複数新tokenやCookie消失を起こさない。
- [ ] 401/403と502/504/networkをfrontendが安全に区別する。
- [ ] refresh token cleanup index/jobが検証済みで、production適用結果が記録される。
- [ ] Cookie/token/Authorization/Secret/raw errorが証拠・logへ出ていない。
- [ ] rollback先と互換性matrixが確認されている。
- [ ] R7・R8・R9・R11A・R11・R12・R14〜R16へ引き継ぎが同期されている。
- [ ] 計画書、進捗、API/security/deployment文書が実装と一致する。

計画書作成だけではR5を`[-]`または`[x]`へ変更しない。実装開始時に`[-]`、上記すべてとproduction証拠が揃った時だけ`[x]`にする。

## 後続taskへの引き継ぎ

- **R7**: approved API hostname、zone、`workers_dev: false`、production DO bindingをWAF/429/503確認へ渡す。
- **R8**: exact CORS、Cookie属性、safe error、log negative reviewの証拠形式を渡す。
- **R9**: 観測待ちは独立継続。R5 branchへR9状態を巻き戻さない。
- **R11A**: R5 merge後にpackage更新を開始し、auth/Workers/Playwright契約を回帰する。
- **R11**: production configを含むrelease候補SHAで全quality gateを実行する。
- **R12**: staging主要導線を回帰するが、reload refreshの合否はproductionへ持ち越す。
- **R14**: G1〜G8、resource/Environment key名、rollback IDをpreflightする。
- **R15**: migration→API→frontendの承認付きrolloutを実行する。
- **R16**: 値非表示production auth smokeを実行し、R5完了証拠へ参照する。
- **R18**: cleanup運用、domain更新責任、将来のsame-origin proxy検討を引き継ぐ。

## タスクリスト3回レビュー

### v1 初版

- 文書/code/DB/workflow/外部仕様を棚卸しした。
- hostname gate、backend、frontend、DB、config、test、rollout、証拠同期をtask化した。

### v2 1回目レビュー（error・型安全・security）

- 401/403とtransient 5xx/networkを分離した。
- refresh responseのruntime user検証、1回retry、single-flightを追加した。
- host-only、Strict、wildcard禁止、値非表示、session fixation/replay/CSRFを明記した。
- production設定欠落・不正URL・staging混同をfail-fast testへ追加した。

### v3 2回目レビュー（既存実装・test・DB）

- 現行transaction、PK、userId indexを再利用し、不要なrefresh token全面再設計を避けた。
- expiresAt cleanup不足だけをexpand-only migrationとして追加した。
- 管理画面の局所single-flightを共通化し、共通HTTP client全面移行と分離した。
- Workers entrypointのstaging固定とWrangler production env不在を明示taskにした。

### v4 3回目レビュー・確定

- production操作をR14〜R16へ分離しつつ、production証拠なしにR5を完了しない境界を確定した。
- stagingをproduction証拠へ流用しないこと、API先行のadditive rollout、rollback順を確定した。
- R9観測待ちとのbranch分離、R11A package更新の開始条件、最終docs整合を追加した。

## 最終タスクリスト

| ID    | 内容                                         | phase    | 主対象                            | 優先度 | 完了条件                            |
| ----- | -------------------------------------------- | -------- | --------------------------------- | ------ | ----------------------------------- |
| R5-1  | hostname/owner/branch/rollback gate確定      | Gate     | 外部判断・本計画                  | 高     | G1〜G8を非秘密値で承認              |
| R5-2  | 実装baselineと進捗を同期                     | 準備     | plan/progress/release             | 高     | 最新develop、R5だけ`[-]`            |
| R5-3  | Cookie属性contractをRed追加                  | Red      | cookie/login/refresh/logout tests | 高     | 現行不足理由で失敗                  |
| R5-4  | refresh rotation/競合/reuseをRed追加         | Red      | auth service/route tests          | 高     | winner/loser、旧token拒否を固定     |
| R5-5  | frontend reload/single-flight/errorをRed追加 | Red      | auth store tests                  | 高     | duplicate refresh等で失敗           |
| R5-6  | production Worker/WranglerをRed追加          | Red      | config/runtime tests              | 高     | production env不在で失敗            |
| R5-7  | expiry index/cleanupをRed追加                | Red      | schema/job tests                  | 高     | index/job不在で失敗                 |
| R5-8  | Cookie/route/serviceをGreen実装              | Green    | backend auth                      | 高     | 属性、rotation、logout test成功     |
| R5-9  | auth store共通coordinationをGreen実装        | Green    | frontend auth/routes              | 高     | reload、1 retry、concurrency成功    |
| R5-10 | production Worker configをGreen実装          | Green    | Worker/Wrangler/scripts           | 高     | staging/prod分離、dry-run成功       |
| R5-11 | expiry index/cleanupをGreen実装              | Green    | Prisma/jobs/batch                 | 高     | local migration/job test成功        |
| R5-12 | production smoke基盤をGreen実装              | Green    | Playwright/workflow               | 高     | 外部接続なしcontract成功            |
| R5-13 | 重複除去と直接回帰                           | Refactor | auth/config/jobs                  | 高     | helper一元化、関連test成功          |
| R5-14 | API/security/deploy文書同期                  | Docs     | 02/03/04/09/11/release            | 高     | 旧記述を現行契約へ同期              |
| R5-15 | 最終local/CI品質gate                         | Quality  | backend/frontend                  | 高     | 全test/build/lint/format/Prisma成功 |
| R5-16 | production preflight                         | R14      | Vercel/Cloudflare/GitHub          | 高     | 値非表示でtarget/rollback確認       |
| R5-17 | production migration/deploy                  | R15      | DB/API/frontend                   | 高     | 直前承認、順序、version記録         |
| R5-18 | production auth smoke                        | R16      | approved hosts/browser            | 高     | login/reload/rotation/logout成功    |
| R5-19 | security/log negative review                 | R8/R16   | response/log/Artifacts            | 高     | 秘密・wildcard・raw errorなし       |
| R5-20 | 証拠・進捗・計画完了同期                     | Docs     | plan/progress/release             | 高     | 全条件後だけR5`[x]`                 |
| R5-21 | 後続task handoff                             | Handoff  | R7/R8/R9/R11A/R11/R12/R18         | 中     | owner、証拠、再着手条件を記録       |

## 最終タスクリスト（タブ区切り）

```text
タスクID	タスク内容	フェーズ	ファイル・環境	優先度
R5-1	hostname・owner・branch・rollback gateを確定	Gate	外部判断・本計画	高
R5-2	実装baselineと進捗を同期	準備	plan・progress・release	高
R5-3	Cookie属性contractをRed追加	Red	backend auth/cookie tests	高
R5-4	refresh rotation・競合・reuseをRed追加	Red	auth service/route tests	高
R5-5	frontend reload・single-flight・errorをRed追加	Red	auth store tests	高
R5-6	production Worker・WranglerをRed追加	Red	config/runtime tests	高
R5-7	expiry index・cleanupをRed追加	Red	schema/job tests	高
R5-8	Cookie・route・serviceをGreen実装	Green	backend auth	高
R5-9	auth store共通coordinationをGreen実装	Green	frontend auth/routes	高
R5-10	production Worker configをGreen実装	Green	Worker/Wrangler/scripts	高
R5-11	expiry index・cleanupをGreen実装	Green	Prisma/jobs/batch	高
R5-12	production smoke基盤をGreen実装	Green	Playwright/workflow	高
R5-13	重複除去と直接回帰	Refactor	auth/config/jobs	高
R5-14	API・security・deploy文書を同期	Docs	02/03/04/09/11/release	高
R5-15	最終local・CI品質gate	Quality	backend/frontend	高
R5-16	production preflight	R14	Vercel/Cloudflare/GitHub	高
R5-17	production migration・deploy	R15	DB/API/frontend	高
R5-18	production auth smoke	R16	approved hosts/browser	高
R5-19	security・log negative review	R8/R16	response/log/Artifacts	高
R5-20	証拠・進捗・計画完了を同期	Docs	plan/progress/release	高
R5-21	後続taskへhandoff	Handoff	R7/R8/R9/R11A/R11/R12/R18	中
```

## ローカル実装完了（R5はproduction証拠待ち）

- 実装日: 2026-07-22
- 実装ブランチ: `feature/r5-production-auth-refresh`
- PR: 作成前
- 進捗: code・test・migration file・runbookは実装済み。G1〜G8、R14〜R16が未完了のためR5は`[-]`を維持する。

### 実装済み項目

- production Cookieをhost-only、HttpOnly、Secure、SameSite=Strict、`Path=/api/v1/auth`、`Max-Age=604800`へ固定し、login/refresh/logoutとlegacy Path削除を共通helperへ集約した。
- refresh responseへ`user { id, username, role }`をadditiveに追加した。DB winnerは旧hash削除count=1、loserは409かつCookie削除なしとした。
- frontendは同一tab single-flightとWeb Locks対応browserのtab間直列化、401後の論理refresh 1回・元request retry 1回、401/403と一時障害の分離、stale access token即時無効化を実装した。
- 管理画面の局所single-flightをauth store共通coordinationへ置換し、login response runtime validationと`unavailable` alert/retry/focusを追加した。
- production専用Worker entrypointと、実在値をcommitしない一時Wrangler config validator/dry-runを追加した。
- `RefreshToken(expiresAt, tokenHash)` indexとexpand-only migration file、default無効・dry-run既定の固定batch cleanupを追加した。
- production auth smokeのparameter validator、Playwright設定、Cookie属性boolean、login→reload rotation 2回→同時refresh 200/409→競合後refresh成功→logout→refresh 401 spec、manual production Environment workflowを追加した。workflowは実行していない。

### 計画から変更した設計判断

- `wrangler.jsonc env.production`へ実在resource IDを置く案は採用せず、R14で与える非秘密parameterからstandalone configを一時生成してdry-run後に削除する方式へ変更した。committed `wrangler.jsonc`はstaging専用のまま維持する。
- refresh token cleanupは既存scheduleへ自動接続せず、Batch Jobsのmanual dry-run/execute選択肢だけを追加した。production自動cleanupの有効化はR16のauth smokeとR18の運用承認後へ送る。
- 既存`worker-config.ts`はproduction target/CORS/secret/binding fail-fastを既に実装済みだったため変更せず、production固有hostname/resource混同は新しいconfig builderで検証した。
- frontend build URL validatorは既存契約を再利用し、`frontend/scripts/*vercel*`は変更しなかった。approved frontend/API pairはproduction Playwright/Worker config validatorで追加検証する。

### シニアフルスタックレビューでの追加改善

- DB: productionの通常`CREATE INDEX`は書込みlockリスクがあるため`CREATE INDEX CONCURRENTLY`へ変更した。fresh local DBへ全16 migrationを適用し、対象indexの`indisvalid=true`を確認した。
- DB: cleanup workerが競合して選択済みrowを先に削除された場合、`deleteMany.count === 0`だけで完了扱いにせず、後続batchを確認するよう修正した。query数はbatchごとにfindMany 1回・deleteMany 1回で固定し、N+1はない。
- API: `expiresAt === request時刻`も期限切れとしてfail-closedにした。access token署名をDB rotation前へ移し、署名失敗後に旧refresh tokenだけが失効する不整合を防止した。
- production config: DNS labelの空要素、先頭/末尾hyphen、末尾dot、registrable domain不一致、provider hostnameをbackend/frontendで同じ契約として拒否した。
- A11Y: loginのclient validationは該当inputへ、server/network errorは`role=alert`へfocusする。inputに`aria-invalid`と`aria-describedby`を状態連動で付与し、色だけに依存しないエラー関連付けを追加した。

#### 追加TDD記録

| 対象                 | Red                                                                 | Green                                                    |
| -------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| concurrent index     | migration schema testが通常`CREATE INDEX`を検出して失敗             | SQLを`CREATE INDEX CONCURRENTLY`へ変更しfresh DB適用成功 |
| cleanup競合          | 先行workerが削除したbatchで後続期限切れrowを残して失敗              | count=0でも後続batchを探索し完了                         |
| refresh境界/署名失敗 | exact expiryがrotationへ進み、sign失敗後にtransactionが実行され失敗 | exact expiry 401、sign成功後だけtransaction開始          |
| hostname             | malformed DNS labelとprovider/bare suffixを受理して失敗             | label単位validationとprovider suffix拒否                 |
| login A11Y           | alert/inputへfocusせずaria関連付けがなく失敗                        | validation対象inputまたはalertへfocusし属性連動          |

### 実際の変更ファイル

| ファイル                                                                                                         | 変更種別  | 内容                                                    |
| ---------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------- |
| `backend/src/lib/refresh-token-cookie.ts` / test                                                                 | 修正      | 発行・現行/legacy削除Cookie契約                         |
| `backend/src/routes/auth/index.ts` / login・refresh・logout tests / test helper                                  | 修正      | user応答、409 loser、production Cookie、revoke          |
| `backend/src/services/auth.service.ts`                                                                           | 修正      | username取得、rotation loser 409、署名前置・期限境界    |
| `backend/src/app.rate-limit-route-matrix.test.ts`                                                                | 修正      | refresh/logoutの`GENERAL_API_IP`固定                    |
| `backend/src/app.ts` / `backend/src/routes/users/index.ts` / test helper                                         | 修正      | production Cookie削除属性をusers routeまで伝播          |
| `backend/src/lib/production-worker-config.ts` / test                                                             | 新規      | URL/DNS/resource/target fail-fast、一時config生成       |
| `backend/src/worker-production.ts`                                                                               | 新規      | production専用entrypoint                                |
| `backend/src/scripts/runProductionWranglerDryRun.cli.ts`                                                         | 新規      | 値非表示local dry-run                                   |
| `backend/src/worker-config-files.test.ts` / `tsconfig.json` / `tsconfig.workers.json` / `package.json`           | 修正      | production build分離contract/script                     |
| `backend/prisma/schema.prisma` / `prisma/migrations/20260722194000_add_refresh_token_expiry_index/migration.sql` | 修正/新規 | cleanup複合index                                        |
| `backend/src/jobs/cleanupExpiredRefreshTokens.ts` / test / CLI / schema test                                     | 新規      | fixed batch、競合継続、dry-run、guard、機密非log        |
| `backend/src/lib/config.ts`                                                                                      | 修正      | cleanup execute flag一元化                              |
| `.github/workflows/batch.yml`                                                                                    | 修正      | refresh cleanupのmanual選択肢。schedule未接続           |
| `frontend/src/lib/stores/auth.svelte.ts` / test                                                                  | 修正      | response validation、single-flight、障害分類、共通retry |
| `frontend/src/routes/(app)/admin/+page.svelte` / test                                                            | 修正      | 共通再認証へ統合                                        |
| `frontend/src/routes/+layout.svelte` / `layout-auth-contract.test.ts`                                            | 修正/新規 | unavailable alert/retry/focus                           |
| `frontend/src/routes/login/+page.svelte` / test                                                                  | 修正      | runtime validation、A11Y error focus・aria関連付け      |
| `frontend/e2e/production-config.ts` / test                                                                       | 新規      | approved production target/DNS fail-fast                |
| `frontend/e2e/production-auth.spec.ts` / `playwright.production.config.ts`                                       | 新規      | 値非表示auth smoke、Artifact禁止                        |
| `frontend/src/production-playwright-contract.test.ts` / `frontend/package.json`                                  | 新規/修正 | source contractと専用script                             |
| `.github/workflows/production-auth-smoke.yml`                                                                    | 新規      | manual production Environment smoke。未実行             |
| `docs/02_security.md` / `03_data_model.md` / `04_api.md`                                                         | 修正      | auth・Cookie・rotation・index・cleanup契約              |
| `docs/05_progress.md` / `09_startup_commands.md` / `11_deployment.md`                                            | 修正      | 継続中理由、手順、rollout/rollback                      |
| `docs/plans/portfolio-release-v0-1/plan.md` / 本計画書                                                           | 修正      | R5とR14〜R16の証拠境界                                  |

### ローカル品質ゲート

- backend: Vitest 100 files・1,043件成功（既存integration 4 files・10件skip）、Workers 2 files・15件成功、build、lint、format:check成功。
- frontend: lint、format、Vitest 59 files・632件成功。外部接続なしproduction config/smoke contract 17件を含む。
- Prisma: local Dockerの一時DB `gensoko_r5_review`へ全16 migrationを最初から適用し、concurrent expiry indexの`indisvalid=true`を確認した。一時DBは検証後に削除し、production DBには接続していない。
- Playwright: local Dockerでlogin画面、health 200、Cookieなしrefresh 401の導線を確認した。trace、screenshot、video、storageState、Cookie一覧は保存していない。
- 共通: `git diff --check`成功。追加差分のcredential付きDB URL、JWT secret literal、sensitive header log、長いhex literal、Cookie Domain、wildcard CORSは値非表示scanですべて0件を確認した。

### productionで未実施の項目

- production deploy/promotion、production workflow実行
- DNS/custom domain、Vercel、Cloudflare、GitHub Environmentの外部設定変更
- Secretの参照・表示・登録・更新
- production DB接続、migration適用、cleanup実行
- approved hostnameでのCORS/login/reload/rotation/logout/smoke

### G1〜G8の未確定事項

G1 所有registrable domain、G2 frontend hostname、G3 API hostname、G4 Vercel project/Production scope、G5 Worker名/custom domain/production Hyperdrive/DO、G6 GitHub production Environmentとkey存在、G7 smoke account責任者、G8 rollback version/deployment/schemaはすべて未確定である。値を推測・hardcodeしていない。

### R14〜R16への引き継ぎ

- R14: G1〜G8、review済みSHA、URL pair、resource非共有、Environment key存在、rollback先をread-only・値非表示で確認する。
- R15: 別承認後にexpand-only migration → additive API → frontendを配備し、version/run IDだけを記録する。
- R16: manual production auth smokeを直前承認後に実行し、statusと属性booleanだけを証拠化する。Cookie/token/header/trace/storageStateを保存しない。
