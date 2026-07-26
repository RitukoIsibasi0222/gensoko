# R7 Free Worker password verification分離 TDD実装計画

> 設計者ロール: シニアバックエンドエンジニア / Cloudflare Workersエンジニア / セキュリティエンジニア
>
> 2026-07-26以降のv0.1では、M2で通常DO版のstaging deploy・valid login・auth 429・cleanupを確認する。
> R7PV-17のrollback証拠は公開後へ移し、本計画全体は未完了のまま継続する。

## 概要

R7 Evidence E-07ではstaging loginの503をmain stateless Workerの`exceededCpu`まで特定し、
Evidence E-08ではローカルworkerd上のcost 12 `bcrypt.compare`を`BCRYPT_DOMINANT`へ分類した。

本タスクではbcrypt cost 12を維持したまま、loginのpassword verificationだけを
SQLite-backed Durable Objectへ内部RPCで分離する。main Workerにlocal bcrypt fallbackを残さず、
既存のlogin 200/401/403/409/429/503、監査、account lock、refresh token、Cookie契約を維持する。

この文書は実装計画であり、コード実装、Cloudflare resource変更、deployment、staging/production request、
workflow dispatchは別承認まで実施しない。

## 基準状態

- 確認日: 2026-07-24
- 基準branch: `develop`
- 基準commit: `419231173b4d4c8ac1ce1b55ebb4bc49f46b2a3a`
- 計画branch: `docs/plan-r7-password-verification-free-worker`
- PR #148: 2026-07-24 12:02 JSTに`develop`へmerge済み
- merge commit: `419231173b4d4c8ac1ce1b55ebb4bc49f46b2a3a`
- E-07: auth request 1〜4は200、5件目だけmain stateless Workerの`exceededCpu`
- E-08: cost 12 `bcrypt.compare` median 209ms、固定classification `BCRYPT_DOMINANT`
- R7状態: R7-02、R7-05、R7-10〜R7-20、R7全体は未完了。v0.1はM1〜M6で別判定する

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`backend/src/services/auth.service.ts`**

- `createAuthService(dependencies).login(input)` — account状態確認、password照合、失敗回数更新、JWT・refresh token発行、成功監査を行う。
- `AuthError` — loginの401/403/409を含む既知の認証エラーを表す。
- login成功transactionはpassword照合後にaccount状態とroleを再確認し、成功更新・refresh token・監査を原子的に確定する。

**`backend/src/lib/password.ts`**

- `hashPassword(password): Promise<string>` — bcrypt cost 12のsingle source。
- `isPasswordWithinBcryptLimit(password): boolean` — 新規保存値のUTF-8 72 byte境界。

**`backend/src/lib/app-dependencies.ts`**

- `createAppDependencies(options)` — Node/test/Workers共通のservice graphを構築する。

**`backend/src/worker-handler.ts`**

- `createWorkerHandler(options)` — runtime config、request adapter、app dependenciesをrequest単位で構築する。

**`backend/src/lib/worker-request-adapters.ts`**

- `createWorkerRequestAdapters(factories?)` — Hyperdrive Prisma、fetch mail、rate limit DO storeをWorkers bindingから生成する。

**`backend/src/cloudflare/rate-limit-counter.ts`**

- `RateLimitCounter.consume(input)` — SQLite-backed Durable Object RPCの既存実装パターン。

**`backend/src/lib/worker-config.ts`**

- `getWorkerRuntimeConfig(options)` — Workersの文字列設定、Hyperdrive、`RATE_LIMIT_COUNTER` bindingを値非表示でfail-fast検証する。

### Cloudflare公式仕様（2026-07-24確認）

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) — Workers FreeのHTTP requestは10ms CPU/invocation。
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/) — SQLite-backed Durable Objectは1 requestあたり既定30秒CPU。
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) — Workers FreeでSQLite-backed DOを利用でき、100,000 requests/day、13,000 GB-s/day。各RPC method callは1 requestとして数える。
- [Durable Object RPC](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/) — public methodは非同期RPCとして呼び出され、serializableな入出力とstack traceなしの例外伝播を持つ。

### 重要な制約

