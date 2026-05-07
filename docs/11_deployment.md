# デプロイ・インフラ設計書

---

## 全体構成

```
┌─────────────────────────────────────────────────────┐
│                   インターネット                        │
└──────────┬────────────────────┬──────────────────────┘
           │ 画面にアクセス         │ APIにアクセス
           ▼                    ▼
  ┌─────────────────┐   ┌───────────────────────┐
  │     Vercel       │   │  Cloudflare Workers    │
  │  SvelteKit       │──▶│  Hono API (TypeScript) │
  │  （フロントエンド）│   │  （バックエンドAPI）    │
  └─────────────────┘   └──────────┬────────────┘
                                    │ SQL (Prisma)
                                    ▼
                         ┌──────────────────────┐
                         │      Supabase         │
                         │  PostgreSQL (DB)      │
                         └──────────────────────┘
```

| サービス | 役割 | 費用 |
|---------|------|------|
| **Vercel** | SvelteKitの画面を配信 | **完全無料**（個人利用） |
| **Cloudflare Workers** | Hono APIサーバー | **完全無料**（日10万リクエストまで） |
| **Supabase** | PostgreSQLデータベース | **無料枠あり**（500MB・2プロジェクト） |

> ✅ スリープなし。全サービスGitHubと連携して自動デプロイ。

---

## 各サービスの説明

### Vercel（フロントエンド）

- SvelteKitと作った会社が同じため相性が最高
- GitHubにpushするだけで数十秒で自動デプロイ
- 独自ドメインも無料で設定可能

### Cloudflare Workers（バックエンド API）

- 世界中に分散したサーバーで動く → 日本からも高速
- **スリープなし**（Renderなどの無料プランと違い、最初のアクセスでも遅くならない）
- Honoは Cloudflare Workers での動作に最適化されている

> ⚠️ **注意点**: Cloudflare Workers は Node.js の一部APIが使えません。
> Prisma は `@prisma/adapter-cloudflare` 経由で接続します（後で設定します）。
> 開発中は Docker 上の通常の Node.js で動かして、本番だけ Workers にデプロイします。

### Supabase（データベース）

- PostgreSQLをホストしてくれるサービス
- Web画面でDBの中身をブラウザで確認・編集できる
- 接続URLを発行してくれるので、Prismaにそのまま設定できる

---

## ドメイン設計

### 開発環境（ローカル）

| サービス | URL |
|---------|-----|
| SvelteKit | `http://localhost:5173` |
| Hono API | `http://localhost:3000` |
| DB（Prisma Studio） | `http://localhost:5555` |
| メール確認 | `http://localhost:8025` |

### 本番環境

| サービス | URL例 |
|---------|-------|
| SvelteKit | `https://gensoko.vercel.app`（または独自ドメイン） |
| Hono API | `https://gensoko-api.あなたのユーザー名.workers.dev` |

> 💡 独自ドメイン（例: `gensoko.com`）を取得した場合：
> - `gensoko.com` → Vercel（フロントエンド）
> - `api.gensoko.com` → Cloudflare Workers（API）
> 独自ドメインはどちらのサービスも無料で設定できます。

---

## CORS（クロスオリジン）設定

別ドメイン間の通信を許可するため、Honoに CORS ミドルウェアを設定します。

`backend/src/index.ts`:
```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

app.use('*', cors({
  origin: [
    'https://gensoko.vercel.app',  // 本番フロントエンド
    'http://localhost:5173',        // 開発フロントエンド
  ],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));

export default app;
```

---

## Vercel へのデプロイ手順

### 1. Vercel アカウント作成

1. https://vercel.com にアクセス
2. 「Sign Up」→「Continue with GitHub」
3. GitHubアカウントと連携

### 2. プロジェクトをインポート

1. Vercelダッシュボードで「Add New Project」
2. GitHubリポジトリ `gensoko` を選択
3. 設定:
   - **Framework Preset**: SvelteKit（自動検出）
   - **Root Directory**: `frontend`
4. 「Deploy」をクリック

### 3. 環境変数を設定

Vercelダッシュボード → Settings → Environment Variables：

```
VITE_API_URL = https://gensoko-api.あなたのユーザー名.workers.dev
```

---

## Cloudflare Workers へのデプロイ手順

### 1. Cloudflare アカウント作成

1. https://cloudflare.com にアクセス
2. 「Sign Up」でアカウント作成

### 2. Wranglerのインストール（Cloudflareのデプロイツール）

```bash
# ローカルPC（Dockerの外）で実行
npm install -g wrangler

# Cloudflareにログイン
wrangler login
```

### 3. `wrangler.toml` を作成（backendフォルダ）

```toml
name = "gensoko-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
FRONTEND_URL = "https://gensoko.vercel.app"
```

### 4. Supabaseの接続URLを Workers の Secret に設定

