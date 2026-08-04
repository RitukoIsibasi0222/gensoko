# Production 元素 seed 実装計画

> 設計者ロール: シニアバックエンドエンジニア / セキュリティエンジニア / リリースマネージャー

## 概要

Gensoko ポートフォリオ版 v0.1 の M6 smoke を再開できるよう、production DBへ正本の118元素を安全に投入する承認付き手順を整備する。
既存のproduction DB workflowへmanual operationを追加し、main限定、required reviewer、review済みSHA、接続先検証、原子的な冪等upsert、実行後の独立検証、秘密情報非表示を保証する。

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`backend/src/lib/supabase-database-target.ts`**

- `validateSupabaseDatabaseTarget(target: SupabaseDatabaseTarget): void` — Environment名、project ref、Session pooler接続先を値非表示で検証する。

**`backend/prisma/seed.ts`**

- 118元素の正本定義 — Element主キーに対する`upsert`用データ。

**`.github/workflows/production-database.yml`**

- `workflow_dispatch` — production DB操作を`main`、`production` Environment、共通concurrencyへ固定する。

**`.github/workflows/staging-database.yml`**

- `seed-elements` — staging限定の既存seed操作。共通seed処理の変更後もこの契約を維持する。

### 重要な制約

- production seedは本feature branch、PR、ローカルtestでは実行しない。
- production workflow dispatchは、repository実装が`develop`と`main`へreview・mergeされた後もownerの別の明示承認まで実行しない。
- production Environmentのrequired reviewerを維持する。
- `main`以外ではEnvironment、Secret、DB接続へ到達させない。
- DB URL、project ref、email、token、resource ID、内部ID、raw errorをlog・Summary・文書へ出力しない。
- schema、migration、API仕様、Element以外のproduction dataを変更しない。
- 予期しない既存Elementがある場合は上書きや削除を行わずfail-closedにする。
- seed処理はtransaction内で完結し、途中失敗時に部分投入を残さない。
- 正常な再実行は同じ118件を維持し、追加・重複・削除を発生させない。

## 対象ファイル一覧

| ファイル                                                        | 変更種別 | 内容                                |
| --------------------------------------------------------------- | -------- | ----------------------------------- |
| `backend/src/lib/production-database-target.ts`                 | 新規     | production接続先検証wrapper         |
| `backend/src/lib/production-database-target.test.ts`            | 新規     | target検証test                      |
| `backend/src/jobs/validateProductionDatabaseTarget.cli.ts`      | 新規     | 値非表示CLI                         |
| `backend/src/jobs/validateProductionDatabaseTarget.cli.test.ts` | 新規     | CLI契約test                         |
| `backend/src/lib/elements/seed-data.ts`                         | 新規     | 118元素の正本定義                   |
| `backend/src/jobs/seedElements.ts`                              | 新規     | preflight・upsert・事後検証         |
| `backend/src/jobs/seedElements.test.ts`                         | 新規     | 原子性前提・冪等性・不正状態test    |
| `backend/src/jobs/seedElements.cli.ts`                          | 新規     | production/staging共通seed CLI      |
| `backend/src/jobs/seedElements.cli.test.ts`                     | 新規     | transaction・秘密非表示CLI test     |
| `backend/src/jobs/verifyElementSeed.cli.ts`                     | 新規     | 別processによる118件検証CLI         |
| `backend/src/jobs/verifyElementSeed.cli.test.ts`                | 新規     | 独立verify・秘密非表示CLI test      |
| `backend/prisma/seed.ts`                                        | 修正     | 共通CLIを呼ぶ互換entrypoint         |
| `backend/package.json`                                          | 修正     | target検証・seed・verify script追加 |
| `.github/workflows/production-database.yml`                     | 修正     | 承認付き`seed-elements`操作追加     |
| `backend/src/jobs/productionDatabaseWorkflow.test.ts`           | 修正     | production workflow source contract |
| `backend/src/jobs/stagingDatabaseWorkflow.test.ts`              | 修正     | 共通seed CLIとの整合                |
| `docs/05_progress.md`                                           | 修正     | M6停止理由とproduction seed進捗     |
| `docs/11_deployment.md`                                         | 修正     | production seed runbook             |
| `docs/plans/portfolio-release-v0-1-minimal/plan.md`             | 修正     | M6再開条件を同期                    |

## API仕様

APIのendpoint、request、response、status、error messageは変更しない。

## 設計上の決定事項