- Workers Paidへ変更しない。
- bcrypt cost 12を下げない。`hashPassword`のcost定数を変更しない。
- loginのpassword verificationを弱いhash、plaintext比較、DB関数、raw queryへ置換しない。
- Prisma以外のDBアクセスを追加しない。Prisma schema/migrationは変更しない。
- main WorkerからDOへの待機をCPU削減の仮説として扱い、ローカル時間をCloudflare実課金CPUへ換算しない。
- Worker runtimeではDO binding欠損・RPC失敗・不正result時にlocal bcryptへfallbackせず、固定503でfail-closedにする。
- raw password、bcrypt hash、email、username、user ID、IP、token、Cookie、Authorization、DB URL、raw errorをDO storage、console、response、監査、文書へ出さない。
- password/hashは1回の内部RPC引数としてだけ扱い、field、closure、SQLite、alarm、cacheへ保持しない。
- public verifier endpoint、Service Binding先の公開hostname、共有secretを追加しない。
- staging workflow、Cloudflare resource作成・変更、deployment、実環境requestは別承認まで実施しない。
- R7-05の11回目429証拠をこのrepository実装だけで完了扱いにしない。
- R7全体、v0.1公開gateを完了扱いにしない。

## スコープ

- login serviceへ`PasswordVerifier` portをdependency injectionする。
- Node/testは明示的なlocal bcrypt adapter、WorkersはDO adapterを必須注入する。
- SQLite-backed `PasswordVerifierDurableObject`を追加し、storageを使わずcost 12 hashを照合する。
- 同一accountごとにDO instanceを分け、異なるaccountの照合を全体で直列化しない。
- Workers runtime config、staging/test Wrangler config、production config generatorへbindingとv2 migrationを追加する。
- verifier障害時の固定日本語503、`Retry-After: 60`、値非露出eventを既存共通契約へ統合する。
- unit/workerd/config/bundle testと文書を同期する。

## 非スコープ

- `/auth/register`と`/auth/reset-password`のcost 12 hash生成分離。
- `PATCH /users/me`と`DELETE /users/me`のcurrent password照合分離。
- bcryptからArgon2等へのalgorithm migration。
- login処理全体、Prisma、JWT、refresh token、監査、rate limitの別Worker化。
- account enumeration対策のtiming変更。
- WAF、Cloudflare plan変更、production resource、production deploy。
- R7-05のstaging auth request、11回目429、rollback実行。

上記の他bcrypt経路は別のCPUリスクとして残る。今回の完了条件は、E-07/E-08で特定した
valid login pathから`bcrypt.compare`を除去することに限定する。

## 採用構成

```text
Client
  -> main stateless Worker
     -> general/auth IP/email rate limit DO
     -> Prisma: user + cost 12 hash取得
     -> account状態確認
     -> PasswordVerifier port
        -> account単位のPasswordVerifierDurableObject RPC
           -> bcrypt.compare(password, passwordHash)
           -> booleanだけ返す
     -> 失敗: failCount/lock更新 + 401
     -> 成功: JWT + refresh token + 状態再確認transaction + 200
```

### 無料枠の成立条件

| 項目 | 設計上の扱い |
| --- | --- |
| main Worker CPU | bcryptを実行せず、DO RPCの結果待ちと後続の軽量処理だけを残す |
| DO CPU | 既定30秒/invocation内でcost 12 compareを1回だけ実行する |
| DO request | verifier RPC 1回を追加。既存rate-limit DOと100,000 requests/dayを共有する |
| DO duration | storageなし・alarmなし。13,000 GB-s/dayを既存DOと共有する |
| storage | SQLite classとしてmigrationするがpassword/hash/resultを保存しない |
| 課金判断 | E-08の209msはcapacity合格値へ換算せず、実装後の別承認preflightで最新quotaを再確認する |

無料枠は「無制限」を意味しない。DO request/duration上限へ達した場合は照合を継続せず503に倒し、
cost低下やmain Worker fallbackで回避しない。

## 設計上の決定事項

1. **分離先**
   - 選択: 同じWorker scriptにexportするSQLite-backed `PasswordVerifierDurableObject`。
   - 根拠: Freeで利用でき、通常のFree Workerより大きいDO CPU budgetを持ち、public network endpointや外部provider secretを追加しないため。

2. **通常Worker + Service Bindingを採用しない**
   - 選択: 不採用。
   - 根拠: 別の通常WorkerもFreeの10ms CPU制約を解決せず、password処理の公開面と構成だけが増えるため。

3. **DB側照合を採用しない**
   - 選択: 不採用。
   - 根拠: Prisma-only・raw query原則禁止を破り、DB extension互換性とcredential境界を増やすため。

