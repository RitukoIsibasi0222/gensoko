# 本番DBバックアップ耐障害性強化 実装計画

> 設計者ロール: SRE / セキュリティエンジニア

## 概要

Supabase Free planで運用するproduction DBの暗号化論理backupを、週次1世代に近い状態から日次・最大7世代へ強化する。backup失敗時の自動再試行と通知確認、backup鮮度監視、四半期ごとの隔離環境restore drillを追加し、「backupが作成された」だけでなく「期限内に検知でき、実際に復元できる」状態を運用契約にする。

個人情報を含み得るbackupの保持上限は、アカウント完全削除計画との整合を優先して7日のまま維持する。長期保持によって削除済みデータの残存期間を延ばさず、頻度を日次化することで通常時は最大7世代を確保する。

ポートフォリオ版v0.1の現在の正本は[`portfolio-release-v0-1-minimal`](../portfolio-release-v0-1-minimal/plan.md)である。M1でproductionのUser・legacy・関連row 0件と初回配備を確認できた場合、公開前は日次schedule、既存の暗号化・7日保持契約、24時間以内の成功Artifact 1世代を必須とする。2世代目以降、最大3回retry、2時間後recovery、36時間鮮度監視、通常7世代の定常確認、四半期restore drillは公開後へ分離する。M1が成立しない場合は、本計画の通常gateを維持する。

## 背景と現状

- `.github/workflows/production-database.yml`はR9実装branchでUTC毎日19:41（JST毎日04:41）へ変更済みである。`develop`へのmergeと日次scheduleの実run確認は未完了である。
- backupはroles・schema・dataをdumpし、AES-256で暗号化して復号後の内容を検査してからGitHub Actions Artifactへ保存する。
- 初回production backupは2026-07-14の手動run 29322979476でArtifact・暗号化・復号検証まで成功したが、Artifactは2026-07-21 09:48 UTCに7日保持どおり失効した。
- 2026-07-18の週次schedule run 29658935594でも暗号化・復号検証・Artifact uploadが成功し、Artifact `production-db-backup-29658935594`は2026-07-25 20:03 UTCまで未失効である。
- 2026-07-22のR9計画調査時点で、確認できる未失効production backup Artifactは1世代であり、R9の2世代条件は未達である。
- Artifactの保持期間は7日であり、週次backupが1回失敗すると有効な世代がなくなる可能性がある。
- `migrate-deploy`とaccount deletion executeは、24時間以内の成功backup runと期限内Artifactがなければ停止する。
- GitHub Actionsのfailed workflowメール通知は設定済みだが、backup失敗通知を意図的に検証した実績と、schedule欠落を検知する鮮度監視は未記録である。
- 復号してファイル名と非空を確認する処理はあるが、隔離DBへroles・schema・dataを復元する定期訓練は未実施である。
- Supabase Free planではproviderによる自動backup・PITRを利用できないため、GitHub Actions Artifactが主要な復旧手段となる。

## 目的

1. backupを毎日取得し、1回の失敗で復旧手段が消える状態を解消する。
2. 一時的なCLI・network障害は自動再試行し、最終失敗は安全な固定文言で通知する。
3. 成功runだけでなく、期限内・未失効Artifactの鮮度を別scheduleで確認する。
4. 四半期ごとに隔離Supabase projectへ復元し、実際に利用可能なbackupであることを確認する。
5. backup・通知・復元の証跡に個人情報、内部ID、DB接続情報、passphraseを残さない。

## v0.1最小公開境界

### 公開前に完了する項目

- T2: 日次scheduleの契約testをRedで追加する。
- T3: backup cronをJST毎日04:41へ変更し、暗号化・7日保持・手動実行・migration gateを回帰させる。
- M4: 24時間以内の成功Artifact 1世代、暗号化・checksum・平文非保存、日次schedule有効を確認する。
- T10・T11のうち、日次化に関するrunbook・リリース計画・進捗を実態へ同期する。

### 初回公開後に継続する項目

- 最大3回retry、当日Artifact欠落時の2時間後recovery、36時間鮮度監視。
- failed workflow通知の意図的な安全性・受信検証。
- T6の日次run 2回と未失効Artifact 2世代の確認。
- 通常7世代の定常運用と7日失効境界の確認。
- 手動restore drill workflow、四半期ごとの隔離restore、隔離data削除確認。

公開後項目を未実装のまま日次化だけを完了しても、本計画全体または旧R9を完了扱いにしない。v0.1の公開判定はM4の公開前項目と証拠で行う。

## 旧R9実装計画（履歴・本計画全体の継続管理）

### 本計画内での責務

旧R9は本計画のT2・T3・T6と、T10・T11の日次化に関する部分を実行する作業単位である。T6の2世代確認は本計画と旧R9の完了条件として保持するが、現在のv0.1 blockerにはしない。retry・recovery・鮮度監視・通常7世代・restore drillも本計画で継続管理する。

### R9実装PR時点の契約

| 項目                    | 現在値・構成                                                     | R9での扱い                                |
| ----------------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| backup schedule         | `41 19 * * *`（UTC毎日19:41、JST毎日04:41）                      | code・contract test完了、実run観測待ち    |
| capacity-check schedule | `23 19 * * *`（UTC毎日19:23、JST毎日04:23）                      | 変更しない                                |
| manual実行              | `workflow_dispatch`の`operation=backup`                          | 維持する                                  |
| Environment             | `production`固定                                                 | 維持する                                  |
| concurrency             | `gensoko-batch-jobs`、`cancel-in-progress: false`                | 維持する                                  |
| operation分岐           | event schedule文字列またはmanual inputから解決                   | backup cronのcaseラベルを日次値へ変更済み |
| backup対象              | `roles.sql`、`schema.sql`、`data.sql`                            | 維持する                                  |
| 暗号化                  | GnuPG symmetric AES-256、passphraseはSecret                      | 維持する                                  |
| 復号検証                | 同一run内で復号し、期待する3ファイル名と非空dumpを確認           | 維持する                                  |
| checksum                | 暗号化archiveのSHA-256                                           | 維持する                                  |
| Artifact                | 暗号化`.tar.gz.gpg`と`.sha256`を含む専用directoryだけをupload    | 維持する                                  |
| retention               | `retention-days: 7`                                              | 維持する                                  |
| 平文cleanup             | `trap`と明示cleanupで平文・検証用archiveを削除                   | 維持する                                  |
| migration前gate         | 24時間以内の成功backup run IDと未失効Artifact 1件                | 維持し、2世代要求へ変更しない             |
| 既存成功run             | 手動run 29322979476、週次schedule run 29658935594                | 実装前baselineとして記録                  |
| 現在の未失効世代        | 2026-07-22調査時点で1世代                                        | 日次化後に2世代以上を確認するまでR9未完了 |
| 現時点で未確認          | 日次cronの実run、日次schedule 2回連続成功、日次化後の未失効2世代 | R9の実環境gateで確認                      |

