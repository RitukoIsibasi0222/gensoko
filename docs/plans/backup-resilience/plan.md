# 本番DBバックアップ耐障害性強化 実装計画

> 設計者ロール: SRE / セキュリティエンジニア

## 概要

Supabase Free planで運用するproduction DBの暗号化論理backupを、週次1世代に近い状態から日次・最大7世代へ強化する。backup失敗時の自動再試行と通知確認、backup鮮度監視、四半期ごとの隔離環境restore drillを追加し、「backupが作成された」だけでなく「期限内に検知でき、実際に復元できる」状態を運用契約にする。

個人情報を含み得るbackupの保持上限は、アカウント完全削除計画との整合を優先して7日のまま維持する。長期保持によって削除済みデータの残存期間を延ばさず、頻度を日次化することで通常時は最大7世代を確保する。

ポートフォリオ版v0.1では、週次の単一障害点を解消する日次schedule、既存の暗号化・7日保持契約、未失効Artifact 2世代の確認までを公開前必須とする。最大3回retry、2時間後recovery、36時間鮮度監視、通常7世代の定常確認、四半期restore drillは、日次化後の運用強化として公開後へ分離する。

## 背景と現状

- `.github/workflows/production-database.yml`はUTC土曜19:41（JST日曜04:41）の週次backupを実行する。
- backupはroles・schema・dataをdumpし、AES-256で暗号化して復号後の内容を検査してからGitHub Actions Artifactへ保存する。
- 初回production backupは2026-07-14のrun 29322979476でArtifact・暗号化・復号検証まで成功している。
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

## v0.1公開境界

### 公開前に完了する項目

- T2: 日次scheduleの契約testをRedで追加する。
- T3: backup cronをJST毎日04:41へ変更し、暗号化・7日保持・手動実行・migration gateを回帰させる。
- T6: 日次runを連続成功させ、未失効Artifactが2世代以上あることを確認する。
- T10・T11のうち、日次化に関するrunbook・リリース計画・進捗を実態へ同期する。

### 初回公開後に継続する項目

- 最大3回retry、当日Artifact欠落時の2時間後recovery、36時間鮮度監視。
- failed workflow通知の意図的な安全性・受信検証。
- 通常7世代の定常運用と7日失効境界の確認。
- 手動restore drill workflow、四半期ごとの隔離restore、隔離data削除確認。

公開後項目を未実装のまま日次化だけを完了しても、本計画全体は完了扱いにしない。v0.1のR9だけを、本セクションの公開前項目と証拠が揃った時点で完了できる。

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
| `docs/plans/backup-resilience/plan.md`                            | 新規     | 本計画と実装記録                                                                          |

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
| T6       | 日次backupを連続実行し最低2世代を確認           | v0.1公開前   | Actions                                                | 高     | 未失効Artifactが2世代以上                                           |
| T6A      | 通常7世代と7日失効境界を確認                    | 初回公開後   | Actions                                                | 高     | 日次run 7回と、保持上限を超えたArtifactの失効を確認                 |
| T7       | restore drill workflowのRed testを追加          | 初回公開後   | `productionDatabaseRestoreDrillWorkflow.test.ts`       | 高     | manual限定・環境分離・production拒否testが失敗                      |
| T8       | 手動restore drill workflowを実装                | 初回公開後   | `production-database-restore-drill.yml`                | 高     | checksumから隔離restore・検証・平文cleanupまで成功                  |
| T9       | 隔離projectで初回restore drillを実施            | 初回公開後   | Actions / Supabase                                     | 高     | 復元成功と隔離data削除を証跡化                                      |
| T10      | startup・deployment runbookを更新               | フェーズごと | `docs/09_startup_commands.md`, `docs/11_deployment.md` | 高     | 実装済みの日次運用と公開後強化を混同せず、実態と一致                |
| T11      | 計画書・進捗を実態へ同期                        | フェーズごと | 本計画、`docs/05_progress.md`                          | 中     | v0.1境界、対象ファイル、判断、結果、完了markが実態と一致            |

