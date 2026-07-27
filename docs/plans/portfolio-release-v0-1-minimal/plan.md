# ポートフォリオ版 v0.1 最小リリース計画

> 設計者ロール: シニアフルスタックエンジニア / セキュリティエンジニア / リリースマネージャー

## 概要

Gensokoを、一般ユーザーが登録・メール認証・ログイン・学習・退会できるポートフォリオWebアプリとして公開する。
商用サービス相当の長期観測や高度な運用自動化は初回公開の条件にせず、一般公開に必要な安全性と主要導線だけを6工程で確認する。

本計画は2026-07-26以降のv0.1リリース範囲と実行順の正本である。
既存の[`portfolio-release-v0-1`](../portfolio-release-v0-1/plan.md)は、R1〜R18の設計・実装・承認履歴として保持する。
個別計画の未完了項目は完了扱いにせず、v0.1の対象外にした項目には再着手条件を記録する。

## 初回公開の方針

- 一般ユーザー登録、メール認証、login・refresh・logout、ゲーム、本人退会を公開する。
- 既存機能をゲスト版へ作り直さず、現在の実装とstaging実績を利用する。
- 基本的なセキュリティはポートフォリオ用途でも省略しない。
- 初回公開前の実環境確認は、同じrelease候補SHAに対するstaging 1回とproduction 1回へ集約する。
- 未公開かつ実利用者0件のproductionでは、旧利用者向けcleanup・migration・soakを実施しない。
- 初回公開では可用性SLAを設けず、互換rollbackが成立しない障害時は公開を停止してfix-forwardする。

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
- production DBが空であると推測しない。M1の承認付きread-only証拠が得られない場合は本計画を停止し、既存の通常移行gateへ戻る。
- API仕様、ステータスコード、エラーメッセージは変更しない。
- bcrypt cost 12、Zod入力検証、Prisma ORM、HttpOnly/Secure Cookie、限定CORS、Hono/DO rate limit、物理削除、安全な日本語error、秘密情報非出力を維持する。
- production frontend/APIはsame-site HTTPS構成とし、Cookie属性を弱めて配備を成立させない。
- password verifier DOの通常版を配備し、main Workerのlocal bcrypt fallbackを禁止する。
- raw password、hash、email、username、User ID、IP、token、Cookie、Authorization、DB URL、Secret、resource ID、raw errorを証拠へ記録しない。

## 対象ファイル一覧

| ファイル                                                        | 変更種別 | 内容                                     |
| --------------------------------------------------------------- | -------- | ---------------------------------------- |
| `docs/plans/portfolio-release-v0-1-minimal/plan.md`             | 新規     | 6工程のv0.1正本                          |
| `docs/plans/portfolio-release-v0-1/plan.md`                     | 修正     | 旧計画を履歴へ変更し、新正本へ誘導       |
| `docs/05_progress.md`                                           | 修正     | M1〜M6を進捗ダッシュボードへ反映         |
| `docs/09_startup_commands.md`                                   | 修正     | backupのv0.1境界を1世代へ同期            |
| `docs/11_deployment.md`                                         | 修正     | 最小deploy・smoke・fix-forward手順を追加 |
| `docs/plans/backup-resilience/plan.md`                          | 修正     | 2世代観測を公開後へ移動                  |
| `docs/plans/production-auth-refresh/plan.md`                    | 修正     | M2・M5・M6へproduction認証証拠を集約     |
| `docs/plans/r6-account-deletion-gates/plan.md`                  | 修正     | 空DB時のT35対象外条件を同期              |
| `docs/plans/r7-rate-limit-environment-gates/plan.md`            | 修正     | v0.1 subsetとR7全体を分離                |
| `docs/plans/r7-password-verification-free-worker/plan.md`       | 修正     | deploy/429とrollback drillを分離         |
| `docs/plans/r7-password-verification-rollback-baseline/plan.md` | 修正     | 実環境drillを公開後へ移動                |

## API仕様

APIのリクエスト、レスポンス、status、error messageは変更しない。
初回公開では次の既存契約を実HTTPで最小確認する。

| 導線                   | 期待結果                                                       |
| ---------------------- | -------------------------------------------------------------- |
| 登録・メール認証       | 登録201、メール受信、token認証成功、再利用拒否                 |
| login・refresh・logout | login成功、reload後refresh、rotation、logout後拒否             |
| ゲーム                 | 問題取得、結果送信、結果表示                                   |
| 本人退会               | Userと所有dataを物理削除し、旧access・refresh・資格情報を拒否  |
| auth rate limit        | stagingの許可回数成功後、境界requestが429と`Retry-After`を返す |
| security               | 固定CORS、security headers、安全なerror、秘密情報非出力        |

