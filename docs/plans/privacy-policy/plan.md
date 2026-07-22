# プライバシーポリシー `/privacy` 実装計画

> 設計者ロール: シニアフロントエンドエンジニア / プライバシー設計レビュー担当

## 概要

ポートフォリオ版 v0.1 のリリースタスク R3 として、認証不要で閲覧できるプライバシーポリシーページ `/privacy` と、Footer・ユーザー登録・設定画面からの導線を TDD で実装する。

本文は、現行コードと運用文書で確認できるデータ処理を利用者向けに説明する。未確定値や staging だけの構成を production の確定事項として扱わず、R3 の実装入力と R4 の正式承認を分離する。

## 計画再レビュー結果（2026-07-22）

### 結論

既存計画の目的と主要な記載項目は妥当だが、そのまま実装すると route 配置、認証情報のブラウザ保存、R3 と後続 release task の境界にずれが生じる。以下を修正した。

| 指摘                                                  | 確認した事実                                                                                             | 改善内容                                                                                                                    | 優先度 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------ |
| route 配置が共通レイアウトと不一致                    | Header/Footer は `frontend/src/routes/(app)/+layout.svelte` にあり、既存案の `routes/privacy` はその外側 | `frontend/src/routes/(app)/privacy/+page.svelte` に配置する。route group は URL に現れないため公開 URL は `/privacy` のまま | 高     |
| R3 に R4・R10・R12 の完了条件が混在                   | release 計画は R3=実装、R4=正式承認、R10=全画面 A11Y、R12=staging 主要導線として分離                     | R3 は実装・新規画面固有確認・frontend 品質 gate まで。正式承認、横断 A11Y、staging は後続 task に残す                       | 高     |
| ブラウザ保存の説明が不足                              | access token と `id`・`username`・`role` は `sessionStorage`、refresh token は HttpOnly Cookie           | Cookie 節を「ブラウザ保存・Cookie」へ広げ、両方の用途・削除境界を記載する                                                   | 高     |
| `docs/02_security.md` の古い認証説明を正本にできない  | 現行 frontend/backend は access token + HttpOnly refresh Cookie を実装している                           | 認証の事実確認は `auth.svelte.ts`、auth route/service、`docs/04_api.md` を優先し、文書差分は R4 で同期する                  | 高     |
| 外部 service の確定状態が曖昧                         | Vercel/Cloudflare/Supabase/Resend は staging 実績がある一方、production resource・deploy は未完了        | production 予定と実利用を区別して棚卸しし、R3 へ渡す provider 一覧を具体化する。R4 で最終承認する                           | 高     |
| content test が文言の完全一致へ寄りすぎる             | policy 本文は承認 review で表現が変わり得る                                                              | 見出し・意味上の必須情報・安定 ID・link 契約を検証し、長文の完全一致は避ける                                                | 中     |
| component test だけで HTTP 200 を保証しようとしている | Vitest component test は SvelteKit の実 HTTP status を検証しない                                         | component test は DOM 契約、`npm run build` は route 生成、未認証 direct navigation は browser 確認で分担する               | 中     |
| 利用者向け本文に技術詳細が多い                        | Zod/CORS/security headers などは変更頻度が高く、privacy の主要説明ではない                               | 安全管理措置は利用者向け要約にし、検証できない絶対保証や内部実装一覧を載せない                                              | 中     |

## R3 と後続リリースタスクの境界

| task | この計画で扱う内容                                                                                                      | この計画で完了扱いにしない内容           |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| R3   | `/privacy`、Footer/register/settings 導線、component test、新規画面固有の responsive・keyboard 確認、frontend 品質 gate | production 公開、全画面の A11Y、法務助言 |
| R4   | R3 実装へ入れる具体値の最終確認と、運営主体・問い合わせ先・保持/backup/provider 文言の正式承認記録                      | R3 のコード実装そのもの                  |
| R10  | register/login/game/settings/admin/privacy/theme を横断した responsive・keyboard/A11Y release 確認                      | `/privacy` 単体の基本確認だけでの完了    |
| R12  | review 済み SHA を staging へ配備した後の主要導線確認                                                                   | local component test や local build      |
| R16  | production deploy 後の `/privacy` smoke                                                                                 | staging または local の結果による代替    |

