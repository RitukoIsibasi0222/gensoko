# Gensoko 実装タスク一覧

> 更新日: 2026-08-06
> ステータス: `[ ]` 未実装 / `[-]` 実装中 / `[x]` 完了

---

## 設計決定（実装前に確定した事項）

| #         | 内容                                                           | 決定                                                                                                                                                                                                             |
| --------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 設計決定1 | 習得バッジ用「どの元素が習得済みか」の追跡方法                 | **GameAnswer集計方式**（新テーブルなし）。`GET /elements` は認証時に `masteryStatus: "unlearned" \| "learning" \| "mastered"` を付与。`POST /game/sessions` 時の `UserStats.masteredCount` 更新はフェーズ7で実装 |
| 設計決定2 | `GET /game/questions` → `POST /game/sessions` 間の正解一時保持 | **GameQuestionSetテーブル方式**。`GET /game/questions` でDBに正解情報と有効期限（30分）を保存し `questionSetId` を返す。`POST /game/sessions` で受け取り正誤判定後削除                                           |
| 設計決定3 | 本番DBマイグレーション運用                                     | GitHub Actions で本番デプロイ前に `prisma migrate deploy` を実行する。実行前に24時間以内の暗号化backup workflow成功と期限内Artifactを確認し、破壊的変更はexpand/contract方式で複数リリースに分ける               |
| 設計決定4 | 本番レート制限の責務分担                                       | Cloudflare 側のエッジ制限と Hono ミドルウェアを併用する。認証系・一般APIに加え、`POST /game/sessions` はユーザーID/IP単位でより厳しく制限する                                                                    |
| 設計決定5 | スキーマ確定時のインデックス設計                               | `docs/03_data_model.md` のインデックス案を Prisma schema / migration に反映する。`GameQuestionSet` 期限切れ cleanup、ランキング、履歴、苦手リスト、token 期限検索を主要対象にする                                |

---

## フェーズ1: セットアップ ✅

- [x] GitHubリポジトリ作成・.gitignore・初回push
- [x] Docker Compose起動（hono/sveltekit/postgres/mailpit）※sveltekitはport 5174
- [x] backend .env 作成（DATABASE_URL / JWT_SECRET / MAIL等）
- [x] backend package.json・tsconfig.json 作成
- [x] Prismaスキーマ定義・マイグレーション実行（主要インデックスは設計決定5に従い本番前に schema/migration へ反映）
- [x] 元素シードデータ作成・投入（prisma/seed.ts・118元素）
- [x] 元素モデルに由来フィールド追加（etymology）+ シードデータ更新
- [x] src/index.ts 作成・Honoサーバー起動確認
- [x] GameQuestionSet スキーマ追加・マイグレーション（設計決定2 対応）
- [x] backend src/ ファイル構造作成（routes/ services/ middleware/ lib/ types/）
- [x] lib/prisma.ts（シングルトン）+ lib/mail.ts 実装
- [x] .env.example 作成（backend・frontend両方）
- [x] SvelteKitプロジェクト作成（TypeScript + Tailwind CSS）
- [x] ESLint / Prettier 設定（backend・frontend両方）

## フェーズ2: バックエンド認証 ✅

- [x] JWT認証ミドルウェア（middleware/auth.ts）
- [x] Adminロールチェックミドルウェア（middleware/admin.ts）
- [x] POST /auth/register（Zod検証・bcrypt・メール認証tokenHash保存）
- [x] POST /auth/verify-email（tokenHash検証・有効期限・使用済削除）
- [x] POST /auth/login（JWT発行・ブルートフォースロック・UserStats streak更新）
- [x] POST /auth/refresh（HttpOnly Cookieリフレッシュトークン）
- [x] POST /auth/logout（DBからRefreshToken削除）
- [x] POST /auth/forgot-password + /auth/reset-password（1時間有効・全token無効化）

---

> ⬇️ ここからフェーズを UI ファースト方式に再編。
> 方針: 主要画面モック作成 → API 疎通確認 → 仕様微調整 → API 本実装 の順で進める。

---

## フェーズ3: UI モック（アカウント管理）

> 目的: 既存の認証 API と接続して UI の使い勝手を確認し、仕様の微調整に活かす。

### フロントエンド共通基盤

- [x] SvelteKit ルーティング・共通レイアウト（ヘッダー/フッター/ナビ）
- [x] 認証 Store（Svelte ストア・Bearer トークン管理・リフレッシュ自動実行）
- [-] API クライアント基盤（`lib/api/client.ts`・共通エラーハンドリング・Hono RPC 導入可否検討） — 計画書: [`docs/plans/frontend-api-client/plan.md`](plans/frontend-api-client/plan.md)
- [x] トースト通知コンポーネント（成功/エラー表示）

### アカウント系画面

- [x] ログイン画面 `/login`（フォーム・エラー表示・「パスワードを忘れた」リンク）
- [x] ユーザー登録画面 `/register`（入力・確認メール送信完了メッセージ）
- [x] メール認証完了ページ `/verify-email`（トークン自動送信・成功/失敗メッセージ）
- [x] パスワードリセット申請画面 `/forgot-password`
- [x] パスワードリセット画面 `/reset-password`（トークン付きURL経由） — 計画書: [`docs/plans/reset-password-page/plan.md`](plans/reset-password-page/plan.md)
- [x] プロフィール設定画面 `/settings`（ユーザー名変更・パスワード変更・アカウント削除）

### 既存 API との疎通確認

- [x] ログイン → JWT 取得 → リフレッシュ の流れを実動作確認
- [x] 登録 → メール認証 → ログイン の流れを実動作確認（Mailpit で確認）

### 仕様微調整タスク（UI を触って気づいた点を記録）

- [ ] 認証 API インターフェースの微調整（あれば）

## フェーズ4: UI モック（トップ・元素一覧）

> 目的: 元素一覧の UI 設計を固め、`GET /elements` の API インターフェースを決定する。

### 画面