4. **外部無料function providerを採用しない**
   - 選択: 不採用。
   - 根拠: public endpoint、service credential、provider別quota、network failure、rollback対象を追加するため。

5. **Worker fallback**
   - 選択: Workerでは禁止。Node entrypointだけlocal adapterを明示注入する。
   - 根拠: binding/config不備時にmain Workerのcost 12 compareへ戻ると同じ`exceededCpu`を再発させるため。

6. **DO sharding**
   - 選択: `namespace.idFromName(user.id)`でaccount単位のinstanceを選ぶ。
   - 根拠: 同一accountの照合を直列化しつつ、異なるaccountをglobal singletonで直列化しないため。user IDはstorage・log・responseへ出さない。

7. **RPC契約**
   - 選択: DOへ`password`と`passwordHash`だけを渡し、strict booleanだけを返す。
   - 根拠: token発行、account状態、fail count、監査、DB責務をmain serviceへ残し、credential滞在範囲を最小化するため。

8. **RPC障害**
   - 選択: 固定型`PasswordVerificationUnavailableError`へ縮約し、loginは日本語JSON 503と`Retry-After: 60`を返す。
   - 根拠: raw RPC errorやhashを露出せず、sensitive dependency障害をfail-closedにするため。

9. **監査**
   - 選択: verifier unavailableは認証失敗監査へ記録しない。固定event名だけをconsoleへ出す。
   - 根拠: credential mismatchではなく内部依存障害であり、既存API文書の「想定外内部エラーは認証失敗監査対象外」と一致させるため。

10. **account状態競合**
    - 選択: 既存のpassword照合後transaction再確認と条件付き更新を維持する。
    - 根拠: RPC待機中の停止・削除・role変更を古い状態で成功させないため。

11. **migration**
    - 選択: 既存`v1`を変更せず、`v2`の`new_sqlite_classes`へ新classを追加する。
    - 根拠: 適用済みmigration履歴を改変せず、Freeで許可されるSQLite backendを明示するため。

12. **rollback**
    - 選択: v2 lifecycleを共有するstaging専用rollback baselineと通常版のpost-v2 version間だけでrollbackする。pre-v2 versionへは戻さず、新namespace/migrationは直後に削除しない。
    - 根拠: Durable Object class lifecycle変更を跨ぐversion rollbackは成立しないため。migration/resource削除は緊急rollbackへ混ぜず、安定確認後の別承認cleanupへ分離する。

## 公開インターフェース案

```typescript
export type PasswordVerificationInput = Readonly<{
  userId: string;
  password: string;
  passwordHash: string;
}>;

export interface PasswordVerifier {
  verify(input: PasswordVerificationInput): Promise<boolean>;
}

export class PasswordVerificationUnavailableError extends Error {
  constructor();
}

// Node/test専用: backend/src/lib/bcrypt-password-verifier.ts
export function createBcryptPasswordVerifier(): PasswordVerifier;

export function createDurableObjectPasswordVerifier(
  namespace: DurableObjectNamespace<PasswordVerifierDurableObject>,
): PasswordVerifier;

export class PasswordVerifierDurableObject extends DurableObject {
  verify(input: Readonly<{
    password: string;
    passwordHash: string;
  }>): Promise<boolean>;
}
```

`PasswordVerificationUnavailableError`は固定messageだけを持ち、raw errorを`cause`へ保持しない。
DO adapterはRPC exception、binding exception、non-boolean resultを同じ固定errorへ縮約する。

## API仕様

### `POST /api/v1/auth/login`

成功・credential mismatch・account状態・rate limit・Cookie契約は変更しない。

