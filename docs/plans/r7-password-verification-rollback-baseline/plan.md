# R7 Password verification rollback互換baseline TDD実装計画

> 設計者ロール: シニアバックエンドエンジニア / Cloudflare Workersエンジニア / セキュリティエンジニア
>
> repository実装は緊急時の選択肢として保持する。2026-07-28以降のv0.1では通常DO版をM5で配備し、M6で確認する。
> M2 staging campaignとR7PVRB-13〜15のbaseline deploy・rollback drillは公開後へ移す。本計画全体は未完了のまま継続する。

## 概要

R7 Free Worker password verification分離は、SQLite-backed Durable Object classを追加する
v2 migrationを含む。Cloudflare WorkersはDurable Object class lifecycle変更を跨ぐversion rollbackを
許可しないため、v2適用後に現在のpre-v2 staging versionへ直接戻す手順はrollbackとして成立しない。

本タスクでは、v2 migration・binding・class exportを通常版と共有しながら、stagingでだけ
旧来のcost 12 local bcrypt照合へ明示的に戻せるrollback互換baselineをTDD実装する。
通常staging Workerとproduction Workerにはlocal bcrypt fallbackを追加せず、baseline専用entrypoint、
専用bundle profile、短時間の承認付き運用で境界を固定する。

この文書はrepository実装計画である。Cloudflare resource変更、deployment、version rollback、
staging/production request、workflow dispatch、fixture操作は別承認まで実施しない。

## 基準状態

- 確認日: 2026-07-24
- 基準branch: `develop`
- 基準commit: `f30e266ef605b586719442d074708990f4c4fa83`
- 計画branch: `docs/plan-r7-password-verification-rollback-baseline`
- PR #150は基準commitとして`develop`へmerge済み
- R7PV-01〜R7PV-15: repository実装完了
- R7PV-16: Free plan、共有DO quota、staging resource、review済みSHAをread-only確認済み
- R7PV-17: 未実施。v0.1は通常DO版のdeploy・valid login・最小auth 429だけをM5/M6で確認し、M2 staging campaignとrollback証拠は公開後へ移す
- staging/production resource値、version ID、hostname、Secretは本計画へ記録しない

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`backend/src/lib/password-verifier.ts`**

- `PasswordVerifier.verify(input): Promise<boolean>` — runtime共通のpassword照合port。
- `PasswordVerificationUnavailableError` — raw原因を保持しない固定障害型。

**`backend/src/lib/bcrypt-password-verifier.ts`**

- `createBcryptPasswordVerifier(): PasswordVerifier` — Node/test向けcost 12 local adapter。

**`backend/src/lib/durable-object-password-verifier.ts`**

- `createDurableObjectPasswordVerifier(namespace): PasswordVerifier` — account単位のDO stubを選び、strict booleanだけを受け取るWorkers adapter。

**`backend/src/lib/worker-request-adapters.ts`**

- `createWorkerRequestAdapters(factories?)` — request単位のPrisma、mail、rate limit、password verifier adapterを生成する。

**`backend/src/lib/worker-config.ts`**

- `getWorkerRuntimeConfig(options)` — target、Hyperdrive、rate limit DO、password verifier DOを値非表示でfail-fast検証する。

**`backend/src/worker-handler.ts`**

- `createWorkerHandler(options)` — runtime configとrequest adapterをapp dependencyへ接続する。

**`backend/src/worker.ts`**

- staging通常版entrypoint。`RateLimitCounter`と`PasswordVerifierDurableObject`をexportする。

**`backend/src/worker-production.ts`**

- production専用entrypoint。stagingと分離したtarget検証を持つ。

**`backend/src/lib/worker-bundle-contract.ts`**

- `assertWorkerBundleInputs(inputPaths)` — Node entrypoint、Node mail/Prisma、memory rate limit、local bcrypt adapterの通常Workers bundle混入を拒否する。

**`backend/src/lib/worker-bundle-metadata.ts`**

- `readWorkerBundleInputPaths(metadataPath)` — 許可済みWorkers entrypointを含むmetafileだけを解析する。

### Cloudflare公式仕様（2026-07-24確認）

- [Workers rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) — Durable Object class lifecycle変更を含むversionを跨いだrollbackはできない。
- [Durable Object migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/) — migration tagは一意かつ順序付きであり、適用済みtagの変更・再利用をしない。
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) — Workers FreeのCPU制約下ではmain Workerのcost 12 bcryptは既知の`exceededCpu`リスクである。

### 重要な制約