- [x] トップページ `/`（アプリ概要・ゲーム開始CTA・ランキングプレビュー）
- [x] トップページ ランキングプレビュー実データ対応（週間ランキング上位3件・loading/error/empty表示） — Issue #72 / 計画書: [`docs/plans/home-ranking-preview/plan.md`](plans/home-ranking-preview/plan.md)
- [x] 元素一覧ページ `/elements`（118枚カードグリッド・分類色分け）
- [x] 元素詳細モーダルコンポーネント（カードクリックで開く） — 計画書: [`docs/plans/elements-detail-modal/plan.md`](plans/elements-detail-modal/plan.md)
- [x] 検索・フィルターUI（キーワード・分類・周期）
- [x] 習得状態バッジ表示（ログイン時のみ・未学習/学習中/習得） — 計画書: [`docs/plans/elements-mastery-badges/plan.md`](plans/elements-mastery-badges/plan.md)

### API インターフェース確定

- [x] `GET /elements` のクエリパラメーター・レスポンス形式を決定・ドキュメント更新

## フェーズ5: GET /elements API 本実装

> フェーズ4 の疎通確認で確定したインターフェースを実装する。

- [x] GET /elements（keyword・category・period 検索） — 計画書: [`docs/plans/elements-query-search/plan.md`](plans/elements-query-search/plan.md)
- [x] GET /elements/:id — 計画書: [`docs/plans/elements-detail-api/plan.md`](plans/elements-detail-api/plan.md)
- [x] `GET /elements` のテスト

## フェーズ6: UI モック（ゲーム）

> 目的: ゲームの UX をモックで確認し、ゲーム系 API のインターフェースを決定する。

### 画面

- [x] ゲームモード選択画面 `/game`（モード一覧・苦手5問未満ガード表示） — 計画書: [`docs/plans/game-screens/plan.md`](plans/game-screens/plan.md)
- [x] ゲームプレイ画面 `/game/play`（インジケーター・15秒タイマー・4択・正誤フィードバック・1〜4キー操作・A11Y 読み上げ順考慮） — 計画書: [`docs/plans/game-screens/plan.md`](plans/game-screens/plan.md)
- [x] ゲーム結果画面 `/game/result`（スコア・連続正解・間違え一覧・「もう一度」「ホームへ」。`POST /game/sessions` の仕様確定・実装後に着手） — 計画書: [`docs/plans/game-screens/plan.md`](plans/game-screens/plan.md)

### API インターフェース確定

- [x] `GET /game/questions` のレスポンス形式（問題・選択肢・questionSetId）を決定 — 計画書: [`docs/plans/game-screens/plan.md`](plans/game-screens/plan.md)
- [x] `POST /game/sessions` のリクエスト/レスポンス形式を決定（`/game/result` の表示元レスポンスを含む） — 計画書: [`docs/plans/game-screens/plan.md`](plans/game-screens/plan.md)

## フェーズ7: ゲーム API 本実装

> フェーズ6 の確認で確定したインターフェースを実装する。

- [x] GET /game/questions（ランダム10問・4択生成・GameQuestionSet保存・苦手5問未満チェック【設計決定2】） — 計画書: [docs/plans/game-questions/plan.md](plans/game-questions/plan.md)
- [x] POST /game/sessions（questionSetId受信・正誤判定・スコア計算・苦手自動更新・consecutiveHit・masteredCount更新【設計決定1・2】）
- [x] `/game` 苦手件数実データ反映（固定4件表示の解消・`GET /weak` 先行実装） — 計画書: [`docs/plans/game-weak-count-sync/plan.md`](plans/game-weak-count-sync/plan.md)
- [x] 期限切れ GameQuestionSet クリーンアップ処理（手動実行 + Cron Trigger 想定） — 計画書: [`docs/plans/game-question-set-cleanup/plan.md`](plans/game-question-set-cleanup/plan.md)
- [x] GET /game/sessions（ゲーム履歴一覧） — 計画書: [docs/plans/game-session-history/plan.md](plans/game-session-history/plan.md)
- [x] GET /game/sessions/:sessionId（ゲーム結果詳細取得・/game/result 再読み込み復元） — 計画書: [`docs/plans/game-result-session-restore/plan.md`](plans/game-result-session-restore/plan.md)
- [-] ゲーム API のテスト — 計画書: [`docs/plans/game-api-tests/plan.md`](plans/game-api-tests/plan.md)（GET /game/questions テスト補強完了）

## フェーズ8: UI モック（苦手・マイページ・ランキング）

> 目的: 残りページの UI を確認し、各 API のインターフェースを決定する。

### 画面

- [x] 共通ナビ導線・モバイルメニュー整備（/weak 仮ページ、ログイン後 /weak・/mypage 導線、スマホハンバーガーメニュー） — 計画書: docs/plans/header-navigation/plan.md
- [x] 苦手リスト画面 `/weak`（ソート・手動削除ボタン） — 計画書: [`docs/plans/weak-list-page/plan.md`](plans/weak-list-page/plan.md)
- [x] マイページ・統計画面 `/mypage`（正答率グラフ・サマリーカード） — 計画書: [docs/plans/mypage-stats/plan.md](plans/mypage-stats/plan.md)
- [x] ランキングページ `/ranking`（週間・全期間・自分の順位） — 計画書: [`docs/plans/ranking-page/plan.md`](plans/ranking-page/plan.md)

### API インターフェース確定

- [x] 苦手 / ユーザー / ランキング / 統計 各 API のインターフェースを確定 — 計画書: [docs/plans/api-interface-contracts/plan.md](plans/api-interface-contracts/plan.md)

## フェーズ9: 残 API 本実装

> フェーズ8 の確認で確定したインターフェースを実装する。

- [x] GET /weak + DELETE /weak/:elementId
- [x] GET /users/me + PATCH /users/me + DELETE /users/me — 計画書: [docs/plans/api-interface-contracts/plan.md](plans/api-interface-contracts/plan.md)
- [x] GET /users/me/stats — 計画書: [docs/plans/mypage-stats/plan.md](plans/mypage-stats/plan.md)
- [x] GET /ranking/weekly + /alltime（myRank フィールド・Top50） — 計画書: [`docs/plans/ranking-page/plan.md`](plans/ranking-page/plan.md)
- [x] 週間スコアリセットバッチ処理（weeklyScore リセット） — 計画書: [docs/plans/weekly-score-reset/plan.md](plans/weekly-score-reset/plan.md)
- [x] 定期バッチ運用設計（週間リセット・GameQuestionSet cleanup の Cron Trigger 設定） — 計画書: [docs/plans/batch-cron-triggers/plan.md](plans/batch-cron-triggers/plan.md)
- [x] 残 API のテスト — 計画書: [docs/plans/remaining-api-tests/plan.md](plans/remaining-api-tests/plan.md)