- [x] T1: 現行backupの初回成功Artifactを記録する（run 29322979476）
- [ ] T2: 日次scheduleのRed testを追加する
- [ ] T3: backupをJST毎日04:41へ日次化する
- [ ] T4: 最大3回retry・当日Artifact欠落時のrecovery・36時間鮮度確認をTDD実装する
- [ ] T5: 失敗通知の安全性と受信を検証する
- [ ] T6: 日次backupを連続実行し未失効Artifact 2世代以上を確認する
- [ ] T6A: 通常7世代と7日失効境界を確認する
- [ ] T7: restore drill workflowのRed testを追加する
- [ ] T8: 手動restore drill workflowを実装する
- [ ] T9: 隔離projectで初回restore drillを実施し、隔離dataを削除する
- [ ] T10: startup・deployment runbookを更新する
- [ ] T11: 計画書・進捗を実態へ同期する

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

1. 確認済み: run 29322979476で暗号化Artifactとchecksumだけが存在し、復号検証に成功している。
2. v0.1: 日次runを2回以上成功させ、未失効Artifact 2世代と7日保持を確認する。
3. v0.1: logとArtifactにPII・接続情報・passphrase・平文dumpがないことを再確認する。
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

- 最新成功backupが36時間を超えた。
- 未失効の成功Artifactが2世代未満になった。
- checksum、復号、Artifact uploadのいずれかが失敗した。
- failed workflow通知を担当者が受信できない。
- restore drillが失敗した、または隔離dataの削除を確認できない。
- productionとrestore-drillの接続先分離を検証できない。

上記のいずれかに該当する間は、production migration、legacy cleanup、contract migration、その他の破壊的DB操作を停止する。

## ロールバック方針

- 日次化でGitHub Actions使用量やDB負荷に問題が出た場合は、手動backupを継続しつつscheduleを一時停止し、原因を調査する。
- retryがDB負荷を増やす場合はattemptを1回へ戻し、失敗通知と手動再実行で運用する。
- freshness checkの誤検知時もbackup自体は停止せず、時刻境界とGitHub API条件だけを修正する。
- restore drill workflowはproduction Secretを参照しないため、問題時はworkflowを無効化してrunbookによる承認付き手動検証へ戻す。
- 既存の24時間以内backup gateと7日保持は後退させない。

## v0.1公開完了条件

- [x] 初回production backupのArtifact・暗号化・復号検証が成功している（run 29322979476）。
- [ ] 日次cronの契約testがRedからGreenになり、JST毎日04:41へ解決される。
- [ ] 暗号化archiveとchecksumだけを7日保持し、平文dump非保存の既存契約が回帰している。
- [ ] 未失効の成功Artifactを2世代以上確認している。
- [ ] `docs/11_deployment.md`、v0.1公開計画、`docs/05_progress.md`が実装と実環境証拠に一致している。

最大3回retry、recovery、36時間鮮度監視、通常7世代、restore drillは本計画全体の完了条件だが、v0.1公開完了条件には含めない。

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

## 最終タスクリスト（タブ区切り）

```text
タスクID	タスク内容	フェーズ	ファイル	優先度
T1	現行backupの初回成功Artifactを記録	v0.1確認済み	Actions・runbook	高
T2	日次scheduleのRed testを追加	v0.1公開前	backend/src/jobs/productionDatabaseWorkflow.test.ts	高
T3	backupをJST毎日04:41へ日次化	v0.1公開前	.github/workflows/production-database.yml	高
T4	最大3回retry・recovery・36時間鮮度確認をTDD実装	初回公開後	workflow・contract test	高
T5	失敗通知の安全性と受信を検証	初回公開後	Actions・runbook	高
T6	日次backupを連続実行し最低2世代を確認	v0.1公開前	Actions	高
T6A	通常7世代と7日失効境界を確認	初回公開後	Actions	高
T7	restore drill workflowのRed testを追加	初回公開後	backend/src/jobs/productionDatabaseRestoreDrillWorkflow.test.ts	高
T8	手動restore drill workflowを実装	初回公開後	.github/workflows/production-database-restore-drill.yml	高
T9	隔離projectで初回restore drillとdata削除を実施	初回公開後	Actions・Supabase	高
T10	startup・deployment runbookを更新	フェーズごと	docs/09_startup_commands.md・docs/11_deployment.md	高
T11	計画書・進捗を実態へ同期	フェーズごと	docs/plans/backup-resilience/plan.md・docs/05_progress.md	中
```
