# R7 login CPU隔離診断 TDD実装計画

> 設計者ロール: シニアバックエンドエンジニア / Cloudflare Workersエンジニア / セキュリティエンジニア

## 概要

R7 Evidence E-07では、staging auth request 5回目の503がmain stateless Workerの
`exceededCpu`であることまで判明した。一方、具体的なCPU消費処理は未特定であり、
valid login pathの`bcrypt.compare`は有力仮説に留まっている。

本タスクでは実環境runを増やさず、Cloudflare Workers Vitest統合が提供するローカルworkerd内で、
login経路のCPU集約処理を固定operation単位に分離して測定する。raw password、hash、credential、
PIIを結果へ含めず、固定分類だけで支配的処理を判断する。

## 前提条件・依存関係

### 既存の公開インターフェース

**`backend/src/services/auth.service.ts`**

- `createAuthService(...).login(input)` — user取得、`bcrypt.compare`、JWT・refresh token生成、成功transactionを実行する。

**`backend/src/lib/password.ts`**

- `hashPassword(password)` — cost 12のbcrypt hashを生成するsingle source。

**`backend/src/middleware/rateLimit/key.ts`**

- `createRateLimitKeyDigest(input)` — Web Crypto HMAC-SHA-256でactor keyを生成する。

**`backend/src/worker-handler.ts`**

- requestごとにadapter、app dependencies、Hono appを構築する。

**`backend/vitest.config.workers.ts`**

- `@cloudflare/vitest-pool-workers`により`src/cloudflare/**/*.test.ts`をローカルworkerdで実行する。

### 実環境証拠

- R7 Evidence E-07ではauth request 1〜4が200、request 5だけ503 / `exceededCpu`だった。
- 5件は同じscript/versionで、失敗はmain stateless Worker invocationへ付与された。
- Cloudflare Workers FreeのHTTP request CPU上限は10ms。
- DB query、Durable Object RPC等のI/O待機時間そのものはWorker CPU時間へ含まれない。

### 重要な制約

- Cloudflare、GitHub Actions、staging、productionへrequestを送らない。
- workflow dispatch、fixture、DB操作、Environment Variable、Secret、Workers設定を変更しない。
- Workers Paidへ変更せず、無料枠のまま診断する。
- bcrypt costを下げず、password securityを弱めない。
- raw password、bcrypt hash、email、user ID、IP、token、Cookie、Authorizationを結果・console・文書へ出さない。
- ローカルworkerdの実時間値をCloudflare実環境の課金CPU値と同一視しない。
- timing testは絶対時間だけで合否判定せず、operation間の十分な桁差と固定分類を使う。
- R7-02、R7-05、R7全体、v0.1公開gateを完了扱いにしない。

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
| --- | --- | --- |
| `backend/src/cloudflare/login-cpu-diagnostics.test.ts` | 新規 | workerd測定、固定分類、値非露出のTDD test |
| `backend/src/cloudflare/login-cpu-diagnostics.ts` | 新規 | operation測定・要約・固定分類 |
| `docs/plans/r7-login-cpu-diagnostics/plan.md` | 新規 | 本計画とTDD・診断結果 |
| `docs/plans/r7-rate-limit-environment-gates/plan.md` | 修正 | 隔離診断証拠と次工程を同期 |
| `docs/05_progress.md` | 修正 | 診断状態とR7未完了境界を同期 |

## 診断対象

| operation ID | 対象 |
| --- | --- |
| `BCRYPT_COMPARE_COST_12` | `hashPassword`で作成したsynthetic cost 12 hashに対する実`bcrypt.compare` |
| `RATE_LIMIT_KEY_DIGEST_X3` | loginで通るgeneral IP、auth IP、auth email相当のHMAC 3回 |
| `JWT_SIGN` | login成功時のHS256署名 |
| `REFRESH_TOKEN_CRYPTO` | 32 byte random tokenとSHA-256 |
| `APP_DEPENDENCY_CONSTRUCTION` | request単位のdependenciesとHono app構築 |

DB・Durable Objectは外部接続せず、既存testとmock I/Oで呼出し境界を確認する。
I/O待機時間をCPU消費として比較対象へ混ぜない。

## 設計上の決定事項

1. **絶対時間と原因分類を分ける**
   - 選択: 測定値はmin/median/maxへ縮約し、原因判定は固定classificationへ変換する。
   - 根拠: ローカルマシン差を許容しつつ、operation間の桁差を証拠化するため。