R3 の Green 実装前に、下記「実装入力 gate」の具体値を owner から受け取る。R3 では placeholder を source に入れない。R4 は、その具体値と本文全体を release 前の正式承認として記録する別 task である。

## 現行実装の確認結果

- `/privacy` route と privacy 文言は未実装である。
- `Footer.svelte` は copyright だけを表示し、`(app)` route group にだけ配置されている。
- `/register` は `(app)` の外側にあるため Footer がなく、登録 form 近傍へ直接 link が必要である。
- `/settings` には、稼働 DB から profile・認証情報・学習データを物理削除する既存警告がある。privacy link はこの警告の近くに置く。
- DB は username、email、password hash、role、認証状態・login 状態、token hash、有効期限、苦手元素、game session/answer、問題セット、統計、監査内部 ID 等を保持する。
- access token と `id`・`username`・`role` は browser の `sessionStorage` に保存する。refresh token は HttpOnly Cookie、DB では SHA-256 hash と有効期限を保存する。
- 監査 row は email/username ではなく内部 ID を含み、正式保持期間は 365 日である。
- 現行の account deletion 計画は、稼働 DB の物理削除、監査内部 ID の期限付き例外、暗号化 backup の最長 7 日境界、全損時の削除 replay 未決定リスクを分けている。
- staging では Vercel、Cloudflare Workers/Durable Objects、Supabase、Resend を使用済みである。production の実利用構成は R4/R14 の確認前に確定扱いしない。

## 前提条件・依存関係

### 既存の公開インターフェース

**`frontend/src/routes/(app)/+layout.svelte`**

- Header、main、Footer を持つ公開共通レイアウト。
- 認証 guard はなく、route group 名は URL に含まれない。

**`frontend/src/lib/components/Footer.svelte`**

- `(app)` 配下の全画面に表示される共通 Footer。

**`frontend/src/lib/stores/auth.svelte.ts`**

- `AuthUser`: `{ id: string; username: string; role: "USER" | "ADMIN" }`。
- access token と `AuthUser` を `sessionStorage` に保存し、logout・refresh 失敗・退会時に削除する。
- refresh token は frontend JavaScript から読み取らず、`credentials: "include"` で HttpOnly Cookie を送る。

**`docs/04_api.md` と auth route/service**

- 登録、メール認証、login、refresh、logout、password reset、本人退会の現行契約。
- token hash、有効期限、Cookie 属性の実装確認元。

**`backend/prisma/schema.prisma`**

- account、認証、学習、game、統計、監査の保存 field と cascade 関係。

**関連計画・運用文書**

- `docs/plans/portfolio-release-v0-1/plan.md` — R3〜R4、R10、R12、R16 の正本。
- `docs/plans/account-data-complete-deletion/plan.md` — 稼働 DB、監査、backup、restore の削除境界。
- `docs/plans/audit-log-production-operations/plan.md` — 監査目的、365 日保持、cleanup。
- `docs/11_deployment.md` — staging/production の provider、暗号化 backup、release checklist。
- `docs/02_security.md` — セキュリティ方針。ただし認証方式の古い記述は現行 code/API と照合する。

### 重要な制約