2026-07-22に`feature/r9-daily-backup`で日次cronのcontract testをRedからGreenへ更新した。production Actionsは実行しておらず、review・`develop`へのmerge後に日次scheduleを2回以上観測するまでR9は実装中とする。

GitHub ActionsのscheduleはUTCで解釈され、default branch `develop`の最新commitで実行される。高負荷時の遅延があり得るため、JST 04:41はcron契約の時刻とし、実行証拠には予定時刻と実際の開始日時を分けて記録する。

### R9に含める範囲

- 日次cronを要求するcontract testを先に追加し、現行週次cronを理由にRedを確認する。
- workflowのschedule宣言と`Resolve requested operation`のcaseラベルだけを日次値へ変更する。
- capacity-check等の別schedule、manual dispatch、concurrency、operation分岐を回帰させる。
- AES-256、復号検証、SHA-256、平文cleanup、Artifact内容、7日保持を回帰させる。
- migration・account deletion execute前のbackup gateを回帰させる。
- review・merge後の日次schedule runを2回以上成功させ、未失効Artifact 2世代以上を確認する。
- run ID、対象SHA、実行日時、Artifact名、失効境界、確認日時を秘密情報なしで記録する。
- `docs/05_progress.md`、v0.1 release計画、本計画、startup・deployment runbookを実態へ同期する。

### R9に含めない範囲

- 最大3回retry、2時間後recovery、36時間鮮度監視、通常7世代の定常確認。
- failed workflow通知の意図的な失敗検証、四半期restore drill、external replay source。
- Artifactの保持期間延長、production DBへのrestore、既存Artifactの手動削除。
- DB schema、migration、API、認証、frontend UI、A11Y、package、production deployの変更。
- R5、R11A、R11、R14、R15等の別release task。

### R9完了条件

以下は旧R9とbackup計画全体の完了条件であり、v0.1のM4は「v0.1公開完了条件」を使う。

- [x] 日次cronのcontract testが存在し、現行週次cronを理由に意図したRedを確認している。
- [x] workflowのschedule宣言とoperation解決だけを必要最小限変更してGreenになっている。
- [x] `41 19 * * *`がUTC毎日19:41、JST毎日04:41の契約としてtest・workflow・文書で一致している。
- [x] `workflow_dispatch`、capacity-check cron、concurrency、operation分岐が維持されている。
- [x] migration・account deletion execute前のbackup gateが維持されている。
- [x] AES-256、復号検証、SHA-256、平文cleanupが維持されている。
- [x] Artifactは暗号化archiveとchecksumだけで、`retention-days: 7`が維持されている。
- [ ] review済み変更がdefault branch `develop`へmergeされ、対象commit SHAが記録されている。
- [ ] merge後の日次schedule runが2回以上成功し、各runのoperationがbackupであることを確認している。
- [ ] 同一確認時点で未失効のproduction backup Artifactが2世代以上ある。
- [ ] run ID、実行日時、Artifact名、失効境界、確認日時を秘密情報なしで記録している。
- [ ] `docs/05_progress.md`、release計画、本計画、startup・deployment runbookが実装と証拠に一致している。
- [x] 実際の変更ファイルと本節の対象ファイル・実変更ファイルが一致している。
- [x] retry・recovery・鮮度監視・通常7世代・restore drill等を完了扱いにしていない。

### R9対象ファイル一覧

| ファイル                                                    | 変更種別 | 内容                                                         |
| ----------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| `backend/src/jobs/productionDatabaseWorkflow.test.ts`       | 修正     | 日次cron、旧週次cron不在、capacity cron維持のcontract test   |
| `backend/src/jobs/deleteLegacySoftDeletedUsers.cli.test.ts` | 修正     | CIのNode 22で発生したPrisma import失敗mockのフレークを安定化 |
| `.github/workflows/production-database.yml`                 | 修正     | backup schedule宣言とoperation解決caseを日次化               |
| `docs/plans/backup-resilience/plan.md`                      | 修正     | R9の計画、実装記録、実環境証拠、実変更ファイル               |
| `docs/05_progress.md`                                       | 修正     | R9を実装中へ更新し、2世代確認後だけ完了へ更新                |
| `docs/plans/portfolio-release-v0-1/plan.md`                 | 修正     | R9の実装・観測状態とrelease完了条件を同期                    |
| `docs/09_startup_commands.md`                               | 修正     | 日次backupの運用入口と確認境界を同期                         |
| `docs/11_deployment.md`                                     | 修正     | schedule表、2世代確認、証拠記録、rollback runbookを同期      |

R9実装PRでは上記の対象ファイルを変更する。実環境のrun ID・Artifact metadata・完了markは、実装PRのreview・`develop`へのmerge後に別の証拠docs PRで同期する。

### R9実装記録（schedule観測前）

- 実装日: 2026-07-22
- 実装branch: `feature/r9-daily-backup`
- 状態: code・contract test完了、review・mergeと日次schedule 2回・未失効Artifact 2世代の観測待ち
- Red: 対象test 6件中、追加した日次cron契約1件だけが現行週次cronを理由に失敗し、既存5件は成功
- Green: workflowのschedule宣言とoperation解決caseの2行だけを変更し、対象test 6件が成功
- CI follow-up: Node 22で既存CLI testのPrisma import失敗mockが稀に旧factoryを参照するフレークを再現したため、mock export参照時に失敗条件を評価するgetter方式へ安定化。production codeへの変更はない
- production Actions: 未実行。manual dispatch、Artifact download・復号、production DB接続、deploy、migration、cleanupは行っていない
- 公開後task: retry・recovery・36時間鮮度監視・通常7世代・通知失敗検証・restore drillは未完了のまま維持
- 最終品質gate: 対象test 6件、backend 97 files・1014 tests、Workers 15 tests、Workers build、backend build、lint、format、Prisma validate、変更ファイルのPrettier check、`git diff --check`が成功。専用DB test 10件は既定どおりskip
- 横断確認: 日次cron宣言・operation case、capacity cron、manual dispatch、concurrency、AES-256、復号、SHA-256、平文cleanup、暗号化Artifact path、7日保持、migration・account deletion execute前backup gateを確認。旧週次cronはworkflowに存在しない