2. **bcryptの支配判定は相対比を使う**
   - 選択: bcrypt medianが他operationの最大medianの10倍以上なら`BCRYPT_DOMINANT`とする。
   - 根拠: 10msをローカルtestの絶対合否値にせず、支配的処理だけを安定して分類するため。

3. **synthetic値を結果へ含めない**
   - 選択: operation ID、sample数、min/median/max、固定classificationだけを返す。
   - 根拠: password・hash・credential・PIIの非露出を型とtestで固定するため。

4. **診断コードをproduction graphへ含めない**
   - 選択: `src/cloudflare/`のtestからだけimportする。
   - 根拠: staging/production Workerの挙動・bundle・API契約を変更しないため。

## 公開インターフェース案

```typescript
export type LoginCpuDiagnosticOperation =
  | "BCRYPT_COMPARE_COST_12"
  | "RATE_LIMIT_KEY_DIGEST_X3"
  | "JWT_SIGN"
  | "REFRESH_TOKEN_CRYPTO"
  | "APP_DEPENDENCY_CONSTRUCTION";

export type LoginCpuDiagnosticClassification =
  | "BCRYPT_DOMINANT"
  | "MIXED_OR_INCONCLUSIVE"
  | "INSUFFICIENT_MEASUREMENTS";

export async function measureLoginCpuOperation(input: {
  operation: LoginCpuDiagnosticOperation;
  sampleCount: number;
  run: () => void | Promise<void>;
  now?: () => number;
}): Promise<LoginCpuOperationMeasurement>;

export function classifyLoginCpuMeasurements(
  measurements: readonly LoginCpuOperationMeasurement[],
): LoginCpuDiagnosticClassification;
```

## タスクリスト（3回レビュー）

### v1: 初版

- operation型、測定helper、median要約、固定分類を作る。
- workerdでbcrypt、HMAC、JWT、token、app構築を測る。
- 正本計画と進捗を更新する。

### v2: security・error review

- raw password、hash、credential、PIIの非露出testを追加する。
- 不正sample数、非有限時間、operation重複・欠損を安全側の固定分類へ倒す。
- 実環境CPU値とローカル時間の混同を禁止する。
- cost低下、delay、実環境再実行を対象外へ固定する。

### v3: consistency・regression review

- 実loginの3段rate limit順序とoperation数を既存実装へ合わせる。
- 既存`worker-production.test.ts`とWorkers runtime testを関連回帰に含める。
- 診断moduleがproduction Worker graphから到達不能であることをbundle確認対象にする。
- R7未完了、No-Go、無料枠維持を文書同期条件にする。

### v4: 確定

| タスクID | 内容 | ファイル | 優先度 |
| --- | --- | --- | --- |
| R7CPU-01 | Red: 測定・固定分類・非露出契約 | diagnostics test | 高 |
| R7CPU-02 | Green: operation測定と要約 | diagnostics本体 | 高 |
| R7CPU-03 | Green: workerd実operation測定 | diagnostics test | 高 |
| R7CPU-04 | Refactor: validationと固定classification | diagnostics本体・test | 高 |
| R7CPU-05 | 対象・関連Workers test | backend | 高 |
| R7CPU-06 | production bundle非混入確認 | Workers build metadata | 高 |
| R7CPU-07 | backend最終品質gate | backend | 高 |
| R7CPU-08 | 正本計画・進捗・診断記録を同期 | docs | 中 |
| R7CPU-09 | code/docs分割commit・push・PR | Git/GitHub | 中 |

- [x] R7CPU-01: Redで測定・固定分類・非露出契約を追加する
- [x] R7CPU-02: operation測定と要約をGreen実装する
- [x] R7CPU-03: workerdで実operationを隔離測定する
- [x] R7CPU-04: validationと固定classificationをRefactorする
- [x] R7CPU-05: 対象・関連Workers testを通す
- [x] R7CPU-06: 診断moduleがproduction bundleへ混入しないことを確認する
- [x] R7CPU-07: backend最終品質gateを通す
- [x] R7CPU-08: 正本計画・進捗・診断記録を同期する
- [ ] R7CPU-09: code/docsを分割commitしpush・PRを作成する

### タブ区切り

