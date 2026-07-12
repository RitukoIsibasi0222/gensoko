# 開発環境セットアップ手順

> Docker を使って「誰のPCでも同じ環境で動く」状態を作ります
> コマンドを上から順に実行すれば動きます

---

## ❓ GitHubとDockerどちらを先にするか

**答え: GitHubリポジトリが先**

```
❌ Docker先にやる問題
  PC上でファイルを作る
    → 後からGitに入れると履歴が汚れる
    → .env（パスワード入り）を誤ってコミットする事故が起きやすい

✅ GitHub先が正解
  リポジトリ作成（.gitignoreも同時に作る）
    → クローンしてからファイルを作る
    → 最初から「Gitで管理された状態」で開発できる
```

---

## プロジェクト開始の正しい順序

### 個人開発（このプロジェクト）

```
Step 1: GitHubでPrivateリポジトリ作成
Step 2: git clone でローカルに落とす
Step 3: .gitignore を作成してコミット・プッシュ   ← 最重要（.envを守る）
Step 4: docs/ フォルダをコミット・プッシュ（仕様書をGitHubに保管）
Step 5: docker-compose.yml など設定ファイルを作成・コミット
Step 6: docker compose up -d で起動・動作確認
Step 7: バックエンド・フロントエンドのプロジェクト作成
Step 8: 動いたことを確認してコミット
Step 9: 機能ごとにブランチを切って開発開始
```

### チーム開発（将来参加者が増えた場合）

```
リーダーが行う（1回だけ）
  └── 上記 Step 1〜8 を実施して main ブランチに積み上げる

メンバーが参加するとき（これだけで動く）
  $ git clone git@github.com:ユーザー名/gensoko.git
  $ cd gensoko
  $ docker compose up -d
  → 開発開始できる
```

> ✅ Dockerを使う最大の理由がこれです。`git clone` + `docker compose up -d` だけで
> 誰のPCでも同じ環境が立ち上がります。「自分のPCでは動くのに…」が起きなくなります。

---

## 今日やること（目安30分）

```
[ ] Step 1: GitHubでリポジトリ作成（Private）
[ ] Step 2: git clone
[ ] Step 3: .gitignore 作成・コミット・プッシュ
[ ] Step 4: docs/ をコミット・プッシュ（仕様書の保管完了）
[ ] Step 5: docker-compose.yml 作成
[ ] Step 6: docker compose up -d で起動確認
```

> Step 4 まで終わると「GitHubに仕様書が保管された状態」になります。
> まずそこをゴールにしましょう。

---

## 全体像

```
GitHub（プライベートリポジトリ）
  └── ローカルPC（クローン）
        └── Docker Compose
              ├── hono（Node.js 22 / バックエンドAPI：ポート3000）
              ├── sveltekit（Node.js 22 / フロントエンド：ポート5174）
              ├── postgres（データベース：ポート5432）
              └── mailpit（テスト用メール確認画面：ポート8025）
```

---