### 設計上の決定事項（R9）

1. **cronをどこまで変更するか**
   - 選択: `on.schedule`とschedule eventをoperationへ解決するcaseラベルの2箇所だけを`41 19 * * *`へ変更する。
   - 根拠: 片方だけの変更による未対応schedule failureを防ぎ、別operationへ影響を広げないため。

2. **cron contractをどうtestするか**
   - 選択: 既存のsource contract方式を維持し、新しいYAML parser依存は追加しない。日次cronのschedule宣言・caseラベル、旧週次cron不在、capacity cron維持を明示検証する。
   - 根拠: package変更なしで、実装上必要な2箇所と非変更対象を直接固定できるため。

3. **未失効2世代をmigration gateへ組み込むか**
   - 選択: 組み込まない。既存gateは24時間以内の成功backup 1件を維持し、2世代は旧R9とbackup計画全体の観測完了条件として扱う。
   - 根拠: migration直前性とrelease耐障害性は目的が異なり、R9で既存operation契約を不用意に変更しないため。

4. **実環境証拠をいつ取得するか**
   - 選択: workflow変更をreview・`develop`へmergeした後、原則として2回の自動scheduleを待つ。
   - 根拠: scheduleはdefault branchの最新commitで実行され、feature branchや計画branchでは日次契約の実環境証拠にならないため。

5. **Artifact内容をどう確認するか**
   - 選択: 通常はcontract test、review済みworkflow、暗号化・復号検証・upload step成功、Artifact metadataで確認し、Artifactをdownload・復号しない。
   - 根拠: R9はrestore drillではなく、個人dataを含み得るArtifactの不要な複製を避けるため。直接のarchive file一覧確認が必要になった場合は、事前の明示承認を別途得る。

6. **実装と観測証拠を同じPRで完了させるか**
   - 選択: 実装PRを先にmergeし、R9は実装中のまま保持する。2回のschedule成功後に証拠docs PRで完了へ更新する。
   - 根拠: merge前にはschedule証拠を取得できず、長い観測待ちでworkflow変更のreviewを滞留させないため。

### TDD・検証手順（R9）

#### Red

1. `productionDatabaseWorkflow.test.ts`へ、schedule宣言とoperation解決caseの両方に`41 19 * * *`を要求するtestを追加する。
2. 旧週次cron`41 19 * * 6`が存在しないことと、capacity cron`23 19 * * *`が維持されることを同じ契約で確認する。
3. 対象test fileだけを実行し、現行週次cronを理由に追加testが失敗することを確認する。
4. manual dispatch、Environment、concurrency、暗号化、復号、retention、upload、migration gateの既存testが維持されることを確認する。

```bash
cd backend
npm run test -- --run src/jobs/productionDatabaseWorkflow.test.ts
```

#### Green

1. `production-database.yml`のbackup schedule宣言とoperation解決caseだけを`41 19 * * *`へ変更する。
2. capacity-checkと別operationのcron・条件・入力・権限を変更しない。
3. 対象test fileだけを再実行して成功させる。

#### Refactor

1. cron testに重複や曖昧な部分一致があれば、schedule宣言とcaseラベルの責務が読める形へ整理する。
2. 対象testと直接関係するtestだけを再実行する。
3. workflow YAMLと変更MarkdownをPrettierで整形し、意図しない全体差分を作らない。

#### 最終品質gate

実装・再review・文書同期後に原則1回、次を実行する。Red / Green中にbackend全testを繰り返さない。

```bash
cd backend
npm run test -- --run src/jobs/productionDatabaseWorkflow.test.ts
npm run test -- --run
npm run test:workers
npm run workers:build
npm run build
npm run lint
npm run format:check
npx prisma validate
npx prettier --check ../.github/workflows/production-database.yml \
  ../docs/plans/backup-resilience/plan.md \
  ../docs/plans/portfolio-release-v0-1/plan.md \
  ../docs/05_progress.md \
  ../docs/09_startup_commands.md \
  ../docs/11_deployment.md
```

- Prisma schema・migrationは変更しないが、既存backend PR qualityとrelease gateに合わせて`prisma validate`を最終確認で1回実行する。
- `git diff --check`を実行する。
- `rg`で日次cron、旧週次cron不在、capacity cron、AES256、decrypt、SHA-256、upload path、`retention-days: 7`、平文非upload、backup gateを横断確認する。
- frontend変更はないためfrontend test・buildはR9単独gateに含めず、R11の統合release候補SHAで全体確認する。

### production Actions確認手順（R9）

1. test・workflow・実装時点の文書がreview済みで、実装PRがdefault branch `develop`へmergeされていることを確認する。
2. merge commit SHAと、workflow差分が日次cronの2箇所だけであることを記録する。
3. production Environment・Secretの存在は名前と設定状態だけを確認し、値を表示・取得しない。
4. 原則として自動scheduleを待ち、日次化確認を早める目的だけでmanual dispatchしない。
5. merge後の日次schedule runが2回以上成功することを確認する。GitHub側の遅延がある場合は予定cronと実際の開始日時を分けて記録する。
6. 各runのeventが`schedule`、head branchが`develop`、head SHAが日次化commitを含むことを確認する。
7. 各runで`Resolve requested operation`、`Create and verify encrypted logical backup`、`Upload encrypted backup`が成功し、capacity・migration等のstepがskipされていることからoperation=backupを確認する。
8. 各runに`production-db-backup-{run ID}`のArtifactが1件存在し、`expired=false`であることをmetadataで確認する。
9. workflow・contract test・成功stepからAES-256暗号化archiveとSHA-256 checksumだけがupload対象で、平文dumpがArtifact pathへ含まれないことを確認する。
10. `retention-days: 7`と各Artifactの`expires_at`を確認し、repository・organization側の上限で短縮されていないことを確認する。
11. 同一確認時点で未失効のproduction backup Artifactが2世代以上あることを確認する。
12. run ID、対象SHA、実行日時、Artifact名、expiryまたは保持境界、確認日時、確認者だけを運用記録へ残す。
13. Artifact内容、Secret、`DATABASE_URL`、passphrase、DB接続情報、個人data、raw API responseをlog・Issue・PR・文書・チャットへ転記しない。
14. Artifactを不用意にdownload・復号しない。直接file一覧の確認が必要になった場合は、プロダクトオーナー`RitukoIsibasi0222`の明示承認を実行前に得る。
15. schedule failure・欠落時は同じrunを無条件に繰り返さず、原因と有効な最新Artifactを確認する。manual backupが必要な場合も同じ明示承認を得る。
16. 2回のschedule成功と未失効2世代が揃うまでR9を完了扱いにせず、R5を進めてもR9のcheckboxは未完了に保つ。
17. 証拠取得後にprogress、release計画、本計画、startup・deployment runbookを同じ証拠へ同期する。