1. **専用workflowを増やすか**
   - 選択: 既存`Production Database Operations`へmanual operationを追加する。
   - 根拠: main guard、production Environment、required reviewer、DB concurrencyを共通化し、安全責務の重複を避けるため。

2. **seedをどのように冪等化するか**
   - 選択: 118件を主キー`upsert`し、transaction前提でpreflightから事後検証まで実行する。
   - 根拠: 初回0件と正規118件からの再実行を同じ結果にし、途中失敗の部分投入を防ぐため。

3. **既存Elementが正本と異なる場合に更新するか**
   - 選択: 更新せず停止する。
   - 根拠: 初回production seedの対象は空DBであり、不明な既存reference dataの上書きは別changeとしてreviewすべきため。

4. **実行成功をどう確認するか**
   - 選択: seed transaction内の検証に加え、別processで件数・ID集合・全公開fieldの正本一致を確認する。
   - 根拠: seed commandの固定成功messageだけに依存せず、commit後のDB状態を独立確認するため。

5. **backupを必須にするか**
   - 選択: 必須にしない。
   - 根拠: schema変更や削除を伴わず、空または正規118件だけを受理する原子的な決定的upsertであり、v0.1正本のbackup条件はmigration時に限定されているため。

## 公開インターフェース案

```typescript
export const ELEMENT_SEED: readonly Element[];

export async function seedElements(
  client: ElementSeedClient,
): Promise<{ count: number }>;

export async function verifyElementSeed(
  client: ElementReadClient,
): Promise<{ count: number }>;

export function validateProductionDatabaseTarget(
  environment: ProductionDatabaseTargetEnvironment,
): void;
```

## タスクリスト（進捗管理）

| タスクID | 内容                               | ファイル                | 優先度 | 備考                   |
| -------- | ---------------------------------- | ----------------------- | ------ | ---------------------- |
| PES1     | 計画・進捗記録                     | plan・progress          | 高     | production操作なし     |
| PES2     | production DB target validator     | backend lib/jobs        | 高     | shared validator再利用 |
| PES3     | seed data・冪等transaction・verify | backend lib/jobs/prisma | 高     | TDD                    |
| PES4     | workflow guard・操作追加           | production workflow     | 高     | main/reviewer/SHA/確認 |
| PES5     | workflow contract test             | backend test            | 高     | secret非表示含む       |
| PES6     | release正本・runbook同期           | docs                    | 高     | M6再開条件             |
| PES7     | 最終品質gate                       | backend                 | 高     | 外部DB・workflowなし   |
| PES8     | commit・push・PR                   | Git/GitHub              | 高     | base develop           |
| PES9     | production初回失敗のtimeout修正    | backend/workflow/docs   | 高     | 再実行は別承認         |

- [x] PES1: 計画・進捗記録
- [x] PES2: production DB target validator
- [x] PES3: seed data・冪等transaction・verify
- [x] PES4: production workflow guard・操作追加
- [x] PES5: workflow contract test
- [x] PES6: release正本・runbook同期
- [x] PES7: 最終品質gate
- [x] PES8: commit・push・develop向けPR
- [x] PES9: production初回失敗のtransaction timeout修正

## 技術的注意点

- Prisma v7のclient生成には`PrismaPg` adapterを使用する。
- ESM importは`.js`拡張子を付ける。
- DB target検証は`validateSupabaseDatabaseTarget`を再利用し、production固有処理を複製しない。
- workflowのseed logとverify logは一時fileへredirectし、生logを表示しない。
- Summaryには固定statusだけを記録し、SHA値・接続情報・DB row値を記録しない。
- workflow全体は既存`gensoko-batch-jobs`concurrencyで直列化する。

## テストケース一覧

| ケース                      | 期待結果                                     |
| --------------------------- | -------------------------------------------- |
| production target正常       | 値を出さず成功                               |
| staging・別project・不正URL | URLやproject refを出さず失敗                 |
| Element 0件                 | transaction内で118件upsertし正本一致         |
| 正規118件から再実行         | 件数と内容が変化せず成功                     |
| 一部・余分・不一致Element   | upsert前にfail-closed                        |
| upsert途中失敗              | transactionが失敗し成功扱いにしない          |
| seed後検証不一致            | 固定errorで失敗                              |
| non-main workflow           | Environment・Secret前に拒否                  |
| SHA・確認・承認記録不正     | DB操作前に拒否                               |
| raw seed/verify error       | logへ出さず固定日本語error                   |
| staging seed                | 既存のdevelop・staging・確認文字列契約を維持 |