## フェーズ10: 管理者機能

- [x] Admin APIs（ユーザー一覧/詳細/停止/ロール変更/強制退会/統計） — 計画書: [docs/plans/admin-apis/plan.md](plans/admin-apis/plan.md)
- [x] 管理者作成 CLI コマンド（UI 登録不可・環境変数両対応） — 計画書: [docs/plans/admin-create-cli/plan.md](plans/admin-create-cli/plan.md)
- [x] 監査ログ実装（ログイン/PW変更/管理者操作・個人情報除外） — 計画書: [docs/plans/audit-log/plan.md](plans/audit-log/plan.md)
- [x] 管理者ダッシュボード `/admin`（ユーザー一覧・管理 UI） — 計画書: [docs/plans/admin-dashboard/plan.md](plans/admin-dashboard/plan.md)

## フェーズ11: セキュリティ・品質仕上げ

- [x] bcrypt 72バイト上限の入力検証統一（UTF-8バイト数、登録・変更・リセット・管理者CLI、既存ユーザー互換性、フロント表示、72/73バイト境界テスト） — 計画書: [`docs/plans/bcrypt-password-byte-limit/plan.md`](plans/bcrypt-password-byte-limit/plan.md) / PR: #82
- [x] セキュリティヘッダーミドルウェア（CSP/HSTS/X-Frame-Options/nosniff等） — 計画書: [`docs/plans/security-headers/plan.md`](plans/security-headers/plan.md) / PR: #84
- [-] APIレート制限の本番設計・適用（認証系 / 一般API / `POST /game/sessions`） — 実装履歴: [`api-rate-limit-production`](plans/api-rate-limit-production/plan.md) / R7実環境gate正本: [`r7-rate-limit-environment-gates`](plans/r7-rate-limit-environment-gates/plan.md) — Hono・フロントエンド、SQLite-backed Durable Object/store adapter、local Workers runtime test、staging namespace/binding稼働、manual staging境界証拠workflowまで実装済み。server-side診断run 30059544533ではauth 5回目の503をmain stateless Workerの`exceededCpu`まで絞った。無料枠のローカルworkerd隔離診断ではcost 12の`bcrypt.compare`を`BCRYPT_DOMINANT`へ分類し、HMAC/JWT/token/app構築は同じ桁の原因でないことを確認した。staging実HTTP 429成功証拠、安全な無料枠修正、制御された503契約、WAF、監視、production namespace/binding・実機確認は未完了
- [-] 監査ログ本番運用設計（保持期間365日・退会後内部IDの同期間保持は2026-07-14承認済み。T20・公開前T21・T22完了。公開後回帰と残るrelease gateを継続） — 計画書: [docs/plans/audit-log-production-operations/plan.md](plans/audit-log-production-operations/plan.md)
  - [x] T20: production容量監視・通知先・暗号化backup・migration gateを実環境で確認
  - [x] T21: 2026-07-14 22:54 JST〜2026-07-21 22:55 JSTの公開前baselineを確認。観測開始時と2026-07-22 03:58 JSTの終了後確認run時はいずれも監査row 0件、7日増加量0件
  - [x] 自動test: 10,000件上限、上限後の残件通知、stable concurrency group、cleanup失敗時の非0終了
  - [ ] 実環境運用確認: schedule/manualのqueue動作、Actions失敗通知の受信、retention変更前dry-run
  - [ ] 本番アプリ公開後の監査回帰・実負荷baseline: LOGIN success/failure、password change/reset、admin操作、本人・管理者退会、API status/body/Cookie
  - [x] T22: 7日baselineと残課題を記録したdocs PR #95が2026-07-22にdevelopへmerge済み