#### 運用記録フォーマット

| 項目                      | run 1                           | run 2                           |
| ------------------------- | ------------------------------- | ------------------------------- |
| run ID                    | 未確認                          | 未確認                          |
| head SHA                  | 未確認                          | 未確認                          |
| event / operation         | `schedule` / `backup`を確認予定 | `schedule` / `backup`を確認予定 |
| 実行日時                  | 未確認                          | 未確認                          |
| Artifact名                | 未確認                          | 未確認                          |
| expired                   | `false`を確認予定               | `false`を確認予定               |
| expiry・保持境界          | 未確認                          | 未確認                          |
| 暗号化・復号・upload step | 未確認                          | 未確認                          |
| 確認日時・確認者          | 未確認                          | 未確認                          |

この表へSecret値、Artifactのdigest・download URL・内容、DB情報、個人dataを記載しない。

### R5・後続taskとの並行作業

- R9実装とR5を同じbranch・worktree・commitへ混在させない。
- R9は`feature/r9-daily-backup`相当の専用branchでtest・workflowを先にreview可能にし、merge後は証拠docs branchで観測結果を記録する。
- schedule観測待ち中のR5は別branchまたはworktreeで進められる。
- `docs/05_progress.md`、release計画、deployment runbookは競合し得るため、各PRのmerge前に最新`develop`へrebaseまたは安全な同期を行い、R9の実装中・完了状態を落とさない。
- R11Aの依存調査は並行可能だが、実際のpackage更新はR5のproduction認証構成確定後を基本とする。
- R11はR5・R9・R11A等を統合したrelease候補SHAで実行する。
- R14・R15はR9の2世代確認とrelease文書同期後に、別承認のpreflight・production deployとして実行する。

### commit・PR分割案

実装PR:

1. `test: production backupの日次cron契約を追加`
2. `feat: production backupを日次化`
3. `docs: R9日次backupの運用手順を同期`

実装PRではR9を実装中のままにし、未観測のrun IDや2世代を成功済みと記録しない。merge後の証拠docs PRでは、次の1 commitで実測結果と完了markを同期する。

1. `docs: R9の未失効backup 2世代確認を記録`

### rollback方針（R9）

- 日次化でDB負荷、Actions使用量、schedule競合に問題が出た場合は、新規migration・cleanupを停止し、有効な最新Artifactを確認する。
- 原因と影響をreviewしたうえで、schedule宣言とoperation解決caseの2箇所を既知の週次値`41 19 * * 6`へ戻す。片方だけを戻さない。
- manual `operation=backup`、capacity-check、migration gate、暗号化、7日保持は維持する。
- rollback中に既存Artifactを手動削除せず、必要なbackupのmanual実行は明示承認後だけ行う。
- rollbackした場合はR9を未完了へ戻し、原因、対象SHA、run ID、次の再着手条件を秘密情報なしで記録する。

### R9タスクリスト（3回レビュー）

#### v1 初版

- R9-1: 実装開始前のGit・workflow・test・Artifact baselineを再確認し、進捗を実装中へ更新する。
- R9-2: 日次cron contract testを追加してRedを確認する。
- R9-3: workflowの2箇所だけを日次化してGreenにする。
- R9-4: 対象testと直接回帰をRefactor確認する。
- R9-5: 最終品質gateと横断検索を実行する。
- R9-6: 実装時点の文書を同期し、実装PRをmergeする。
- R9-7: merge後の日次schedule runを2回観測する。
- R9-8: 未失効Artifact 2世代と秘密情報非出力を確認する。
- R9-9: 証拠文書を同期し、R9だけを完了へ更新する。
- R9-10: 対象ファイル・実変更ファイル・公開後taskの状態を最終照合する。

#### v2 1回目レビュー（workflow安全性・timezone・秘密情報）

- cronはschedule宣言とoperation解決caseの2箇所を同じtestで固定し、片側変更を防ぐよう補強した。
- UTC/JSTの対応、GitHub schedule遅延、default branch反映後だけ実run証拠になる条件を追加した。
- manual dispatch、capacity cron、concurrency、operation分岐、migration gateを明示的な非変更対象にした。
- encryption、復号検証、checksum、平文cleanup、Artifact retentionを既存testだけに依存せず横断検索でも確認するよう追加した。
- Artifact download・復号を通常手順から除外し、必要時の事前承認と秘密情報非記録を追加した。

#### v3 2回目レビュー（既存実装・test・DB・実環境証拠）

- 既存contract testがsource文字列方式であるため、YAML parserやpackage追加を対象外にした。
- migration gateは2世代要求へ変更せず、既存の24時間・1 Artifact契約を回帰する方針を確定した。
- DB schema・API・認証・frontend・A11Yへ影響しないことを確認し、不要なmigration・frontend testを除外した。
- feature branchではschedule証拠を取得できないため、実装PRと証拠docs PRを分離した。
- run IDだけでなくhead SHA、event、operation、実行日時、Artifact名、expiry、確認日時を証拠項目へ追加した。

#### v4 3回目レビュー・確定

- R9の完了境界を日次cron、既存安全契約の回帰、schedule 2回成功、未失効2世代、文書同期に限定した。
- retry・recovery・鮮度監視・通常7世代・restore drillを公開後taskのまま維持した。
- 実装ファイルと実変更ファイルの一致確認、R5とのbranch分離、rollback時の2箇所同期を最終taskへ含めた。

### R9最終タスクリスト