- 実装・設定・運用で確認できない保証を書かない。
- `TODO`、`TBD`、`example.com`、架空の連絡先、未確定を示す仮文言を source に入れない。
- secret、実 token、Cookie 値、Authorization 値、DB URL、credential、実在利用者の情報を page/test/docs に入れない。
- 「退会直後にすべての媒体から完全消去」と断言しない。稼働 DB、監査内部 ID、暗号化 backup、メール配送・provider log の境界を分ける。
- password は平文を保存しない。ただしメール事業者は確認・reset メールの宛先と本文中の期限付き URL を配送処理するため、「外部 service は token を一切処理しない」と断言しない。
- raw IP を application DB/DO rowへ保存しないことと、Cloudflare/Vercel 等が request metadata を処理し得ることを混同しない。
- analytics、広告、第三者販売を利用していないことは実装・production 設定を確認できた場合だけ記載する。
- Cookie の `Secure`/`SameSite` production 値は R5 の実環境 gate 前に確定済みと書かない。R3 では用途、HttpOnly、保持境界を中心に説明する。
- 法的助言の代替ではない。適用法令上必要な表示の判断は owner の責任で R4 に記録する。

## 実装入力 gate

R3 の page 実装を開始する前に、次を具体値として決定する。値を決めずに仮実装して完了扱いにしない。

| 決定事項                     | 現状                                          | R3 の開始条件                                 | R4 の役割                          |
| ---------------------------- | --------------------------------------------- | --------------------------------------------- | ---------------------------------- |
| 運営主体の表示名             | 未確定                                        | 公開可能な具体名を受領                        | 表示の妥当性を正式承認             |
| 問い合わせ窓口               | 未確定                                        | 実際に受信・対応できる URL またはメールを受領 | 対応責任者・運用を正式承認         |
| 発効日・version              | 未確定                                        | 実日付と version を受領                       | release 日程との整合を正式承認     |
| 監査内部 ID の利用者向け説明 | 目的・365 日は承認済み、公開文言は未確定      | 目的、access 範囲、保持期間の文案を受領       | 公開文言を正式承認                 |
| backup/restore 説明          | 最長 7 日境界あり、全損時 replay 方針は未決定 | 現時点の制約を隠さない具体文案を受領          | 残余リスクと運用を正式承認         |
| production provider 一覧     | staging 実績あり、production 未配備           | v0.1 で利用予定の一覧と役割を受領             | 配備構成と privacy link を正式承認 |
| policy 改定の告知方法        | 未確定                                        | 実行可能な方法を受領                          | 運用責任を正式承認                 |

## 対象ファイル一覧

| ファイル                                                   | 変更種別         | 内容                                                                       |
| ---------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| `frontend/src/routes/(app)/privacy/+page.svelte`           | 新規             | 共通 Header/Footer を使う公開 privacy page、head metadata、安定 section ID |
| `frontend/src/routes/(app)/privacy/privacy-page.test.ts`   | 新規             | DOM content contract、head、section ID、link、placeholder 禁止             |
| `frontend/src/lib/components/Footer.svelte`                | 修正             | `/privacy` link を追加                                                     |
| `frontend/src/lib/components/Footer.svelte.test.ts`        | 新規             | accessible name と `href` の component contract                            |
| `frontend/src/routes/register/+page.svelte`                | 修正             | submit 前に確認できる `/privacy` link                                      |
| `frontend/src/routes/register/register-page.test.ts`       | 修正             | privacy link の accessible name と `href`                                  |
| `frontend/src/routes/(app)/settings/+page.svelte`          | 修正             | 削除警告近くに `/privacy#account-deletion` link                            |
| `frontend/src/routes/(app)/settings/settings-page.test.ts` | 修正             | 削除説明 link と既存警告の共存                                             |
| `docs/05_progress.md`                                      | 実装完了時に修正 | R3 だけを完了へ更新し、R4/R10/R12 は未完了のまま維持                       |
| `docs/plans/privacy-policy/plan.md`                        | 修正             | TDD記録、実変更、確認結果、R3 完了を同期                                   |

`docs/02_security.md`、`docs/11_deployment.md`、`docs/04_api.md` は R3 の page/link 追加だけでは変更しない。事実差分や承認値を同期する場合は R4 の `docs:` 変更として分離する。API、DB schema、認証 store は変更対象外である。

## ページ構成と内容契約

長文の完全一致を test へ固定せず、次の意味上の内容と安定 ID を契約にする。

