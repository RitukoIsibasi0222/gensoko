# Gensoko 実装タスク一覧

> 更新日: 2026-05-06
> ステータス: `[ ]` 未実装 / `[-]` 実装中 / `[x]` 完了

---

## 設計決定（実装前に確定した事項）

| # | 内容 | 決定 |
|---|------|------|
| 設計決定1 | 習得バッジ用「どの元素が習得済みか」の追跡方法 | **GameAnswer集計方式**（新テーブルなし）。`POST /game/sessions` 時に直近2ゲーム連続正解を集計して `UserStats.masteredCount` を更新。`GET /elements` は認証時に `isMastered: boolean` を付与 |
| 設計決定2 | `GET /game/questions` → `POST /game/sessions` 間の正解一時保持 | **GameQuestionSetテーブル方式**。`GET /game/questions` でDBに正解情報と有効期限（30分）を保存し `questionSetId` を返す。`POST /game/sessions` で受け取り正誤判定後削除 |

---

## フェーズ1: セットアップ

- [x] GitHubリポジトリ作成・.gitignore・初回push
- [x] Docker Compose起動（hono/sveltekit/postgres/mailpit）※sveltekitはport 5174
- [x] backend .env 作成（DATABASE_URL / JWT_SECRET / MAIL等）
- [x] backend package.json・tsconfig.json 作成
- [x] Prismaスキーマ定義・マイグレーション実行
- [x] 元素シードデータ作成・投入（prisma/seed.ts・118元素）
- [x] 元素モデルに由来フィールド追加（etymology）+ シードデータ更新
- [x] src/index.ts 作成・Honoサーバー起動確認
- [x] GameQuestionSet スキーマ追加・マイグレーション（設計決定2 対応）
- [x] backend src/ ファイル構造作成（routes/ services/ middleware/ lib/ types/）
- [x] lib/prisma.ts（シングルトン）+ lib/mail.ts 実装
- [x] .env.example 作成（backend・frontend両方）
- [x] SvelteKitプロジェクト作成（TypeScript + Tailwind CSS）
- [x] ESLint / Prettier 設定（backend・frontend両方）

## フェーズ2: バックエンド認証

- [x] JWT認証ミドルウェア（middleware/auth.ts）
- [ ] Adminロールチェックミドルウェア（middleware/admin.ts）
- [ ] POST /auth/register（Zod検証・bcrypt・メール認証tokenHash保存）
- [ ] POST /auth/verify-email（tokenHash検証・有効期限・使用済削除）
- [ ] POST /auth/login（JWT発行・ブルートフォースロック・UserStats streak更新）
- [ ] POST /auth/refresh（HttpOnly Cookieリフレッシュトークン）
- [ ] POST /auth/logout（DBからRefreshToken削除）
- [ ] POST /auth/forgot-password + /auth/reset-password（1時間有効・全token無効化）

## フェーズ3: 元素・ゲーム・苦手 API

- [ ] GET /elements（keyword・category・period検索・isMastered付与【設計決定1】）
- [ ] GET /elements/:id
- [ ] GET /game/questions（ランダム10問・4択生成・GameQuestionSet保存・苦手5問未満チェック【設計決定2】）
- [ ] POST /game/sessions（questionSetId受信・正誤判定・スコア計算・苦手自動更新・consecutiveHit・masteredCount更新【設計決定1・2】）
- [ ] GET /game/sessions（ゲーム履歴一覧）
- [ ] GET /weak + DELETE /weak/:elementId

## フェーズ4: ユーザー・ランキング・管理者 API

- [ ] GET /users/me + PATCH /users/me + DELETE /users/me
- [ ] GET /users/me/stats
- [ ] GET /ranking/weekly + /alltime（myRankフィールド・Top50）
- [ ] 週間スコアリセットバッチ処理（weeklyScoreリセット）
- [ ] Admin APIs（ユーザー一覧/詳細/停止/ロール変更/強制退会/統計）
- [ ] 管理者作成CLIコマンド（UI登録不可・環境変数両対応）
- [ ] 監査ログ実装（ログイン/PW変更/管理者操作・個人情報除外）

## フェーズ5: セキュリティ基盤

- [ ] セキュリティヘッダーミドルウェア（CSP/HSTS/X-Frame-Options/nosniff等）
- [ ] APIレート制限ミドルウェア（認証系10req/10min・一般60req/1min）
- [ ] CORS設定（ホワイトリスト・開発/本番分岐）

## フェーズ6: フロントエンド共通

- [ ] SvelteKitルーティング・共通レイアウト・frontend .env
- [ ] 認証Store（Svelteストア + sessionStorage・Bearerトークン管理）
- [ ] APIクライアント関数実装（lib/api/各ファイル）

## フェーズ7: アカウント管理ページ

- [ ] ログインページ（/login）
- [ ] ユーザー登録ページ（/register）・メール認証完了ハンドリング
- [ ] パスワードリセットページ（/reset-password）
- [ ] プロフィール設定ページ（/settings）・アカウント削除確認モーダル

## フェーズ8: 元素一覧ページ

- [ ] 元素一覧ページ（/elements）カードグリッド・分類色分け
- [ ] 検索・フィルター機能（キーワード・分類・周期）
- [ ] 元素詳細モーダルコンポーネント
- [ ] 習得状態バッジ表示（ログイン時のみ・未学習/学習中/習得【設計決定1】）

## フェーズ9: ゲームページ

- [ ] ゲームモード選択画面（/game）・苦手5問未満ガード表示
- [ ] ゲームプレイ画面（/game/play）インジケーター・15秒タイマー・4択・正誤フィードバック・1〜4キーボード操作
- [ ] ゲーム結果画面（/game/result）スコア・連続正解・間違え一覧
- [ ] ゲーム中断・再開機能（sessionStorage保存・再訪問時プロンプト）

## フェーズ10: その他ページ

- [ ] 苦手リスト画面（/weak）ソート（回数順/日時順）・手動削除
- [ ] マイページ・統計画面（/mypage）折れ線グラフ（chart.js）・サマリーカード
- [ ] ランキングページ（/ranking）週間・全期間・自分の順位表示
- [ ] 管理者ダッシュボード（/admin）ユーザー一覧・管理UI
- [ ] ダークモード対応（OS設定追従 + トグルボタン）
- [ ] レスポンシブデザイン確認・修正（PC/タブレット/スマホ）
- [ ] アクセシビリティ確認（キーボード操作・スクリーンリーダー）
- [ ] プライバシーポリシーページ（/privacy）

## フェーズ11: デプロイ

- [ ] Supabaseプロジェクト作成・接続URL取得
- [ ] Cloudflare Workers wrangler.toml + @prisma/adapter-cloudflare 設定・デプロイ
- [ ] Vercel SvelteKit デプロイ・環境変数設定
- [ ] GitHub Actions CI/CD 設定（自動デプロイ）
- [ ] npm audit・本番環境動作確認（ログイン/ゲーム/メール）