## 設計上の決定事項

1. **一般登録を初回から公開するか**
   - 選択: 公開する。
   - 根拠: 登録から学習・退会までがポートフォリオの主要成果であり、既にコードとstaging導線が実装済みであるため。

2. **商用運用相当の全gateを初回公開前に完了するか**
   - 選択: 完了条件にしない。
   - 根拠: WAF tuning、24/48時間soak、rollback drill、複数backup世代、restore drill、高度な監視は、基本的な安全性ではなく運用品質の継続改善であるため。

3. **production DBの既存利用者向け移行を実施するか**
   - 選択: M1でUser・legacy・関連rowが0件、旧production配備なし、個人dataを含む旧backupなしを確認できた場合だけ対象外とする。
   - 根拠: 空DBなら削除対象と互換対象が存在せず、staging T35や長期soakを公開前に行う実益がないため。

4. **password verifier DOのrollback baseline drillを初回公開前に行うか**
   - 選択: 行わない。通常版をstagingで確認し、初回production障害は公開停止とfix-forwardで扱う。
   - 根拠: production未公開・実利用者0件ならpre-v2へ戻す可用性要件がなく、baseline deployとversion drillはリリース本体より大きい運用作業になるため。

5. **backupを何世代待つか**
   - 選択: M1の空DB条件が成立する場合、24時間以内の暗号化済み成功Artifact 1世代と日次schedule有効を公開前条件にする。
   - 根拠: migration前の既存gateも1世代であり、2世代目の観測待ちは未公開・空DBの初回公開を止める理由にならないため。2世代目は公開後の日次runで確認する。

6. **依存関係監査の境界**
   - 選択: production依存のCritical/Highを0件にし、Moderateは到達可能性、回避策、更新期限を記録して判断する。
   - 根拠: severityだけで自動的に全更新を要求せず、実行経路とproduction影響を確認するため。

7. **WAFと長時間観測**
   - 選択: Hono/DOのアプリrate limitをv0.1必須とし、WAF、24時間staging、48時間production観測は公開後へ送る。
   - 根拠: 公開hostnameと実trafficがない段階でのtuning・soakより、公開後の実測に基づく確認が有効であるため。

## タスクリスト（3回レビュー）

### v1: 初版

- 既存のR1〜R18から、初回公開に必要な実環境作業をDB確認、staging、品質、backup、deploy、smokeへ集約した。
- 一般登録、メール認証、login・refresh、game、本人退会を公開範囲に維持した。

### v2: セキュリティ・失敗時レビュー

- bcrypt、Zod、Prisma、Secure Cookie、限定CORS、アプリrate limit、物理削除、安全なerror、秘密非出力を削減対象から除外した。
- 空DBを推測せず、M1の証拠がなければ通常gateへ戻るfail-closed条件を追加した。
- password verifier DO障害時にlocal bcryptへfallbackせず、公開route停止とfix-forwardを採用した。
- backupを1世代へ減らす条件を、空DB・初回配備、24時間以内、暗号化・checksum・日次scheduleへ限定した。

### v3: 既存実装・運用整合レビュー

- repository実装済みの通常DO版を再利用し、baseline drillを初回公開後へ分離した。
- stagingとproductionの実環境確認を各1 campaignへ集約し、release候補SHAが変わった場合はstaging確認をやり直す条件を追加した。
- 既存利用者向けcleanup・migration・soakは、0件証拠がある場合だけ対象外とした。
- production依存はCritical/High 0を必須とし、Moderateを到達可能性に基づく明示判断へ変更した。

### v4: 確定

- M1〜M6以外をv0.1 blockerにしない。
- 未完了の旧Rタスクを完了扱いにせず、公開後の再着手条件を残す。
- productionのwrite・deploy・workflowは引き続き別承認とする。

## 最小リリース工程

| タスクID | 内容                           | 対象                              | 完了条件                                                                                    |
| -------- | ------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------- |
| M1       | 初回公開前提をread-only確認    | production metadata/DB/Artifact   | User・legacy・関連row 0、旧配備・個人data入り旧backupなしを値非表示で確認                   |
| M2       | release候補をstagingで1回確認  | staging frontend/API              | 登録〜退会、通常password verifier DO、auth 429、基本keyboard/320px、cleanup成功             |
| M3       | release候補SHAの品質gate       | backend/frontend                  | test・Workers test・build・lint・format・Prisma validate成功、production依存Critical/High 0 |
| M4       | 新鮮な暗号化backupを確認       | production Actions                | 24時間以内の成功Artifact 1世代、暗号化・checksum・平文なし、日次schedule有効                |
| M5       | preflight後にproduction deploy | Vercel/Cloudflare/Supabase/Resend | same-site URL、Cookie、CORS、送信元、Secret/binding分離、review済みSHA、別承認deploy成功    |
| M6       | production smokeとrelease記録  | production/docs                   | synthetic Userで登録・メール受信〜退会、game、refresh、security確認、cleanup、残課題引継ぎ  |