- v2適用後のpre-v2 versionをrollback先として扱わない。
- 既存v1・追加済みv2 migrationを変更、削除、tag再利用しない。v3 migrationを追加しない。
- baselineは通常版と同じv2 class lifecycle、binding名、class exportを持つ。
- baselineはstaging専用とし、production config、production entrypoint、通常staging entrypointへimportしない。
- baselineのlocal bcryptは自動fallbackではなく、専用entrypointの明示的dependency injectionだけで選択する。
- bcrypt cost 12を下げない。plaintext比較、弱いhash、DB側照合、raw queryを追加しない。
- baselineは既知のmain Worker CPUリスクを一時的に受容する緊急復旧版であり、長期稼働版や成功版として扱わない。
- baseline deployと通常版deployは同じreview済みcommitから生成し、別commit・未review差分を混ぜない。
- password、hash、email、username、user ID、IP、token、Cookie、Authorization、DB URL、
  resource ID、hostname、raw errorをconsole、response、metadata、文書へ出さない。
- baseline有効中もlogin 503/429、Cookie、監査、account lock、refresh token契約を変更しない。
- deployment、rollback、request、fixture、flag、resource cleanupはrepository実装と分離し、対象・手順・停止条件を示した別承認を得る。
- R7PV-17、R7-05、R7全体、v0.1公開gateをrepository実装だけで完了扱いにしない。

## スコープ

- staging専用rollback baseline entrypointを追加する。
- 既存`createBcryptPasswordVerifier`を再利用し、同じbcrypt照合実装を複製しない。
- `createWorkerRequestAdapters`の既存factory injectionを使い、baseline entrypointだけがlocal adapterを選ぶ。
- baseline用一時Wrangler config generatorとdry-run CLIを追加する。
- baseline configが通常stagingと同じWorker、binding、v1/v2 migrationを使い、専用entrypointだけを差分とする契約を追加する。
- bundle metadata/contractを通常staging、production、baselineのprofile別に検証する。
- production/通常staging bundleへbaseline moduleが混入しないcontractを追加する。
- rollout、rollback drill、停止条件をdeployment文書とR7計画へ同期する。

## 非スコープ

- Cloudflareへのdeploy、rollback、resource作成・削除、binding変更。
- staging/production HTTP request、synthetic fixture、flag変更。
- pre-v2 versionへ戻す仕組み、migration履歴の巻き戻し。
- baselineの自動選択、環境変数による動的fallback、障害時の自動deploy。
- production向けlocal bcrypt経路。
- password verifier DO namespaceの削除。
- bcrypt cost、algorithm、login API、rate limit thresholdの変更。
- register、reset-password、users経路の追加分離。
- R7-02、WAF、production resource、production smoke等のR7残タスク。

## 採用構成

```text
同じreview済みcommit
  ├─ 通常staging bundle
  │    entrypoint: worker.ts
  │    password verification: Durable Object RPC
  │    v1 + v2 migration / 2 DO class export
  │
  ├─ production bundle
  │    entrypoint: worker-production.ts
  │    password verification: Durable Object RPC
  │    baseline module混入禁止
  │
  └─ rollback baseline bundle
       entrypoint: worker-staging-rollback-baseline.ts
       password verification: 既存cost 12 local adapterを明示DI
       v1 + v2 migration / 2 DO class export
       staging専用一時configからだけbuild/deploy可能
```

baselineを先にstagingへdeployするとv2 lifecycleが適用される。その後に通常版をdeployする。
以後はbaseline versionと通常版versionの双方がv2 lifecycleを持つため、その2 version間の
rollback drillが可能になる。pre-v2 versionは記録対象ではあってもrollback候補にはしない。

## 設計上の決定事項

1. **rollback先**
   - 選択: v2 lifecycleを持つstaging専用baseline version。
   - 根拠: pre-v2 versionへのrollbackはCloudflareのDO lifecycle制約により拒否されるため。

2. **baselineの動作**
   - 選択: loginのpassword verificationだけをcost 12 local bcryptへ戻す。
   - 根拠: DO verifier障害から旧来の認証動作へ戻す目的を満たし、auth service、DB、rate limit、token、Cookie契約を変えないため。

3. **CPUリスク**
   - 選択: stagingの緊急・短時間baselineとして明示的に受容する。
   - 根拠: 旧来動作はvalid loginで`exceededCpu`を起こし得るため、通常運用には不適切だが、DO分離の不具合時に既知状態へ戻す限定用途はあるため。

