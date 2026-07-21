# ポートフォリオ版 v0.1 リリース計画

> 設計者ロール: シニアフルスタックエンジニア / セキュリティエンジニア / リリースマネージャー

## 概要

Gensokoを、商用サービスではなく技術力を示すポートフォリオWebアプリとして一般公開する。一般ユーザー登録を受け付けるため、認証・個人情報・アカウント削除・公開APIに関する基本的なセキュリティは初回公開時点で維持する。一方、高度な運用自動化や長期間の運用実績が必要な項目は、残余リスクと再着手条件を記録したうえで初回公開後へ分離する。

本計画はリリース範囲の正本であり、個別機能の実装詳細は既存計画を参照する。個別計画の未完了項目を本計画だけで完了扱いにしない。

## 初回リリースの目的

- 商用サービスではなく、設計・実装・テスト・セキュリティ・運用判断を示すポートフォリオ公開とする。
- 一般ユーザーが自分で登録、メール認証、ログイン、学習、退会できる状態にする。
- インターネット公開サービスとして必要な認証、入力検証、パスワード保護、CORS、Cookie、レート制限、秘密情報管理を省略しない。
- 高度な監視、完全自動CI/CD、長期baseline、バックアップ耐障害性強化は、安全性を後退させない範囲で初回公開後に段階導入する。

## ステータスの読み方

| 表記           | 意味                                                   |
| -------------- | ------------------------------------------------------ |
| 完了           | コード、必要なテスト、必要な実環境証跡が揃っている     |
| 進行中         | 一部実装・検証済みだが、公開前の残作業がある           |
| 未着手         | 実装または検証が開始されていない                       |
| 外部確認待ち   | リポジトリだけでは完了できず、承認付き実環境操作が必要 |
| 条件付き対象外 | 明記した前提を証拠で確認した場合だけv0.1から除外できる |

## 前提条件・依存関係

### 既存の実装・公開インターフェース

**`docs/04_api.md`**

- `POST /api/v1/auth/register` — 一般ユーザー登録と確認メール送信。
- `POST /api/v1/auth/verify-email` — メール認証。
- `POST /api/v1/auth/login` / `refresh` / `logout` — access tokenとHttpOnly refresh tokenのライフサイクル。
- `DELETE /api/v1/users/me` — 本人によるアカウント物理削除。
- `DELETE /api/v1/admin/users/:id` — 管理者によるアカウント物理削除。
- `POST /api/v1/game/sessions` — 認証済みゲーム結果送信。

**`docs/11_deployment.md`**

- staging frontend/API、synthetic導線、production DB backup・migration、rollout・rollbackのrunbook。

**個別計画**

- [`staging-app-deployment`](../staging-app-deployment/plan.md) — staging配備とsynthetic E2E。
- [`account-data-complete-deletion`](../account-data-complete-deletion/plan.md) — 本人・管理者の物理削除とlegacy移行。
- [`api-rate-limit-production`](../api-rate-limit-production/plan.md) — Hono/DO/WAFの責務と実環境gate。
- [`audit-log-production-operations`](../audit-log-production-operations/plan.md) — 監査保持、cleanup、通知。
- [`backup-resilience`](../backup-resilience/plan.md) — 初回公開後のbackup日次化・retry・restore drill強化。
- [`dark-mode`](../dark-mode/plan.md) — v0.1必須のダークモード。
- [`privacy-policy`](../privacy-policy/plan.md) — v0.1必須の`/privacy`。

### 重要な制約

- production deploy、production migration、production cleanup、production DBのデータ変更は本計画PRでは実行しない。
- 本番DBに実利用者がいないことを推測しない。承認付きread-only確認の証拠がない限り、既存利用者を考慮した移行gateを維持する。
- API仕様、ステータスコード、エラーメッセージは本計画で変更しないため、`docs/04_api.md`は編集しない。
- productionでrefresh tokenを利用するには、frontend/APIのsite境界と`SameSite=Strict` Cookieが両立するhostname構成を確認する。stagingの`vercel.app`→`workers.dev` cross-site構成でSPA遷移が通ることを、reload後のrefresh成功証拠の代替にしない。
- 秘密値、PII、token、Cookie、Authorization、DB URLを文書、PR、logへ記録しない。