- [-] 退会時の個人情報・学習データ完全削除方針（本人退会・管理者強制退会・既存soft-deleted userの移行） — 計画書: [docs/plans/account-data-complete-deletion/plan.md](plans/account-data-complete-deletion/plan.md) — v0.1ではM6のsynthetic本人退会と物理削除を確認済み。legacy cleanup、managed DB性能証拠、restore drillなど旧全体計画の公開後項目は完了扱いにせず継続する
  - [x] 実装計画・現行soft delete・User配下のcascade対象・不足indexを確認
  - [-] Phase 0: privacy・監査内部ID・backup・再登録・削除replay・性能基準・本番cleanup体制を決定（T1A確定、T1B継続）
    - [x] T1A: 物理削除、監査成功action、再登録、backup境界、replay block、同期削除性能基準の実装契約を確定
    - [-] T1B: 監査保持365日・内部ID同期間保持は2026-07-14承認済み。privacy問い合わせ先、backup境界、全損時replayの残存リスクは2026-07-22承認済み。本番cleanup体制など残るgateを継続
  - [-] Phase 1: cascade/index契約test、expand index migration、専用DB・staging検証
  - [x] Phase 2: 共通Serializable transaction、本人退会・管理者強制退会の物理削除、成功監査、cleanup CLI・workflow
    - [x] T5〜T9: 共通Serializable transaction、本人退会の物理削除、last-admin、成功監査
    - [x] T10〜T11: 管理者強制退会のactor再確認、物理削除、成功・失敗監査
    - [x] T12: 本人・管理者退会routeのvalidation、409/404、Cookie、generic 500契約
    - [x] T13: 専用DBで全所有row cascade・Element保持・成功監査・rollback・並行退会を検証
    - [x] T14: legacy cleanupの実行許可・batch size設定を安全側defaultと厳格validationでTDD実装
    - [x] T15: legacy cleanupのdry-run・batch削除・安全log・失敗停止契約をRed test化
    - [x] T16: legacy cleanup serviceを集合dry-run・Serializable batch物理削除・安全logで実装
    - [x] T17: legacy cleanup CLIの三重gate・DB load前拒否・残件確認・秘密非出力をRed test化
    - [x] T18: legacy cleanup CLI・npm scriptを三重gate・実行後dry-run・安全errorで実装
    - [x] T19: staging/production workflowのmanual限定・三重gate・backup・承認契約をRed test化
    - [x] T20: staging/production workflowを実装（manual限定、productionは24時間以内のbackup・dry-run marker・承認記録を必須化。実環境検証はT35/T38）
    - [x] T21: 物理削除後のregister/login/forgot-password/refresh・Bearer認証契約をTDD更新（対象71件・backend全体789件成功）
    - [x] T22: admin v1互換一覧・detail・stats契約をTDD更新（対象55件・backend全体793件成功）
  - [ ] Phase 3: staging cleanupを検証し、Phase 2・4の同時公開後にproductionの既存soft-deleted userをdry-run・batch削除・冪等再実行
  - [-] Phase 4: 設定画面・認証store・管理画面の契約／A11Y整合
    - [x] T23: settings退会フォームの説明・control別error・focus・busy・Abort契約をRed test化（専用18件中11件成功・7件Red、frontend全体466件成功・7件Red）
    - [x] T24: settings退会フォームの説明・control別error・focus・busy・Abortを実装（専用18件・frontend全体473件成功）
    - [x] T25: auth storeのlocal/cross-tab clear・refresh abort・安全event・SSR fallback契約をRed test化（専用5件Red、frontend既存473件成功・追加5件Red）
    - [x] T26: auth storeのlocal/cross-tab clearを実装しsettings退会成功処理へ接続（対象24件・frontend全体479件成功）
    - [x] T27: admin frontendのdeleted UI除去・完全削除警告・削除後focus・同期失敗分離をRed test化（対象85件中68件成功・17件Red、frontend全体473件成功・17件Red）
    - [x] T28: admin deleted UIを除去し、強制退会後の同期・focus・失敗表示を実装（対象85件・frontend全体490件成功）
  - [x] T29: API・security・testing・deployment文書を実装済み契約と未承認gateへ同期（6文書とworkflow/CLIを照合、Prettier・diff check成功。実環境workflow未実行）
  - [x] T30: backend品質check完了（ESLint・Prettier・TypeScript build・Prisma validate成功、通常全test 793件成功・専用DB 7件skip）
  - [x] T31: frontend品質check完了（Prettier・ESLint・Svelte/TypeScript check・production build成功、通常全test 490件成功）
  - [x] T32: 専用Docker PostgreSQL integration 5件成功（15 migrations適用済み・pending 0、終了後fixture 0件）
  - [-] T33: stagingのGameSession 5,000件・GameAnswer 50,000件cascadeは1,446.32msで基準5,000ms以内、cleanup・事後preview・flag `false`復旧まで成功。ローカル専用PostgreSQL 16.13で対象migrationだけpendingを再構築した30秒baselineも、migration 1,427ms・probe 115回・最大write待ち 22.14ms・cleanup成功・残存fixture 0件だった。managed DB再計測の同等性条件と暫定gate（probe 30秒以上、migration 5,000ms以下、最大write待ち1,000ms以下、probe 20回以上、cleanup完了、migration current）を文書化したが、ローカル値をmanaged DB合格証拠とは扱わない。managed DB証拠または正式な残余リスク承認まで進行中
  - [-] 2026-07-21残作業区分: T34はrun 29802327100成功で完了。T33のmanaged DB固有検証、T35 cleanup dry-run/execute/再実行、production・backup・restore・shared contract適用は実環境条件付きで継続する
  - [x] T34安全なstaging synthetic確認: synthetic browser回帰、fixture完全一致preflight、登録・メール認証・login・本人退会・ゲーム・password resetに加え、PR #125 merge後のrun 29802327100でAdmin login、管理者linkのSPA遷移、`/admin` dashboard、強制退会、旧credential 401、main cleanupを確認した。prepareは2件作成・置換0件、main cleanupはE2E後に残るAdmin 1件を削除し、recoveryはmain成功のためskip。flagは`false`へ復旧済み
  - [ ] T35 staging legacy cleanup: 完全一致fixture preflightは実装済み。明示承認付きdry-run/execute/再実行0、sentinel保持、両flag `false`復旧は未実施
  - [-] Phase 5: T39の`deletedAt`非参照code・test、Prisma User writeの明示`select`契約、v1 deprecated互換値を実装済み。staging/production deploy・soakとT44のPrisma Client再生成は未実施
  - [ ] Phase 6: cleanup後backup、旧Artifactの7日失効、isolated restore drill・削除replay
  - [-] Phase 7: T43のtable lock付き隔離guard SQL・contract test・ローカル専用DB fail/success/並行insert/drop後Prisma writeを完了。staging/production適用はT44として未実施
  - [x] 2026-07-18 PR #107 review follow-up品質check: backend 887件成功・10件skip、ESLint・Prettier・TypeScript build・Prisma validate成功。deleteOnlyUserIds空配列拒否とshorthand select許容を含み、専用cascade 5件とcontract migration 5件も成功
  - [ ] Release gate: 本番cleanup担当者・承認者・実施時間帯・通知方法、integration・Playwright・smoke testを完了（privacy・backup・全損時replay残存リスクはR4で承認済み）

### 完全削除から切り出した関連タスクの着手タイミング

> Phase番号は作業パッケージを表し、そのまま本番公開順を意味しない。Phase 2のバックエンドを先に実装・staging検証してもよいが、下表の「完了期限」を満たすまで本番公開・不可逆cleanupへ進まない。