4. **自動fallback**
   - 選択: 禁止。
   - 根拠: runtime障害時のlocal bcrypt再実行は、障害を隠して同一requestをCPU failureへ導くため。

5. **entrypoint分離**
   - 選択: 専用entrypointを追加し、環境変数mode切替は採用しない。
   - 根拠: production graphへ到達可能なfallback分岐を作らず、bundle自体で挙動を識別できるため。

6. **adapter再利用**
   - 選択: 既存`createBcryptPasswordVerifier`をbaseline entrypointから明示的に再利用する。
   - 根拠: 同じbcrypt照合と固定error処理を複製せず、許可範囲はbundle profileでbaselineだけに限定できるため。

7. **bundle contract**
   - 選択: `standard`、`production`、`staging-rollback-baseline`のprofileを明示し、baseline例外をprofile引数なしの共通関数へ混ぜない。
   - 根拠: 通常bundleでのlocal bcrypt禁止をdefault denyのまま維持するため。

8. **Wrangler config**
   - 選択: checked-inの通常`wrangler.jsonc`は変更せず、既存設定を検証してbaseline用一時configを生成する。
   - 根拠: 常設設定のentrypoint差し替え事故を避け、同じWorker/resource/migration契約との差分を専用entrypointだけに限定するため。

9. **一時config**
   - 選択: repository root近傍にprocess単位の一時fileを権限制限付きで生成し、成功・失敗とも`finally`で削除する。
   - 根拠: entrypoint解決を維持し、環境値をrepositoryやcommitへ残さないため。

10. **同一commit保証**
    - 選択: baseline/通常版のbuild metadataへ同じreview済みcommitを運用上照合し、dirty worktreeを拒否する。
    - 根拠: rollback差分をpassword verification modeだけに限定し、未review変更を排除するため。

11. **migration**
    - 選択: baselineも通常版と同じv1/v2配列を使用する。
    - 根拠: rollback可能性はclass lifecycle一致で成立し、追加migrationは不要なため。

12. **rollback drill後**
    - 選択: baselineへrollbackして最小確認後、review済み通常版を再deployしてstagingを復旧する。
    - 根拠: baselineを常時稼働させず、DO分離版をstagingの目標状態に戻すため。

## 公開インターフェース案

```typescript
export type WorkerBundleProfile =
  | "standard"
  | "production"
  | "staging-rollback-baseline";

export function assertWorkerBundleInputs(
  inputPaths: readonly string[],
  profile?: WorkerBundleProfile,
): void;

export function buildStagingRollbackBaselineConfig(
  checkedInStagingConfig: unknown,
): Readonly<Record<string, unknown>>;
```

- `assertWorkerBundleInputs`の既定profileは通常版とし、local bcryptを引き続き拒否する。
- baseline profileでもNode server、Nodemailer、Node Prisma singleton、memory rate limitを拒否する。
- baseline profileだけが既存local bcrypt adapterを許可し、standard/production profileは引き続き拒否する。
- config builderは値を新規入力せず、checked-in staging configのtarget、binding、migration契約を検証して
  entrypointだけをbaselineへ置換する。

## API仕様

`POST /api/v1/auth/login`の公開仕様は変更しない。

| 状態                     | 期待結果                                                         |
| ------------------------ | ---------------------------------------------------------------- |
| 通常staging/production   | DO verifierを1回呼ぶ                                             |
| baseline・正しいpassword | local cost 12照合後、既存200/Cookie契約                          |
| baseline・誤password     | 既存401/fail count契約                                           |
| baseline・CPU超過        | Cloudflare側失敗を安全分類し、requestを増やさず停止              |
| binding欠損              | baselineでもruntime configの固定503。bindingを無視して起動しない |

baselineはv2 binding/class lifecycleを保持するため、local adapterがbindingを呼ばなくても
`PASSWORD_VERIFIER` bindingの存在検証を省略しない。

## 対象ファイル一覧