| タスクID | 内容                                       | フェーズ | ファイル・環境                                 | 優先度 | 完了条件                                                       |
| -------- | ------------------------------------------ | -------- | ---------------------------------------------- | ------ | -------------------------------------------------------------- |
| R9-1     | 実装前baseline確認と実装中mark             | 準備     | Git・Actions metadata・関連文書                | 高     | 最新develop、週次cron、未失効1世代、変更対象を再確認           |
| R9-2     | 日次cron contract testをRedで追加          | Red      | `productionDatabaseWorkflow.test.ts`           | 高     | 現行週次cronを理由に対象testだけが意図どおり失敗               |
| R9-3     | backup cronを日次化                        | Green    | `production-database.yml`                      | 高     | schedule宣言とcaseだけを変更して対象test成功                   |
| R9-4     | 既存安全契約をRefactor回帰                 | Refactor | workflow contract test                         | 高     | manual、capacity、concurrency、暗号化、retention、gate成功     |
| R9-5     | 最終品質gateを実行                         | 品質     | backend・workflow・docs                        | 高     | test、Workers、build、lint、format、Prisma、diff、横断検索成功 |
| R9-6     | 実装時点文書を同期してreview・merge        | 実装PR   | progress・release・backup・startup・deployment | 高     | R9を実装中のまま、review済み変更がdevelopへmerge               |
| R9-7     | 日次schedule runを2回確認                  | 実環境   | production Actions                             | 高     | merge後のschedule backupが2回以上成功                          |
| R9-8     | 未失効Artifact 2世代を確認                 | 実環境   | Actions Artifact metadata                      | 高     | 同時点で未失効2世代、7日保持、秘密情報非記録                   |
| R9-9     | 証拠文書と完了markを同期                   | 証拠PR   | progress・release・backup・startup・deployment | 高     | run ID等を記録しR9だけを完了へ更新                             |
| R9-10    | 実変更・公開後task・rollback境界を最終照合 | 完了確認 | Git diff・全関連文書                           | 中     | 対象と実変更が一致し、公開後taskは未完了のまま                 |

### R9最終タスクリスト（タブ区切り）

```text
タスクID	タスク内容	フェーズ	ファイル・環境	優先度
R9-1	実装前baseline確認と実装中mark	準備	Git・Actions metadata・関連文書	高
R9-2	日次cron contract testをRedで追加	Red	backend/src/jobs/productionDatabaseWorkflow.test.ts	高
R9-3	backup cronを日次化	Green	.github/workflows/production-database.yml	高
R9-4	既存安全契約をRefactor回帰	Refactor	workflow contract test	高
R9-5	最終品質gateを実行	品質	backend・workflow・docs	高
R9-6	実装時点文書を同期してreview・merge	実装PR	progress・release・backup・startup・deployment	高
R9-7	日次schedule runを2回確認	実環境	production Actions	高
R9-8	未失効Artifact 2世代を確認	実環境	Actions Artifact metadata	高
R9-9	証拠文書と完了markを同期	証拠PR	progress・release・backup・startup・deployment	高
R9-10	実変更・公開後task・rollback境界を最終照合	完了確認	Git diff・全関連文書	中
```

## 対象外

- Supabase有料planへの変更やPITR導入。
- backup Artifactの7日を超える保持。
- production DBへの自動restoreまたは上書きrestore。
- GitHub外の長期archive作成。
- 現行DB全損時に、backup取得後のアカウント削除を再適用する外部replay sourceの導入。
- backup方式そのものを物理backupへ変更すること。

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`.github/workflows/production-database.yml`**

- `operation=backup` — production DBのroles・schema・dataをdumpし、AES-256暗号化・復号検証後にArtifactへ保存する。
- `operation=migrate-deploy` — 24時間以内の成功backup run IDと未失効Artifactを確認してからPrisma migrationを適用する。
- `operation=account-deletion-execute` — backup、dry-run、flag、確認文字列、承認記録を検証してlegacy dataを削除する。
- `concurrency.group=gensoko-batch-jobs` — production DB操作を直列化する。

**`backend/src/jobs/productionDatabaseWorkflow.test.ts`**

- production DB workflowのEnvironment固定、暗号化backup、保持期間、migration前backup gateを契約テストする。

**`docs/11_deployment.md`**

- backupの取得、復号、隔離projectへのrestore、migration前確認、秘密情報をログへ残さない運用を定義する。

### 重要な制約

- production DBへの接続はGitHub Actionsのproduction Environment経由に限定し、開発端末やPR workflowから接続しない。
- `DATABASE_URL`、DB password、暗号化passphrase、平文dumpをログ、Artifact、Issue、PR、チャットへ出さない。
- Artifactへ保存するのは暗号化archiveとSHA-256 checksumだけとする。
- backup保持期間は7日を超えない。日次化後は通常7世代、失敗時も直近の成功世代を保持する。
- 1回のbackup run内の生成処理は最大3 attemptとし、さらに主runの2時間後に有効な当日Artifactがない場合だけrecovery runを1回実行する。DBやGitHub Actionsへ無制限に負荷をかけない。
- restore先はproductionと異なる専用の隔離projectであることを、接続前にproject refまたはhostで検証する。
- restore workflowからproduction DBへ書き込めるSecretを参照しない。
- `restore-drill` Environmentには復号用passphrase、隔離DB URL、production/隔離project refだけを登録し、productionの`DATABASE_URL`は登録しない。
- restoreは自動scheduleで実行せず、承認者が四半期ごとに手動実行する。期限確認は運用チェックリストで管理する。
- drill終了後は隔離projectの削除または全復元dataの確実な消去を確認し、個人情報の複製を残さない。
- 通知やJob Summaryにはrun URL、結果、世代数、経過時間などの運用情報だけを記録し、メール、username、User ID、raw DB errorを含めない。

## 設計上の決定事項

1. **backup頻度をどうするか**
   - 選択: JST毎日04:41に日次実行する。
   - 根拠: 週次の単一障害点を解消しつつ、アクセスが少ない時間帯と既存運用時刻を維持するため。

2. **複数世代をどう確保するか**
   - 選択: GitHub Actions Artifactの保持期間は7日のまま、日次backupにより通常最大7世代を保持する。
   - 根拠: アカウント削除後の個人情報がbackupに残り得る期間を延長せず、世代数だけを増やすため。

3. **自動再試行をどこまで行うか**
   - 選択: dump・暗号化・復号検証を同一run内で最大3 attempt実行し、各attempt前に平文・作業領域を消去する。さらに主runの2時間後、当日の未失効Artifactがない場合だけ同じbackup operationを1回再実行する。
   - 根拠: CLI・networkの一時障害だけでなくArtifact uploadを含むrun全体の失敗からも自動回復し、成功済みの日に重複Artifactを作らないため。