| section ID          | 必須内容                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `scope`             | サービス名、運営主体、適用範囲、発効日、version                                                |
| `data-collected`    | account 情報、認証・security 情報、学習/game 情報、監査内部 ID、必要な request metadata の分類 |
| `purposes`          | account 提供、認証・mail、学習機能、security/不正対策、障害対応                                |
| `browser-storage`   | access token と利用者情報の `sessionStorage`、HttpOnly refresh Cookie、用途、削除/期限境界     |
| `service-providers` | production 予定 provider の役割、処理する情報、各社 privacy policy への link                   |
| `retention`         | account 継続中の情報、token 期限、監査 365 日、backup 最長 7 日、provider 側保持の境界         |
| `account-deletion`  | 稼働 DB の所有 data 物理削除、旧認証拒否、再登録、共有 Element 非対象、監査/backup 例外        |
| `security`          | hash、access 制御、暗号化 backup 等の検証可能な安全管理措置の利用者向け要約                    |
| `contact`           | 実際に対応できる問い合わせ窓口と、secret/個人情報を公開投稿しない注意                          |
| `changes`           | 改定時の告知方法、発効日/version の更新方針                                                    |

### 情報分類の最低契約

- account: username、email、password hash、role、email 確認・account 状態、作成/更新/login 関連時刻。
- 認証: refresh/email verification/password reset の token hash と有効期限。raw refresh token は HttpOnly Cookie、access token は `sessionStorage`。
- 学習/game: 苦手元素、正誤・選択・score・時間・streak、game session、問題セット、統計。
- 監査: security 上重要な操作、結果、内部 actor/target ID、role、時刻、限定された失敗理由。email/username は監査 row に保存しない。
- request/security: provider が処理し得る IP address、user agent、request metadata と、rate limit 用の HMAC 化識別境界を実態に沿って説明する。

### 外部 service 棚卸し

R3 着手時に code、deployment docs、production 予定構成を再確認し、利用しない service を本文へ載せない。

| service                  | 確認済みの役割                                          | 本文で説明する処理境界                                     | R3/R4 の確認点                                        |
| ------------------------ | ------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| Vercel                   | frontend 配信、staging 配備済み                         | frontend request の配信と request metadata                 | production 利用有無、公式 privacy link                |
| Cloudflare               | API、edge security、rate limit DO、staging 配備済み     | API request、IP 等の request metadata、期限付き counter    | production hostname/WAF/DO 構成、公式 privacy link    |
| Supabase                 | PostgreSQL hosting、staging/production project 作成済み | account・認証・学習・監査 data                             | production 接続先、region、公式 privacy link          |
| Resend                   | staging の確認/reset mail 配送実績                      | 宛先 email、mail 本文、期限付き確認/reset URL              | production mail provider、保持設定、公式 privacy link |
| GitHub Actions/Artifacts | 暗号化 backup workflow                                  | 暗号化 archive と checksum。平文 dump を Artifact にしない | production workflow、最長 7 日、公式 privacy link     |

provider 独自の保持期間、region、subprocessor を Gensoko が保証できない場合は、Gensoko 側の設定と provider の policy を分けて説明する。

## 公開インターフェース案

| method | path       | 認証 | 内容                            |
| ------ | ---------- | ---- | ------------------------------- |
| GET    | `/privacy` | 不要 | 静的なプライバシーポリシー HTML |

- SvelteKit page として実装し、API call、個人 data fetch、Cookie 設定を行わない。
- `(app)` route group に置き、既存 Header/Footer と theme を利用する。
- 日本語の `title` と `meta description`、最上位 `h1` を 1 つ設定する。
- settings の link target として `#account-deletion` を安定公開する。

## 設計上の決定事項

1. **route の配置**
   - 選択: `frontend/src/routes/(app)/privacy/+page.svelte`。
   - 根拠: `/privacy` の URL と未認証公開を維持しつつ、既存 Header/Footer、幅、theme を再利用できるため。