## 対象ファイル一覧

| ファイル                                            | 変更種別 | 内容                                                              |
| --------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| `docs/plans/portfolio-release-v0-1/plan.md`         | 新規     | v0.1範囲、release blocker、deferred、rollout/rollback、最終タスク |
| `docs/plans/dark-mode/plan.md`                      | 新規     | ダークモードのTDD実装計画                                         |
| `docs/plans/privacy-policy/plan.md`                 | 新規     | `/privacy`と導線・承認の実装計画                                  |
| `docs/05_progress.md`                               | 修正     | 公開前、公開後、条件付き対象外、外部確認待ちの4区分を追加         |
| `docs/11_deployment.md`                             | 修正     | Admin E2E成功証跡とv0.1計画への参照を追加                         |
| `docs/plans/staging-app-deployment/plan.md`         | 修正     | SD16成功runとタスク状態を同期                                     |
| `docs/plans/account-data-complete-deletion/plan.md` | 修正     | T34のstaging Admin E2E成功を同期                                  |

## staging synthetic Admin E2Eの解決記録

### 原因

Admin login成功後の`page.goto('/admin')`がdocument navigationを起こし、memory上の認証stateを破棄していた。root layoutの初期化はrefreshへ進むが、staging frontendの`vercel.app`とAPIの`workers.dev`はcross-siteであり、`SameSite=Strict` refresh cookieが送信されない。refresh失敗後にauth storeがanonymousへclearされ、URLは`/admin`でも管理者ダッシュボードを表示できなかった。

Admin role反映待ち、見出し文言、10秒timeout、API停止が原因ではない。

### TDDと修正

