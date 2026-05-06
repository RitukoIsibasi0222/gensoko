# Gensoko（元素庫）

元素記号を楽しく覚えるための学習Webアプリ

---

## ドキュメント構成

| ファイル | 内容 |
|---------|------|
| [docs/01_features.md](docs/01_features.md) | 機能仕様（画面・ゲームルール） |
| [docs/02_security.md](docs/02_security.md) | セキュリティ仕様 |
| [docs/03_data_model.md](docs/03_data_model.md) | データベース設計 |
| [docs/04_api.md](docs/04_api.md) | APIエンドポイント設計 |
| [docs/05_progress.md](docs/05_progress.md) | 実装進捗管理 |
| [docs/06_libraries.md](docs/06_libraries.md) | 使用ライブラリ一覧と解説 |
| [docs/07_conventions.md](docs/07_conventions.md) | コード規約・命名ルール |
| [docs/08_dev_setup.md](docs/08_dev_setup.md) | 開発環境セットアップ手順 |

---

## 技術スタック

| レイヤー | 技術 | 役割 |
|---------|------|------|
| フロントエンド | SvelteKit + TypeScript + Tailwind CSS | 画面の構築 |
| バックエンド | Hono (TypeScript / Node.js) | APIサーバー・ゲームロジック |
| データベース | PostgreSQL + Prisma ORM | データ保存 |
| 認証 | hono/jwt + bcryptjs | JWTトークン認証・パスワードハッシュ |
| 開発環境 | Docker / Docker Compose | 全員が同じ環境で開発できる仕組み |
| バージョン管理 | GitHub（プライベートリポジトリ） | コード管理 |
| 公開（フロント） | Vercel | 無料・自動デプロイ |
| 公開（API） | Cloudflare Workers | 無料・スリープなし |
| 公開（DB） | Supabase | 無料枠あり |

---

## プロジェクト概要

- **対象ユーザー**: 元素記号を覚えたい学習者（中学生〜大人）
- **公開形態**: 一般公開Webアプリ（アカウント登録制）
- **コア機能**: 元素一覧・4択ゲーム・苦手管理・学習履歴

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-05-06 | 仕様書初版作成 |
| 2026-05-06 | バックエンドをLaravel→Honoに変更、インフラをVercel+Cloudflare Workers+Supabaseに変更 |