4. **失敗をどう検知するか**
   - 選択: backup jobの最終失敗をGitHub Actions failed workflowメールへ接続し、別scheduleの鮮度確認で36時間以内の成功backupと未失効Artifactを検証する。
   - 根拠: 実行失敗だけでなく、schedule自体の遅延・欠落やArtifact失効も検知するため。36時間はGitHub scheduleの遅延を許容しつつ、次世代消失前に対応できる境界とする。

5. **restore drillをどう実施するか**
   - 選択: 専用の手動workflowを追加し、四半期に1回、productionとは別の一時的な隔離Supabase projectへ復元する。
   - 根拠: production誤上書きを構造的に防止し、復元行為を明示承認と監査可能なrunに限定するため。

6. **復元成功を何で判定するか**
   - 選択: checksum、復号、roles/schema/dataの適用成功、主要tableの存在、Prisma migration整合性、件数の非負・参照整合性を確認する。PII値や個別IDは出力しない。
   - 根拠: ファイルが開けるだけでなくDBとして利用可能であることを確認し、検証ログからの情報流出を防ぐため。

7. **隔離projectのdataをどう扱うか**
   - 選択: drill完了後にproject削除または全data消去を行い、削除確認日時・担当者・run URLだけを運用記録へ残す。
   - 根拠: backup由来の個人情報コピーを恒常的に増やさないため。

## 目標運用値

| 項目           | 目標                                    |
| -------------- | --------------------------------------- |
| 自動backup頻度 | 主run 1日1回（JST 04:41）               |
| 自動再試行     | 生成最大3 attempt + 2時間後recovery 1回 |
| backup鮮度     | 最新成功Artifactが36時間以内            |
| Artifact保持   | 7日                                     |
| 通常時の世代数 | 最大7世代                               |
| 最低安全状態   | 未失効の成功Artifactが2世代以上         |
| restore drill  | 四半期に1回、手動承認付き               |
| restore先      | productionと別の一時隔離project         |
| 隔離data保持   | drill確認後、同一change内で削除         |

最低安全状態を満たさない場合は新しいproduction migration、legacy cleanup、破壊的DB操作を停止する。APIの通常稼働を直ちに停止する条件とはせず、担当者が障害内容と最新成功backupを確認して判断する。

## 対象ファイル一覧

| ファイル                                                          | 変更種別 | 内容                                                                                      |
| ----------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `.github/workflows/production-database.yml`                       | 修正     | backup日次化、最大3回retry、当日Artifact欠落時のrecovery、鮮度確認、固定文言の失敗summary |
| `.github/workflows/production-database-restore-drill.yml`         | 新規     | 手動承認付き隔離restore workflow                                                          |
| `backend/src/jobs/productionDatabaseWorkflow.test.ts`             | 修正     | 日次schedule、retry、7日保持、鮮度gate、秘密情報非出力の契約test                          |
| `backend/src/jobs/productionDatabaseRestoreDrillWorkflow.test.ts` | 新規     | manual限定、環境分離、production拒否、復元・cleanup gateの契約test                        |
| `docs/09_startup_commands.md`                                     | 修正     | backup・鮮度確認・restore drillの実行入口を追記                                           |
| `docs/11_deployment.md`                                           | 修正     | 日次運用、障害対応、世代確認、四半期restore drill runbookを追記                           |
| `docs/05_progress.md`                                             | 修正     | 本タスクの進捗項目を追加                                                                  |
| `docs/plans/backup-resilience/plan.md`                            | 修正     | 本計画、R9実装記録、公開後強化の進捗                                                      |
| `docs/plans/portfolio-release-v0-1/plan.md`                       | 修正     | R9の実装・観測状態とrelease完了条件を同期                                                 |

## Workflow仕様案

### production backup

| 項目        | 仕様                                                                                    |
| ----------- | --------------------------------------------------------------------------------------- |
| trigger     | 主run `schedule` JST毎日04:41、recovery JST毎日06:41、`workflow_dispatch`               |
| Environment | `production`                                                                            |
| concurrency | `gensoko-batch-jobs`、cancelしない                                                      |
| attempt     | 最大3回。attempt間で平文領域を削除し、段階的に待機                                      |
| 成功条件    | 3 dumpが非空、暗号化成功、復号成功、期待ファイル確認、checksum作成、Artifact upload成功 |
| Artifact    | 暗号化archiveとSHA-256のみ、7日保持                                                     |
| 失敗時      | 固定文言のerror/summaryを出し、workflowをfailureにして登録メールへ通知                  |
| recovery    | 主runの2時間後に当日の未失効Artifactを確認し、存在しない場合だけbackupを1回再実行       |

### backup鮮度確認

| 項目     | 仕様                                                                                 |
| -------- | ------------------------------------------------------------------------------------ |
| trigger  | recovery予定時刻より後の日次schedule                                                 |
| 権限     | `actions: read`、`contents: read`                                                    |
| 確認対象 | develop上の`Production Database Operations`成功run、operation backup、未失効Artifact |
| 正常     | 最新成功Artifactが36時間以内かつ未失効                                               |
| 異常     | runなし、36時間超過、Artifactなし・失効を固定文言でfailureにする                     |
| 出力禁止 | Secret、DB URL、Artifact内容、個人情報、raw API response                             |

### restore drill

| 項目        | 仕様                                                                                 |
| ----------- | ------------------------------------------------------------------------------------ |
| trigger     | `workflow_dispatch`のみ                                                              |
| Environment | productionとは別の`restore-drill` Environment、required reviewer付き                 |
| 入力        | 期限内backup run ID、承認者識別子、change record、確認文字列                         |
| 接続先      | `RESTORE_DRILL_DATABASE_URL`。production project refと一致したら接続前に停止         |
| 処理        | Artifact取得、checksum、復号、隔離DBへroles→schema→dataの順でrestore                 |
| 検証        | schema、migration整合性、主要table、参照整合性。値・IDはlogへ出さない                |
| 後処理      | runner平文を常に削除。隔離project/dataの削除確認が完了するまでtaskを完了扱いにしない |
| 証跡        | run URL、backup run ID、成功/失敗、所要時間、承認者、change record、隔離data削除日時 |

## タスクリスト（進捗管理）