| ファイル                                                           | 変更種別 | 内容                                               |
| ------------------------------------------------------------------ | -------- | -------------------------------------------------- |
| `backend/src/worker-staging-rollback-baseline.ts`                  | 新規     | staging専用baseline entrypointと明示DI             |
| `backend/src/worker-staging-rollback-baseline.test.ts`             | 新規     | local adapter明示DI、binding必須、class export契約 |
| `backend/src/lib/staging-rollback-worker-config.ts`                | 新規     | checked-in staging設定からbaseline一時configを生成 |
| `backend/src/lib/staging-rollback-worker-config.test.ts`           | 新規     | entrypoint以外同一、staging限定、v1/v2固定test     |
| `backend/src/scripts/runStagingRollbackBaselineDryRun.cli.ts`      | 新規     | 一時config生成・dry-run・確実な削除                |
| `backend/src/scripts/runStagingRollbackBaselineDryRun.cli.test.ts` | 新規     | dry-run成功・失敗時の削除と固定error契約           |
| `backend/src/lib/worker-bundle-profile.ts`                         | 新規     | bundle profileとentrypoint対応の一元管理           |
| `backend/src/lib/worker-bundle-contract.ts`                        | 修正     | profile別default denyとbaseline限定許可            |
| `backend/src/lib/worker-bundle-contract.test.ts`                   | 修正     | 通常/production混入拒否、baseline限定許可          |
| `backend/src/lib/worker-bundle-metadata.ts`                        | 修正     | baseline entrypointをprofile付きで検証             |
| `backend/src/lib/worker-bundle-metadata.test.ts`                   | 修正     | entrypoint/profile不一致を拒否                     |
| `backend/src/scripts/checkWorkerBundle.cli.ts`                     | 修正     | allowlist済みprofile引数を検証してcontractへ渡す   |
| `backend/src/worker-config-files.test.ts`                          | 修正     | 常設configがbaseline entrypointを参照しない契約    |
| `backend/src/lib/production-worker-config.test.ts`                 | 修正     | production生成物へbaseline path/modeがない契約     |
| `backend/tsconfig.workers.json`                                    | 修正     | baseline専用Workers graphを型検査対象へ追加        |
| `backend/tsconfig.json`                                            | 修正     | Node buildからbaseline Workers entrypointを分離    |
| `backend/package.json`                                             | 修正     | baseline dry-run/build検証script                   |
| `docs/11_deployment.md`                                            | 修正     | post-v2 baseline rollout/rollback runbook          |
| `docs/plans/r7-password-verification-free-worker/plan.md`          | 修正     | pre-v2 rollback記述を互換baseline依存へ訂正        |
| `docs/plans/r7-rate-limit-environment-gates/plan.md`               | 修正     | R7PV-17の前提、証拠、停止条件を同期                |
| `docs/plans/r7-password-verification-rollback-baseline/plan.md`    | 修正     | 本計画と実装完了記録                               |
| `docs/05_progress.md`                                              | 修正     | baseline計画・実装・実環境証拠を分離して同期       |

実装完了時は`git diff --name-status`と照合し、追加・変更・未実装をこの表へ反映する。

## TDD方針

### Red

1. baseline entrypointだけが既存local adapter factoryを注入するtestを追加する。
2. 通常staging/production bundleへlocal adapterが入ると失敗するcontract testを追加する。
3. baseline profile以外でbaseline entrypoint・local adapterを許可しないmetadata/contract testを追加する。
4. baseline configが通常stagingと同じname、target、binding、v1/v2 migrationを持ち、
   entrypointだけを変更するtestを追加する。
5. baseline configへのproduction target、欠損binding、migration差分、追加secret、未知keyを拒否するtestを追加する。
6. 一時configが成功・dry-run失敗の双方で削除されるCLI testを追加する。
7. 変更対象testだけを実行し、専用entrypoint、adapter、profile、config builder未実装の理由で失敗確認する。

### Green

1. baseline entrypointで既存Worker handlerへ`createBcryptPasswordVerifier`を明示注入し、2 DO classをexportする。
2. profile別bundle metadata/contractをdefault denyで実装する。
3. checked-in staging configをstrict検証し、entrypointだけを差し替えるconfig builderを実装する。
4. 権限制限付き一時configとdry-run CLIを実装する。
5. 対象unit、config、bundle、Workers testを通す。

### Refactor

1. cost 12、固定error、path正規化、profile allowlistの重複をsingle sourceへ集約する。
2. local adapterのWorkers importがbaseline entrypoint/test以外にないことを確認する。
3. 通常/production bundle metadataにlocal bcrypt moduleがないことを確認する。
4. baseline bundleにもNode server、Nodemailer、Node Prisma、memory rate limitがないことを確認する。
5. 常設Wrangler config、production generator、runtime envへbaseline modeがないことを確認する。
6. raw値がtest fixture、CLI output、error、文書へ出ないことを確認する。
7. 対象testと直接影響するWorkers/config testを再実行し、Prettierと文書同期を行う。

## テストケース一覧