## 品質確認

- 対象test: 38件成功
- backend全test: 1302件成功、10件skip
- Workers test: 32件成功
- build / Workers build / lint / format check / Prisma schema validate: 成功
- production DB接続、production workflow実行、外部deploy: 未実施
- timeout修正後の関連test: 38件成功
- timeout修正後のbackend全test 1302件、Workers test 32件、build / lint / format check / Prisma schema validate: 成功

## Production初回実行の停止記録

- production seedの初回runは、main・入力・DB target・migration currentの検証成功後、`Seed production Elements`で失敗した。
- Element APIは失敗後も空配列を返し、transaction rollbackにより部分投入が残っていないことを確認した。
- Prisma interactive transactionの既定timeoutが5秒である一方、118件を逐次upsertするCLIがtimeoutを明示していなかった。
- 有限120秒のtransaction timeout、10秒のmaxWait、workflow stepの3分上限をTDDで追加し、review・main昇格・別の明示承認が完了するまで再実行しない。

## 実装完了

- 完了日: 2026-08-04
- 実装ブランチ: `feature/production-elements-seed`
- PR: #175

### 計画からの変更点

- 既存`backend/prisma/seed.ts`の118元素定義を共通moduleへ移し、従来entrypointは共通CLIを呼ぶ互換wrapperとして維持した。
- seed/verifyが利用するPrisma依存は、testと実装の型整合を保つため実際に使うmethodだけのinterfaceへ限定した。
- production実行、PR merge、developからmainへの昇格、M6再開は本feature実装の完了対象に含めず、別承認工程として維持した。

### 実際の変更ファイル

| ファイル                                                        | 変更種別 | 内容                                 |
| --------------------------------------------------------------- | -------- | ------------------------------------ |
| `backend/src/lib/production-database-target.ts`                 | 新規     | production接続先validator            |
| `backend/src/lib/production-database-target.test.ts`            | 新規     | target validator test                |
| `backend/src/jobs/validateProductionDatabaseTarget.cli.ts`      | 新規     | 値非表示validation CLI               |
| `backend/src/jobs/validateProductionDatabaseTarget.cli.test.ts` | 新規     | CLI契約test                          |
| `backend/src/lib/elements/seed-data.ts`                         | 新規     | 正本118元素                          |
| `backend/src/jobs/seedElements.ts`                              | 新規     | preflight・transaction用seed・verify |
| `backend/src/jobs/seedElements.test.ts`                         | 新規     | 冪等性・fail-closed test             |
| `backend/src/jobs/seedElements.cli.ts`                          | 新規     | 共通transaction CLI                  |
| `backend/src/jobs/seedElements.cli.test.ts`                     | 新規     | transaction・秘密非表示test          |
| `backend/src/jobs/verifyElementSeed.cli.ts`                     | 新規     | 独立verify CLI                       |
| `backend/src/jobs/verifyElementSeed.cli.test.ts`                | 新規     | 独立verify契約test                   |
| `backend/prisma/seed.ts`                                        | 修正     | 共通CLI互換entrypoint                |
| `backend/package.json`                                          | 修正     | production seed関連script            |
| `.github/workflows/production-database.yml`                     | 修正     | 承認付きseed operation               |
| `.github/workflows/staging-database.yml`                        | 修正     | 共通seed CLI                         |
| `backend/src/jobs/productionDatabaseWorkflow.test.ts`           | 修正     | production workflow契約              |
| `backend/src/jobs/stagingDatabaseWorkflow.test.ts`              | 修正     | staging workflow契約                 |
| `docs/05_progress.md`                                           | 修正     | M6停止・repository実装状況           |
| `docs/11_deployment.md`                                         | 修正     | production seed runbook              |
| `docs/plans/portfolio-release-v0-1-minimal/plan.md`             | 修正     | M6再開条件                           |
| `docs/plans/production-elements-seed/plan.md`                   | 新規     | 設計・TDD・完了記録                  |

### Production初回失敗からの追加修正

- 修正日: 2026-08-04
- 修正ブランチ: `fix/production-elements-seed-transaction-timeout`
- Red: transaction optionsとworkflow step上限が未指定で2 test失敗
- Green: maxWait 10秒・timeout 120秒・workflow step 3分上限を追加し、対象14 testと関連38 test成功
- production再実行: review・develop/main昇格・別の明示承認まで未実施