```bash
# 秘密情報はwrangler secretコマンドで設定（.envには書かない）
wrangler secret put DATABASE_URL
# → プロンプトでSupabaseの接続URLを貼り付ける

wrangler secret put JWT_SECRET
# → 本番用の強いランダム文字列を設定
```

### 5. デプロイ

```bash
cd backend
wrangler deploy
```

---

## Supabase のセットアップ手順

1. https://supabase.com にアクセス
2. 「Start your project」→ GitHubアカウントで登録
3. 「New Project」をクリック
4. 設定:
   - Project name: `gensoko`
   - Database Password: **強いパスワードを設定してメモしておく**
   - Region: Northeast Asia (Tokyo)
5. 作成完了後、「Settings」→「Database」→「Connection string」→「URI」をコピー

このURLを Cloudflare Workers の `DATABASE_URL` に設定します。

---

## GitHub Actions による自動デプロイ（CI/CD）

`.github/workflows/deploy.yml`:
```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-frontend:
    name: Deploy SvelteKit to Vercel
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          working-directory: frontend
          vercel-args: '--prod'

  deploy-backend:
    name: Deploy Hono to Cloudflare Workers
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install dependencies
        working-directory: backend
        run: npm install
      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          workingDirectory: backend
```

> `secrets.VERCEL_TOKEN` などは GitHub の「Settings > Secrets and variables > Actions」に登録します。

---

## 本番デプロイのチェックリスト

```
[ ] Supabaseプロジェクト作成・接続URLの取得
[ ] Vercelアカウント作成・プロジェクトインポート
[ ] Vercelに VITE_API_URL 環境変数を設定
[ ] Cloudflareアカウント作成・Wranglerインストール
[ ] wrangler.toml 作成
[ ] DATABASE_URL と JWT_SECRET を Wrangler Secrets に設定
[ ] wrangler deploy で初回デプロイ
[ ] GitHub Actions の Secrets 設定（CI/CD）
[ ] 本番環境での動作確認（ログイン・ゲーム・メール）
[ ] CORS設定の確認（フロントエンドのURLが正しく許可されているか）
```

| サービス | 役割 | 費用目安 |
|---------|------|---------|
| **Firebase Hosting** | SvelteKitの画面を配信 | 無料枠あり（月10GBまで） |
| **Railway** | LaravelのAPIサーバー | 月5〜10ドル程度 |
| **Railway** | PostgreSQLデータベース | 上記に含む |

---

## Firebase Hosting の基本知識

### できること・できないこと

| できること | できないこと |
|----------|------------|
| HTML / CSS / JS ファイルの配信 | PHP / Python / Ruby などのサーバー処理 |
| SvelteKit のビルド成果物を公開 | データベースの直接操作 |
| 独自ドメインの設定（無料） | Laravel を動かすこと |
| 世界中のCDNで高速配信 | |

### SvelteKit のビルド設定

Firebase Hosting に乗せるには SvelteKit を「静的サイト」としてビルドする必要があります。

`frontend/svelte.config.js` に以下を設定：
```javascript
import adapter from '@sveltejs/adapter-static';

export default {
  kit: {
    adapter: adapter({
      fallback: 'index.html'  // SPAとして動作させる設定
    })
  }
};
```

> ✅ `adapter-static` を使うと、SvelteKit が HTML/JS/CSS ファイルだけを出力します
> ✅ ページ移動やデータ取得はすべてブラウザ側で行い、Laravel API を呼び出します

---

## Railway の基本知識

### できること

- PHP + Laravel をそのまま動かせる
- PostgreSQL データベースをセットで管理できる
- GitHubと連携して、コードをpushすると自動デプロイ
- 環境変数（.env）をWeb画面から設定できる

### 初期設定手順（大まかな流れ）

```
1. railway.app でアカウント作成
2. 「New Project」→「Deploy from GitHub repo」
3. リポジトリの「backend/」フォルダを選択
4. 「Add Database」→「PostgreSQL」を追加
5. 環境変数を設定
6. デプロイ完了 → URLが発行される（例: gensoko-api.railway.app）
```

---

## ドメイン設計

### 開発環境（ローカル）

| サービス | URL |
|---------|-----|
| SvelteKit | `http://localhost:5173` |
| Laravel API | `http://localhost:80` |

### 本番環境

| サービス | URL | サービス |
|---------|-----|---------|
| SvelteKit | `https://gensoko.web.app`（または独自ドメイン） | Firebase Hosting |
| Laravel API | `https://gensoko-api.railway.app` | Railway |

> 💡 **独自ドメイン**（例: `gensoko.com`）を取得した場合：
> - `gensoko.com` → Firebase Hosting（フロントエンド）
> - `api.gensoko.com` → Railway（API）
> これにより URL が分かりやすくなります。独自ドメインは Firebase Hosting に無料で設定できます。