- Red: 管理者リンク、click、URL、見出しの順序と`page.goto('/admin')`禁止を要求するsource contract 1件が意図どおり失敗した。
- Green: 実UIの「管理者」リンクをclickするSPA遷移へ変更し、contract 6件が成功した。
- Refactor: Header・Admin pageを含む関連3 files・35 testsが成功した。
- 最終品質gate: frontend 51 files・555 tests、ESLint、Prettier check、Svelte check、production build、backend workflow contract 5 tests、Playwright `--list`が成功した。
- 実装PR: [#125](https://github.com/RitukoIsibasi0222/gensoko/pull/125)（2026-07-21、`develop`へmerge済み）。

### 修正後の実環境確認

- run: [Staging Synthetic Admin E2E 29802327100](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/29802327100)
- SHA: `6bb898d52915df1139b863383e8be88e35a3d63b`
- 結果: Admin login、管理者リンクによる`/admin`到達、synthetic User強制退会、旧資格情報401拒否を含むPlaywright 1件が11.7秒で成功。
- fixture: prepare `createdUsers: 2` / `replacedUsers: 0`。E2E内で対象Userを削除し、main cleanupは残るAdmin 1件を削除。recovery cleanupは不要のためskip。
- 復旧: `STAGING_SYNTHETIC_E2E_FIXTURES_ENABLED=false`を確認済み。
- 非実施: production URL・DB・deploy、migration、実メール、追加の直接DB query。

## 初回リリース前の必須項目

| 項目                                        | 現在の状態   | 残作業                                                                   | 完了条件                                                                                                  | 確認方法                                     | 関連計画                                          |
| ------------------------------------------- | ------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| staging synthetic Admin E2E                 | 完了         | なし                                                                     | 修正後developでAdmin到達・強制退会・旧credential拒否・cleanup成功                                         | run 29802327100                              | `staging-app-deployment`                          |
| 一般ユーザー登録                            | 進行中       | production deploy後の登録smoke                                           | 登録201、重複・不正入力・rate limitが安全に処理される                                                     | unit/integration、staging、本番smoke         | `staging-app-deployment`                          |
| メール認証                                  | 進行中       | production送信元・許可設定とsmoke                                        | 確認メール受信、token認証、再利用拒否                                                                     | staging synthetic、本番smoke                 | `staging-app-deployment`                          |
| login・refresh・logout                      | 進行中       | production hostname/Cookie構成、reload・期限更新smoke                    | login、token rotation、logout後拒否、reload後refresh成功                                                  | auth tests、browser smoke                    | `staging-app-deployment`                          |
| 本人退会の物理削除                          | 進行中       | 残るstaging/production gate、production deploy後smoke                    | Userと所有rowを物理削除し、旧auth拒否・再登録契約を満たす                                                 | 専用DB、staging、本番smoke                   | `account-data-complete-deletion`                  |
| ダークモード                                | 未着手       | TDD実装と主要画面のcontrast/A11Y確認                                     | OS設定追従、明示toggle、保存、主要画面で読める                                                            | component test、browser、keyboard            | `dark-mode`                                       |
| `/privacy`                                  | 未着手       | 文言決定、公開route、footer/register/settings導線                        | 未確定事項を残さず公開し、削除・監査・backup境界を正確に説明                                              | content contract、browser、owner確認         | `privacy-policy`                                  |
| 基本レスポンシブ                            | 進行中       | 主要画面を320px以上で再確認                                              | 横スクロール・操作不能・見切れがない                                                                      | Playwright/manual viewport                   | 本計画                                            |
| 基本キーボード/A11Y                         | 進行中       | register/login/game/settings/admin/privacy/themeを確認                   | focus可視、操作完結、alert/status、見出し順が成立                                                         | component test、keyboard smoke               | 各UI計画                                          |
| 認証・ゲーム送信APIのアプリレベルrate limit | 進行中       | staging実HTTP 429/503、production DO binding/secret                      | productionでmemory fallbackせず、policyどおり制限                                                         | Workers test、staging/prod実HTTP             | `api-rate-limit-production`                       |
| セキュリティヘッダー                        | 進行中       | production responseの最終確認                                            | API正常/エラー/404/preflightに定義済みheader、production HSTS                                             | test、`curl -I`相当のsmoke                   | [`security-headers`](../security-headers/plan.md) |
| CORS限定origin                              | 進行中       | production `FRONTEND_URL`設定と実HTTP確認                                | wildcardなし、固定frontend originだけ許可                                                                 | config test、preflight smoke                 | `staging-app-deployment`                          |
| HttpOnly refresh token Cookie               | 進行中       | productionのSecure/SameSite/site境界確認                                 | HttpOnly・Secure・SameSite・Path、rotation、logout削除が成立                                              | auth tests、browser devtoolsを値非表示で確認 | `docs/04_api.md`                                  |
| bcryptパスワード保護                        | 完了         | release回帰のみ                                                          | bcryptjs cost 12、72 byte境界、新規平文保存なし                                                           | unit/source review                           | `bcrypt-password-byte-limit`                      |
| Zod入力検証                                 | 完了         | release回帰のみ                                                          | route入口で未検証値をDB/外部へ渡さない                                                                    | route tests、source review                   | `docs/04_api.md`                                  |
| 安全なエラーレスポンス                      | 完了         | production proxy errorのUI確認                                           | stack、DB error、内部pathを返さず日本語一般化message                                                      | negative tests、smoke                        | `docs/04_api.md`                                  |
| 秘密情報・PII非出力                         | 進行中       | production/staging logの最終negative review                              | password、email、token、Cookie、Authorization、DB URL、raw error非出力                                    | tests、Actions/Workers log review            | `audit-log-production-operations`                 |
| 最低限の暗号化backup                        | 外部確認待ち | 初回production backup Artifactと復号検証                                 | AES-256暗号化Artifactとchecksumのみ、復号検証成功、平文非保存                                             | production workflow、Artifact metadata       | `docs/11_deployment.md`                           |
| staging主要導線                             | 進行中       | dark/privacy/responsive実装後の最終回帰                                  | 登録、認証、refresh、game、本人/管理者退会、privacy/themeが成功                                           | Playwright/manual                            | `staging-app-deployment`                          |
| production smoke                            | 未着手       | deploy後に実施                                                           | health、登録、認証、refresh、game、退会、privacy/theme、header/CORSを確認                                 | production smoke checklist                   | `docs/11_deployment.md`                           |
| npm audit・品質gate                         | 進行中       | backend runtimeのHigh/Moderate依存を更新し全回帰。release候補SHAで再監査 | backend production依存のHigh/Moderate 0件、test/build/lint/format成功。frontend Lowは影響と更新条件を記録 | CIとローカル品質gate                         | 本計画                                            |

## 初回リリース後へ回す項目

| 項目                            | v0.1での扱い   | 判断理由                                                            | 残るリスク                            | 着手条件・時期                          |
| ------------------------------- | -------------- | ------------------------------------------------------------------- | ------------------------------------- | --------------------------------------- |
| 共通APIクライアントへの全面移行 | 初回リリース後 | 現行個別clientは動作し、安全なerror handlingを回帰test済み          | 重複修正・挙動差の保守コスト          | v0.1安定後、API変更または重複障害発生時 |
| Hono RPC導入                    | 初回リリース後 | 型共有の改善であり、現行API公開の安全性に必須ではない               | frontend/backend型の手動同期          | 共通client設計確定後                    |
| ゲームAPIテストの追加補強       | 初回リリース後 | 主要導線と既存テストはある。未実装testを完了扱いにはしない          | rare error/cascade回帰の検出力        | v0.1公開後の最初の品質改善              |
| 高度なWAFチューニング           | 初回リリース後 | v0.1はHono/DOのアプリ制限を必須とし、WAF最適化はtraffic実績後が妥当 | origin到達前の大量traffic防御が限定的 | 公開hostname確定・traffic/abuse観測後   |
| 監査ログ7日baseline             | 初回リリース後 | 7日間の実績は公開前には収集できない                                 | 容量閾値の精度が低い                  | 公開直後から収集し7日後にreview         |
| 高度な容量監視と通知            | 初回リリース後 | 初回はprovider容量確認とfailed workflow通知を必須に限定             | 予兆検知が粗い                        | 利用増加または70%到達前                 |
| backup最大3回retry              | 初回リリース後 | 初回成功・復号可能な暗号化backupをv0.1必須とする                    | 単発障害時に手動再実行が必要          | 初回backup成功後の次の運用改善          |
| 7世代backup運用                 | 初回リリース後 | 7日分の運用期間が必要                                               | 初期は利用可能世代が少ない            | 日次化実装後、連続成功を確認            |
| 四半期ごとの隔離restore訓練     | 初回リリース後 | 初回公開前は初回backupの復号確認までを必須とする                    | DBとしての完全復元可能性は未実証      | 初回backup後、最初の四半期内            |
| 完全自動CI/CD                   | 初回リリース後 | 承認付き手動rolloutの方が初回公開の不可逆操作を制御しやすい         | 手順漏れ・人的負荷                    | 手動releaseを1回成功後                  |
| 管理画面Playwright網羅          | 初回リリース後 | v0.1は強制退会の主要1導線を必須とする                               | filter/role/statusのE2E網羅不足       | Admin仕様変更または回帰発生時           |
| 高度なスクリーンリーダー検証    | 初回リリース後 | 基本keyboard、semantic、live regionはv0.1で確認する                 | 複数AT/browser組合せの未検証          | v0.1後、対象AT matrix決定時             |
| 本番公開後の追加運用自動化      | 初回リリース後 | 実trafficと障害実績を見て優先順位を決める                           | 手動運用の見落とし                    | 初回運用reviewまたは同一手順2回目       |

## 本番DBが未公開・実利用者なしの場合の簡略化

現時点では、本番DBの実利用者0件を示す承認付き証拠を確認していない。したがって次の簡略化はまだ適用せず、既存計画のgateを維持する。productionへの直接queryやcleanupは本計画PRで実行しない。

### 必要な確認証拠

- production Environmentとproject refを検証する承認付きread-only workflowであること。
- active / suspended / legacyを含むUser件数と関連rowの有無を、PII・User ID・接続情報を出さず集計すること。
- run URL、review済みSHA、実行日時、承認記録、集計結果だけを記録すること。
- 0件以外、接続先不一致、結果不明の場合は簡略化しないこと。

| 項目                                         | v0.1での扱い                     | 前提条件                                         | 確認証拠                 | 将来必要になる条件                               |
| -------------------------------------------- | -------------------------------- | ------------------------------------------------ | ------------------------ | ------------------------------------------------ |
| legacy soft-deleted userのproduction cleanup | 条件付き対象外候補。現在は未適用 | 全User/legacy 0件                                | 承認付きread-only run    | legacy rowが存在する、または既存DBを引き継ぐ場合 |
| 既存実利用者向け段階的data migration         | 条件付き対象外候補。現在は未適用 | 実利用者・所有data 0件                           | 同上                     | 実利用者が1人でも存在する場合                    |
| 旧backend assetの長期soak                    | 条件付き対象外候補。現在は未適用 | productionへ旧物理削除版が一度も配備されていない | deployment履歴           | 旧asset配備済み、またはrollback互換が必要な場合  |
| 旧backup Artifactの失効待ち                  | 条件付き対象外候補。現在は未適用 | 個人dataを含む旧production backupが存在しない    | Artifact metadata        | 旧backupが1つでも存在する場合                    |
| 既存ユーザー向けexpand/contract移行          | 条件付き対象外候補。現在は未適用 | 対象row 0件かつ旧schema/code未配備               | migration/deployment履歴 | 既存row・旧code・旧schemaを引き継ぐ場合          |

省略条件を満たした場合も「完了」にはせず、release recordで「v0.1対象外」、証拠、再着手条件を記録する。

## セキュリティ最低基準

v0.1で次を維持する。ポートフォリオ用途を理由に無効化しない。

1. bcryptjs cost 12でパスワードをハッシュ化し、平文を保存・比較しない。
2. 新規保存するパスワードは正規化後UTF-8 72バイト以内とし、73バイト以上をbcryptへ渡さない。
3. `JWT_SECRET`、`DATABASE_URL`、rate limit HMAC key、mail credential、backup passphraseはEnvironment Secretで管理し、コード・frontend・logへ出さない。
4. refresh tokenはHttpOnly・production Secure・SameSite・限定Path Cookieで管理し、DBではhashだけを保持する。`localStorage`へ保存しない。
5. 認証、本人確認、Admin role、last-admin、操作直前のactor/target再確認を維持する。
6. route入口でZod検証し、未検証値をDB、mail、workflowへ渡さない。
7. CORSは単一の承認済みfrontend originに限定し、`*`を使わない。
8. 認証系、account操作、game questions/submitにHono + Durable Objectのアプリケーションレベルrate limitを適用する。productionでmemory fallbackしない。
9. API正常・エラー・404・preflightにセキュリティヘッダーを付与し、productionでHSTSを有効化する。
10. DBアクセスはPrisma ORM経由とし、無制限のraw queryを追加しない。
11. エラーは日本語の安全な一般化messageとし、stack、DB error、内部path、raw外部responseを返さない。
12. password、email、username、PII、token、Cookie、Authorization、DB URL、内部ID、raw errorをapplication/workflow logへ出さない。
13. 本人退会でUserと所有認証・学習dataを物理削除し、監査内部IDの例外保持・期限・目的を`/privacy`と承認記録に一致させる。
14. `/privacy`で収集項目、利用目的、外部service、Cookie、監査、削除、backup、問い合わせ先を正確に説明する。
15. production変更前に復号確認済みの暗号化backupを取得し、平文dumpをArtifactへ保存しない。
16. backend/frontendの依存関係監査をrelease候補SHAで実行し、未修正項目は影響、回避策、期限を記録する。
17. rollout前に旧version、DB互換、feature/execute flagの初期値を確認し、障害時は新規変更を停止してアプリを先にrollbackする。

## 依存関係監査の現在値（2026-07-21）

この計画作成時にlockfileを変更せず監査した。自動`npm audit fix`はdocsブランチで実行していない。

| 対象                    | command                                       | 結果                             | v0.1での扱い                                    |
| ----------------------- | --------------------------------------------- | -------------------------------- | ----------------------------------------------- |
| backend全依存           | `npm audit --audit-level=moderate`            | 7件: High 3 / Moderate 3 / Low 1 | release blocker                                 |
| backend production依存  | `npm audit --omit=dev --audit-level=moderate` | 5件: High 2 / Moderate 3         | release blocker                                 |
| frontend全依存          | `npm audit --audit-level=moderate`            | Low 3。moderate以上0件           | 影響・上流更新条件を記録し、release候補で再確認 |
| frontend production依存 | `npm audit --omit=dev --audit-level=moderate` | 0件                              | 現時点で合格                                    |

backendでは少なくともHono、Nodemailer、Prisma toolchain経由の`@hono/node-server`が報告対象になっている。advisoryの一部が現在のadapter・機能で到達不能でも、HonoのJWT・Cookie・CORS関連を含むため、ポートフォリオ用途を理由に一括受容しない。別の`feature/*`ブランチで次を実施する。

1. auditが提示する固定versionと直接/推移依存を確認し、packageを意図的に更新する。
2. auth Cookie、JWT、CORS、mail、Workers bundle、Node local runtimeの対象testをRed/Green/Refactorで確認する。
3. backend通常全test、Workers test、build、lint、format check、Prisma validate、両auditを再実行する。
4. frontend Low 3件は`--force`によるSvelteKit breaking downgradeを行わず、安全な上流versionが利用可能になった時点で更新する。release時点の実影響と再確認日を記録する。

## 設計上の決定事項

1. **一般ユーザー登録をv0.1へ含めるか**
   - 選択: 含める。
   - 根拠: ポートフォリオの主要体験であり、認証・メール・削除を含む技術力を示すため。

2. **ダークモードと`/privacy`を後回しにするか**
   - 選択: 後回しにせずrelease blockerとする。
   - 根拠: 明示されたv0.1要件であり、`/privacy`は一般登録と完全削除の前提でもあるため。

3. **WAFとアプリレベルrate limitを同じ完了境界にするか**
   - 選択: v0.1ではアプリレベルのHono/DOを必須とし、高度なWAF tuningは公開後へ分離する。
   - 根拠: 公開APIの濫用防止を維持しつつ、traffic実績のない段階の過剰tuningを避けるため。

4. **backup耐障害性計画をすべてv0.1へ含めるか**
   - 選択: 初回暗号化backup・復号検証を必須とし、retry・7世代・四半期drillは公開後へ分離する。
   - 根拠: 最低限の復旧手段は必要だが、複数世代や四半期実績は初回公開前に時間上成立しないため。

5. **本番DB空を前提にmigrationを省略するか**
   - 選択: 証拠が揃うまで省略しない。
   - 根拠: 未確認の仮定で既存ユーザーdataを危険にさらさないため。

## rollout手順

1. release blockerのコード、計画、品質gateをrelease候補SHAへ固定する。
2. production DB実利用者0件の簡略化を使う場合は、承認付きread-only workflowの証拠を先に記録する。確認できなければ完全削除計画の通常gateを維持する。
3. production Environment、frontend/API hostname、CORS、Cookie site境界、DO binding、Secrets名、execute flag `false`を値非表示で確認する。
4. 初回暗号化backupを取得し、Artifactが暗号化archiveとchecksumだけであること、復号検証成功を確認する。
5. 必要なmigrationをbackup gate付きで適用する。破壊的contract migrationは個別計画の全gate完了前に適用しない。
6. APIをdeployし、health、security headers、CORS、rate limit、mail、DB targetを確認する。
7. frontendをdeployし、`/privacy`、theme、登録、認証、refresh、game、settingsを確認する。
8. synthetic accountだけで本人退会と、必要ならAdmin導線を確認する。
9. production smoke結果、run/deployment URL、SHA、時刻、非秘密の設定確認、残余リスクをrelease recordへ記録する。

## rollback手順

1. 新規登録・削除・migration等の変更操作を停止し、execute flagを安全側の`false`へ戻す。
2. frontend/APIを直前のreview済みdeploymentへ戻す。productionでrate limitをmemoryへfallbackさせない。
3. DB migrationは即時rollbackを前提にせず、後方互換なexpand/contractを維持する。無承認でproduction DBを復元しない。
4. refresh/CORS/hostname障害はCookie属性を弱めず、同site構成または正しいorigin設定へ戻す。
5. 物理削除済みdataは通常rollbackで復元しない。backup restoreが必要な場合はisolated projectと削除replay方針の承認後だけ行う。
6. 障害のscope、時刻、deployment SHA、rollback先、影響、follow-upを秘密情報なしで記録する。

## タスクリスト3回レビュー

### v1 初版

- staging Admin E2E、認証、完全削除、dark、privacy、responsive/A11Y、rate limit、headers/CORS/Cookie、log、backup、quality、staging、production smokeを列挙した。
- 共通API client、Hono RPC、game test補強、WAF tuning、監査baseline、backup強化、CI/CDを候補として列挙した。

### v2 セキュリティ・型・エラー観点

- refresh Cookieのcross-site問題を、Admin E2E修正済みだけで解決扱いにしない項目を追加した。
- productionでmemory rate limit fallbackを禁止し、sensitive APIのstore障害503を維持した。
- PII/secret negative log review、safe error、production origin、暗号化backupをrelease blockerとして維持した。
- 本番DB空を仮定せず、簡略化に承認付きread-only証拠を要求した。

### v3 既存実装・テスト・DB整合観点

- PR #125とrun 29802327100を確認し、Admin E2Eを重複実装せず完了へ更新した。
- stagingで登録・メール・login・本人導線は確認済みだが、production smokeの代替にはしない境界を明記した。
- 完全削除のコード完了と、T33/T35/production/restore等の未完了を分離した。
- 共通API client、game test補強、backup耐障害性計画の未完了checkboxを保持した。

### v4 確定

- v0.1必須の安全性と主要体験だけをrelease blockerへ残した。
- 高度な運用は削除せず「初回リリース後」へ移し、残余リスクと再着手条件を付けた。
- 実環境作業とローカル実装を分離し、production操作は別承認のままとした。

## 最終タスクリスト

| タスクID | 内容                                      | ファイル・環境       | 優先度 | 完了条件                                            |
| -------- | ----------------------------------------- | -------------------- | ------ | --------------------------------------------------- |
| R1       | Admin E2E修正後runを記録                  | staging/docs         | 高     | run 29802327100成功、cleanup、flag false            |
| R2       | ダークモードをTDD実装                     | frontend             | 高     | OS追従、toggle、保存、主要画面確認                  |
| R3       | `/privacy`をTDD実装                       | frontend/docs        | 高     | 公開route、必須文言、footer/register/settings導線   |
| R4       | privacy・監査・backup・問い合わせ先を承認 | docs/運用            | 高     | 正式値、承認者、日付を記録                          |
| R5       | 認証・refreshのproduction構成を確定       | frontend/API/環境    | 高     | same-site/Strict Cookieでreload後refresh成功        |
| R6       | 完全削除の残るv0.1 gateを完了             | account deletion計画 | 高     | 本人削除、旧auth拒否、必要な移行判断                |
| R7       | app rate limitの実環境gateを完了          | Cloudflare/API       | 高     | staging/prod DO、429/503、memory fallbackなし       |
| R8       | headers・CORS・safe error・logを最終確認  | API/環境             | 高     | production smokeとnegative log review成功           |
| R9       | 最低限の暗号化backupを確認                | production Actions   | 高     | 初回Artifact、checksum、復号、平文なし              |
| R10      | 基本responsive・keyboard/A11Yを確認       | frontend             | 高     | 主要画面の基準を満たす                              |
| R11A     | backend High/Moderate依存を安全に更新     | backend/package      | 高     | TDD回帰後、production依存High/Moderate 0件          |
| R11      | release候補SHAの品質gateとnpm audit       | backend/frontend     | 高     | test/build/lint/format/audit結果を記録              |
| R12      | staging主要導線を最終確認                 | staging              | 高     | 登録〜削除、game、privacy、theme成功                |
| R13      | 本番DB簡略化の適用可否を判断              | production read-only | 高     | 証拠ありで対象外記録、なければ通常gate維持          |
| R14      | rollout/rollback preflight                | deployment docs      | 高     | URL、SHA、Secrets名、flags、rollback先確認          |
| R15      | production deployを別承認で実施           | production           | 高     | review済みSHAを配備しrun URL記録                    |
| R16      | production smokeを実施                    | production           | 高     | auth/refresh/game/delete/privacy/theme/security成功 |
| R17      | release recordと進捗を同期                | docs                 | 中     | 未実施を完了扱いせず残余リスク記録                  |
| R18      | 公開後タスクをissue/計画へ引き継ぐ        | docs/issues          | 中     | ownerと再着手条件を記録                             |

- [x] R1: Admin E2E修正後runを記録する
- [-] R2: ダークモードをTDD実装する
- [ ] R3: `/privacy`をTDD実装する
- [ ] R4: privacy・監査・backup・問い合わせ先を承認する
- [ ] R5: 認証・refreshのproduction構成を確定する
- [ ] R6: 完全削除の残るv0.1 gateを完了する
- [ ] R7: app rate limitの実環境gateを完了する
- [ ] R8: headers・CORS・safe error・logを最終確認する
- [ ] R9: 最低限の暗号化backupを確認する
- [ ] R10: 基本responsive・keyboard/A11Yを確認する
- [ ] R11A: backend High/Moderate依存を安全に更新する
- [ ] R11: release候補SHAの品質gateとnpm auditを実行する
- [ ] R12: staging主要導線を最終確認する
- [ ] R13: 本番DB簡略化の適用可否を証拠で判断する
- [ ] R14: rollout/rollback preflightを完了する
- [ ] R15: production deployを別承認で実施する
- [ ] R16: production smokeを実施する
- [ ] R17: release recordと進捗を同期する
- [ ] R18: 公開後タスクを引き継ぐ

## 最終タスクリスト（タブ区切り）

```text
タスクID	タスク内容	ファイル・環境	優先度
R1	Admin E2E修正後runを記録	staging・docs	高
R2	ダークモードをTDD実装	frontend	高
R3	/privacyをTDD実装	frontend・docs	高
R4	privacy・監査・backup・問い合わせ先を承認	docs・運用	高
R5	認証・refreshのproduction構成を確定	frontend・API・環境	高
R6	完全削除の残るv0.1 gateを完了	account deletion計画	高
R7	app rate limitの実環境gateを完了	Cloudflare・API	高
R8	headers・CORS・safe error・logを最終確認	API・環境	高
R9	最低限の暗号化backupを確認	production Actions	高
R10	基本responsive・keyboard・A11Yを確認	frontend	高
R11A	backend High・Moderate依存を安全に更新	backend・package	高
R11	release候補SHAの品質gateとnpm audit	backend・frontend	高
R12	staging主要導線を最終確認	staging	高
R13	本番DB簡略化の適用可否を判断	production read-only	高
R14	rollout・rollback preflight	deployment docs	高
R15	production deployを別承認で実施	production	高
R16	production smokeを実施	production	高
R17	release recordと進捗を同期	docs	中
R18	公開後タスクをissue・計画へ引き継ぐ	docs・issues	中
```

## 品質確認

### 本計画PR

- MarkdownをPrettierで整形する。
- `git diff --check`を実行する。
- plan、progress、deployment、account deletion、staging deployment間のlink・statusを照合する。
- API仕様を変更していないことを確認し、`docs/04_api.md`を不要に編集しない。

### v0.1 release候補

- backend: 通常全test、Workers test、build、lint、format check、Prisma validate。
- frontend: 全test、lint、format check、Svelte check、production build。
- backend/frontend: `npm audit`。未解決項目はruntime影響、回避策、期限を記録する。
- staging: 登録、メール認証、login、refresh、logout、game、本人/管理者退会、theme、privacy、responsive/A11Y。
- production: deploy後smoke。production DB cleanupや不可逆操作は個別承認runbookに従う。

## 完了条件

- R1〜R17とR11Aが完了し、未実施項目が完了扱いになっていない。
- release blocker表の各項目に成功証拠または明示的な停止判断がある。
- 条件付き対象外を使う場合、前提・証拠・再着手条件が記録されている。
- 公開後タスクにownerと再着手条件がある。
- production deploy、migration、cleanup、データ変更は別承認のrunbookでのみ実施されている。
