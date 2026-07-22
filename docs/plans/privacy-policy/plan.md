# プライバシーポリシー `/privacy` 実装計画

> 設計者ロール: プライバシー設計エンジニア / シニアフロントエンドエンジニア

## 概要

一般ユーザー登録を受け付けるポートフォリオ版v0.1のrelease blockerとして、公開プライバシーポリシーページ`/privacy`を実装する。実際に収集・利用・保存・削除するデータと外部サービスを正確に説明し、アカウント完全削除、監査内部ID、refresh Cookie、暗号化backup、問い合わせ先の境界を明文化する。

法務・運用上の未決定値を推測で埋めず、公開前にownerが正式値と発効日を確認する。テンプレートや仮文言のままproductionへ公開しない。

## 現状

- `/privacy` routeは存在しない。
- Footerはcopyrightだけを表示し、privacy linkがない。
- register/settingsからprivacy・削除・backup境界を確認する導線がない。
- `docs/02_security.md`、監査ログ計画、完全削除計画に必要記載事項はある。監査ログの正式保持期間365日と目的は承認済みだが、利用者向け文言と問い合わせ先は未確定である。
- 現行実装が収集する主なaccount情報はusernameとemailで、passwordはbcrypt hashとして保持する。
- 学習data、認証token hash、監査内部ID、暗号化backup、外部providerの処理境界を説明する必要がある。

## 前提条件・依存関係

### 既存の公開インターフェース

**`docs/02_security.md`**

- SEC-008 — 監査ログ、禁止ログ、退会後内部IDの正式365日保持。
- SEC-009 — username/email、物理削除、再登録、backup境界。

**`docs/04_api.md`**

- 登録、メール認証、login/refresh/logout、本人退会、管理者強制退会の公開契約。

**`docs/plans/account-data-complete-deletion/plan.md`**

- Userと所有rowの物理削除、監査内部ID例外、backup失効・restore replayの未完了gate。

**`docs/plans/audit-log-production-operations/plan.md`**

- 監査目的、正式保持期間365日、2026-07-14の承認記録、cleanup有効化前のrelease gate。

**`docs/11_deployment.md`**

- production DB暗号化backupの7日Artifact保持とisolated restore方針。

### 重要な制約

- 実装・設定・運用で確認できない保証を書かない。
- 監査保持期間、問い合わせ先、運営者表示、発効日、外部provider、backup境界をplaceholderのまま公開しない。
- password、token、Cookie、Authorization、DB URL、内部ID、provider credentialの値をページやtest fixtureへ書かない。
- アカウント削除を「即時にすべての媒体から消える」と表現しない。稼働DBの物理削除、監査内部ID例外、暗号化backupの最長保持・restore時再削除境界を分けて説明する。
- 監査内部IDの保持期間・目的は2026-07-14承認済みとして扱う。問い合わせ先と利用者向けアクセス範囲の正式文言が決まらなければreleaseをblockする。
- analytics、広告、第三者販売を使っていない場合だけ「利用しない」と記載し、将来導入時は先にpolicyを更新する。
- 本計画は法的助言の代替ではない。個人開発の公開範囲に合わせた事実確認とowner承認を必須にする。

## 対象ファイル一覧

