# Gensoko 実装タスク一覧

> 更新日: 2026-07-16
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
- [-] APIレート制限の本番設計・適用（認証系 / 一般API / `POST /game/sessions`） — 計画書: [`docs/plans/api-rate-limit-production/plan.md`](plans/api-rate-limit-production/plan.md) — Hono・フロントエンド先行実装済み。本番Durable Object・WAF・実機検証はフェーズ12基盤後に実施
- [-] 監査ログ本番運用設計（保持期間・容量監視・cleanup・退会後の内部ID保持方針） — 計画書: [docs/plans/audit-log-production-operations/plan.md](plans/audit-log-production-operations/plan.md)
- [-] 退会時の個人情報・学習データ完全削除方針（本人退会・管理者強制退会・既存soft-deleted userの移行） — 計画書: [docs/plans/account-data-complete-deletion/plan.md](plans/account-data-complete-deletion/plan.md) — 監査ログ保持とは分離した本番公開前ブロッカー（実装中・本番公開gate未完了）
  - [x] 実装計画・現行soft delete・User配下のcascade対象・不足indexを確認
  - [-] Phase 0: privacy・監査内部ID・backup・再登録・削除replay・性能基準・本番cleanup体制を決定（T1A確定、T1B継続）
    - [x] T1A: 物理削除、監査成功action、再登録、backup境界、replay block、同期削除性能基準の実装契約を確定
    - [-] T1B: 監査保持の正式承認、本番cleanup体制、全損時replayの最終判断を本番公開前gateとして継続
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
  - [ ] Phase 4: 設定画面・認証store・管理画面の契約／A11Y整合
  - [ ] Phase 5: `deletedAt` 非参照codeへの移行、v1 deprecated互換値の維持、deploy・soak
  - [ ] Phase 6: cleanup後backup、旧Artifactの7日失効、isolated restore drill・削除replay
  - [ ] Phase 7: guard付きcontract migrationをstaging・productionへ適用
  - [ ] Release gate: privacy policy、監査保持承認、全損時replay方針、本番cleanup体制、integration・Playwright・smoke testを完了

### 完全削除から切り出した関連タスクの着手タイミング

> Phase番号は作業パッケージを表し、そのまま本番公開順を意味しない。Phase 2のバックエンドを先に実装・staging検証してもよいが、下表の「完了期限」を満たすまで本番公開・不可逆cleanupへ進まない。

| 切り出しタスク                                   | 着手タイミング                                                  | 完了期限・合流点                                                                  | 進捗管理先                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 監査ログ保持期間・退会後内部IDの承認             | Phase 0で既存案の確認を開始し、本体と並行                       | Phase 2の物理削除backendを本番公開する前                                          | [`audit-log-production-operations`](plans/audit-log-production-operations/plan.md) |
| プライバシーポリシー `/privacy`                  | Phase 0で文言案を作り、Phase 4のUI文言確定後に実装              | Phase 2の物理削除backendを本番公開する前                                          | フェーズ11「プライバシーポリシーページ」                                           |
| 現行DB全損時の外部削除replay source              | Phase 0で「実装」または「残余リスク承認」を決定                 | 方針決定・承認はPhase 2本番公開前。実装を選ぶ場合はPhase 6のrestore drill前に完成 | 新規計画を作成する場合は本計画からlink                                             |
| 監査内部IDのHMAC化・退会時null化・legal hold     | 監査保持方針で必要と判断した時点                                | 必要と判断した場合はPhase 2本番公開前                                             | 監査ログ本番運用の追加計画                                                         |
| 非同期削除queue                                  | Phase 1〜3のstaging性能計測が基準超過した場合だけ着手           | 同期削除を本番公開する前。超過時は本計画を再設計                                  | 新規計画                                                                           |
| 匿名化済みhistorical KPI                         | 完全削除後も退会者を含む統計が必要と決まった時点                | 本機能のrelease blockerではない。Phase 7後でも可                                  | 新規計画                                                                           |
| 管理API v2・deprecated field廃止                 | Phase 5の非参照codeが安定し、旧frontend退役条件を定義できた時点 | Phase 7のDB contract migrationとは分離し、旧asset失効後                           | 新規API version計画                                                                |
| メール配送事業者・外部log・browser保持期間の確認 | Phase 0で調査開始                                               | `/privacy` 文言確定・本番公開前                                                   | security/privacy運用記録                                                           |

### その他の品質タスク

- [ ] エラートラッキング・構造化ログ導入（500通知・requestId・個人情報除外）
- [ ] ダークモード対応（OS設定追従 + トグルボタン）
- [ ] レスポンシブデザイン確認・修正（PC/タブレット/スマホ）
- [ ] アクセシビリティ確認（キーボード操作・スクリーンリーダー）
- [ ] プライバシーポリシーページ `/privacy`

## フェーズ12: デプロイ

- [x] Supabase staging・production project作成、東京region・Session pooler接続設定
- [-] 本番DBバックアップ・Prismaマイグレーション運用（Free plan暗号化backup・容量監視workflow実装中） — 計画書: [`docs/plans/audit-log-production-operations/plan.md`](plans/audit-log-production-operations/plan.md)
- [ ] Cloudflare Workers wrangler.toml + @prisma/adapter-cloudflare 設定・デプロイ
- [ ] APIレート制限の本番適用継続（Workers専用entrypoint・SQLite-backed Durable Object・WAF・staging/production実機確認） — 計画書: [`docs/plans/api-rate-limit-production/plan.md`](plans/api-rate-limit-production/plan.md)（フェーズ11先行実装の続き）
- [ ] Vercel SvelteKit デプロイ・環境変数設定
- [ ] GitHub Actions CI/CD 設定（本番マイグレーション → APIデプロイ → フロントデプロイ）
- [ ] npm audit・本番環境動作確認（ログイン/ゲーム/メール）
