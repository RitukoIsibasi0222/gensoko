# 実装進捗管理

> 更新日: 2026-05-06
> ステータス: `[ ]` 未実装 / `[-]` 実装中 / `[x]` 完了

---

## フェーズ1: プロジェクトセットアップ

- [ ] GitHubプライベートリポジトリ作成
- [ ] Docker Compose セットアップ（hono / sveltekit / postgres / mailpit）
- [ ] Honoプロジェクト作成（TypeScript + tsx）
- [ ] Prismaセットアップ・DBスキーマ定義（`03_data_model.md`のスキーマをコピー）
- [ ] マイグレーション実行（`npx prisma migrate dev`）
- [ ] 元素データの初期シードデータ作成（118元素分）・投入
- [ ] SvelteKitプロジェクト作成（TypeScript + Tailwind CSS）
- [ ] 各プロジェクトにESLint / Prettier 設定
- [ ] `.gitignore` 作成（`.env` が含まれていることを確認）

## フェーズ2: 認証基盤（Hono + hono/jwt + bcryptjs）

- [ ] ユーザー登録API（`POST /api/v1/auth/register`）
- [ ] メール認証API（`POST /api/v1/auth/verify-email`）・Mailpitで確認
- [ ] ログインAPI（`POST /api/v1/auth/login`）・JWTトークン発行
- [ ] 認証ミドルウェア（`Authorization: Bearer <token>` の検証）
- [ ] ログアウトAPI（`POST /api/v1/auth/logout`）・DBのトークン削除
- [ ] パスワードリセット（`POST /api/v1/auth/forgot-password` / `reset-password`）
- [ ] 管理者ロールチェックミドルウェア（`role === "ADMIN"`）

## フェーズ3: 元素一覧ページ

- [ ] 元素一覧APIの実装（`GET /elements`）
- [ ] 元素一覧ページ（`/elements`）UI実装
  - [ ] カードグリッドレイアウト
  - [ ] 分類による色分け
  - [ ] 検索・フィルター機能
- [ ] 元素詳細モーダルコンポーネント
- [ ] 習得状態バッジ表示（ログイン時）

## フェーズ4: ゲーム機能

- [ ] 問題セット取得API（`GET /game/questions`）
  - [ ] ランダム選出ロジック（重複なし・難易度帯フィルター）
  - [ ] 4択選択肢生成ロジック
- [ ] ゲーム結果保存API（`POST /game/sessions`）
  - [ ] サーバーサイドスコア計算
  - [ ] 苦手リスト自動更新
  - [ ] UserStats 更新
- [ ] ゲームモード選択画面（`/game`）
- [ ] ゲームプレイ画面（`/game/play`）
  - [ ] 問題インジケーター
  - [ ] カウントダウンタイマー
  - [ ] 4択ボタン
  - [ ] 正誤フィードバック表示
  - [ ] キーボード操作（1〜4キー）
- [ ] ゲーム結果画面（`/game/result`）
- [ ] ゲーム中断・再開機能（sessionStorage）

## フェーズ5: 苦手管理・統計

- [ ] 苦手リストAPI（`GET /weak` / `DELETE /weak/:id`）
- [ ] 苦手リスト画面（`/weak`）
- [ ] マイページ・統計画面（`/mypage`）
  - [ ] 正答率グラフ（折れ線グラフ）
  - [ ] 統計サマリーカード
- [ ] ゲーム履歴API（`GET /game/sessions`）

## フェーズ6: アカウント管理

- [ ] ログイン画面（`/login`）
- [ ] ユーザー登録画面（`/register`）
- [ ] プロフィール設定画面（`/settings`）
  - [ ] ユーザー名変更
  - [ ] パスワード変更
  - [ ] アカウント削除
- [ ] パスワードリセット画面（`/reset-password`）

## フェーズ7: ランキング

- [ ] ランキングAPI（`GET /ranking/weekly` / `alltime`）
- [ ] ランキング画面（`/ranking`）
- [ ] 週間スコアリセットバッチ処理

## フェーズ8: 管理者機能

- [ ] 管理者ルート保護（`/admin`以下を管理者のみに制限）
- [ ] ユーザー一覧・検索API（`GET /admin/users`）
- [ ] ユーザー操作API（停止・ロール変更・強制退会）
- [ ] 管理者ダッシュボード画面

## フェーズ9: セキュリティ強化・UI改善

- [ ] セキュリティヘッダーの設定（CSP / HSTS / X-Frame-Options 等）
- [ ] APIレート制限の実装
- [ ] ブルートフォース対策（ログイン失敗ロック）
- [ ] ダークモード対応
- [ ] レスポンシブデザインの確認・修正
- [ ] アクセシビリティ確認（キーボード操作・スクリーンリーダー）
- [ ] プライバシーポリシーページ（`/privacy`）

## フェーズ10: 本番環境デプロイ

- [ ] Supabase プロジェクト作成・接続URL取得
- [ ] Vercel にSvelteKitをデプロイ・環境変数設定
- [ ] Cloudflare Workers に Hono APIをデプロイ（`wrangler deploy`）
- [ ] Wrangler Secrets に `DATABASE_URL` / `JWT_SECRET` を設定
- [ ] CORS設定の本番URL確認
- [ ] GitHub Actions の CI/CD 設定（自動デプロイ）
- [ ] 本番環境での動作確認（ログイン・ゲーム・メール送信）
- [ ] `npm audit` で脆弱性チェック

---

## 直近の作業ログ

| 日付 | 作業内容 |
|------|---------|
| 2026-05-06 | 仕様書初版作成 |
| 2026-05-06 | バックエンドをLaravel→Hono(TypeScript)に変更、インフラをVercel+Cloudflare Workers+Supabaseに変更 |