| ケース                                                 | 期待結果                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| baseline entrypoint                                    | staging target、2 DO class export、local adapterを明示注入 |
| baseline binding欠損                                   | 固定503、local adapterで設定不備を迂回しない               |
| baseline match/mismatch                                | cost 12互換のtrue/false                                    |
| baseline adapter exception                             | 固定unavailable error、raw causeなし                       |
| baseline log/response                                  | credential、ID、raw error非露出                            |
| standard bundle + baseline adapter                     | contract error                                             |
| production bundle + baseline adapter                   | contract error                                             |
| baseline bundle + local adapter                        | contract成功                                               |
| baseline bundle + Node server/mail/Prisma/memory store | contract error                                             |
| entrypoint/profile不一致                               | metadata error                                             |
| baseline config                                        | 通常stagingとentrypoint以外の運用契約が一致                |
| baseline config migration                              | v1/v2が同一順序で、v3なし                                  |
| baseline config target                                 | staging以外を拒否                                          |
| baseline config secret                                 | checked-in varsへのsecret混入を拒否                        |
| production config                                      | baseline path/modeなし                                     |
| checked-in staging config                              | baseline pathを常設しない                                  |
| dry-run成功                                            | 一時configを削除                                           |
| dry-run失敗                                            | 一時configを削除し、固定errorだけを返す                    |
| dirty worktree deploy preflight                        | deploy手順を停止                                           |
| commit不一致                                           | baseline/通常版の連続deployを停止                          |

## タスクリスト（3回レビュー）

### v1: 初版

- baseline専用entrypointから既存local adapterを明示再利用する。
- v2 lifecycleを共有する一時Wrangler configを追加する。
- bundle metadata/contractをbaseline entrypointへ対応する。
- unit、config、bundle、Workers testを追加する。
- deployment/R7文書を同期する。

### v2: security・failure・運用レビュー

- local bcryptを自動fallbackから専用entrypointの明示DIへ限定した。
- 既存local adapterを再利用して重複実装を避け、通常/production bundleの禁止contractを維持した。
- binding欠損時にもbaselineが設定不備を迂回しない条件を追加した。
- raw credential、account識別子、resource値、raw errorの非露出をtest条件へ追加した。
- baselineのCPU超過を既知リスクとして記録し、requestを増やさない停止条件を追加した。
- dirty worktree、commit不一致、target不一致をdeploy前停止条件にした。
- external deploy、rollback、fixture、cleanupを別承認へ分離した。

### v3: consistency・migration・rollbackレビュー

- pre-v2 rollbackを禁止し、baseline/通常版のpost-v2 version間だけをrollback対象にした。
- v1/v2 migrationの同一順序、class export、bindingを両bundleで固定した。
- checked-in staging configを常設baselineへ変更しない設計へ修正した。
- production config/entrypointにbaseline pathやmodeが存在しない回帰testを追加した。
- baseline先行deploy、通常版deploy、rollback drill、通常版再deployの順序を固定した。
- baseline有効時間、unexpected traffic、quota/CPU、PII、cleanup失敗を停止条件へ追加した。
- repository実装完了とR7PV-17/R7全体完了を分離した。

### v4: 確定

| タスクID  | 内容                                                | ファイル            | 優先度 | 外部操作 |
| --------- | --------------------------------------------------- | ------------------- | ------ | -------- |
| R7PVRB-01 | Red: baseline明示DI・自動fallback禁止契約           | Worker tests        | 高     | なし     |
| R7PVRB-02 | Red: profile別bundle・metadata境界                  | bundle tests        | 高     | なし     |
| R7PVRB-03 | Red: v2同一config・staging限定・一時file契約        | config/CLI tests    | 高     | なし     |
| R7PVRB-04 | Green: baseline entrypointと既存local adapter明示DI | Worker entrypoint   | 高     | なし     |
| R7PVRB-05 | Green: profile別bundle contract/CLI                 | bundle libs/scripts | 高     | なし     |
| R7PVRB-06 | Green: baseline config builder                      | config lib          | 高     | なし     |
| R7PVRB-07 | Green: baseline dry-run CLIと一時file削除           | script              | 高     | なし     |
| R7PVRB-08 | Refactor: default deny・値非露出・重複排除          | backend             | 高     | なし     |
| R7PVRB-09 | 対象unit/config/bundle/Workers回帰test              | backend             | 高     | なし     |
| R7PVRB-10 | backend最終品質gate                                 | backend             | 高     | なし     |
| R7PVRB-11 | deployment・R7計画・進捗同期                        | docs                | 中     | なし     |
| R7PVRB-12 | code/docs分割commit・push・PR                       | Git/GitHub          | 中     | PRのみ   |
| R7PVRB-13 | review/merge後のread-only再preflight                | Cloudflare/Git      | 高     | 別承認   |
| R7PVRB-14 | baseline先行deploy・通常版deploy                    | staging             | 高     | 別承認   |
| R7PVRB-15 | R7PV-17証拠・rollback drill・通常版復旧             | staging             | 高     | 別承認   |