| ファイル                                                   | 変更種別 | 内容                                         |
| ---------------------------------------------------------- | -------- | -------------------------------------------- |
| `frontend/src/routes/privacy/+page.svelte`                 | 新規     | 公開プライバシーポリシーページ               |
| `frontend/src/routes/privacy/privacy-page.test.ts`         | 新規     | 見出し、必須節、link、禁止placeholderのtest  |
| `frontend/src/lib/components/Footer.svelte`                | 修正     | 全app画面から`/privacy`へ到達するlink        |
| `frontend/src/lib/components/Footer.svelte.test.ts`        | 新規     | link・accessible name・href契約              |
| `frontend/src/routes/register/+page.svelte`                | 修正     | 登録前に確認できるprivacy導線                |
| `frontend/src/routes/register/register-page.test.ts`       | 修正     | privacy linkとkeyboard到達                   |
| `frontend/src/routes/(app)/settings/+page.svelte`          | 修正     | 退会前に削除・backup説明へ到達する導線       |
| `frontend/src/routes/(app)/settings/settings-page.test.ts` | 修正     | privacy link、退会説明との整合               |
| `docs/02_security.md`                                      | 修正候補 | 正式決定した保持期間・問い合わせ境界だけ同期 |
| `docs/05_progress.md`                                      | 修正     | 実装中/完了状態と計画link                    |
| `docs/11_deployment.md`                                    | 修正候補 | release checklistに公開URL・owner確認を同期  |
| `docs/plans/privacy-policy/plan.md`                        | 修正     | 正式文言、承認、実変更、TDD・確認結果        |

`docs/04_api.md`はAPI仕様が変わる場合だけ更新する。privacy pageとlink追加だけなら編集しない。

## ページ構成案

| 節                            | 必須内容                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| 運営者・適用範囲              | Gensoko、ポートフォリオ公開、運営主体、発効日、version                                            |
| 収集する情報                  | username、email、password hash、認証token hash、学習/ゲームdata、監査内部ID、必要最小限の運用情報 |
| 収集しない/ログへ出さない情報 | 平文password、token、Cookie、Authorization、不要なPII                                             |
| 利用目的                      | account、メール認証、login、学習機能、セキュリティ、障害対応                                      |
| Cookie・認証                  | HttpOnly refresh Cookie、目的、Secure/SameSite、localStorageへrefresh tokenを保存しないこと       |
| 外部サービス                  | Vercel、Cloudflare、Supabase、Resend、GitHub Actions backup。役割と各provider policyへのlink      |
| 保存期間                      | account継続中、token期限、監査正式期間、backup最長境界。未確定値禁止                              |
| アカウント削除                | 稼働DBのUser/所有data物理削除、再登録、旧auth拒否、共有Element非対象                              |
| 監査の例外                    | email/usernameを含まない内部ID・role・event、目的、保持期間、アクセス範囲                         |
| backup・restore               | AES-256暗号化、Artifact保持、削除済みdataを含み得ること、isolated restoreと再削除                 |
| 安全管理                      | bcrypt、Zod、CORS、Cookie、rate limit、security headers、秘密非出力                               |
| 利用者の選択                  | 登録しない選択、退会、問い合わせ、policy変更時の確認方法                                          |
| 問い合わせ                    | 実際に受信・対応できる公開窓口。秘密値や個人情報の公開投稿を避ける注意                            |
| 改定                          | 重要変更の告知方法、発効日、履歴                                                                  |

## 外部サービス境界

公開前に現在のproduction構成と照合し、利用していないproviderを記載しない。

| provider       | 役割                                  | policyへ記載する境界                         |
| -------------- | ------------------------------------- | -------------------------------------------- |
| Vercel         | frontend配信                          | request時のprovider処理、公開frontend        |
| Cloudflare     | API配信、rate limit、network/security | API requestとedge/Workers処理                |
| Supabase       | PostgreSQL hosting                    | account・学習・監査dataの保存                |
| Resend         | 確認・password resetメール            | 宛先emailと配送に必要な情報                  |
| GitHub Actions | 暗号化backup・運用workflow            | 暗号化Artifactとchecksumのみ。平文dump非保存 |

providerの保持期間、region、subprocessor、問い合わせ先をアプリが保証できない場合は、各providerの公開policyへの参照とGensoko側の設定境界を区別する。

## 公開インターフェース案

| method | path       | 認証 | 内容                           |
| ------ | ---------- | ---- | ------------------------------ |
| GET    | `/privacy` | 不要 | 静的なプライバシーポリシーHTML |

- API呼び出し、Cookie設定、個人data取得を行わない。
- page title、description、最上位`h1`を設定する。
- fragment linkを採用する場合は見出しIDを安定させる。