| 切り出しタスク                                   | 着手タイミング                                                  | 完了期限・合流点                                                  | 進捗管理先                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 監査ログ保持期間・退会後内部IDの承認             | 2026-07-14に正式承認、公開文面は2026-07-22に再承認              | R4完了。公開後回帰と残るproduction gateは継続                     | [`audit-log-production-operations`](plans/audit-log-production-operations/plan.md) |
| プライバシーポリシー `/privacy`                  | R3で実装し、正式値を2026-07-22にR4で承認                        | R4完了。staging回帰とproduction smokeはR12/R16で実施              | [`privacy-policy`](plans/privacy-policy/plan.md)                                   |
| 現行DB全損時の外部削除replay source              | 未導入。完全なreplayを保証できない残存リスクを2026-07-22に承認  | 方針決定はR4で完了。外部source導入とrestore drillは未実装・未検証 | [`account-data-complete-deletion`](plans/account-data-complete-deletion/plan.md)   |
| 監査内部IDのHMAC化・退会時null化・legal hold     | 監査保持方針で必要と判断した時点                                | 必要と判断した場合はPhase 2本番公開前                             | 監査ログ本番運用の追加計画                                                         |
| 非同期削除queue                                  | Phase 1〜3のstaging性能計測が基準超過した場合だけ着手           | 同期削除を本番公開する前。超過時は本計画を再設計                  | 新規計画                                                                           |
| 匿名化済みhistorical KPI                         | 完全削除後も退会者を含む統計が必要と決まった時点                | 本機能のrelease blockerではない。Phase 7後でも可                  | 新規計画                                                                           |
| 管理API v2・deprecated field廃止                 | Phase 5の非参照codeが安定し、旧frontend退役条件を定義できた時点 | Phase 7のDB contract migrationとは分離し、旧asset失効後           | 新規API version計画                                                                |
| メール配送事業者・外部log・browser保持期間の確認 | Phase 0で調査開始                                               | `/privacy` 文言確定・本番公開前                                   | security/privacy運用記録                                                           |

### その他の品質タスク

- [ ] エラートラッキング・構造化ログ導入（500通知・requestId・個人情報除外）
- [x] ダークモード対応（OS設定追従 + トグルボタン）— D1〜D12、browser確認、frontend 580 test・全品質gate成功
- [ ] レスポンシブデザイン確認・修正（PC/タブレット/スマホ）
- [ ] アクセシビリティ確認（キーボード操作・スクリーンリーダー）
- [x] プライバシーポリシーページ `/privacy` — リリースタスク: R3 / 個別計画: [`privacy-policy`](plans/privacy-policy/plan.md)

## フェーズ12: デプロイ

- [x] Supabase staging・production project作成、東京region・Session pooler接続設定
- [-] 定期バッチ運用再設計（GameQuestionSet cleanup日次化・scheduled専用production境界・kill switch・滞留run解消） — PR #166のrepository実装とPR #168の外部設定記録はmerge済み。BO1〜BO14完了（旧run #804/#868はstep 0件確認後にcancel）。M1R・M3・M5・M6とdefault branchの`main`切替は完了した。`production-batch`最小設定は維持し、BO15は別承認まで無効、kill switchは`false`、自然発生run確認のBO16と最終同期のBO18は未実施 — 計画書: [`batch-operations-redesign`](plans/batch-operations-redesign/plan.md)
  - [x] `Production Database Operations`のscheduled run滞留を恒久修正。Environment前に`disabled / skipped / failure / ready`を固定分類し、kill switch無効時はSecret・依存導入・DB接続・concurrency取得前に終了する。scheduledは`production-batch`＋専用concurrency、manualはrequired reviewer付き`production`＋既存manual concurrencyへ分離し、capacity/backupのraw error非露出をTDD固定した。production状態変更、BO15有効化、run操作、M6ユーザー・メールルーティング変更は行っていない
- [x] 本番DBバックアップ・Prismaマイグレーション運用（Free plan容量確認・暗号化backup・migration gateをproductionで確認済み） — 計画書: [`docs/plans/audit-log-production-operations/plan.md`](plans/audit-log-production-operations/plan.md)
- [-] 本番DBバックアップ耐障害性強化 — M1Rが成立するv0.1はpending Prisma migrationがある場合だけ24時間以内の暗号化済み1世代とchecksumを必須とし、migration不要時のbackup、日次schedule確認、2世代目以降、最大3回retry・recovery・36時間鮮度監視・通常7世代・四半期隔離restoreは公開後に継続 — 計画書: [`docs/plans/backup-resilience/plan.md`](plans/backup-resilience/plan.md)
- [-] staging frontend/API配備基盤（Workers専用entrypoint・Prisma/mail runtime境界・Wrangler・Vercel Preview・T34実機確認） — 計画書: [`docs/plans/staging-app-deployment/plan.md`](plans/staging-app-deployment/plan.md) / PR: #117 — SD1〜SD13・SD15完了。Vercel `develop` Preview、Cloudflare staging Worker/DO/Hyperdrive/secret、Supabase migration、health/CORS/OPTIONS、元素118件、synthetic登録・認証・ゲーム・password reset・本人退会を確認済み。production baselineはM5/M6で別途完了した。固定staging alias自動更新はIssue #173、staging API rollback実確認は継続する
  - [x] SD16実環境検証: PR #125で管理者linkのSPA遷移をTDD固定し、run 29802327100でAdmin login、`/admin` dashboard、強制退会、旧credential 401、main cleanupが成功した。flagは`false`へ復旧済み。production・migration・実メール・再配備・追加の直接DB queryは未実行