## 前提条件（インストール済みであること）

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Git](https://git-scm.com/)
- [VS Code](https://code.visualstudio.com/)

---

## GitHubリポジトリのセットアップ

### 1. GitHubでプライベートリポジトリを作成

1. GitHub（https://github.com）にログイン
2. 右上の「+」→「New repository」をクリック
3. 設定:
   - Repository name: `gensoko`
   - Visibility: **Private** ← 必ずプライベートを選択
   - Add a README file: **チェックしない**（後で追加するため）
4. 「Create repository」をクリック

### 2. ローカルにクローン

```bash
# SSH（推奨）または HTTPS どちらでもOK
git clone git@github.com:あなたのユーザー名/gensoko.git
cd gensoko
```

---

## プロジェクトの構成

```
gensoko/                       ← リポジトリのルート
├── docker-compose.yml         ← Docker全体の設定
├── backend/                   ← Honoプロジェクト（API）
│   ├── src/
│   ├── prisma/
│   ├── package.json
│   └── .env
├── frontend/                  ← SvelteKitプロジェクト
│   ├── src/
│   ├── package.json
│   └── .env
├── docs/                      ← 仕様書（このフォルダ）
└── .gitignore
```

---

## Dockerファイルの作成

### `docker-compose.yml`

```yaml
services:
  hono:
    image: node:22-alpine
    working_dir: /app
    ports:
      - "3000:3000"
    volumes:
      - ./backend:/app
    env_file:
      - ./backend/.env
    environment:
      - DATABASE_URL=postgresql://gensoko:secret@postgres:5432/gensoko
      - MAIL_HOST=mailpit
      - MAIL_PORT=1025
      - FRONTEND_URL=http://localhost:5174
      - RATE_LIMIT_STORE=memory
    command: sh -c "npm install && npm run dev"
    depends_on:
      - postgres

  sveltekit:
    image: node:22-alpine
    working_dir: /app
    ports:
      - "5174:5174"
    volumes:
      - ./frontend:/app
    environment:
      - VITE_API_BASE_URL=http://localhost:3000/api/v1
    command: sh -c "npm install && npm run dev -- --host"

  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: gensoko
      POSTGRES_USER: gensoko
      POSTGRES_PASSWORD: secret
    volumes:
      - postgres_data:/var/lib/postgresql/data

  mailpit:
    image: axllent/mailpit
    ports:
      - "8025:8025"   # メール確認画面
      - "1025:1025"   # SMTPポート

volumes:
  postgres_data:
```

### `.gitignore`

```gitignore
# Node.js
backend/node_modules/
frontend/node_modules/
frontend/.svelte-kit/

# 環境変数（絶対にGitにあげない）
backend/.env
frontend/.env

# Prisma
backend/prisma/migrations/.gitkeep

# Docker
postgres_data/

# OS
.DS_Store
Thumbs.db
```

---

## 初回セットアップ手順

### 1. Dockerを起動

```bash
# プロジェクトルートで実行
docker compose up -d

# 起動確認（全サービスが「running」になればOK）
docker compose ps
```

### 2. Honoプロジェクト作成

```bash
# backendフォルダでHonoプロジェクトを初期化
docker compose exec hono sh -c "npm init -y && npm install hono @hono/node-server"

# TypeScript設定
docker compose exec hono npm install -D typescript tsx @types/node

# tsconfig.json を作成
docker compose exec hono sh -c "npx tsc --init"
```

`backend/package.json` の `scripts` に以下を追加：
```json
{
  "scripts": {
    "dev": "tsx watch --env-file=.env src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

### 3. Prismaのセットアップ

```bash
# Prismaインストール
docker compose exec hono npm install @prisma/client
docker compose exec hono npm install -D prisma

# Prisma初期化（prisma/schema.prisma が生成される）
docker compose exec hono npx prisma init
```

`backend/.env` を作成：
```env
DATABASE_URL="postgresql://gensoko:secret@postgres:5432/gensoko"
JWT_SECRET="開発用の適当な文字列（本番では必ず変更すること）"
MAIL_HOST="mailpit"
MAIL_PORT="1025"
MAIL_FROM="noreply@gensoko.local"
FRONTEND_URL="http://localhost:5174"
RATE_LIMIT_STORE="memory"
RATE_LIMIT_KEY_SECRET="<32バイト以上のランダム値をbase64化した文字列>"
```

#### ローカルのレート制限設定

developmentではプロセス内のmemory storeを使用する。これは本番用Durable Objectと同じstore契約を使うが、Docker再起動やbackend再起動でカウントはリセットされる。

秘密鍵は次のコマンドで生成し、Git管理外の `backend/.env` にだけ保存する。

```bash
openssl rand -base64 32
```

- backendの直接起動とDocker Composeは、どちらも `backend/.env` の同じ値を使用する。
- Docker Composeでは `env_file` で `backend/.env` を読み込み、コンテナ内だけ異なる値（`DATABASE_URL`など）は `environment` で上書きする。
- リポジトリルートにCompose補間用の `.env` を重複作成しない。
- `RATE_LIMIT_KEY_SECRET` はレート制限キー専用とし、`JWT_SECRET`を流用しない。
- `RATE_LIMIT_STORE=memory` はdevelopment/test専用である。productionでは `durable-object` 以外を起動時に拒否し、memory storeへfallbackしない。
- レート制限のIP取得に `TRUST_PROXY`、`X-Forwarded-For`、`X-Real-IP`は使用しない。Node developmentではsocket address、Workers productionでは検証済み `CF-Connecting-IP` を使う。
- ローカルの小さい上限値を環境変数で上書きしない。テストではpolicy/storeをdependency injectionし、本番policy定数を変更せず境界を確認する。

`backend/prisma/schema.prisma` に [docs/03_data_model.md](03_data_model.md) のスキーマをコピー後：
```bash
# マイグレーション実行（テーブル作成）
docker compose exec hono npx prisma migrate dev --name init

# 元素データを投入
docker compose exec hono npx tsx prisma/seed.ts
```

### 4. SvelteKitプロジェクト作成

```bash
# frontendフォルダでSvelteKitを作成
docker compose exec sveltekit sh -c "npm create svelte@latest . -- --template skeleton --types typescript --no-prettier --no-eslint --no-playwright"

# 依存関係インストール
docker compose exec sveltekit npm install

# adapter-staticインストール（Vercelへのデプロイ用）
docker compose exec sveltekit npm install -D @sveltejs/adapter-static
```

`frontend/.env` を作成：
```env
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

---

## 動作確認

| URL | 内容 |
|-----|------|
| http://localhost:3000 | Hono APIサーバー |
| http://localhost:5174 | SvelteKitのフロントエンド |
| http://localhost:8025 | Mailpit（送信したメールを確認） |

---

## よく使うコマンド

```bash
# Docker起動・停止
docker compose up -d        # バックグラウンドで起動
docker compose down         # 停止
docker compose down -v      # 停止 + DBデータも削除（初期化したいとき）

# Honoのコマンド（バックエンド）
docker compose exec hono npm install <パッケージ名>   # パッケージ追加
docker compose exec hono npx prisma migrate dev      # マイグレーション実行
docker compose exec hono npx prisma migrate reset    # DBをリセットして再構築
docker compose exec hono npx tsx prisma/seed.ts      # シードデータ投入
docker compose exec hono npx prisma studio           # DB内容をブラウザで確認（便利！）

# SvelteKitのコマンド（フロントエンド）
docker compose exec sveltekit npm install <パッケージ名>  # パッケージ追加
docker compose exec sveltekit npm run check              # TypeScript型チェック

# ログ確認
docker compose logs hono     # Honoのエラーログ
docker compose logs -f       # 全サービスのリアルタイムログ
```

> 💡 `npx prisma studio` はブラウザでDBの中身を確認・編集できるツールです。
> 開発中にデータを確認したいときに非常に便利です。

---

## VS Code 推奨拡張機能

`.vscode/extensions.json` をリポジトリに含めておくと、チームに自動で提案されます：

```json
{
  "recommendations": [
    "svelte.svelte-vscode",
    "bradlc.vscode-tailwindcss",
    "esbenp.prettier-vscode",
    "dbaeumer.vscode-eslint",
    "ms-azuretools.vscode-docker",
    "humao.rest-client",
    "Prisma.prisma"
  ]
}
```

| 拡張機能 | 役割 |
|---------|------|
| Svelte for VS Code | `.svelte`ファイルの補完・ハイライト |
| Tailwind CSS IntelliSense | Tailwindクラス名の補完 |
| Prettier | コード自動整形 |
| ESLint | コード品質チェック |
| Docker | DockerコンテナをVS Codeから管理 |
| REST Client | `.http`ファイルでAPIをテスト |
| Prisma | `schema.prisma`の補完・フォーマット |

---

## Dockerファイルの作成

### `docker-compose.yml`

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./backend:/var/www/html
      - ./docker/nginx/default.conf:/etc/nginx/conf.d/default.conf
    depends_on:
      - laravel

  laravel:
    build:
      context: .
      dockerfile: docker/php/Dockerfile
    volumes:
      - ./backend:/var/www/html
    environment:
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_DATABASE=gensoko
      - DB_USERNAME=gensoko
      - DB_PASSWORD=secret
      - MAIL_HOST=mailpit
      - MAIL_PORT=1025
    depends_on:
      - postgres

  sveltekit:
    image: node:22-alpine
    working_dir: /app
    ports:
      - "5173:5173"
    volumes:
      - ./frontend:/app
    command: sh -c "npm install && npm run dev -- --host"

  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: gensoko
      POSTGRES_USER: gensoko
      POSTGRES_PASSWORD: secret
    volumes:
      - postgres_data:/var/lib/postgresql/data

  mailpit:
    image: axllent/mailpit
    ports:
      - "8025:8025"   # メール確認画面
      - "1025:1025"   # SMTPポート

volumes:
  postgres_data:
```

### `docker/php/Dockerfile`

```dockerfile
FROM php:8.3-fpm

# 必要なPHP拡張をインストール
RUN apt-get update && apt-get install -y \
    git curl zip unzip \
    libpq-dev libzip-dev \
    && docker-php-ext-install pdo pdo_pgsql zip

# Composerをインストール
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html
```

### `docker/nginx/default.conf`

```nginx
server {
    listen 80;
    root /var/www/html/public;
    index index.php;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass laravel:9000;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }
}
```

### `.gitignore`

```gitignore
# Laravel
backend/.env
backend/vendor/
backend/storage/logs/
backend/storage/framework/cache/
backend/storage/framework/sessions/

# SvelteKit
frontend/node_modules/
frontend/.svelte-kit/
frontend/.env

# Docker
postgres_data/

# OS
.DS_Store
Thumbs.db
```

---

## 初回セットアップ手順

### 1. Dockerを起動

```bash
# プロジェクトルートで実行
docker compose up -d

# 起動確認（全サービスが「running」になればOK）
docker compose ps
```

### 2. Laravelプロジェクト作成

```bash
# Laravelをbackendフォルダに作成
docker compose exec laravel composer create-project laravel/laravel . --prefer-dist

# .envファイルをコピー
docker compose exec laravel cp .env.example .env

# アプリケーションキーを生成
docker compose exec laravel php artisan key:generate
```

### 3. Laravelの.envを編集

`backend/.env` の以下の部分を書き換える:

```env
DB_CONNECTION=pgsql
DB_HOST=postgres
DB_PORT=5432
DB_DATABASE=gensoko
DB_USERNAME=gensoko
DB_PASSWORD=secret

MAIL_MAILER=smtp
MAIL_HOST=mailpit
MAIL_PORT=1025
MAIL_FROM_ADDRESS=noreply@gensoko.local

FRONTEND_URL=http://localhost:5173
SANCTUM_STATEFUL_DOMAINS=localhost:5173
SESSION_DRIVER=cookie
SESSION_DOMAIN=localhost
```

### 4. Laravelの初期設定

```bash
# マイグレーション実行（テーブル作成）
docker compose exec laravel php artisan migrate

# Sanctumのインストール
docker compose exec laravel composer require laravel/sanctum
docker compose exec laravel php artisan vendor:publish --provider="Laravel\Sanctum\SanctumServiceProvider"
docker compose exec laravel php artisan migrate
```

### 5. SvelteKitプロジェクト作成

```bash
# frontendフォルダでSvelteKitを作成
docker compose exec sveltekit sh -c "npm create svelte@latest . -- --template skeleton --types typescript --no-prettier --no-eslint --no-playwright"

# 依存関係インストール
docker compose exec sveltekit npm install
```

---

## 動作確認

| URL | 内容 |
|-----|------|
| http://localhost | LaravelのAPIサーバー |
| http://localhost:5173 | SvelteKitのフロントエンド |
| http://localhost:8025 | Mailpit（送信したメールを確認） |

---

## よく使うコマンド

```bash
# Docker起動・停止
docker compose up -d        # バックグラウンドで起動
docker compose down         # 停止
docker compose down -v      # 停止 + DBデータも削除（初期化したいとき）

# Laravelのコマンド
docker compose exec laravel php artisan migrate          # マイグレーション実行
docker compose exec laravel php artisan migrate:fresh    # DBをリセットして再構築
docker compose exec laravel php artisan db:seed          # シードデータ投入
docker compose exec laravel php artisan make:model Element -mcr  # モデル+マイグレーション+コントローラー一括作成
docker compose exec laravel php artisan route:list       # ルート一覧確認
docker compose exec laravel php artisan tinker           # LaravelのREPL（動作確認に便利）

# SvelteKitのコマンド
docker compose exec sveltekit npm install <パッケージ名>  # パッケージ追加
docker compose exec sveltekit npm run check              # TypeScript型チェック

# ログ確認
docker compose logs laravel  # Laravelのエラーログ
docker compose logs -f       # 全サービスのリアルタイムログ
```

---

## VS Code 推奨拡張機能

`.vscode/extensions.json` をリポジトリに含めておくと、チームに自動で提案されます：

```json
{
  "recommendations": [
    "svelte.svelte-vscode",
    "bmewburn.vscode-intelephense-client",
    "bradlc.vscode-tailwindcss",
    "esbenp.prettier-vscode",
    "dbaeumer.vscode-eslint",
    "ms-azuretools.vscode-docker",
    "humao.rest-client"
  ]
}
```

| 拡張機能 | 役割 |
|---------|------|
| Svelte for VS Code | `.svelte`ファイルの補完・ハイライト |
| PHP Intelephense | PHPの補完・定義ジャンプ |
| Tailwind CSS IntelliSense | Tailwindクラス名の補完 |
| Prettier | コード自動整形 |
| ESLint | コード品質チェック |
| Docker | DockerコンテナをVS Codeから管理 |
| REST Client | `.http`ファイルでAPIをテスト |
