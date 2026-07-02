# 開発開始時のコマンド一覧

> エディタを立ち上げたら、まずこのファイルを確認する

---

## 1. Docker 起動

```bash
cd ~/labs/Gensoko

# 初回のみ（または node_modules ボリュームを削除した直後）
docker compose run --rm hono npm ci
docker compose run --rm sveltekit npm ci

# Prisma Client の再生成（初回・依存更新後に実行）
docker compose run --rm hono npx prisma generate

# 全サービス起動（初回 or 停止後）
docker compose up -d

# 起動確認
docker compose ps
```

| サービス | 説明 | ポート |
|---|---|---|
| `hono` | バックエンド API (Hono) | http://localhost:3000 |
| `sveltekit` | フロントエンド (SvelteKit) | http://localhost:5174 |
| `postgres` | データベース (PostgreSQL) | localhost:5432（HTTP ではない） |
| `mailpit` | メール確認 UI | http://localhost:8025 |

---

## 2. 動作確認 URL

| 確認内容 | URL |
|---|---|
| API ヘルスチェック | http://localhost:3000/api/v1/health |
| API ルート | http://localhost:3000/ |
| フロントエンド | http://localhost:5174 |
| メール受信確認 | http://localhost:8025 |

`postgres` の `5432` は DB 接続用ポートなので、ブラウザで開いても表示確認はできない。

---

## 3. ログ確認

```bash
# 全サービスのログをリアルタイムで表示
docker compose logs -f

# 特定サービスのログ（直近30行）
docker compose logs hono --tail=30
docker compose logs sveltekit --tail=30
```

---

## 4. バックエンド開発コマンド

```bash
cd ~/labs/Gensoko/backend

# テスト実行（1回）
npm run test -- --run

# テスト実行（ウォッチモード：ファイル変更で自動再実行）
npm run test -- --watch

# 特定ファイルのテストのみ
npm run test -- --run src/middleware/auth.test.ts

# Lint チェック
npm run lint

# Lint 自動修正
npm run lint:fix

# フォーマット確認
npm run format:check

# フォーマット適用
npm run format
```


---

## 5. 手動バッチ実行

    cd ~/labs/Gensoko

    # 週間スコアを現在週へ正規化する（Docker 内で実行すること）
    docker compose exec hono npm run reset:weekly-scores

    # 期限切れ GameQuestionSet を削除する（Docker 内で実行すること）
    docker compose exec hono npm run cleanup:game-question-sets

backend/.env の DATABASE_URL は Docker Compose 内ホスト名 postgres を使うため、ホスト側の cd backend && npm run reset:weekly-scores は標準手順にしない。

---

## 6. Prisma コマンド

```bash
cd ~/labs/Gensoko/backend

# マイグレーション実行（Docker 内で実行すること）
docker compose exec hono npx prisma migrate dev --name <変更名>

# DBの内容をブラウザで確認
docker compose exec hono npx prisma studio

# シードデータ再投入
docker compose exec hono npx tsx prisma/seed.ts
```

---

## 7. Git ブランチ操作

```bash
cd ~/labs/Gensoko

# 現在のブランチ確認
git branch --show-current

# develop を最新にする
git checkout develop && git pull origin develop

# 新しいフィーチャーブランチを切る
git checkout -b feature/xxx

# 変更をコミット
git add -A && git commit -m "feat: xxx"

# リモートに push（PR 作成後にマージ）
git push origin feature/xxx

# マージ済みブランチの掃除
git branch --merged develop | grep -v "develop\|main" | xargs git branch -d
```

---

## 8. Docker 停止・リセット

```bash
# コンテナ停止（データは保持）
docker compose stop

# コンテナ削除（データは保持）
docker compose down

# DB ボリュームごと削除（データリセット）
docker compose down -v
```