- [x] Cloudflare Workers Wrangler + Prisma `@prisma/adapter-pg`/接続binding設定・デプロイ — stagingはHyperdrive方式で設定・配備・実機確認済み。productionもM5でresource・binding分離、通常password verifier DOを含むAPI deploy、healthを確認済み。WAF・監視・R7の全境界確認は別タスクで継続する
- [-] APIレート制限の本番適用継続（Workers専用entrypoint・SQLite-backed Durable Object・WAF・staging/production実機確認） — 実装履歴: [`api-rate-limit-production`](plans/api-rate-limit-production/plan.md) / R7実環境gate正本: [`r7-rate-limit-environment-gates`](plans/r7-rate-limit-environment-gates/plan.md) — T13/T14のDO test・store adapterとstaging namespace/binding稼働は確認済み。server-side診断run 30059544533はauth 1〜4回目の200後、5回目の503だけmain stateless Workerの`exceededCpu`を観測した。無料枠のローカルworkerd隔離診断ではcost 12の`bcrypt.compare`中央値209msに対し、HMAC 3回・JWT・token・app構築は分解能未満で`BCRYPT_DOMINANT`へ分類した。M5/M6でbaseline production resource・preflight、通常password verifier DO、valid login、最小429とresetは確認済み。auth 11回目429の個別証拠、安全な無料枠修正、制御された503契約、WAF、監視、R7全境界caseは未完了
- [x] Vercel SvelteKit `develop` Previewデプロイ・branch scoped環境変数設定 — 計画書: [`docs/plans/staging-app-deployment/plan.md`](plans/staging-app-deployment/plan.md)
- [-] develop merge後に固定staging frontendを自動更新する — Issue [#173](https://github.com/RitukoIsibasi0222/gensoko/issues/173) / PR: [#192](https://github.com/RitukoIsibasi0222/gensoko/pull/192), [#193](https://github.com/RitukoIsibasi0222/gensoko/pull/193), [#194](https://github.com/RitukoIsibasi0222/gensoko/pull/194), [#195](https://github.com/RitukoIsibasi0222/gensoko/pull/195) / 計画書: [`staging-frontend-auto-deploy`](plans/staging-frontend-auto-deploy/plan.md) — PR #195のmerge SHA `d40bf365`でrun 31081222649の品質gate、exact Preview探索、develop先端確認は成功したが、共通actionがlist JSONのdeployment ID欠落を不一致としてalias更新前に安全停止した。listでSHA/ref/URL/stateを確認し、同じ候補の`inspect --format=json`で初めてID/project/URL/target/READYを取得・検証する修正をTDD実装し、merge後の実staging再検証待ち
- [ ] main merge後に承認付きでAPI → health → frontend → smokeを自動化する — Issue [#174](https://github.com/RitukoIsibasi0222/gensoko/issues/174)（#173完了後に着手）
- [x] npm audit・本番環境動作確認（M3でproduction依存監査、M6で登録・メール・認証・ゲーム・本人退会を確認）

## ポートフォリオ版 v0.1 公開計画

> 現在の正本: [`docs/plans/portfolio-release-v0-1-minimal/plan.md`](plans/portfolio-release-v0-1-minimal/plan.md)
>
> 旧R1〜R18の履歴: [`docs/plans/portfolio-release-v0-1/plan.md`](plans/portfolio-release-v0-1/plan.md)
>
> 一般登録・認証・ゲーム・本人退会は公開する。基本セキュリティは維持し、商用運用相当の長期観測・drill・高度な自動化だけを公開後へ移す。
>
> branch境界は`develop=staging/開発統合`、`main=production/公開済み`とする。release branchは作らず、通常releaseは`develop`から`main`への直接PRで昇格する。旧develop SHAのM3/M1Rは履歴として保持し、main merge後の確定SHAで再固定する。
>
> 確定main SHAのM3後、別承認でproduction Environmentだけをmain限定へ変更してから同じSHAのM1Rを実行する。M1R review後の別承認でproduction-batchとdefault branchをmainへ切り替える。stagingはdevelop限定、production required reviewer、kill switch `false`を維持する。

### 最小リリース工程（M1R・M3・M5・M6、条件付きM4）

- [-] M1: production初回状態のschema v1証拠を取得・review済み — 計画書: [`docs/plans/m1-production-read-only-evidence/plan.md`](plans/m1-production-read-only-evidence/plan.md) — 旧run [30321699906](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30321699906)と中間run [30335685074](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30335685074)は履歴として維持する。M4後の最新候補`64ff4d2eccb5c6cd008d472f1940feaa5a2de4c3`のrun [30416382440](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30416382440)でDB 5項目・Cloudflare・両attestationは`clear`、GitHub deployment・backup履歴は`present`、Vercel deploymentは`unknown`だった。schema v1のPath BとM1未完了を維持する
- [x] M1R: 旧develop SHAの証拠とowner判断を履歴として維持し、main merge後の確定SHAでM3成功後、production Environmentをrequired reviewer・main限定のまま同じmain SHAのread-only evidenceとowner判断を再固定した
- [-] M2: repository実装完了、外部実行は未完了のまま公開後へ移管。同じrelease候補SHAのstaging campaignは実行せず、M2P-17〜M2P-22を完了扱いにしない。通常password verifier DO、valid login、最小429、主要導線はM6 production smokeで確認する
- [x] M3: 旧develop SHAの品質gate成功を履歴として維持し、release PRをmainへmergeした後の確定main SHAで品質gateとproduction依存監査を再実行した
- [x] M4: backup run [30301334445](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30301334445)を確認し、対象SHA `7dbe5649a4057baa3b123aaadb6531422f96fd2f`のmigration run [30342343404](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30342343404)で`prisma migrate deploy`に成功した。検証run [30406227957](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30406227957)で対象run・SHAとv0.1対象5 indexの`indisvalid`・`indisready`を値非表示確認し、M4を完了した
- [x] M5: same-site URL、Cookie、CORS、メール送信元、Secret/binding分離を値非表示でpreflightし、別承認でproduction API・frontendをdeployして両healthを確認した
- [x] M6: productionの単一synthetic Userで登録、転送メール受信、メール認証、login、reload後の認証維持、正本118元素、元素一覧、game、ranking、mypage、weak、通常password verifier DO、最小429とreset、password reset、本人退会を確認した。本人退会workflowのmain/recoveryは固定失敗として終了し再実行せず、再認証後の通常UIで対象identityを再確認して物理削除した。削除成功表示、再設定メール非発行、保護画面拒否、ランキング消失を独立確認し、追加検証Userもlogin拒否・再設定メール非発行で不在を確認した。本人退会用一時Secret 2件・対象Variable・M6専用Email Routingルールを削除し、本人退会flagとscheduled batchは`false`、BO15は無効、active workflowは0件を維持した。AuditLogは365日保持方針に従い、公開後項目は別計画へ引き継ぐ
  - [x] Production元素seed手順: 初回から5回目までの失敗workflowは再実行せず、Prisma Client生成修正をreview・develop/mainへ再昇格した後、別の明示承認による新規dispatchでseed stepと別process・別接続の独立verifyが成功した。productionへの直接CLI・SQL seedを使わず、正本118件と公開元素一覧118件を確認してM6を再開した — 計画書: [`production-elements-seed`](plans/production-elements-seed/plan.md)
    - [x] 第五回の`module_load_failure`修正: production接続なしのfresh `npm ci`直後にPrisma Client生成物不在とmodule import失敗を再現し、`prisma generate`後の同import成功を確認した。production workflowへseed時限定の生成stepを`npm ci`後・DB接続・module-load probe前に追加し、生成log非表示を契約testで固定した。対象12件・関連28件、backend全1306件・Workers 32件、build・Workers build・lint・format・Prisma validate・正本整形が成功し、review・develop/main昇格後の新規承認付きrunでproduction seedと独立verifyの成功を確認した

### 旧リリース実行タスク（R1〜R18・履歴）

- [x] R1: Admin E2E修正後runを記録する
- [x] R2: ダークモードをTDD実装する
- [x] R3: `/privacy`をTDD実装する
- [x] R4: privacy・監査・backup・問い合わせ先を承認する（プロダクトオーナー `RitukoIsibasi0222`、2026-07-22承認）
- [-] R5: 認証・refreshのproduction構成を確定する — 計画書: [`production-auth-refresh`](plans/production-auth-refresh/plan.md)
  - code・contract test・migration file・runbookを実装中。G1〜G8、R14 preflight、R15 deploy、R16 production smokeの証拠が未完了のため`[-]`を維持する。
- [-] R6: 完全削除の残るv0.1 gateを完了する — 計画書: [`r6-account-deletion-gates`](plans/r6-account-deletion-gates/plan.md)
  - production本人削除専用config guard、main/recovery Playwright、manual-only workflow、runbookをTDD実装済み。最新release候補でもM1Rが成立し、T1B、T33、T35、legacy cleanup、既存利用者向けmigrationをv0.1対象外として維持する。R14〜R16のpreflight・deploy・production本人退会smokeは未完了のため`[-]`を維持する。
- [-] R7: app rate limitの実環境gateを完了する — 計画書: [`r7-rate-limit-environment-gates`](plans/r7-rate-limit-environment-gates/plan.md) — R7-01の基準SHA・repository contract test 100件・Workers build、R7-03のstaging Worker/DO/Secret presence、R7-04のG5/G6とfixture lifecycleは完了。server-side診断run 30059544533ではauth 1〜4回目の200後、5回目の503だけmain stateless Workerの`exceededCpu`を観測した。E-08の無料枠ローカルworkerd診断でvalid loginのcode-level支配要因をcost 12の`bcrypt.compare`へ固定分類したが、安全な無料枠修正と11回目429証拠は未完了。Cloudflare domain/zoneが0件でR7-02はblocked。監視、production分離、rollbackも未完了
  - 503安全分類の別TDD計画: [`r7-auth-503-safe-classification`](plans/r7-auth-503-safe-classification/plan.md) — PR #144はmerge commit `628ce06f90d150ae3dd3eb7e8e6c52ee42deace8`として`develop`へmerge済み。safe JSON 503、非JSON/契約不一致503、その他statusをraw body/header値なしの固定enumで区別し、関連65件、backend 1109件、Workers 15件、build・lint・format checkが成功した。第三runでは6回目503を`EDGE_OR_UNCLASSIFIED_503`へ分類したが、契約内の不一致箇所と内部原因は未特定
  - [x] 503契約不一致詳細分類: [`r7-auth-503-contract-detail`](plans/r7-auth-503-contract-detail/plan.md) / PR: [#145](https://github.com/RitukoIsibasi0222/gensoko/pull/145) — merge commit `dcae128899275c0ec58027c97c9d039427fc5e57`。raw値を出さず503公開契約の不一致箇所だけを固定分類した。server-side診断では5回目の503をmain stateless Workerの`exceededCpu`まで絞ったが、具体的なCPU消費処理は未特定。main/recovery cleanupとflag `false`復旧は成功し、campaign上限到達により追加runを停止した
  - [x] login CPU隔離診断: [`r7-login-cpu-diagnostics`](plans/r7-login-cpu-diagnostics/plan.md) / PR: [#148](https://github.com/RitukoIsibasi0222/gensoko/pull/148) — 実環境runを増やさず、無料枠のローカルworkerdでcost 12の`bcrypt.compare`を`BCRYPT_DOMINANT`へ固定分類した。最終測定はbcrypt中央値209ms、HMAC 3回・JWT・token・app構築は分解能未満（各最大2ms以下）。backend 1110件、Workers 27件、build・lint・format check成功。R7全体と安全な無料枠修正は未完了
  - [x] Free Worker password verification分離: [`r7-password-verification-free-worker`](plans/r7-password-verification-free-worker/plan.md) / PR: [#150](https://github.com/RitukoIsibasi0222/gensoko/pull/150) — R7PV-01〜R7PV-15のrepository実装を完了した。bcrypt cost 12を維持し、valid loginの照合だけをstorageなしのSQLite-backed Durable Objectへaccount単位の内部RPCで分離した。Worker fallback禁止、固定503 + `Retry-After: 60`、値非露出、既存v1を変えないv2 class migration、Node adapter bundle禁止をTDDで固定し、backend 1124件、Workers 32件、build・staging/production dry-run・lint・format checkが成功した。Cloudflare resource変更、deployment、staging requestは未実施でR7PV-16/17の別承認待ち、R7-05とR7全体は未完了
  - [x] Password verification rollback互換baseline repository実装: [`r7-password-verification-rollback-baseline`](plans/r7-password-verification-rollback-baseline/plan.md) — v2 lifecycleを共有するstaging専用baseline、既存cost 12 local adapterの専用entrypoint明示DI、profile別bundle contract、一時Wrangler config、通常/baseline/production dry-runをR7PVRB-01〜12としてPR #152へ実装した。Cloudflare resource変更、deploy、version rollback、staging/production request、workflow dispatch、fixture・flag操作、namespace cleanupは未実施。R7PVRB-13〜15、R7PV-17、R7-05、R7全体は未完了だが、rollback drillはM1の空DB・初回配備条件が成立するv0.1のblockerにしない
- [ ] R8: headers・CORS・safe error・logを最終確認する
- [-] R9: 暗号化backupを日次化し、未失効Artifact 2世代以上を確認する（code・contract test完了。main昇格・default branch切替後の日次schedule 2回と未失効2世代は観測待ち）
- [ ] R10: 基本responsive・keyboard/A11Yを確認する
- [x] R11A: backend production依存を安全に更新し、Critical/High/Moderate/Low 0件を確認する
- [x] R11: review済みSHA `3370cefbc6934e5e3d68ddf9c22eaaf4c5a634ae`でrelease候補の品質gateとnpm auditを実行する
- [ ] R12: staging主要導線を最終確認する
- [x] R13: M4後の最新release候補のM1 run [30416382440](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30416382440)でschema v1のPath BとDB 5項目`clear`を再reviewし、Vercel履歴の`unknown`を保持したまま、M1Rのowner再確認によりv0.1の既存利用者向け移行を対象外と判断する
- [ ] R14: rollout/rollback preflightを完了する
- [ ] R15: production deployを別承認で実施する
- [ ] R16: production smokeを実施する
- [ ] R17: release recordと進捗を同期する
- [ ] R18: 公開後タスクを引き継ぐ

### 旧公開前リリースゲート（履歴）

> 以下は旧R1〜R18全体の完了条件であり、現在のv0.1公開条件はM1R・M3・M5・M6と条件付きM4とする。

- [x] staging synthetic Admin E2Eの`/admin`到達・強制退会・旧credential拒否・cleanup — run 29802327100
- [x] bcryptjsハッシュ、UTF-8 72バイト境界、Zod入力検証、安全な日本語errorのコード契約
- [x] APIセキュリティヘッダーとCORS単一originのコード契約
- [-] 一般ユーザー登録・メール認証・login/logout — staging確認済み、production smoke待ち
- [ ] refresh tokenのproduction same-site構成とreload後refresh確認
- [-] 本人退会の物理削除 — code・専用DB・staging本人/Admin導線を確認済み、残る移行・production gate待ち
- [x] ダークモード（OS設定追従 + 明示toggle） — D1〜D12完了、計画: [`dark-mode`](plans/dark-mode/plan.md)
- [x] プライバシーポリシーページ`/privacy` — R3 / 計画: [`privacy-policy`](plans/privacy-policy/plan.md)
- [-] 基本レスポンシブ・keyboard・focus・live region — 実装済み範囲あり、主要画面のrelease確認待ち
- [-] 認証系・ゲーム送信APIのアプリレベルrate limit — Hono/DO、staging binding、manual境界証拠workflowまで実装済み。server-side診断でauth 5回目の503をmain stateless Workerの`exceededCpu`まで絞り、E-08のローカルworkerd診断でcost 12の`bcrypt.compare`を`BCRYPT_DOMINANT`へ分類した。無料枠修正は計画作成のみで、実装、実HTTP 429成功証拠、制御された503契約、production binding待ち
- [ ] production CORS、HttpOnly/Secure/SameSite Cookie、security headersの実HTTP確認
- [ ] staging/production logでPII・token・Cookie・Authorization・DB URL・raw error非出力を最終確認
- [-] 暗号化backupの日次化 — 日次cronのcontract testとworkflowの2行変更はRed→Greenで実装済み。初回Artifact・checksum・復号はrun 29322979476で確認済み。main昇格・default branch切替後の日次schedule 2回と未失効Artifact 2世代の確認待ち
- [x] backend production依存を安全に更新し、回帰後にCritical/High/Moderate/Low 0件を確認
- [x] review済みSHA `3370cefbc6934e5e3d68ddf9c22eaaf4c5a634ae`でtest・Workers test・build・lint・format・Prisma validate・production npm auditを完了（frontend production依存も0件）
- [ ] dark/privacyを含むstaging主要導線の最終確認
- [ ] production deploy後のsmoke test

### 初回リリース後

- [ ] 共通APIクライアントへの全面移行 — 計画: [`frontend-api-client`](plans/frontend-api-client/plan.md)
- [ ] Hono RPC導入
- [ ] ゲームAPIテスト追加補強 — 計画: [`game-api-tests`](plans/game-api-tests/plan.md)
- [ ] 高度なWAF tuning
- [ ] R7PVRB-13〜15のbaseline deploy・post-v2 rollback drill・通常版復旧
- [ ] R7の全境界case、staging 24時間・production 48時間観測
- [ ] 本番公開後の監査ログ実負荷7日baseline（公開前0件baselineは2026-07-21完了）
- [ ] 高度な容量監視・通知
- [ ] backup最大3回retry・2時間後recovery・36時間鮮度監視・通常7世代・四半期隔離restore — 計画: [`backup-resilience`](plans/backup-resilience/plan.md)
- [ ] 日次backupの2世代目以降を確認する
- [ ] staging T35 legacy cleanupを実演する（M1でlegacy row 0件を確認できない場合は公開前へ戻す）
- [-] develop frontend自動更新 — Issue [#173](https://github.com/RitukoIsibasi0222/gensoko/issues/173) / PR: [#192](https://github.com/RitukoIsibasi0222/gensoko/pull/192) / 計画書: [`staging-frontend-auto-deploy`](plans/staging-frontend-auto-deploy/plan.md)
- [ ] main承認付き通常release自動化 — Issue [#174](https://github.com/RitukoIsibasi0222/gensoko/issues/174)（#173完了後）
- [ ] 管理画面Playwright網羅
- [ ] 複数screen reader/browserの高度検証
- [ ] 本番公開後の追加運用自動化

### 条件付きで v0.1 対象外

- [x] production DB target、全User・legacy・関連row・AuditLogが`clear`であることを、承認付きread-only workflowでPII/IDなしに確認した
- [x] ownerが一般公開・一般登録・実利用者data保存の実績なしを確認したため、legacy production cleanup、既存利用者向け段階migration、旧backend長期soak、旧backup失効待ち、T33/T35を「v0.1対象外」と記録した
- [ ] DB 5項目またはowner確認が不明になった場合は簡略化せず、完全削除計画の通常gateへ戻る

### 外部承認・実環境確認待ち

- [x] privacyの運営主体、問い合わせ先、監査正式保持期間・目的、backup/replay説明、発効日をowner承認する（2026-07-22。全損時replayの完全保証がない残存リスクを含む）
- [ ] production hostname、same-site Cookie、CORS origin、Cloudflare DO binding/secret、rollback先を値非表示で確認する
- [ ] pending Prisma migrationがある場合だけ24時間以内の暗号化backup 1世代、checksum、平文非保存を確認する
- [x] T33/T35と既存利用者向け完全削除gateは、DB 5項目`clear`とM1Rによりv0.1対象外と判断する
- [ ] review済みrelease候補SHAをproductionへ配備し、smokeとfix-forward時の公開停止手順を記録する