| タスクID | 内容                                            | フェーズ     | ファイル                                               | 優先度 | 完了条件                                                            |
| -------- | ----------------------------------------------- | ------------ | ------------------------------------------------------ | ------ | ------------------------------------------------------------------- |
| T1       | 現行backupの初回成功Artifactを記録              | v0.1確認済み | Actions / runbook                                      | 高     | run 29322979476、暗号化・復号・平文非保存の証拠を記録               |
| T2       | 日次scheduleのRed testを追加                    | v0.1公開前   | `productionDatabaseWorkflow.test.ts`                   | 高     | 週次cronに対し日次cronを要求するtestが意図した理由で失敗            |
| T3       | backupを日次化                                  | v0.1公開前   | `production-database.yml`                              | 高     | JST毎日04:41、手動実行、7日保持、既存backup gateが成立              |
| T4       | 最大3回retry・recovery・36時間鮮度確認をTDD実装 | 初回公開後   | workflow / contract test                               | 高     | 一時失敗を回復し、当日欠落・36時間超過・Artifact失効をfailureにする |
| T5       | 失敗通知の安全性と受信を検証                    | 初回公開後   | Actions / runbook                                      | 高     | 固定文言のみのsafe failureで登録メール受信を確認                    |
| T6       | 日次backupを連続実行し最低2世代を確認           | 初回公開後   | Actions                                                | 高     | 未失効Artifactが2世代以上                                           |
| T6A      | 通常7世代と7日失効境界を確認                    | 初回公開後   | Actions                                                | 高     | 日次run 7回と、保持上限を超えたArtifactの失効を確認                 |
| T7       | restore drill workflowのRed testを追加          | 初回公開後   | `productionDatabaseRestoreDrillWorkflow.test.ts`       | 高     | manual限定・環境分離・production拒否testが失敗                      |
| T8       | 手動restore drill workflowを実装                | 初回公開後   | `production-database-restore-drill.yml`                | 高     | checksumから隔離restore・検証・平文cleanupまで成功                  |
| T9       | 隔離projectで初回restore drillを実施            | 初回公開後   | Actions / Supabase                                     | 高     | 復元成功と隔離data削除を証跡化                                      |
| T10      | startup・deployment runbookを更新               | フェーズごと | `docs/09_startup_commands.md`, `docs/11_deployment.md` | 高     | 実装済みの日次運用と公開後強化を混同せず、実態と一致                |
| T11      | 計画書・進捗を実態へ同期                        | フェーズごと | 本計画、`docs/05_progress.md`                          | 中     | v0.1境界、対象ファイル、判断、結果、完了markが実態と一致            |

- [x] T1: 現行backupの初回成功Artifactを記録する（run 29322979476）
- [x] T2: 日次scheduleのRed testを追加する
- [x] T3: backupをJST毎日04:41へ日次化する
- [ ] T4: 最大3回retry・当日Artifact欠落時のrecovery・36時間鮮度確認をTDD実装する
- [ ] T5: 失敗通知の安全性と受信を検証する
- [ ] T6: 日次backupを連続実行し未失効Artifact 2世代以上を確認する
- [ ] T6A: 通常7世代と7日失効境界を確認する
- [ ] T7: restore drill workflowのRed testを追加する
- [ ] T8: 手動restore drill workflowを実装する
- [ ] T9: 隔離projectで初回restore drillを実施し、隔離dataを削除する
- [-] T10: startup・deployment runbookを更新する（実装時点を同期済み、実run証拠待ち）
- [-] T11: 計画書・進捗を実態へ同期する（実装時点を同期済み、実run証拠待ち）

## TDD・検証方針

### Red

- v0.1: 現行の週次cronに対し、日次cronを要求する契約testが失敗することを確認する。
- 初回公開後: retry回数上限、attempt間cleanup、当日Artifact欠落時だけのrecovery、鮮度36時間を要求するtestが失敗することを確認する。
- restore drill workflow未存在により、manual限定・Environment分離・production拒否のtestが失敗することを確認する。

### Green

- v0.1では日次cronだけを実装し、既存の暗号化・7日保持・manual・backup gateを含む対象契約testを通す。
- 初回公開後はretry・recovery・鮮度監視・restore drillを各Red testに対応して実装する。
- 既存のmigration前backup gateとaccount deletion gateのtestを回帰させる。
- workflow YAMLをPrettierで検証する。

### 実環境

1. 確認済み: 手動run 29322979476と週次schedule run 29658935594で暗号化・復号検証・uploadが成功した。前者は7日保持どおり失効し、2026-07-22調査時点では後者だけが未失効である。
2. 初回公開後: 日次runを2回以上成功させ、未失効Artifact 2世代と7日保持を確認する。
3. v0.1: M4で使う1世代のlogとArtifactにPII・接続情報・passphrase・平文dumpがないことを再確認する。
4. 初回公開後: 接続前に失敗する安全な条件で通知testを行い、固定文言のメール受信を確認する。
5. 初回公開後: 日次run 7回と7日失効境界を確認する。
6. 初回公開後: 期限内Artifactを隔離projectへrestoreし、Prisma migration・主要table・参照整合性を確認する。
7. 初回公開後: 隔離projectまたは復元dataを削除し、削除日時と担当者だけを記録する。

## テストケース一覧

| ケース                         | 期待結果                                                            |
| ------------------------------ | ------------------------------------------------------------------- |
| 日次schedule                   | backupが毎日JST 04:41に解決される                                   |
| 手動backup                     | 従来どおり`workflow_dispatch`で実行できる                           |
| 1・2回目の一時失敗             | 作業領域を消去して次attemptへ進む                                   |
| 3回目まで失敗                  | workflow failureとなり固定文言で通知される                          |
| 主run成功後のrecovery          | 有効な当日Artifactを確認してDB接続せず終了する                      |
| 主run失敗後のrecovery          | backup operationを1回再実行する                                     |
| backup成功                     | 暗号化archiveとchecksumだけを7日保持する                            |
| 鮮度36時間以内                 | freshness check成功                                                 |
| 鮮度36時間超過                 | freshness check失敗、DB内容は出力しない                             |
| Artifact失効・欠落             | freshness check失敗                                                 |
| migration前の古いbackup        | 既存gateが拒否する                                                  |
| restore workflowのschedule実行 | trigger自体が存在せず実行不可                                       |
| restore先がproductionと一致    | DB接続・書込み前に失敗                                              |
| backup run ID不正              | Artifact download前に失敗                                           |
| checksum不一致                 | 復号・restoreせず失敗                                               |
| passphrase不正                 | restoreせず失敗、値をlogへ出さない                                  |
| 隔離restore成功                | schema・data・整合性確認が成功                                      |
| runner cleanup                 | 成否にかかわらず平文・復号fileを削除                                |
| log監査                        | PII、内部ID、DATABASE_URL、password、passphrase、raw DB errorがない |