- [x] R7PVRB-01: baseline明示DI・自動fallback禁止のRed testを追加する
- [x] R7PVRB-02: profile別bundle・metadata境界のRed testを追加する
- [x] R7PVRB-03: v2同一config・staging限定・一時fileのRed testを追加する
- [x] R7PVRB-04: baseline entrypointで既存local adapterを明示DIする
- [x] R7PVRB-05: profile別bundle contract/CLIをGreen実装する
- [x] R7PVRB-06: baseline config builderをGreen実装する
- [x] R7PVRB-07: baseline dry-run CLIと一時file削除をGreen実装する
- [x] R7PVRB-08: default deny・値非露出・重複を再レビューする
- [x] R7PVRB-09: 対象unit/config/bundle/Workers回帰testを通す
- [x] R7PVRB-10: backend最終品質gateを通す
- [x] R7PVRB-11: deployment・R7計画・進捗を同期する
- [x] R7PVRB-12: code/docsを分割commitしpush・PRを作成する
- [ ] R7PVRB-13: 別承認でreview済みSHA・v2構成・version lifecycleをread-only再確認する
- [ ] R7PVRB-14: 別承認でbaselineを先行deployし、同一SHAの通常版をdeployする
- [ ] R7PVRB-15: 別承認でR7PV-17証拠、rollback drill、通常版復旧を完了する

### タブ区切り

```tsv
タスクID	タスク内容	ファイル	優先度
R7PVRB-01	Red: baseline明示DI・自動fallback禁止契約	Worker tests	高
R7PVRB-02	Red: profile別bundle・metadata境界	bundle tests	高
R7PVRB-03	Red: v2同一config・staging限定・一時file契約	config/CLI tests	高
R7PVRB-04	Green: baseline entrypointと既存local adapter明示DI	backend/src/worker-staging-rollback-baseline.ts	高
R7PVRB-05	Green: profile別bundle contract/CLI	backend/src/lib・scripts	高
R7PVRB-06	Green: baseline config builder	backend/src/lib/staging-rollback-worker-config.ts	高
R7PVRB-07	Green: baseline dry-run CLIと一時file削除	backend/src/scripts/runStagingRollbackBaselineDryRun.cli.ts	高
R7PVRB-08	Refactor: default deny・値非露出・重複排除	backend	高
R7PVRB-09	対象unit/config/bundle/Workers回帰test	backend	高
R7PVRB-10	backend最終品質gate	backend	高
R7PVRB-11	deployment・R7計画・進捗同期	docs	中
R7PVRB-12	code/docs分割commit・push・PR	Git/GitHub	中
R7PVRB-13	review済みSHA・v2構成・version lifecycle再preflight	Cloudflare/Git	高
R7PVRB-14	baseline先行deploy・同一SHA通常版deploy	staging	高
R7PVRB-15	R7PV-17証拠・rollback drill・通常版復旧	staging	高
```

## 品質gate

実装・再レビュー・文書同期後に原則1回実行する。

```bash
cd backend
npm run test -- --run
npm run test:workers
npm run build
npm run workers:build
npm run workers:rollback-baseline:dry-run
npm run workers:production:dry-run
npm run lint
npm run format:check
```

- `workers:build`は通常staging/productionのlocal bcrypt非混入を維持する。
- `workers:rollback-baseline:dry-run`はbaseline profileだけをbuildし、metafile契約と一時config削除を確認する。
- Prisma schema/migrationを変更しないため、repository実装gateに`prisma migrate deploy`とPlaywrightを含めない。
- Cloudflare DO migrationはdry-runだけでは適用しない。実環境適用はR7PVRB-14の別承認対象とする。

## rollout・rollback gate

### repository実装PR

- local test、workerd、通常/baseline/production dry-runだけを実行する。
- Cloudflare API/Dashboardへのwrite、deploy、rollback、workflow、staging requestを行わない。
- 実装PRをmergeしてもR7PVRB-13〜15、R7PV-17、R7-05、R7全体は未完了とする。

### 別承認read-only preflight