2. **本文の source of truth**
   - 選択: 利用者向け本文は `/privacy`、技術契約は code/schema/API/deployment docs とし、R4 checklist で照合する。
   - 根拠: 技術文書のコピーではなく、利用者向け説明として一箇所に保つため。

3. **導線**
   - 選択: Footer は `/privacy`、register は submit button 前後の説明から `/privacy`、settings は削除警告近くから `/privacy#account-deletion` へ link する。
   - 根拠: 一般閲覧、登録前、退会前という異なる利用場面を満たすため。

4. **同意 UI**
   - 選択: R3 では必須 checkbox を追加しない。
   - 根拠: release 要件は確認導線であり、法的根拠と同意撤回運用が未設計のため。必要なら R4 で別仕様にする。

5. **test の安定性**
   - 選択: DOM role、見出し、section ID、重要語、link 契約を検証し、本文全体の snapshot/完全一致は使わない。
   - 根拠: 重要情報の脱落を防ぎつつ、承認 review の表現調整で壊れにくくするため。

6. **外部 link**
   - 選択: provider の公式 privacy page へ、service 名が分かる label で link する。新規 tab にする場合だけ、その旨を accessible name/本文で通知し `rel="noopener noreferrer"` を付ける。
   - 根拠: link 先と遷移挙動を利用者が予測できるようにするため。

## タスクリスト3回レビュー

### v1: リリース要件からの初版

- 公開 `/privacy`、必須本文、Footer/register/settings 導線、test、responsive/A11Y、品質 gate、docs 同期を列挙した。

### v2: 事実・security・error 観点

- Cookie だけでなく access token と利用者情報の `sessionStorage` 保存を追加した。
- raw IP 非保存と provider の request metadata 処理を分離した。
- token 値や架空の問い合わせ先を fixture/source に入れない制約を追加した。
- 稼働 DB、監査 365 日、backup 最長 7 日、provider 境界を分離した。
- production 未確定の Cookie 属性・provider 構成を断言しないよう修正した。

### v3: 既存実装・test・DB 整合

- route を `(app)/privacy` へ修正し、共通 layout を再利用する方針にした。
- register は Footer 対象外のため個別 link が必要と確認した。
- settings の既存削除 warning と test を壊さず、fragment link を追加する方針にした。
- Prisma の User/RefreshToken/EmailVerification/PasswordResetToken/WeakElement/GameSession/GameAnswer/GameQuestionSet/UserStats/AuditLog を情報分類へ反映した。
- Vitest component test、build、browser の責務を分け、HTTP 200 を component test だけの完了条件にしないよう修正した。
- R4/R10/R12/R16 を R3 の task から除外した。

### v4: 確定タスクリスト

| タスクID | 内容                                            | ファイル・対象         | 優先度 | 完了条件                                                |
| -------- | ----------------------------------------------- | ---------------------- | ------ | ------------------------------------------------------- |
| P1       | 実装入力 gate と data/provider inventory を確定 | code/docs/owner        | 高     | placeholder なしで R3 に入れる具体値が揃う              |
| P2       | privacy page の Red test                        | `privacy-page.test.ts` | 高     | page 未実装を理由に意図どおり失敗                       |
| P3       | `/privacy` page を Green 実装                   | `privacy/+page.svelte` | 高     | content/head/section contract が成功                    |
| P4       | Footer link を Red/Green                        | Footer と新規 test     | 高     | accessible name と `/privacy` href が成功               |
| P5       | register link を Red/Green                      | register page/test     | 高     | submit 前に `/privacy` へ到達できる                     |
| P6       | settings link を Red/Green                      | settings page/test     | 高     | warning 近くから `#account-deletion` へ到達できる       |
| P7       | Refactor と対象 test                            | frontend               | 高     | 重複長文なし、対象4 test file が成功                    |
| P8       | 新規画面固有の browser/A11Y 確認                | local browser          | 高     | direct navigation、keyboard、320px、200%、theme が成功  |
| P9       | frontend 最終品質 gate                          | frontend               | 高     | 全 test、lint、format check、Svelte check、build が成功 |
| P10      | plan/progress を実態へ同期                      | docs                   | 中     | R3 のみ完了、R4/R10/R12 は未完了を維持                  |