verifier binding/RPC/result障害:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 60
Content-Type: application/json
```

```json
{
  "error": "一時的に利用できません。しばらく待ってから再試行してください"
}
```

- verifier障害時はfail count、lock、last login、streak、refresh token、成功/失敗監査を変更しない。
- 503 response/logへpassword、hash、account識別子、binding内部値、raw exceptionを含めない。
- loginの既存503 status/messageは維持し、`docs/04_api.md`では原因範囲をrate limit storeとpassword verifierへ更新する。

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
| --- | --- | --- |
| `backend/src/lib/password-verifier.ts` | 新規 | runtime共通portと固定unavailable error |
| `backend/src/lib/bcrypt-password-verifier.ts` | 新規 | Node/test専用local bcrypt adapter |
| `backend/src/lib/bcrypt-password-verifier.test.ts` | 新規 | local adapterのboolean・固定error test |
| `backend/src/lib/durable-object-password-verifier.ts` | 新規 | namespace選択、RPC result検証、fail-closed adapter |
| `backend/src/cloudflare/password-verifier.ts` | 新規 | storageなしのcost 12 bcrypt compare DO |
| `backend/src/cloudflare/password-verifier.test.ts` | 新規 | workerd実compare、分離、非永続化、固定error test |
| `backend/src/services/auth.service.ts` | 修正 | direct `bcrypt.compare`をinjected verifierへ置換 |
| `backend/src/lib/app-dependencies.ts` | 修正 | verifierを必須dependencyとしてauth serviceへ渡す |
| `backend/src/lib/worker-request-adapters.ts` | 修正 | `PASSWORD_VERIFIER` bindingからDO adapterを生成 |
| `backend/src/worker-handler.ts` | 修正 | request adapterのverifierをapp dependenciesへ渡す |
| `backend/src/index.ts` | 修正 | Node専用local bcrypt adapterを明示注入 |
| `backend/src/test/app-dependencies.ts` | 修正 | test dependencyへlocal/stub verifierを明示注入 |
| `backend/src/routes/auth/index.ts` | 修正 | verifier unavailableを共通503 + Retry-Afterへ変換 |
| `backend/src/routes/auth/test-helpers.ts` | 修正 | auth service testへverifierを明示注入 |
| `backend/src/routes/auth/login.test.ts` | 修正 | verifier呼出し、fallback禁止、503、状態非変更test |
| `backend/src/lib/http-error-responses.ts` | 新規 | rate limit/login共通の503 response helper |
| `backend/src/middleware/rateLimit/index.ts` | 修正 | 既存503生成を共通helperへ移す |
| `backend/src/lib/worker-config.ts` | 修正 | `PASSWORD_VERIFIER` bindingを必須検証 |
| `backend/src/lib/worker-config.test.ts` | 修正 | binding欠損・不正・値非露出test |
| `backend/src/lib/worker-request-adapters.test.ts` | 修正 | verifier factoryとrequest dependency test |
| `backend/src/lib/worker-bundle-contract.ts` | 修正 | Node local verifierのWorker bundle混入を拒否 |
| `backend/src/lib/worker-bundle-contract.test.ts` | 修正 | local verifier禁止とDO verifier許可のcontract test |
| `backend/src/lib/worker-bundle-metadata.ts` | 修正 | staging/production両entrypointのbundle metadataを検証 |
| `backend/src/lib/worker-bundle-metadata.test.ts` | 修正 | production entrypointのmetadata回帰test |
| `backend/src/worker.test.ts` | 修正 | environment・dependency伝播・安全な503回帰 |
| `backend/src/worker.ts` | 修正 | staging class exportとbinding型 |
| `backend/src/worker-production.ts` | 修正 | production class exportとbinding型 |
| `backend/wrangler.jsonc` | 修正 | staging bindingとv2 SQLite class migration |
| `backend/wrangler.test.jsonc` | 修正 | local workerd bindingとv2 migration |
| `backend/src/lib/production-worker-config.ts` | 修正 | production bindingとv2 migration生成 |
| `backend/src/lib/production-worker-config.test.ts` | 修正 | production class/binding/migration分離契約 |
| `backend/src/worker-config-files.test.ts` | 修正 | staging/test configと生成型契約 |
| `backend/src/scripts/runProductionWranglerDryRun.cli.ts` | 修正 | production一時configをentrypoint解決可能なrootへ安全に生成・削除 |
| `backend/tsconfig.json` | 修正 | Node buildからWorker専用DO caller adapterを除外 |
| `backend/tsconfig.workers.json` | 修正 | Worker buildへDO caller adapterを明示追加 |
| `backend/worker-configuration.d.ts` | 自動更新 | Wrangler生成binding型 |
| `docs/04_api.md` | 修正 | login 503原因範囲と非変更契約 |
| `docs/11_deployment.md` | 修正 | v2 DO binding、preflight、rollback、別承認境界 |
| `docs/plans/r7-password-verification-free-worker/plan.md` | 修正 | 本計画と実装記録 |
| `docs/plans/r7-rate-limit-environment-gates/plan.md` | 修正 | E-08次工程、実装後の別承認gate、R7未完了境界 |
| `docs/05_progress.md` | 修正 | 計画・実装・実環境証拠を分離して進捗同期 |

実装完了時は`git diff --name-status`と照合し、この表を実態へ合わせて更新する。

## TDD方針

### Red

1. loginがdirect `bcrypt.compare`ではなくinjected verifierを1回呼ぶ契約を先に追加する。
2. verifier unavailable時の503、`Retry-After: 60`、DB/監査/token非変更を追加する。
3. Workerでbinding欠損時にlocal fallbackしないconfig/adapter testを追加する。
4. workerdで新DO binding、strict boolean、storage非使用、real cost 12 compare testを追加する。
5. staging/test/production configへv2 migrationが必要なcontract testを追加する。
6. 変更対象testだけを実行し、未実装interface/class/bindingで意図どおり失敗することを確認する。

### Green

1. runtime共通portと別ファイルのNode local adapterを実装する。
2. DO classとcaller adapterを実装する。
3. auth service、app dependencies、Worker request adapterへ必須注入する。
4. 共通503 helperを実装し、rate limitとloginの重複を解消する。
5. Wrangler/runtime/production config、entrypoint export、生成型を更新する。
6. 対象unit testとWorkers testを通す。

### Refactor

1. fixed error/result validationをsingle sourceへ集約する。
2. Worker pathにlocal bcrypt fallbackやoptional bindingがないことを再確認する。
3. direct `bcrypt.compare`がlogin serviceから消え、DO classとNode専用adapterだけに残ることを`rg`で確認する。
4. Worker bundle metadataへNode専用`bcrypt-password-verifier.ts`が含まれないことをcontract testで確認する。
5. password/hash/user ID/raw errorがstorage・log・responseへ入らないことをtestと差分で再確認する。
6. 対象testと直接影響するWorker/config testを再実行する。
7. Prettierを適用し、文書を同期する。

## テストケース一覧

| ケース | 期待結果 |
| --- | --- |
| existing・usable account・正しいpassword | verifier 1回、既存200/Cookie/成功transaction |
| existing account・誤password | verifier 1回、failCount更新、既存401 |
| accountなし | verifier 0回、汎用401 |
| inactive/unverified/lock中 | verifier 0回、既存403/401 |
| lock期限切れ | reset後にverifier 1回、既存failCount契約 |
| 73 byte既存password | 値を切り詰めずverifierへ渡し、既存互換を維持 |
| verifier RPC exception | 503 + Retry-After 60、fixed body |
| verifier non-boolean result | 503 + Retry-After 60 |
| verifier unavailable | failCount/token/streak/監査を変更しない |
| Node entrypoint | explicit local bcrypt adapterを使用 |
| Worker binding欠損・不正 | runtime configで値非表示fail-fast、local fallbackなし |
| DO real cost 12 match | `hashPassword`生成hashでtrue |
| DO real cost 12 mismatch | false |
| DO storage inspection | password/hash/result row、alarmなし |
| account A/B | 異なるDO IDを選択 |
| 同一account | 同じDO IDを選択 |
| RPC/log serialization | password/hash/user ID/raw errorを含まない |
| staging config | `PASSWORD_VERIFIER` binding + v2 `new_sqlite_classes` |
| production config | staging resource IDなし、同じclass契約を生成 |
| generated types | 新binding/classを含む |
| Worker bundle | DO classを含み、診断moduleを含まない |
| Worker bundle fallback | Node専用local verifierを含まない |
| existing rate limit 503 | 共通helper移行後もbody/header/status不変 |

## タスクリスト（3回レビュー）

### v1: 初版

- password verifier portとlocal/DO adapterを追加する。
- login serviceへdependency injectionする。
- Wrangler binding/migrationとentrypoint exportを追加する。
- login、workerd、config、bundle testを追加する。
- API、deployment、R7進捗を同期する。

### v2: security・error・無料枠レビュー

- Workerでのlocal fallbackを禁止し、Node adapterを別ファイルへ隔離してbundle contractの禁止対象にした。
- binding/RPC/result障害をfail-closed 503へ固定した。
- password/hash/user ID/raw errorのstorage/log/response/監査非露出をtest条件へ追加した。
- global singletonを避け、account単位shardingで異なるaccountのCPU処理を分離した。
- DO request/duration quotaが既存rate-limit DOと共有されることを明記した。
- Free plan超過時にcost低下やPaid移行を自動選択しない停止条件を追加した。
- public endpoint、追加secret、DB raw query、plaintext比較を不採用にした。

### v3: consistency・regression・rollbackレビュー

- password照合後のaccount状態再確認transactionを維持した。
- verifier 503を認証失敗監査へ誤分類しない条件を追加した。
- loginの73 byte既存互換、lock、failure count、Cookie、refresh tokenを回帰対象へ追加した。
- staging適用済みv1を変更せずv2 migrationを追加する順序へ固定した。
- rollback時は新namespaceを即時削除しない条件を追加した。
- register/reset/user password経路は残余リスクとして明示し、今回のscopeへ混ぜないことを確認した。
- repository実装完了とR7-05/R7全体完了を分離した。

### v4: 確定

| タスクID | 内容 | ファイル | 優先度 | 外部操作 |
| --- | --- | --- | --- | --- |
| R7PV-01 | Red: verifier port・DI・fallback禁止契約 | password/login tests | 高 | なし |
| R7PV-02 | Red: DO RPC・strict result・非永続化契約 | cloudflare test | 高 | なし |
| R7PV-03 | Red: binding・v2 migration・生成型契約 | config tests | 高 | なし |
| R7PV-04 | Green: portと隔離したNode local adapter | `lib/password-verifier.ts`・`bcrypt-password-verifier.ts` | 高 | なし |
| R7PV-05 | Green: password verifier DOとcaller adapter | cloudflare/lib | 高 | なし |
| R7PV-06 | Green: auth service・app dependency injection | auth/app dependencies | 高 | なし |
| R7PV-07 | Green: fixed 503 helperと監査境界 | auth route/rate limit | 高 | なし |
| R7PV-08 | Green: Worker adapter・runtime config | Worker libs | 高 | なし |
| R7PV-09 | Green: staging/test/production configとv2 migration | Wrangler/config generator | 高 | なし |
| R7PV-10 | Refactor: 値非露出・重複排除・fallback監査 | backend | 高 | なし |
| R7PV-11 | 対象unit/workerd/関連回帰test | backend | 高 | なし |
| R7PV-12 | Workers生成型・bundle・production dry-run | backend | 高 | なし |
| R7PV-13 | backend最終品質gate | backend | 高 | なし |
| R7PV-14 | API・deployment・R7計画・進捗同期 | docs | 中 | なし |
| R7PV-15 | code/docs分割commit・push・PR | Git/GitHub | 中 | PRのみ |
| R7PV-16 | review/merge後のFree plan・quota・resource preflight | Cloudflare read-only | 高 | 別承認 |
| R7PV-17 | staging deploy・valid login・11回目429・rollback証拠 | staging | 高 | 別承認 |

- [x] R7PV-01: verifier port・DI・fallback禁止のRed testを追加する
- [x] R7PV-02: DO RPC・strict result・非永続化のRed testを追加する
- [x] R7PV-03: binding・v2 migration・生成型のRed testを追加する
- [x] R7PV-04: portと別ファイルへ隔離したNode local adapterをGreen実装する
- [x] R7PV-05: password verifier DOとcaller adapterをGreen実装する
- [x] R7PV-06: auth serviceとapp dependencyへ必須注入する
- [x] R7PV-07: verifier障害をfixed 503へ変換し監査境界を維持する
- [x] R7PV-08: Worker adapterとruntime configへbindingを通す
- [x] R7PV-09: staging/test/production configへbindingとv2 migrationを追加する
- [x] R7PV-10: 値非露出・重複排除・fallback禁止を再レビューする
- [x] R7PV-11: 対象unit/workerd/関連回帰testを通す
- [x] R7PV-12: 生成型・bundle・production dry-runを通す
- [x] R7PV-13: backend最終品質gateを通す
- [x] R7PV-14: API・deployment・R7計画・進捗を同期する
- [x] R7PV-15: code/docsを分割commitしpush・PRを作成する
- [x] R7PV-16: 別承認でFree plan・共有DO quota・resourceをread-only確認する
- [ ] R7PV-17: 別承認でstaging deploy・valid login・11回目429・rollback証拠を取得する

### タブ区切り

```tsv
タスクID	タスク内容	ファイル	優先度
R7PV-01	Red: verifier port・DI・fallback禁止契約	password/login tests	高
R7PV-02	Red: DO RPC・strict result・非永続化契約	cloudflare test	高
R7PV-03	Red: binding・v2 migration・生成型契約	config tests	高
R7PV-04	Green: portと隔離したNode local adapter	backend/src/lib/password-verifier.ts・bcrypt-password-verifier.ts	高
R7PV-05	Green: password verifier DOとcaller adapter	backend/src/cloudflare・lib	高
R7PV-06	Green: auth service・app dependency injection	backend/src/services・lib	高
R7PV-07	Green: fixed 503 helperと監査境界	auth route・rate limit	高
R7PV-08	Green: Worker adapter・runtime config	backend/src/worker・lib	高
R7PV-09	Green: staging/test/production configとv2 migration	backend Wrangler・config	高
R7PV-10	Refactor: 値非露出・重複排除・fallback監査	backend	高
R7PV-11	対象unit/workerd/関連回帰test	backend	高
R7PV-12	Workers生成型・bundle・production dry-run	backend	高
R7PV-13	backend最終品質gate	backend	高
R7PV-14	API・deployment・R7計画・進捗同期	docs	中
R7PV-15	code/docs分割commit・push・PR	Git/GitHub	中
R7PV-16	Free plan・quota・resource preflight	Cloudflare read-only	高
R7PV-17	staging deploy・valid login・11回目429・rollback証拠	staging	高
```

## 品質gate

実装・再レビュー・文書同期後に原則1回実行する。

```bash
cd backend
npm run test -- --run
npm run test:workers
npm run build
npm run workers:build
npm run workers:production:dry-run
npm run lint
npm run format:check
```

- Prisma schema/migrationを変更しないため`prisma migrate deploy`とPlaywrightはこのrepository実装gateには含めない。
- Wrangler `migrations`はCloudflare DO class migrationであり、repository test/dry-runと実環境適用を分ける。
- staging/production deploy、workflow、実環境requestは品質gateに含めず、R7PVRB-13〜15/R7PV-17の別承認まで起動しない。

## rollout・rollback gate

### repository実装PR

- local test、workerd、生成型check、staging/production dry-runだけを実行する。
- Cloudflare API/Dashboard、wrangler deploy、GitHub Actions dispatch、staging URLへ接続しない。
- rollback baseline実装PRをmergeしてもR7PVRB-13〜15、R7PV-17、R7-05、R7全体は未完了とする。

### 別承認preflight

- Workers planがFreeであることをread-only・値非表示で確認する。
- DO requests/dayとduration/dayが既存`RateLimitCounter`と共有されること、直近利用量、停止閾値を確認する。
- staging Workerのreview済みSHA、直前version、v1 migration、追加予定v2 class/binding、rollback権限を確認する。
- raw Secret、resource ID、hostname、credentialをPR・log・文書へ転記しない。

### 別承認staging

1. review済みSHAだけをstagingへdeployする。
2. binding/migration存在を値非表示で確認する。
3. synthetic fixtureとflag lifecycleを新しい承認範囲で準備する。
4. valid loginが200となりmain Workerの`exceededCpu`が再発しないことを観測する。
5. 既存R7手順に従い、11回目429、`Retry-After`、CORS/security headerを確認する。
6. fixture cleanup、flag `false`復旧、利用量、固定event、PII非露出を確認する。
7. 成功・失敗にかかわらずR7 Evidenceを追記する。

### rollback

- verifier 503増加、binding/migration不一致、DO quota異常、PII露出、main Worker `exceededCpu`再発時はrequestを増やさず停止する。
- pre-v2 versionへrollbackしない。別承認で同じreview済みcommitからbaselineを先行deployし、v2適用後の通常版とbaseline versionだけをrollback候補にする。
- baselineへrollbackした最小確認後、同じreview済みcommitの通常版を再deployする。
- `PasswordVerifierDurableObject` namespaceとv2 migrationを直後に削除しない。
- health/CORS/authの最小確認も別承認範囲に従う。
- resource cleanupはrollback安定後の別承認作業とする。

## 停止条件

- bcrypt cost 12の低下、plaintext比較、弱いhashへの変更が必要になる。
- Workerでlocal bcrypt fallbackが必要になる。
- password/hash/account識別子/raw errorをstorage、log、response、監査へ出す必要が生じる。
- public verifier endpoint、追加の外部provider、DB raw queryが必要になる。
- Free planでSQLite-backed DOまたは必要quotaを利用できない。
- 最新公式仕様でDO CPU/request/duration前提が変わっている。
- repository実装中にCloudflare resource、deployment、workflow、実環境requestが必要になる。
- unrelatedなregister/reset/user password経路まで同一PRで変更する必要が生じる。

停止時はscopeを広げず、根拠、代替案、費用、security、rollbackを再提示して別承認を求める。

## 完了判定

### repository実装完了

- R7PV-01〜R7PV-15が完了し、計画書の対象ファイル・task・実装記録が実態と一致する。
- cost 12、login API、監査、lock、token、Cookie契約が維持される。
- main Worker login graphからdirect `bcrypt.compare`が除去され、Worker fallbackがない。
- local/workerd/config/bundle/品質gateが成功する。

### 無料枠修正のstaging証拠完了

- R7PV-16のread-only確認済み証拠を前提に、R7PVRB-13〜15とR7PV-17を別承認で実施し、valid login 200、main Worker `exceededCpu`非再発、11回目429、cleanup、quota、post-v2 rollback証拠を記録する。

### R7全体

本計画のrepository実装またはstaging証拠だけでR7全体を完了扱いにしない。
R7-02、R7-10〜R7-20、WAF、監視、production分離、production preflight/smoke、rollback等は
`r7-rate-limit-environment-gates`の正本に従って継続する。

## 実装完了

- 完了日: 2026-07-24
- 実装ブランチ: `feature/r7-password-verification-free-worker`
- PR: [#150](https://github.com/RitukoIsibasi0222/gensoko/pull/150)（develop向けReady）
- 完了範囲: R7PV-01〜R7PV-15

### TDD実施記録

- Red: verifier port/DI、Worker fallback禁止、503時の状態非変更、DO strict result/非永続化、binding/v2 migration、bundle境界を未実装理由で失敗確認した。
- Red追加: verifier障害前の期限切れlock更新、production一時configのentrypoint解決、production bundle metadata entrypointを回帰testで失敗確認した。
- Green: port、Node adapter、DO class/caller adapter、auth/service/Worker DI、固定503、config/migration/生成型を実装し、対象testを通した。
- Refactor: 503 helperと固定error/eventを共通化し、Node専用bcrypt adapterのbundle混入禁止、credential非露出、Worker fallbackなしを再確認した。

### 計画からの変更点

- verifier障害時にDB状態を完全に不変とするため、期限切れlockのresetをverifier結果確定後まで遅延した。誤password時の既存fail count契約と、成功時のtransaction内resetは維持した。
- Node buildへWorker専用DO caller adapterを混入させないため、`backend/tsconfig.json`と`backend/tsconfig.workers.json`へruntime境界を明示した。
- production dry-runの既存一時configが出力ディレクトリ基準でentrypointを解決していたため、repository root隣接のPID付き一時configへ変更し、`finally`削除を維持した。
- bundle metadata parserへ`worker.ts`と`worker-production.ts`の2 entrypointだけを明示許可し、production bundleにも同じNode依存禁止contractを適用した。

### 実際の変更ファイル

- 上記「対象ファイル一覧」の41ファイルと`git diff --name-status develop...feature/r7-password-verification-free-worker`を一致させた。
- Prisma schema/migrationは変更していない。Wrangler DO migrationは既存v1を変更せず、v2 `new_sqlite_classes`として追加した。

### 最終品質gate

| Gate | 結果 |
| --- | --- |
| `npm run test -- --run` | 1124 passed / 10 skipped |
| `npm run test:workers` | 32 passed |
| `npm run build` | 成功 |
| `npm run workers:build` | 成功 |
| `npm run workers:production:dry-run` | ローカルダミー値で成功 |
| `npm run lint` | 成功 |
| `npm run format:check` | 成功 |

### 未実施・未完了

- R7PV-16のFree plan・共有DO quota・staging resource・review済みSHAはread-onlyで確認済み。R7PVRB-13〜15とR7PV-17の再preflight、staging deploy/request、valid login、11回目429、post-v2 rollback証拠は実施していない。
- staging/production request、GitHub Actions workflow dispatch、Cloudflare resource/binding/Secret/Environment Variableの実環境変更、dry-runを除く実環境deploy、DB schema/migration変更は実施していない。
- R7-05、R7全体、v0.1公開gateは未完了のままとする。