- review済みcommit、clean worktree、通常/baseline buildのcommit一致を確認する。
- stagingがpre-v2 lifecycleであること、baseline deployがv2初回適用になることを値非表示で確認する。
- Free plan、共有DO quota、直近利用量、deploy/rollback権限を再確認する。
- baseline/通常版の予定version差分がentrypointとpassword verifier adapterだけであることをmetafileで確認する。
- raw Secret、resource ID、hostname、version IDはprivate operator contextだけで扱い、文書・PR・logへ転記しない。

### 別承認staging rollout

1. 対象、review済みcommit、実行command、停止条件、rollback先がpost-v2 baselineであることを承認文に示す。
2. clean worktreeからbaselineと通常版をbuildし、同一commitを再確認する。
3. baselineをstagingへ先行deployし、v2 migration、binding、class export、active versionだけを値非表示で確認する。
4. baseline有効中はlogin requestを送らず、5分以内に同一commitの通常版をdeployする。
5. 通常版のbinding/migration、health、CORSを確認する。
6. synthetic fixture/flag lifecycleを既存R7手順どおり準備する。
7. valid login 200、main Worker `exceededCpu`非再発、11回目429、`Retry-After`、security headerを上限内で確認する。
8. fixture cleanup、flag `false`復旧、quota、PII非露出を確認する。

### rollback drill

1. 通常版から記録済みpost-v2 baseline versionへrollbackする。
2. version lifecycle、health、CORSを値非表示で確認する。
3. 承認済み上限内でvalid loginを最大1回だけ実行する。
4. `exceededCpu`、503、quota異常を観測した場合は追加loginを行わず、baselineの既知リスクとして記録する。
5. 同じreview済みcommitの通常版を再deployし、health、CORS、binding、active versionを確認する。
6. baseline versionとnamespaceは即時削除せず、cleanupは安定確認後の別承認へ分離する。

## 停止条件

- pre-v2 versionへのrollbackが必要になる。
- baseline/通常版でv1/v2 migration、binding、class export、review済みcommitが一致しない。
- dirty worktree、未review commit、target不一致、production resource参照を検出する。
- baselineが5分以内に通常版へ置換できない、またはunexpected trafficを観測する。
- baseline有効中に`exceededCpu`、503増加、quota異常、PII/credential露出を観測する。
- bcrypt cost 12低下、plaintext比較、弱いhash、DB raw query、自動fallbackが必要になる。
- 一時configを削除できない、またはCLIがraw環境値・raw errorを出力する。
- fixture cleanup、flag `false`復旧、通常版再deployのいずれかに失敗する。
- repository実装中にCloudflare write、deployment、実環境requestが必要になる。

停止時はrequestや変更を増やさず、現在のactive lifecycle、影響範囲、安全な次の操作を
値非表示で整理して別承認を求める。

## 完了判定

### repository実装完了

- R7PVRB-01〜R7PVRB-12が完了する。
- baselineだけが既存local adapterを含み、通常staging/production bundleには含まれない。
- baseline/通常版のv1/v2 lifecycle、binding、class exportが一致する。
- 常設configやruntime envにbaseline modeが追加されない。
- unit、Workers、bundle、3種dry-run、build、lint、format gateが成功する。
- 計画書の対象ファイル、タスク、実装完了記録が実態と一致する。

### staging rollback証拠完了

- R7PVRB-13〜15を別承認で実施する。
- baseline先行deployと通常版deployが同じreview済みcommitである。
- R7PV-17のvalid login、11回目429、cleanup、quota、PII非露出を記録する。
- 通常版からpost-v2 baselineへのrollbackと、通常版への復旧を確認する。

### R7全体

本計画のrepository実装またはstaging rollback証拠だけでR7全体を完了扱いにしない。
R7の残るWAF、監視、production分離、production preflight/smoke等は
`docs/plans/r7-rate-limit-environment-gates/plan.md`を正本として継続する。

## 実装完了

