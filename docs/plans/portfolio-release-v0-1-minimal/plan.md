# ポートフォリオ版 v0.1 最小リリース計画

> 設計者ロール: シニアフルスタックエンジニア / セキュリティエンジニア / リリースマネージャー

## 概要

Gensokoを、一般ユーザーが登録・メール認証・ログイン・学習・退会できるポートフォリオWebアプリとして公開する。
商用サービス相当の長期観測や高度な運用自動化は初回公開の条件にせず、一般公開に必要な安全性と主要導線だけを4工程と条件付きDB工程で確認する。

本計画は2026-07-26以降のv0.1リリース範囲と実行順の正本である。
既存の[`portfolio-release-v0-1`](../portfolio-release-v0-1/plan.md)は、R1〜R18の設計・実装・承認履歴として保持する。
個別計画の未完了項目は完了扱いにせず、v0.1の対象外にした項目には再着手条件を記録する。

## 初回公開の方針

- 一般ユーザー登録、メール認証、login・refresh・logout、ゲーム、本人退会を公開する。
- 既存機能をゲスト版へ作り直さず、現在の実装とstaging実績を利用する。
- 基本的なセキュリティはポートフォリオ用途でも省略しない。
- 初回公開前の実環境確認はproductionの単一synthetic smokeへ集約し、同じrelease候補SHAのstaging campaignは公開後の回帰または次の高リスク変更時に行う。
- 未公開かつ実利用者0件のproductionでは、旧利用者向けcleanup・migration・soakを実施しない。
- 初回公開では可用性SLAを設けず、互換rollbackが成立しない障害時は公開を停止してfix-forwardする。
- deployment・Environment・backupの履歴だけを、一般公開、実traffic、実利用者data保存の証拠として扱わない。

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/04_api.md`**

- `POST /api/v1/auth/register` — 一般ユーザー登録と確認メール送信。
- `POST /api/v1/auth/verify-email` — メール認証。
- `POST /api/v1/auth/login` / `POST /api/v1/auth/refresh` / `POST /api/v1/auth/logout` — access tokenとHttpOnly refresh tokenのライフサイクル。
- `GET /api/v1/game/questions` / `POST /api/v1/game/sessions` — 認証済みゲーム導線。
- `DELETE /api/v1/users/me` — 本人によるアカウント物理削除。

**`docs/11_deployment.md`**

- staging、production backup・migration、deploy、smoke、停止・復旧の詳細runbook。

**関連計画**

- [`production-auth-refresh`](../production-auth-refresh/plan.md) — production Cookie・hostname・refresh契約。
- [`r6-account-deletion-gates`](../r6-account-deletion-gates/plan.md) — 本人退会とproduction DB状態による分岐。
- [`r7-rate-limit-environment-gates`](../r7-rate-limit-environment-gates/plan.md) — rate limitとpassword verifier DOの完全な運用計画。
- [`backup-resilience`](../backup-resilience/plan.md) — 日次backupと公開後の耐障害性強化。

### 重要な制約

- 本計画PRではproduction deploy、migration、DB query、workflow dispatch、Cloudflare resource変更を実行しない。
- production DBが空であると推測しない。M1の承認付きread-only証拠でDB target、全User、legacy User、User関連row、AuditLogが`clear`でない場合は本計画を停止し、既存の通常移行gateへ戻る。
- M1 schema v1のPath B判定は変更しない。Vercel・GitHub Environment・backup履歴の`present`は、ownerが一般公開・一般登録・実利用者data保存の実績なしを確認できる場合に限り、v0.1の既存利用者向け移行gateを起動する根拠から除外する。
- M1証拠SHA後のcommitが`docs/**`だけを変更し、backend、frontend、`.github/workflows`、schema/migration、lockfile、deployment configとproduction stateを変更していないことを差分確認できる場合、文書同期だけを理由にM1を再実行しない。実行時のreview済みdocs SHAを別に記録する。
- API仕様、ステータスコード、エラーメッセージは変更しない。
- bcrypt cost 12、Zod入力検証、Prisma ORM、HttpOnly/Secure Cookie、限定CORS、Hono/DO rate limit、物理削除、安全な日本語error、秘密情報非出力を維持する。
- production frontend/APIはsame-site HTTPS構成とし、Cookie属性を弱めて配備を成立させない。
- password verifier DOの通常版を配備し、main Workerのlocal bcrypt fallbackを禁止する。
- raw password、hash、email、username、User ID、IP、token、Cookie、Authorization、DB URL、Secret、resource ID、raw errorを証拠へ記録しない。

## 対象ファイル一覧

| ファイル                                                        | 変更種別 | 内容                                     |
| --------------------------------------------------------------- | -------- | ---------------------------------------- |
| `docs/plans/portfolio-release-v0-1-minimal/plan.md`             | 修正     | owner判断を含むv0.1最小経路へ更新        |
| `docs/plans/m1-production-read-only-evidence/plan.md`           | 修正     | schema v1 Path BとM1Rの境界を追記        |
| `docs/plans/m2-staging-release-candidate-campaign/plan.md`      | 修正     | M2外部実行を公開後へ移動                 |
| `docs/05_progress.md`                                           | 修正     | M1R・M3〜M6を進捗ダッシュボードへ反映    |
| `docs/09_startup_commands.md`                                   | 修正     | backupのv0.1条件をmigration時だけへ限定  |
| `docs/11_deployment.md`                                         | 修正     | 最小deploy・smoke・fix-forward手順を追加 |
| `docs/plans/backup-resilience/plan.md`                          | 修正     | 2世代観測を公開後へ移動                  |
| `docs/plans/r6-account-deletion-gates/plan.md`                  | 修正     | 空DB時のT35対象外条件を同期              |
| `docs/plans/r7-rate-limit-environment-gates/plan.md`            | 修正     | v0.1 subsetとR7全体を分離                |
| `docs/plans/r7-password-verification-free-worker/plan.md`       | 修正     | deploy/429とrollback drillを分離         |
| `docs/plans/r7-password-verification-rollback-baseline/plan.md` | 修正     | 実環境drillを公開後へ移動                |

## API仕様

APIのリクエスト、レスポンス、status、error messageは変更しない。
初回公開では次の既存契約を実HTTPで最小確認する。

| 導線                   | 期待結果                                                          |
| ---------------------- | ----------------------------------------------------------------- |
| 登録・メール認証       | 登録201、メール受信、token認証成功、再利用拒否                    |
| login・refresh・logout | login成功、reload後refresh、rotation、logout後拒否                |
| ゲーム                 | 問題取得、結果送信、結果表示                                      |
| 本人退会               | Userと所有dataを物理削除し、旧access・refresh・資格情報を拒否     |
| auth rate limit        | productionの許可回数成功後、境界requestが429と`Retry-After`を返す |
| security               | 固定CORS、security headers、安全なerror、秘密情報非出力           |

## 設計上の決定事項

1. **一般登録を初回から公開するか**
   - 選択: 公開する。
   - 根拠: 登録から学習・退会までがポートフォリオの主要成果であり、既にコードとstaging導線が実装済みであるため。

2. **商用運用相当の全gateを初回公開前に完了するか**
   - 選択: 完了条件にしない。
   - 根拠: WAF tuning、24/48時間soak、rollback drill、複数backup世代、restore drill、高度な監視は、基本的な安全性ではなく運用品質の継続改善であるため。

3. **production DBの既存利用者向け移行を実施するか**
   - 選択: M1でDB target、User・legacy・関連row・AuditLogが`clear`で、ownerが一般公開・一般登録・実利用者data保存の実績なしを確認した場合は対象外とする。provider・backup履歴の`present`だけでは通常移行へ戻さない。
   - 根拠: 現在DBが空で過去にも実利用者dataを扱っていなければ削除対象と互換対象が存在せず、staging T35や長期soakを公開前に行う実益がないため。

4. **password verifier DOのrollback baseline drillを初回公開前に行うか**
   - 選択: 行わない。通常版をproduction smokeで確認し、初回production障害は公開停止とfix-forwardで扱う。
   - 根拠: production未公開・実利用者0件ならpre-v2へ戻す可用性要件がなく、baseline deployとversion drillはリリース本体より大きい運用作業になるため。

5. **backupを何世代待つか**
   - 選択: pending Prisma DB migrationがある場合だけ、24時間以内の暗号化済み成功Artifact 1世代とchecksumを直前条件にする。DB migrationがなく現在DBが空のままなら、backup作成を公開前条件にしない。
   - 根拠: 空DBのschemaはmigration履歴から再構築でき、利用者dataを含まないbackupを必須化しても安全性は増えないため。migration時の復旧点だけは維持する。

6. **依存関係監査の境界**
   - 選択: production依存のCritical/Highを0件にし、Moderateは到達可能性、回避策、更新期限を記録して判断する。
   - 根拠: severityだけで自動的に全更新を要求せず、実行経路とproduction影響を確認するため。

7. **WAFと長時間観測**
   - 選択: Hono/DOのアプリrate limit、通常password verifier DOのvalid login、最小429境界をproduction smokeでv0.1必須とし、WAF、24時間staging、48時間production観測は公開後へ送る。
   - 根拠: 公開hostnameと実trafficがない段階でのtuning・soakより、公開版の実HTTP確認と公開後の実測が有効であるため。

8. **M1 schema v2またはPath Cを実装するか**
   - 選択: 実装しない。schema v1 ArtifactとPath B判定は履歴として維持し、v0.1限定のowner判断を文書で記録する。
   - 根拠: 3件の`present`は実利用者dataの有無を判定せず、今回だけの既知の運用事実を機械判定へ追加する実益がないため。

## タスクリスト（3回レビュー）

### v1: 初版

- 既存のR1〜R18から、初回公開に必要な実環境作業をDB確認、staging、品質、backup、deploy、smokeへ集約した。
- 一般登録、メール認証、login・refresh、game、本人退会を公開範囲に維持した。

### v2: セキュリティ・失敗時レビュー

- bcrypt、Zod、Prisma、Secure Cookie、限定CORS、アプリrate limit、物理削除、安全なerror、秘密非出力を削減対象から除外した。
- 空DBを推測せず、M1のDB証拠またはownerの実利用者data不存在確認が不明なら通常gateへ戻るfail-closed条件を追加した。
- password verifier DO障害時にlocal bcryptへfallbackせず、公開route停止とfix-forwardを採用した。
- backupを必要なPrisma DB migrationがある場合だけの条件付きgateとし、24時間以内、暗号化・checksumへ限定した。

### v3: 既存実装・運用整合レビュー

- repository実装済みの通常DO版を再利用し、baseline drillと同一SHA staging campaignを初回公開後へ分離した。
- production smokeへvalid login、auth 429、Cookie・CORS・security headers、本人退会、cleanupを集約した。
- 既存利用者向けcleanup・migration・soakは、0件証拠がある場合だけ対象外とした。
- production依存はCritical/High 0を必須とし、Moderateを到達可能性に基づく明示判断へ変更した。

### v4: 確定

- M1R・M3・M5・M6と条件付きM4以外をv0.1 blockerにしない。
- 未完了の旧Rタスクを完了扱いにせず、公開後の再着手条件を残す。
- productionのwrite・deploy・workflowは引き続き別承認とする。

## 最小リリース工程

| タスクID | 内容                            | 対象                              | 完了条件                                                                                    |
| -------- | ------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------- |
| M1R      | M1証拠とowner判断を記録         | production metadata/DB/docs       | DB 5項目`clear`、ownerが一般公開・一般登録・実利用者data保存実績なしを確認                  |
| M3       | release候補SHAの品質gate        | backend/frontend                  | test・Workers test・build・lint・format・Prisma validate成功、production依存Critical/High 0 |
| M4       | 必要な場合だけbackup・migration | production Actions                | pending Prisma migrationがある場合だけ新鮮な暗号化backup確認後に別承認migration             |
| M5       | preflight後にproduction deploy  | Vercel/Cloudflare/Supabase/Resend | same-site URL、Cookie、CORS、送信元、Secret/binding分離、review済みSHA、別承認deploy成功    |
| M6       | production smokeとrelease記録   | production/docs                   | synthetic Userで主要導線、DO、429、security、退会、cleanup、残課題引継ぎ                    |

- [x] M1R: M1 schema v1のPath Bを維持し、DB 5項目`clear`とownerの実利用者data不存在確認からv0.1限定経路を承認する
- [ ] M3: release候補SHAの最終品質gateと依存関係監査を実行する
- [ ] M4: pending Prisma migrationがある場合だけ新鮮な暗号化backupを確認してmigrationする。migration不要なら対象外と記録する
- [ ] M5: 値非表示preflightでURL・Cookie・CORS・送信元・Secret/bindingを確認し、別承認でproductionへdeployする
- [ ] M6: production smoke、DO valid login、最小429、synthetic cleanup、release record、公開後引継ぎを完了する

2026-07-28にrelease候補`7a6979761428759c744ba3bf9c1ed16527c7b33d`を固定し、M1の承認付きmanual-only・GET-only run [30321699906](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30321699906)を1回実行した。Environment approval、対象SHA、safe Artifactのexact schema、11 status、decision再計算をreviewした結果、DB target、全User、legacy User、User関連row、AuditLog、Cloudflare、削除済み履歴・外部copy attestation、production変更凍結attestationは`clear`、Vercel production deployment、GitHub production deployment、production backup historyは`present`だった。schema v1の判定はPath B、M1自体は未完了のまま維持し、履歴やdataをPath Aへ合わせる削除は行わない。

同日、owner `RitukoIsibasi0222`は、productionを一般利用者向けに運用しておらず、一般利用者の登録および実利用者dataの保存実績がなく、3件の`present`は開発・運用準備による履歴であることを確認した。これをM1Rとして記録し、provider・backup履歴だけを理由に既存利用者向け通常移行gateへ戻さず、v0.1限定の最小経路を再開する。schema v1 Artifactを再分類せず、schema v2またはPath C判定コードも実装しない。

M1 evidence SHAは`7a6979761428759c744ba3bf9c1ed16527c7b33d`として維持する。この後のrelease文書同期commitはapplication codeを変更しないため、M3/M5/M6で使用するreview済み実行SHAとの差分が`docs/**`だけであることをpreflightで確認し、M1の再実行条件にしない。docs以外の差分またはproduction state変更があれば、この例外を使わずM1Rを再reviewする。

2026-07-28時点でM2P-01〜M2P-16のrepository基盤はPR [#157](https://github.com/RitukoIsibasi0222/gensoko/pull/157)のmerge commit `7a6979761428759c744ba3bf9c1ed16527c7b33d`として`develop`へmerge済みである。同じSHAのM1証拠はPath BのためM2P-17〜M2P-22は未実施・未完了のまま、v0.1 blockerから公開後の回帰campaignへ移す。M2の完了を偽らず、通常password verifier DO、valid login、最小429、主要導線はM6のproduction smokeで確認する。

### 旧Rタスクとの対応

| 最小工程 | 旧タスク                   | v0.1で扱う範囲                                          |
| -------- | -------------------------- | ------------------------------------------------------- |
| M1R      | R6・R13                    | DB 0件証拠、owner確認、既存利用者向け移行対象外判断     |
| M3       | R11A・R11                  | final quality gateとCritical/High 0。Moderateは個別判断 |
| M4       | R9                         | Prisma migration時だけ新鮮な暗号化backup 1世代          |
| M5       | R5・R7・R14・R15           | production構成、通常DO版、別承認deploy                  |
| M6       | R5〜R8・R10・R12・R16〜R18 | 主要導線、DO、429、security、本人退会、cleanup、記録    |

R1〜R4は完了済みの成果として再実行しない。旧R7、M2、backup計画全体を完了させることはM1R・M3・M5・M6と条件付きM4の条件ではない。

### タブ区切り

```tsv
タスクID	タスク内容	対象	優先度
M1R	M1証拠とowner判断を記録	production metadata・DB・docs	高
M3	release候補SHAの品質gate	backend・frontend	高
M4	必要な場合だけbackup・migration	production Actions	高
M5	preflight後にproduction deploy	Vercel・Cloudflare・Supabase・Resend	高
M6	production smokeとrelease記録	production・docs	高
```

## 初回公開後へ移す項目

| 項目                                           | 残るリスク                                      | 再着手条件                                            |
| ---------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| R7PVRB-13〜15のbaseline deploy・rollback drill | DO障害時は自動rollbackせず公開停止・fix-forward | 初回安定版の後、rollback訓練を行う時                  |
| M2 same-SHA staging campaign                   | productionが最初の統合確認になる                | 公開後回帰、または次のauth/infra高リスク変更時        |
| R7のWAF・全境界case・24/48時間観測             | edgeでの高度な濫用防止と長期証拠が未完了        | custom domain・実traffic・abuse観測後                 |
| backup 2〜7世代、retry、recovery、鮮度監視     | 初日は利用可能世代が少なく、失敗時は手動対応    | 公開後の日次run、またはbackup失敗時                   |
| isolated restore drill                         | DBとしての完全復元は未実証                      | 初回公開後の最初の運用review                          |
| staging T35 legacy cleanup                     | cleanup CLIの実環境実演が未完了                 | productionにlegacy rowが見つかる、またはcleanup変更時 |
| contract migration・旧asset失効・長期soak      | deprecated schemaを当面保持                     | 既存利用者dataまたは旧配備を引き継ぐ時                |
| 高度な監視・構造化log・通知                    | 障害検知はprovider標準と手動確認に依存          | traffic増加、初回障害、または運用review時             |
| 網羅的A11Y・複数screen reader                  | 基本操作以外の組合せは未確認                    | v0.1公開後の品質改善                                  |

## v0.1判断分類

| 分類                       | 項目                                                                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 必須                       | M1RのDB 5項目`clear`とowner確認、review済みSHA固定、M3品質gate、M5のDB target・URL・CORS・Cookie・メール・Secret/binding値非表示preflight、production deploy別承認、M6 synthetic smoke・本人退会・cleanup |
| 条件付き必須               | pending Prisma migrationがある場合だけ、新鮮な暗号化backup 1世代・checksum・別承認migration                                                                                                               |
| 推奨だが公開後でよい       | M2 staging campaign、backup日次scheduleと複数世代観測、restore/rollback drill、24/48時間soak、WAF tuning、高度な監視、網羅的A11Y                                                                          |
| v0.1には不要               | schema v2 / Path C engine、古いbackupの復号・内容調査、過去deploymentの完全機械分類、空DBでのT35 legacy cleanupとmanaged DB性能試験、R6/R7/R9/R13〜R16の一律全実行                                        |
| 不明時は省略してはいけない | DB target・User・関連data・AuditLogまたはowner確認に不明点があり、実利用者dataの存在可能性を否定できない場合の通常移行gate                                                                                |

## rollout手順

1. M1 schema v1のPath BとDB 5項目`clear`を維持し、M1Rのowner判断を確認する。DBまたは実利用者dataの前提が不明なら停止する。
2. M3の品質gateをrelease候補SHAで1回実行する。失敗時は対象testへ絞って修正し、新しいSHAをreviewする。
3. M5の値非表示preflightでpending Prisma migrationを確認する。必要な場合だけM4の新鮮な暗号化backup確認と別承認migrationを行う。
4. 別承認で通常password verifier DOを含むAPI、frontendの順にproductionへdeployする。smoke完了までは公開を告知しない。
5. M6でsynthetic User 1件の主要導線、DO valid login、最小429、Cookie・CORS・security headersを確認し、同じchange内で本人退会・flag復旧・記録を完了する。

## workflow実行・承認回数

pending Prisma migrationがない通常経路では、M3はローカルの一括品質確認、M5は承認済みのprovider deployとして扱い、GitHub Actionsの追加dispatchはM6の既存`Production Account Deletion Smoke` 1回だけとする。登録、メール認証、login、reloadによるrefresh、game、最小429は同じsynthetic Userで手動確認し、別の`Production Auth Smoke`は重複実行しない。

必要な明示承認は2回とする。

1. M5のAPI・frontend production deployをまとめたrelease承認。
2. M6の本人退会workflowに対するproduction Environment承認。

pending Prisma migrationがある場合は`migrate-deploy`のdispatchと承認を1回追加する。24時間以内の有効なbackup Artifactがなければ、その作成dispatchとproduction Environment承認も1回追加する。M6失敗時の`recovery-only`は成功経路の予定回数に含めず、必要になった場合だけ別承認で実行する。

## 停止・復旧方針

- M1のDB 5項目に`present` / `unknown`がある、またはownerが実利用者data不存在を確認できない場合は、簡略化せず既存のR6/R7/R9/R13〜R16 gateへ戻る。
- production URL、Cookie、CORS、メール送信元、Secret/binding、DB targetのいずれかが不明ならdeployしない。
- backupはPrisma migrationが必要な場合だけ必須とし、migration不要時はbackup不在だけでdeployを止めない。
- production障害時はCloudflareのproduction公開routeを停止してAPI trafficを遮断し、fix-forwardする。未実装のapplication flagやmaintenance UIを前提にしない。
- pre-v2 DO versionへはrollbackしない。v2適用後の互換versionがある場合だけ通常rollbackを使う。
- migrationはexpand-onlyを維持し、無承認でproduction DBを復元しない。
- synthetic account、fixture、flagのcleanupに失敗した場合は公開完了にしない。

## 品質確認

### 文書PR

- MarkdownをPrettierで整形する。
- `git diff --check`を実行する。
- 新旧release計画、progress、deployment、R6、R7、backupのstatusとリンクを照合する。
- `rg`で「M2がv0.1 blocker」「backupがmigration不要時も必須」「T35が空DBでも必須」という旧条件が正本に残っていないか確認する。
- API仕様と実装を変更していないことを確認する。

### release候補

- backend: 通常全test、Workers test、build、Workers build、lint、format check、Prisma validate。
- frontend: 全test、lint、format check、Svelte check、production build。
- dependencies: production Critical/High 0。Moderateはpackage、到達可能性、回避策、更新期限を記録。
- staging: M2は公開後の回帰または次の高リスク変更時に実行する。
- production: M6で主要導線、通常DO、最小429、Cookie・CORS・security headers、cleanupを確認する。

## テストケース一覧

| ケース                | 期待結果                                                           |
| --------------------- | ------------------------------------------------------------------ |
| M1R成立               | DB 5項目`clear`、owner確認済みで最小計画を継続できる               |
| DBまたはowner確認不明 | 最小計画を停止し通常gateへ戻る                                     |
| 条件付きbackup        | Prisma migration時だけ24時間以内、暗号化archive・checksumを確認    |
| production preflight  | same-site URL、限定CORS、Cookie、メール送信元、binding、Secret分離 |
| production smoke      | 登録・認証・game・DO・429・退会・security成功、User所有row残存なし |
| production障害        | 公開停止し、pre-v2 rollbackを行わずfix-forward                     |

## 完了条件

- M1R・M3・M5・M6と、必要な場合だけM4が完了している。
- 一般登録から本人退会までのproduction smokeが成功している。
- synthetic User、credential、User所有rowは残存せず、AuditLogは365日保持方針に従う内部IDだけを保持している。
- 基本セキュリティ要件を弱めていない。
- 対象外項目を完了扱いにせず、残余リスクと再着手条件を記録している。
- production操作は各工程の別承認でのみ実行している。