## 設計上の決定事項

1. **routeの公開範囲**
   - 選択: 認証不要の`/privacy`として公開する。
   - 根拠: 登録前とメールlinkから確認できる必要があるため。

2. **文言のsource of truth**
   - 選択: 利用者向け本文はpage、技術契約はsecurity/deployment/各planとし、公開前checklistで照合する。
   - 根拠: 技術詳細をそのまま利用者へ露出せず、事実のずれを防ぐため。

3. **問い合わせ先**
   - 選択: ownerが実際に監視できる公開窓口をrelease前に決定する。架空の担当者・住所・メールを作らない。
   - 根拠: 応答できない窓口は利用者保護にならないため。

4. **監査内部ID**
   - 選択: incident/admin操作の相関目的、アクセス範囲、正式保持期間を明記し、email/username非保存と期限後cleanupを区別する。
   - 根拠: 完全削除とセキュリティ監査の例外を隠さないため。

5. **backup**
   - 選択: 稼働DB削除とbackup失効を分け、最長保持とrestore時再削除を説明する。
   - 根拠: 「退会後即時に全媒体から消える」という不正確な保証を避けるため。

6. **同意UI**
   - 選択: v0.1ではpolicy linkを登録form近傍へ配置する。必須checkboxはowner/legal判断で必要と決まった場合だけ追加する。
   - 根拠: 不要な同意dark patternや未定義の法的根拠を増やさないため。

7. **改定**
   - 選択: pageへ発効日とversionを表示し、収集項目・目的・provider・保持・削除境界の変更時はproduction変更前に更新する。
   - 根拠: 実装と公開説明の時間差を防ぐため。

## 公開前にownerが確定する値

| 決定事項                           | 現在                              | 未確定時の扱い   |
| ---------------------------------- | --------------------------------- | ---------------- |
| 運営主体の表示名                   | 未確定                            | release block    |
| 問い合わせ窓口                     | 未確定                            | release block    |
| 発効日・version                    | 未確定                            | release block    |
| 監査ログ正式保持期間               | 365日、2026-07-14承認済み         | 確定             |
| 監査内部IDの目的・アクセス範囲     | 目的は承認済み、公開文言は未確定  | release block    |
| backup最長保持とrestore replay説明 | 技術境界あり、正式文言待ち        | release block    |
| productionで使用するprovider一覧   | staging構成あり、production未配備 | deploy前に再確認 |
| policy改定の告知方法               | 未確定                            | release block    |

## タスクリスト（進捗管理）

| タスクID | 内容                             | ファイル・担当 | 優先度 | 完了条件                               |
| -------- | -------------------------------- | -------------- | ------ | -------------------------------------- |
| P1       | 実data flowとproviderを棚卸し    | code/docs/環境 | 高     | 事実・未確認・非収集を分類             |
| P2       | owner決定事項を確定              | owner/docs     | 高     | placeholderなし、承認者・日付記録      |
| P3       | page contentのRed test           | privacy test   | 高     | 必須節/link/禁止文言で失敗             |
| P4       | `/privacy` pageを実装            | privacy route  | 高     | 公開route、head、semantic HTML         |
| P5       | Footer linkのRed/Green           | Footer/test    | 高     | 全app画面から到達                      |
| P6       | register/settings導線のRed/Green | pages/tests    | 高     | 登録前・退会前に到達                   |
| P7       | responsive/A11Yを確認            | browser        | 高     | keyboard、heading、link、320px、zoom   |
| P8       | security/deployment整合をreview  | docs/code      | 高     | 収集・保持・削除・providerが一致       |
| P9       | frontend品質gate                 | frontend       | 高     | test/lint/format/check/build成功       |
| P10      | stagingで公開確認                | staging        | 高     | 未認証アクセス、link、内容、header成功 |
| P11      | owner最終確認                    | owner          | 高     | 公開文言・窓口・発効日承認             |
| P12      | plan/progressを同期              | docs           | 中     | 実変更・TDD・URL・status一致           |

