# Gensoko 実装タスク一覧

> 更新日: 2026-07-05
> ステータス: `[ ]` 未実装 / `[-]` 実装中 / `[x]` 完了

---

## 設計決定（実装前に確定した事項）

| # | 内容 | 決定 |
|---|------|------|
| 設計決定1 | 習得バッジ用「どの元素が習得済みか」の追跡方法 | **GameAnswer集計方式**（新テーブルなし）。`GET /elements` は認証時に `masteryStatus: "unlearned" \| "learning" \| "mastered"` を付与。`POST /game/sessions` 時の `UserStats.masteredCount` 更新はフェーズ7で実装 |
| 設計決定2 | `GET /game/questions` → `POST /game/sessions` 間の正解一時保持 | **GameQuestionSetテーブル方式**。`GET /game/questions` でDBに正解情報と有効期限（30分）を保存し `questionSetId` を返す。`POST /game/sessions` で受け取り正誤判定後削除 |
| 設計決定3 | 本番DBマイグレーション運用 | GitHub Actions で本番デプロイ前に `prisma migrate deploy` を実行する。実行前に Supabase のバックアップ取得時刻を確認し、破壊的変更は expand/contract 方式で複数リリースに分ける |
| 設計決定4 | 本番レート制限の責務分担 | Cloudflare 側のエッジ制限と Hono ミドルウェアを併用する。認証系・一般APIに加え、`POST /game/sessions` はユーザーID/IP単位でより厳しく制限する |
| 設計決定5 | スキーマ確定時のインデックス設計 | `docs/03_data_model.md` のインデックス案を Prisma schema / migration に反映する。`GameQuestionSet` 期限切れ cleanup、ランキング、履歴、苦手リスト、token 期限検索を主要対象にする |

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
- [-] APIレート制限の本番設計・適用（認証系 / 一般API / `POST /game/sessions`） — 計画書: [`docs/plans/api-rate-limit-production/plan.md`](plans/api-rate-limit-production/plan.md)
- [ ] 監査ログ本番運用設計（保持期間・容量監視・cleanup・退会後の内部ID保持方針） — 計画書: [docs/plans/audit-log/plan.md](plans/audit-log/plan.md)
- [ ] エラートラッキング・構造化ログ導入（500通知・requestId・個人情報除外）
- [ ] ダークモード対応（OS設定追従 + トグルボタン）
- [ ] レスポンシブデザイン確認・修正（PC/タブレット/スマホ）
- [ ] アクセシビリティ確認（キーボード操作・スクリーンリーダー）
- [ ] プライバシーポリシーページ `/privacy`

## フェーズ12: デプロイ

- [ ] Supabase プロジェクト作成・接続 URL 取得
- [ ] 本番DBバックアップ・Prismaマイグレーション運用（`migrate deploy` 実行タイミング・ロールバック方針）
- [ ] Cloudflare Workers wrangler.toml + @prisma/adapter-cloudflare 設定・デプロイ
- [ ] Vercel SvelteKit デプロイ・環境変数設定
- [ ] GitHub Actions CI/CD 設定（本番マイグレーション → APIデプロイ → フロントデプロイ）
- [ ] npm audit・本番環境動作確認（ログイン/ゲーム/メール）
