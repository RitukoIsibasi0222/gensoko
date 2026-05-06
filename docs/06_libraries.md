# 使用ライブラリ一覧

> 「なぜこのライブラリを使うのか」を合わせて記載しています

---

## バックエンド（Hono / TypeScript）

### 必須インストール

```bash
# backendフォルダで実行（プロジェクト作成後に追加）
npm install hono                        # APIフレームワーク
npm install @hono/node-server           # Node.jsで動かすため
npm install @prisma/client              # DB接続
npm install -D prisma                   # Prisma CLI（開発時のみ）
npm install bcryptjs                    # パスワードハッシュ
npm install hono/jwt                    # JWT認証（Hono組み込み）
npm install zod                         # 入力バリデーション
npm install @hono/zod-validator         # HonoでZodを簡単に使う
npm install nodemailer                  # メール送信
```

| パッケージ | 用途 | なぜ必要か |
|-----------|------|-----------|
| **hono** | APIフレームワーク | Expressの後継として人気。TypeScriptと相性抖れ。ルーティング・ミドルウェアを簡潔に書ける |
| **prisma** | ORM（DB操作） | SQLを直接書かずにデータを操作できる。型無刿安全。スキーマの変更も簡単 |
| **bcryptjs** | パスワードハッシュ | パスワードを安全な形式でDBに保存する。平文で保存するのは絶対にやってはいけない |
| **hono/jwt** | JWT認証 | Honoに組み込み。ログイン後のトークン発行・検証を簡単に実装できる |
| **zod** | 入力バリデーション | APIの入力値を型安全に検証。フロントエンドと同じライブラリを使い回せる |
| **@hono/zod-validator** | HonoとZodの連携 | リクエストのバリデーションをミドルウェアとして簡潔に書ける |
| **nodemailer** | メール送信 | メール認証・パスワードリセットのメールを送信する |

### 開発時のみ使うパッケージ

```bash
npm install -D tsx            # TypeScriptを直接実行（開発時のサーバー起動用）
npm install -D @types/bcryptjs # bcryptjsの型定義
npm install -D @types/nodemailer
npm install -D vitest          # テスト（後で追加でもOK）
```

---

## フロントエンド（SvelteKit / TypeScript）

### 必須インストール

```bash
# プロジェクト作成後に追加するパッケージ
npm install -D tailwindcss @tailwindcss/vite  # スタイリング
npm install zod                               # 入力バリデーション
npm install lucide-svelte                     # アイコン
npm install chart.js                          # グラフ描画
```

| パッケージ | 用途 | なぜ必要か |
|-----------|------|-----------|
| **tailwindcss** | CSSフレームワーク | クラス名を書くだけでデザインができる。初心者でもきれいなUIを作りやすい |
| **zod** | フォームのバリデーション | パスワードの文字数チェックなど、入力値の検証を型安全に書ける |
| **lucide-svelte** | アイコン | ✓ ✗ ⬅ などのアイコンをSVGで簡単に使える |
| **chart.js** | グラフ描画 | マイページの正答率グラフに使う |

### 開発時のみ使うパッケージ

```bash
npm install -D prettier prettier-plugin-svelte  # コード整形
npm install -D eslint @typescript-eslint/parser # コードチェック
npm install -D vitest @testing-library/svelte   # テスト（後で追加でもOK）
```

| パッケージ | 用途 | なぜ必要か |
|-----------|------|-----------|
| **prettier** | コード自動整形 | 保存時にインデントや改行を自動で揃えてくれる |
| **eslint** | コード品質チェック | バグになりやすいコードを書いたときに警告を出してくれる |
| **vitest** | ユニットテスト | ゲームのスコア計算など、ロジックが正しいか確認するテストを書く（最初は不要でも後で追加） |

---

## Docker内で使うミドルウェア

| サービス | 用途 |
|---------|------|
| **PostgreSQL 16** | データベース本体 |
| **Mailpit** | 開発用のメールサーバー。実際にメールを送らずに画面で確認できる |

---

## ライブラリのインストール順序（作業の流れ）

```
1. Dockerで環境を起動
2. Honoプロジェクト作成 → npm install
3. SvelteKitプロジェクト作成 → npm install
4. Prismaセットアップ → npx prisma init
5. bcryptjs・hono/jwtを追加
6. Tailwind・Zod・Lucideをフロントに追加
7. ESLint・Prettierを両プロジェクトに設定
```

> ✅ 一度に全部入れようとしないこと。フェーズごとに追加していくのが安全です