- [ ] P1: 実装入力 gate と data/provider inventory を確定する
- [ ] P2: privacy page の Red test を追加する
- [ ] P3: `/privacy` page を Green 実装する
- [ ] P4: Footer link を Red/Green 実装する
- [ ] P5: register link を Red/Green 実装する
- [ ] P6: settings link を Red/Green 実装する
- [ ] P7: Refactor と対象 test を実行する
- [ ] P8: 新規画面固有の browser/A11Y を確認する
- [ ] P9: frontend 最終品質 gate を実行する
- [ ] P10: plan/progress を実態へ同期する

```text
タスクID	タスク内容	ファイル・対象	優先度
P1	実装入力gateとdata/provider inventoryを確定	code・docs・owner	高
P2	privacy pageのRed test	frontend/src/routes/(app)/privacy/privacy-page.test.ts	高
P3	/privacy pageをGreen実装	frontend/src/routes/(app)/privacy/+page.svelte	高
P4	Footer linkをRed/Green	frontend/src/lib/components/Footer.svelte・Footer.svelte.test.ts	高
P5	register linkをRed/Green	frontend/src/routes/register/+page.svelte・register-page.test.ts	高
P6	settings linkをRed/Green	frontend/src/routes/(app)/settings/+page.svelte・settings-page.test.ts	高
P7	Refactorと対象test	frontend	高
P8	新規画面固有のbrowser/A11Y確認	local browser	高
P9	frontend最終品質gate	frontend	高
P10	plan/progress同期	docs	中
```

## TDD 実行手順

### Red

1. `privacy-page.test.ts` を先に作り、page component が存在しないため失敗することを確認する。
2. Footer test を追加し、privacy link 不在で失敗することを確認する。
3. register/settings の既存 test へ link contract を追加し、link 不在で失敗することを確認する。
4. 各 Red は変更対象 file だけを実行し、unrelated failure を Red 証拠にしない。

```bash
cd frontend
npm run test:run -- 'src/routes/(app)/privacy/privacy-page.test.ts'
npm run test:run -- src/lib/components/Footer.svelte.test.ts
npm run test:run -- src/routes/register/register-page.test.ts
npm run test:run -- 'src/routes/(app)/settings/settings-page.test.ts'
```

### Green

1. `(app)/privacy/+page.svelte` を semantic HTML と既存 design token で実装する。
2. Footer、register、settings の順に最小変更で link を追加する。
3. 各変更後は対応 test file だけを実行する。
4. test を通すためだけの不自然な hidden text、重複文言、source 文字列検査専用実装は追加しない。

### Refactor

1. heading hierarchy、section ID、link label、日付/version 表現を統一する。
2. privacy 長文を他 page へ複製せず、register/settings は短い説明 + link にする。
3. 4 test file をまとめて実行する。
4. `npm run format` を実行し、task 外の意図しない差分がないことを確認する。

```bash
cd frontend
npm run test:run -- \
  'src/routes/(app)/privacy/privacy-page.test.ts' \
  src/lib/components/Footer.svelte.test.ts \
  src/routes/register/register-page.test.ts \
  'src/routes/(app)/settings/settings-page.test.ts'
npm run format
```

## テストケース一覧