- 完了日: 2026-07-24
- 実装ブランチ: `feature/r7-password-verification-rollback-baseline`
- PR: [#152](https://github.com/RitukoIsibasi0222/gensoko/pull/152)
- 完了範囲: R7PVRB-01〜R7PVRB-12
- 未完了範囲: R7PVRB-13〜15、R7PV-17全体、R7-05、R7全体。v0.1はM1R・M3・M5・M6と条件付きM4で別判定する

### TDD記録

- Red: baseline entrypoint、profile別bundle/metadata、strict config、一時file契約を先行追加し、欠落実装を理由とする18件の失敗を確認した。
- Green: 専用entrypoint、既存local adapter明示DI、config builder、bundle contract、dry-run CLIを実装し、対象53 testsを通過した。
- Refactor: profile/entrypoint対応を`worker-bundle-profile.ts`へ一元化し、対象71 testsを通過した。
- 追加Red/Green: cleanup失敗時のraw error非露出testを失敗させた後、固定error化してdry-run CLI 4 testsを通過した。

### 計画からの変更点

- bundle profileとentrypoint対応を重複させないため、`backend/src/lib/worker-bundle-profile.ts`を追加した。
- Node buildへWorkers専用entrypoint/testを混入させずWorkers typecheckへ維持するため、`backend/tsconfig.json`を対象に追加した。
- 一時configの削除自体が失敗するケースでもraw errorを出さない契約を追加した。

### 実際の変更ファイル

| ファイル                                                           | 変更種別 | 内容                                                    |
| ------------------------------------------------------------------ | -------- | ------------------------------------------------------- |
| `backend/src/worker-staging-rollback-baseline.ts`                  | 新規     | staging専用baseline entrypointと既存local adapter明示DI |
| `backend/src/worker-staging-rollback-baseline.test.ts`             | 新規     | DI、binding、class export、fallback禁止契約             |
| `backend/src/lib/staging-rollback-worker-config.ts`                | 新規     | checked-in staging設定のstrict検証と一時config生成      |
| `backend/src/lib/staging-rollback-worker-config.test.ts`           | 新規     | v1/v2、binding、target、secret非混入契約                |
| `backend/src/scripts/runStagingRollbackBaselineDryRun.cli.ts`      | 新規     | mode 0600の一時config、dry-run、確実な削除              |
| `backend/src/scripts/runStagingRollbackBaselineDryRun.cli.test.ts` | 新規     | 成功・dry-run失敗・cleanup失敗・引数欠損契約            |
| `backend/src/lib/worker-bundle-profile.ts`                         | 新規     | profileとentrypoint対応の一元管理                       |
| `backend/src/lib/worker-bundle-contract.ts`                        | 修正     | profile別default denyとbaseline限定許可                 |
| `backend/src/lib/worker-bundle-contract.test.ts`                   | 修正     | 通常/production混入拒否とbaseline限定許可               |
| `backend/src/lib/worker-bundle-metadata.ts`                        | 修正     | profileと単一entrypointの一致検証                       |
| `backend/src/lib/worker-bundle-metadata.test.ts`                   | 修正     | profile不一致・複数entrypoint拒否                       |
| `backend/src/scripts/checkWorkerBundle.cli.ts`                     | 修正     | allowlist済みprofileをbundle検証へ伝播                  |
| `backend/src/worker-config-files.test.ts`                          | 修正     | 常設config、script、tsconfigの分離契約                  |
| `backend/src/lib/production-worker-config.test.ts`                 | 修正     | productionへのbaseline path/mode非混入契約              |
| `backend/tsconfig.workers.json`                                    | 修正     | baseline Workers graphをtypecheck対象へ追加             |
| `backend/tsconfig.json`                                            | 修正     | baseline Workers graphをNode buildから分離              |
| `backend/package.json`                                             | 修正     | 3 profileのbundle検証とbaseline dry-run script          |
| `docs/11_deployment.md`                                            | 修正     | post-v2 baseline rollout/rollback境界                   |
| `docs/plans/r7-password-verification-free-worker/plan.md`          | 修正     | pre-v2 rollback記述を互換baselineへ訂正                 |
| `docs/plans/r7-rate-limit-environment-gates/plan.md`               | 修正     | R7PV-17前提と未完了境界を同期                           |
| `docs/plans/r7-password-verification-rollback-baseline/plan.md`    | 修正     | 実装タスク・設計差分・完了記録                          |
| `docs/05_progress.md`                                              | 修正     | repository実装完了と実環境作業未完了を分離              |

### 品質gate結果

| gate                      | 結果                                                    |
| ------------------------- | ------------------------------------------------------- |
| backend全テスト           | 108 files / 1153 passed、DB依存10件は既定skip           |
| Workers test              | 4 files / 32 passed                                     |
| build                     | 成功                                                    |
| 通常Workers build/dry-run | 成功、standard profile contract通過                     |
| rollback baseline dry-run | 成功、baseline profile contract通過、一時config残存なし |
| production dry-run        | 成功、production profile contract通過                   |
| lint                      | 成功                                                    |
| format check              | 成功                                                    |

Cloudflare resource変更、deploy、version rollback、staging/production request、workflow dispatch、
fixture・flag操作、namespace cleanup、Prisma schema/migration変更は実施していない。