```tsv
タスクID	タスク内容	ファイル	優先度
R7CPU-01	Red: 測定・固定分類・非露出契約	backend/src/cloudflare/login-cpu-diagnostics.test.ts	高
R7CPU-02	Green: operation測定と要約	backend/src/cloudflare/login-cpu-diagnostics.ts	高
R7CPU-03	Green: workerd実operation測定	backend/src/cloudflare/login-cpu-diagnostics.test.ts	高
R7CPU-04	Refactor: validationと固定classification	diagnostics本体・test	高
R7CPU-05	対象・関連Workers test	backend	高
R7CPU-06	production bundle非混入確認	Workers build metadata	高
R7CPU-07	backend最終品質gate	backend	高
R7CPU-08	正本計画・進捗・診断記録を同期	docs	中
R7CPU-09	code/docs分割commit・push・PR	Git/GitHub	中
```

## テストケース一覧

| ケース | 期待結果 |
| --- | --- |
| 指定sample数の測定 | run回数とmin/median/maxが一致 |
| 偶数sampleのmedian | 中央2値の平均 |
| sample数0・負数 | 固定日本語error |
| timerが負・NaN・Infinity | 固定日本語error |
| bcryptが他operationの10倍以上 | `BCRYPT_DOMINANT` |
| operation不足・重複 | `INSUFFICIENT_MEASUREMENTS` |
| 桁差が不足 | `MIXED_OR_INCONCLUSIVE` |
| workerd実bcrypt cost 12 | compare成功、固定要約だけを生成 |
| HMAC 3回 | general/auth IP/auth email相当を実行 |
| JWT・token・app構築 | 各operationを独立測定 |
| report serialize | synthetic input・hash・credentialを含まない |

## 診断結果

- 実施日時: 2026-07-24 11:26〜11:42 JST
- environment: ローカルworkerd（`@cloudflare/vitest-pool-workers`）
- 基準commit: `d6e228d9e765b752a28e08e8c71fa0f77682746c`
- 実装branch: `feature/r7-login-cpu-diagnostics`
- 外部操作: なし。Cloudflare/GitHub Actions/staging/production request、DB、deployment、設定変更を実施していない
- TDD:
  - Red: 診断module未実装により新規suiteがmodule解決errorで失敗することを確認
  - Green: 新規12件を通過
  - Refactor: 必須operation定義を共通化し、非同期処理間のCPU混入を防ぐ直列測定へ変更。新規・関連15件を通過
- 最終workerd測定:

| operation | sample数 | min | median | max |
| --- | ---: | ---: | ---: | ---: |
| `BCRYPT_COMPARE_COST_12` | 3 | 208ms | 209ms | 209ms |
| `RATE_LIMIT_KEY_DIGEST_X3` | 5 | 0ms | 0ms | 0ms |
| `JWT_SIGN` | 5 | 0ms | 0ms | 0ms |
| `REFRESH_TOKEN_CRYPTO` | 5 | 0ms | 0ms | 0ms |
| `APP_DEPENDENCY_CONSTRUCTION` | 5 | 0ms | 0ms | 2ms |

- 固定classification: `BCRYPT_DOMINANT`
- 0msの解釈: CPU消費がないという意味ではなく、今回のローカルworkerd timer分解能未満だったことを表す
- 原因境界:
  - E-07のmain stateless Worker `exceededCpu`と組み合わせると、valid login pathのcode-level支配要因はcost 12の`bcrypt.compare`と分類できる
  - rate-limit HMAC 3回、JWT、refresh token暗号処理、request単位app構築は、bcryptと同じ桁の原因ではない
  - ローカル時間をCloudflare実環境の課金CPU値へ換算せず、DB/DO I/O待機をCPU原因とは扱わない
- production graph非混入: 一時固定設定による`src/worker-production.ts`のローカルdry-run metadataは241 inputs、production entrypoint 1件、`login-cpu-diagnostics` input 0件。実設定は変更せず一時設定を削除した
- 最終品質gate:
  - backend: 1110 passed / 10 skipped（外部DB統合）
  - Workers: 27 passed
  - build / Workers typecheck / ESLint / Prettier check: 成功
- 次工程: bcrypt costを下げず、Free Workerのvalid login CPU pathからpassword verificationを分離できる無料枠構成を別計画で設計する。設計・実装前にR7-05の429証拠取得方法とrollbackを再承認する
- R7状態: R7-02、R7-05、R7-10〜R7-20、R7全体、v0.1公開gateは未完了を維持する

## 停止条件

- 測定にstaging/production request、DB、Cloudflare設定が必要になる。
- raw password、hash、credential、PIIの出力が必要になる。
- timingの絶対値だけで不安定なtestを通す必要が出る。
- bcrypt cost低下やpassword security低下が必要になる。
- 診断moduleをproduction Workerへ組み込む必要が出る。

停止時は範囲を広げず、別計画と別承認を提示する。