## 障害時の停止条件

### M1成立時のv0.1公開前

- release前24時間以内の成功backupに対応する未失効の暗号化Artifact 1世代を確認できない。
- checksum、復号、Artifact uploadのいずれかが失敗した。
- 日次scheduleがdefault branchで有効であることを確認できない。
- Artifactまたはlogに平文dump、PII、接続情報、passphraseが含まれる。

上記のいずれかに該当する間はM5のproduction deployへ進まず、production migration、legacy cleanup、contract migration、その他の破壊的DB操作を停止する。

### M1不成立時、または初回公開後の通常gate

- 最新成功backupが36時間を超えた。
- 未失効の成功Artifactが2世代未満になった。
- checksum、復号、Artifact uploadのいずれかが失敗した。
- failed workflow通知を担当者が受信できない。
- restore drillが失敗した、または隔離dataの削除を確認できない。
- productionとrestore-drillの接続先分離を検証できない。

上記の通常gateのいずれかに該当する間は、production migration、legacy cleanup、contract migration、その他の破壊的DB操作を停止する。2世代要件は旧R9とbackup計画全体の耐障害性条件であり、M1成立時のv0.1公開前には適用しない。

## ロールバック方針

- 日次化でGitHub Actions使用量やDB負荷に問題が出た場合は、手動backupを継続しつつscheduleを一時停止し、原因を調査する。
- retryがDB負荷を増やす場合はattemptを1回へ戻し、失敗通知と手動再実行で運用する。
- freshness checkの誤検知時もbackup自体は停止せず、時刻境界とGitHub API条件だけを修正する。
- restore drill workflowはproduction Secretを参照しないため、問題時はworkflowを無効化してrunbookによる承認付き手動検証へ戻す。
- 既存の24時間以内backup gateと7日保持は後退させない。

## v0.1公開完了条件

- [x] 初回production backupのArtifact・暗号化・復号検証が成功している（run 29322979476）。
- [x] 日次cronの契約testがRedからGreenになり、JST毎日04:41に設定される。
- [x] 暗号化archiveとchecksumだけを7日保持し、平文dump非保存の既存契約が回帰している。
- [ ] M1の空DB・初回配備条件が成立している。
- [ ] release前24時間以内の成功Artifact 1世代が未失効である。
- [ ] 日次scheduleがdefault branchで有効である。
- [ ] `docs/11_deployment.md`、v0.1公開計画、`docs/05_progress.md`が実装と実環境証拠に一致している。

2世代目以降、最大3回retry、recovery、36時間鮮度監視、通常7世代、restore drillは本計画全体の完了条件だが、M1が成立するv0.1公開完了条件には含めない。

## 本計画全体の実装完了条件

- [ ] 日次backup、最大3回retry、当日Artifact欠落時のrecovery、36時間鮮度確認の契約testと実装が一致している。
- [ ] 暗号化Artifactは7日保持で、平文dumpが保存・出力されない。
- [ ] failed workflow通知を一次対応者が実際に受信できる。
- [ ] 未失効の成功Artifactを2世代以上確認し、通常7世代へ移行できる。
- [ ] productionと分離した隔離projectでrestore drillが成功する。
- [ ] drill後の隔離projectまたは復元data削除を確認する。
- [ ] log、summary、Artifactに個人情報・秘密情報がない。
- [ ] `docs/09_startup_commands.md`と`docs/11_deployment.md`が実装済み運用に一致する。
- [ ] 本計画の対象ファイル、task、設計判断、実測結果が実態に更新される。

## R4 正式承認記録

2026-07-22にプロダクトオーナー `RitukoIsibasi0222`が、R3の `/privacy` と本計画で定義した次のbackup・restore方針を正式承認した。

- Supabaseの論理backupはAES-256で暗号化し、暗号化archiveとSHA-256 checksumだけをGitHub Actions Artifactへ保存する。
- Artifact保持上限は7日とし、個人dataを含み得るbackupの残存期間を延長しない。
- 復元は現在のproductionへ直接上書きせず、隔離環境で行う。復元内容には削除済みdataが一時的に含まれ得る。
- 現行production DBが読める場合は、backup取得後の削除成功監査を信頼できる情報源として、対象内部IDをmemory上で取得し復元DBへ再削除を適用する。
- 現行production DBも全損した場合のexternal replay sourceは未導入で、backup取得後に削除された対象IDを完全には再構成できない。この完全な再削除を保証できない境界を残存リスクとして正式承認する。

本承認は方針の承認であり、実装・実環境証拠の代替ではない。R9実装branchではbackupを日次化済みだが、review・`develop`へのmergeと未失効Artifact 2世代の観測は未完了である。retry・recovery・36時間鮮度監視、通常7世代、restore drillも各taskの完了条件を満たすまで未完了とする。

## 最終タスクリスト（タブ区切り）

```text
タスクID	タスク内容	フェーズ	ファイル	優先度
T1	現行backupの初回成功Artifactを記録	v0.1確認済み	Actions・runbook	高
T2	日次scheduleのRed testを追加	v0.1公開前	backend/src/jobs/productionDatabaseWorkflow.test.ts	高
T3	backupをJST毎日04:41へ日次化	v0.1公開前	.github/workflows/production-database.yml	高
T4	最大3回retry・recovery・36時間鮮度確認をTDD実装	初回公開後	workflow・contract test	高
T5	失敗通知の安全性と受信を検証	初回公開後	Actions・runbook	高
T6	日次backupを連続実行し最低2世代を確認	初回公開後	Actions	高
T6A	通常7世代と7日失効境界を確認	初回公開後	Actions	高
T7	restore drill workflowのRed testを追加	初回公開後	backend/src/jobs/productionDatabaseRestoreDrillWorkflow.test.ts	高
T8	手動restore drill workflowを実装	初回公開後	.github/workflows/production-database-restore-drill.yml	高
T9	隔離projectで初回restore drillとdata削除を実施	初回公開後	Actions・Supabase	高
T10	startup・deployment runbookを更新	フェーズごと	docs/09_startup_commands.md・docs/11_deployment.md	高
T11	計画書・進捗を実態へ同期	フェーズごと	docs/plans/backup-resilience/plan.md・docs/05_progress.md	中
```