---

## 認証方式の変更（重要）

### なぜ変更が必要か

Laravel Sanctum の「SPA認証（Cookie方式）」は**同じドメイン上でしか動きません**。
Firebase Hosting（`gensoko.web.app`）と Railway（`gensoko-api.railway.app`）は**別ドメイン**なので、
Cookie方式ではなく**トークン方式**に変更します。

### 変更後の認証フロー

```
① ログイン
SvelteKit → POST /api/v1/auth/login → Laravel
         ← { "token": "1|xxxxxxxx" } を返す

② トークンを保存
SvelteKitの認証Storeにトークンを保持（メモリ内）
ページリロードに備えてsessionStorageにも保存

③ API呼び出し（ログイン後）
SvelteKit → GET /api/v1/elements
  リクエストヘッダーに: Authorization: Bearer 1|xxxxxxxx
         ← Laravel がトークンを検証して応答

④ ログアウト
SvelteKit → POST /api/v1/auth/logout
  Laravel側でトークンを削除
  SvelteKit側のStoreとsessionStorageもクリア
```

---

## CORS（クロスオリジン）設定

別ドメイン間の通信を許可するために Laravel の CORS 設定が必要です。

`backend/config/cors.php`:
```php
return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['*'],
    'allowed_origins' => [
        'https://gensoko.web.app',    // 本番フロントエンド
        'http://localhost:5173',       // 開発フロントエンド
    ],
    'allowed_headers' => ['*'],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => false,  // トークン方式なのでfalse
];
```

---

## Firebase CLIのセットアップ手順

### 1. インストール

```bash
# ローカルPC（Dockerの外）で実行
npm install -g firebase-tools

# Googleアカウントでログイン
firebase login
```

### 2. Firebase プロジェクト作成

1. https://console.firebase.google.com にアクセス
2. 「プロジェクトを追加」をクリック
3. プロジェクト名: `gensoko`
4. Google アナリティクス: スキップでOK

### 3. Firebase Hosting の初期化

```bash
# frontendフォルダで実行
cd frontend
firebase init hosting
```

対話形式で質問されます：
```
? What do you want to use as your public directory? build
? Configure as a single-page app? Yes
? Set up automatic builds with GitHub? Yes（後でも設定可）
```

`firebase.json` が生成されます：
```json
{
  "hosting": {
    "public": "build",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

### 4. デプロイ

```bash
# SvelteKitをビルド
npm run build

# Firebase Hostingにデプロイ
firebase deploy --only hosting
```

---

## GitHub Actions による自動デプロイ（CI/CD）

コードを `main` ブランチに push したら自動でデプロイする設定です。

`.github/workflows/deploy.yml`:
```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-frontend:
    name: Deploy SvelteKit to Firebase
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install & Build
        working-directory: frontend
        run: |
          npm install
          npm run build
        env:
          VITE_API_URL: ${{ secrets.VITE_API_URL }}
      - name: Deploy to Firebase
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          channelId: live
          projectId: gensoko

  # Railwayはpush時に自動デプロイされるので設定不要
```

> ✅ `secrets.VITE_API_URL` などの秘密情報は GitHub の「Settings > Secrets」に登録します
> ✅ Railway は GitHub と連携すると push 時に自動でデプロイされます（設定不要）

---

## 本番環境の環境変数まとめ

### SvelteKit（frontend/.env.production）

```env
# Laravelのデプロイ先URL（Railwayが発行したURL）
VITE_API_URL=https://gensoko-api.railway.app
```

> `VITE_` で始まる変数はブラウザから見えます。秘密情報を入れないこと。

### Laravel（Railwayの環境変数設定画面で入力）

```env
APP_NAME=Gensoko
APP_ENV=production
APP_DEBUG=false
APP_URL=https://gensoko-api.railway.app

DB_CONNECTION=pgsql
DB_HOST=（Railwayが自動で設定）
DB_PORT=5432
DB_DATABASE=（Railwayが自動で設定）
DB_USERNAME=（Railwayが自動で設定）
DB_PASSWORD=（Railwayが自動で設定）

FRONTEND_URL=https://gensoko.web.app
```

---

## デプロイまでのチェックリスト

```
[ ] Firebaseプロジェクト作成
[ ] Firebase CLIインストール・ログイン
[ ] firebase init hosting（frontendフォルダ）
[ ] adapter-static インストール・設定
[ ] Railwayアカウント作成
[ ] RailwayにGitHubリポジトリ連携
[ ] Railway に PostgreSQL 追加
[ ] Railwayの環境変数設定
[ ] CORS設定の更新
[ ] 認証をトークン方式に変更（Sanctum Personal Access Token）
[ ] GitHub Actions の secrets 設定
[ ] 本番環境での動作確認
```