| test/確認                | 期待結果                                                                               | 手段                   |
| ------------------------ | -------------------------------------------------------------------------------------- | ---------------------- |
| privacy component        | `h1` が 1 つ、必須 section と安定 ID がある                                            | Vitest DOM             |
| head                     | 日本語 title と description がある                                                     | Vitest DOM             |
| data content             | account、認証、学習、監査、request metadata の分類がある                               | Vitest DOM             |
| browser storage          | `sessionStorage` の access token/user と HttpOnly refresh Cookie を区別する            | Vitest DOM             |
| retention/deletion       | 監査 365 日、backup 最長 7 日、稼働 DB 物理削除と例外境界がある                        | Vitest DOM             |
| concrete values          | 運営主体、問い合わせ先、発効日/version があり、placeholder がない                      | Vitest DOM             |
| provider links           | 実利用予定 service と公式 policy link の label/href がある                             | Vitest DOM + R4 review |
| Footer                   | accessible name を持つ `/privacy` link がある                                          | Footer component test  |
| register                 | submit 前に確認できる `/privacy` link がある                                           | 既存 component test    |
| settings                 | delete warning 近くに `/privacy#account-deletion` link があり、既存 warning を保持する | 既存 component test    |
| 未認証 direct navigation | `/privacy` が redirect されず表示される                                                | local browser          |
| responsive/theme         | 320px、200% zoom、light/dark で横 scroll・見切れ・低 contrast がない                   | local browser          |
| keyboard                 | Footer/register/settings の link へ focus でき、Enter で移動できる                     | local browser          |
| production HTTP          | review 済み SHA の `/privacy` が production で成功する                                 | R16。R3 では未実施     |

## 最終品質 gate

実装・再レビュー・文書同期後に原則 1 回実行する。

```bash
cd frontend
npm run test:run
npm run lint
npm run format:check
npm run check
npm run build
```

`npm audit` は release task R11 の責務であり、R3 だけの完了条件へ重複させない。DB schema/API を変更しないため、backend test、Prisma migration、DB 専用 test は R3 では不要である。

## 手動確認

- logout 状態で `/privacy` を直接開き、認証 redirect や API call が発生しないことを確認する。
- Footer、register、settings の各 link を keyboard だけで操作する。
- `/privacy#account-deletion` が該当見出しへ到達し、見出しが Header に隠れないことを確認する。
- 320px、desktop、200% zoom、light/dark で本文、長い URL、表/リストが横にはみ出さないことを確認する。
- browser の heading list で `h1` が 1 つ、`h2` が論理順であることを確認する。
- Network panel で privacy page 自体が API を呼ばず、source/console に secret・個人 data がないことを確認する。
- provider、保持期間、問い合わせ先、発効日/version が実装入力と一致することを確認する。

## R3 完了条件

- [ ] `/privacy` が `(app)` 共通 layout 配下の認証不要 route として実装される。
- [ ] account、利用目的、browser storage/Cookie、外部 service、保持、削除、監査、backup、問い合わせ、改定を実態どおり説明する。
- [ ] 運営主体、問い合わせ先、発効日/version、provider、監査/backup 文言に placeholder がない。
- [ ] Footer、register、settings の導線が component test で固定される。
- [ ] privacy page と新規 link の responsive・keyboard・theme 基本確認が成功する。
- [ ] frontend 全 test、lint、format check、Svelte check、production build が成功する。
- [ ] 対象ファイル一覧、task checkbox、実変更、TDD結果を本計画へ同期する。
- [ ] `docs/05_progress.md` の R3 だけを完了へ更新し、R4/R10/R12/R16 を未完了のまま維持する。

## 実装完了時の記録

R3 完了時に次を追記する。

```markdown
## 実装完了

- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/privacy-policy
- PR: #N

### TDD 記録

- Red: 対象 test と意図した失敗理由
- Green: 対象 test の成功件数
- Refactor: 関連 test と format 結果
- 最終品質 gate: test/lint/format:check/check/build の結果
- browser: viewport、zoom、theme、keyboard、direct navigation の結果

### 計画からの変更点

- 変更がなければ「なし」

### 実際の変更ファイル

| ファイル | 変更種別  | 内容 |
| -------- | --------- | ---- |
| `...`    | 新規/修正 | ...  |

### 後続 task

- R4: 正式承認記録
- R10: 横断 responsive/A11Y
- R12: staging 主要導線
- R16: production smoke
```