- [ ] P1: 実data flowとproviderを棚卸しする
- [ ] P2: owner決定事項を確定する
- [ ] P3: privacy page contentのRed testを追加する
- [ ] P4: `/privacy` pageを実装する
- [ ] P5: Footer linkをTDD実装する
- [ ] P6: register/settings導線をTDD実装する
- [ ] P7: responsive・keyboard・A11Yを確認する
- [ ] P8: security/deploymentとの整合をreviewする
- [ ] P9: frontend品質gateを実行する
- [ ] P10: stagingで公開確認する
- [ ] P11: ownerが最終文言を確認する
- [ ] P12: plan/progressを実態へ同期する

## TDD方針

### Red

- `/privacy`の`h1`、発効日、収集、目的、Cookie、provider、保持、削除、監査、backup、問い合わせ、改定の各節を要求するcontent contractを追加する。
- `TODO`、`TBD`、`example.com`、架空の問い合わせ先、即時全媒体削除等の禁止placeholder/誤保証を検出する。
- Footer、register、settingsのlinkとaccessible nameをtest先行で固定する。

### Green

- semantic HTMLでpageを実装し、APIやclient stateへ依存させない。
- linkをFooter、register、settingsへ追加し、既存form・退会処理を変更しない。

### Refactor

- link label、section ID、日付/version表現を一貫させる。
- 同じ長文を複数pageへ複製せず、`/privacy`を正本として短い説明からlinkする。
- format後に対象・関連・frontend全testを実行する。

## テストケース一覧

| ケース               | 期待結果                                                                       |
| -------------------- | ------------------------------------------------------------------------------ |
| 未認証GET `/privacy` | 200で表示、API呼び出しなし                                                     |
| document head        | 日本語title/descriptionあり                                                    |
| heading              | `h1`が1つ、節が論理順                                                          |
| 必須content          | 収集・目的・Cookie・provider・保持・削除・監査・backup・問い合わせ・改定を含む |
| placeholder          | `TODO`/`TBD`/仮窓口なし                                                        |
| 誤保証               | backup/監査を無視した即時全媒体削除を断言しない                                |
| Footer               | `/privacy` linkへkeyboardで到達可能                                            |
| register             | submit前にpolicyへ到達可能                                                     |
| settings             | 退会前に削除境界へ到達可能                                                     |
| mobile/zoom          | 320px、200%で横スクロール・見切れなし                                          |
| light/dark           | 両themeで読みやすい                                                            |
| external link        | provider policy linkが安全な属性と明確なlabelを持つ                            |

## 手動確認

- logout状態で`/privacy`を直接開く。
- Footer、register、settingsからkeyboardだけで移動する。
- link後の戻る操作で入力中formが不必要に失われないか確認する。
- mobile 320px、desktop、200% zoom、light/darkで読む。
- screen readerのheading listとlink名を確認する。
- production予定provider・保持期間・問い合わせ先・発効日が公開本文と運用記録に一致する。
- page source、browser network、logへ秘密値・個人dataが出ていないことを確認する。

## 実装完了条件

- [ ] `/privacy`が未認証で公開され、Footer・register・settingsから到達できる。
- [ ] 収集、利用目的、Cookie、外部サービス、保持、削除、監査、backup、問い合わせ、改定を実態どおり説明する。
- [ ] 監査保持期間、問い合わせ先、発効日、provider、backup境界にplaceholderがない。
- [ ] account deletion、audit、security、deployment文書と矛盾しない。
- [ ] responsive、keyboard、heading、contrastの基本確認が成功する。
- [ ] frontend全test、lint、format check、Svelte check、production buildが成功する。
- [ ] ownerの最終確認者・日付を秘密情報なしで記録する。
- [ ] 本計画と`docs/05_progress.md`が実変更・未実施事項に一致する。