- [ ] M1: productionが空で初回配備であることを承認付きread-only証拠で確認する
- [ ] M2: release候補SHAのstaging主要導線とauth rate limitを1回のcampaignで確認する
- [ ] M3: release候補SHAの最終品質gateと依存関係監査を実行する
- [ ] M4: 24時間以内の暗号化backup 1世代と日次scheduleを確認する
- [ ] M5: 値非表示preflightでURL・Cookie・CORS・送信元・Secret/bindingを確認し、別承認でproductionへdeployする
- [ ] M6: production smoke、synthetic cleanup、release record、公開後引継ぎを完了する

2026-07-27時点で、M1のmanual-only・GET-only実行基盤は`feature/m1-production-read-only-evidence`で実装・厳格review・品質gateを完了し、PR [#155](https://github.com/RitukoIsibasi0222/gensoko/pull/155) はmerge commit `13e005ba8bf2670612d2ba6ce6547bd389fa3acc`として`develop`へmerge済みである。production Environment/Secret/Variableは変更しておらず、workflow dispatch、production DB接続、provider API requestも実施していない。M1P-15〜M1P-16の別承認実行、証拠review、Path A/B確定は未実施であり、PRのmergeだけでM1を完了扱いにしない。read-only scopeまたはattestationを確認できない場合はdispatchせず、M1を未完了のままPath Bを記録する。M2の詳細は[`docs/plans/m2-staging-release-candidate-campaign/plan.md`](../m2-staging-release-candidate-campaign/plan.md)を正本とし、M1が同じrelease候補SHAでPath Aに確定するまでstaging deploy/requestへ進まない。

2026-07-28時点でM2P-01〜M2P-15のrepository基盤を`feature/m2-staging-release-candidate-campaign`へ実装した。M2P-17〜M2P-22のM1証拠確定、staging preflight/deploy/request、workflow dispatch、cleanup review、M3 handoffは別承認のため未実施であり、M2自体は未完了のままとする。repository PRのmerge後に最終SHAを固定し、そのsame SHAでM1 Path Aを確定してからM2をdispatchする。

### 旧Rタスクとの対応

| 最小工程 | 旧タスク                 | v0.1で扱う範囲                                          |
| -------- | ------------------------ | ------------------------------------------------------- |
| M1       | R6・R13                  | 空DB・初回配備証拠と移行対象外判断だけ                  |
| M2       | R5・R6・R7・R8・R10・R12 | 主要1導線、auth 429、基本keyboard/320px、秘密非出力     |
| M3       | R11A・R11                | final quality gateとCritical/High 0。Moderateは個別判断 |
| M4       | R9                       | 新鮮な暗号化backup 1世代と日次schedule                  |
| M5       | R5・R7・R14・R15         | production構成、通常DO版、別承認deploy                  |
| M6       | R5・R6・R8・R16〜R18     | 最小smoke、cleanup、記録、公開後handoff                 |

R1〜R4は完了済みの成果として再実行しない。旧R7やbackup計画全体を完了させることはM1〜M6の条件ではない。

### タブ区切り

```tsv
タスクID	タスク内容	対象	優先度
M1	初回公開前提をread-only確認	production metadata・DB・Artifact	高
M2	release候補をstagingで1回確認	staging frontend・API	高
M3	release候補SHAの品質gate	backend・frontend	高
M4	新鮮な暗号化backupを確認	production Actions	高
M5	preflight後にproduction deploy	Vercel・Cloudflare・Supabase・Resend	高
M6	production smokeとrelease記録	production・docs	高
```

## 初回公開後へ移す項目

| 項目                                           | 残るリスク                                      | 再着手条件                                            |
| ---------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| R7PVRB-13〜15のbaseline deploy・rollback drill | DO障害時は自動rollbackせず公開停止・fix-forward | 初回安定版の後、rollback訓練を行う時                  |
| R7のWAF・全境界case・24/48時間観測             | edgeでの高度な濫用防止と長期証拠が未完了        | custom domain・実traffic・abuse観測後                 |
| backup 2〜7世代、retry、recovery、鮮度監視     | 初日は利用可能世代が少なく、失敗時は手動対応    | 公開後の日次run、またはbackup失敗時                   |
| isolated restore drill                         | DBとしての完全復元は未実証                      | 初回公開後の最初の運用review                          |
| staging T35 legacy cleanup                     | cleanup CLIの実環境実演が未完了                 | productionにlegacy rowが見つかる、またはcleanup変更時 |
| contract migration・旧asset失効・長期soak      | deprecated schemaを当面保持                     | 既存利用者dataまたは旧配備を引き継ぐ時                |
| 高度な監視・構造化log・通知                    | 障害検知はprovider標準と手動確認に依存          | traffic増加、初回障害、または運用review時             |
| 網羅的A11Y・複数screen reader                  | 基本操作以外の組合せは未確認                    | v0.1公開後の品質改善                                  |

## rollout手順

1. M1のread-only確認を行う。0件・初回配備を確認できなければ本計画を停止する。
2. release候補SHAを固定し、通常password verifier DO版をstagingへdeployする。
3. M2の単一campaignで登録、メール認証、login、refresh、game、本人退会、auth 429、cleanupを確認する。
4. M3の品質gateを1回実行する。失敗時は対象testへ絞って修正し、release候補を更新してM2からやり直す。
5. M4で新鮮な暗号化backupと日次scheduleを確認する。
6. M5の値非表示preflight後、別承認で必要なmigration、API、frontendの順にdeployする。
7. M6でsynthetic User 1件の主要導線を確認し、同じchange内で削除・flag復旧・記録を完了する。

## 停止・復旧方針

- M1が0件・初回配備を証明できない場合は、簡略化せず既存のR6/R7/R9/R13〜R16 gateへ戻る。
- stagingでv2 DO migration、binding、valid login、429、cleanupのいずれかが失敗した場合はproductionへ進まない。
- production URL、Cookie、CORS、メール送信元、Secret/binding、DB target、backupのいずれかが不明ならdeployしない。
- production障害時はCloudflareのproduction公開routeを停止してAPI trafficを遮断し、fix-forwardする。未実装のapplication flagやmaintenance UIを前提にしない。
- pre-v2 DO versionへはrollbackしない。v2適用後の互換versionがある場合だけ通常rollbackを使う。
- migrationはexpand-onlyを維持し、無承認でproduction DBを復元しない。
- synthetic account、fixture、flagのcleanupに失敗した場合は公開完了にしない。

## 品質確認

### 文書PR

- MarkdownをPrettierで整形する。
- `git diff --check`を実行する。
- 新旧release計画、progress、deployment、R6、R7、backupのstatusとリンクを照合する。
- `rg`で「2世代がv0.1 blocker」「R7PVRB-13〜15がv0.1 blocker」「T35が空DBでも必須」という旧条件が正本に残っていないか確認する。
- API仕様と実装を変更していないことを確認する。

### release候補

- backend: 通常全test、Workers test、build、Workers build、lint、format check、Prisma validate。
- frontend: 全test、lint、format check、Svelte check、production build。
- dependencies: production Critical/High 0。Moderateはpackage、到達可能性、回避策、更新期限を記録。
- staging: M2の単一campaign。
- production: M6の最小smoke。

## テストケース一覧

| ケース               | 期待結果                                                            |
| -------------------- | ------------------------------------------------------------------- |
| M1が全件0・初回配備  | 最小計画を継続できる                                                |
| M1が0件以外・不明    | 最小計画を停止し通常gateへ戻る                                      |
| staging通常DO版      | valid login成功、main Workerの`exceededCpu`非再発                   |
| staging auth境界     | 許可回数後に429と`Retry-After`                                      |
| staging主要導線      | 登録から本人退会・旧認証拒否まで成功                                |
| backup               | 24時間以内、暗号化archive・checksumのみ、平文なし                   |
| production preflight | same-site URL、限定CORS、Cookie、メール送信元、binding、Secret分離  |
| production smoke     | 登録・メール受信・認証・game・退会・security成功、synthetic残存なし |
| production障害       | 公開停止し、pre-v2 rollbackを行わずfix-forward                      |

## 完了条件

- M1〜M6が完了している。
- 一般登録から本人退会までのproduction smokeが成功している。
- 基本セキュリティ要件を弱めていない。
- 対象外項目を完了扱いにせず、残余リスクと再着手条件を記録している。
- production操作は各工程の別承認でのみ実行している。
