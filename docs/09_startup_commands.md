# 開発開始時のコマンド一覧

> エディタを立ち上げたら、まずこのファイルを確認する

---

## 1. Docker 起動

```bash
cd ~/labs/Gensoko

# 初回のみ（または node_modules ボリュームを削除した直後）
docker compose run --rm hono npm ci
docker compose run --rm sveltekit npm ci

# Prisma Client の再生成（初回・依存更新・schema変更・DB変更を含むbranch切替後に実行）
docker compose run --rm hono npx prisma generate

# 全サービス起動（初回 or 停止後）
docker compose up -d

# 起動確認
docker compose ps
```

| サービス    | 説明                       | ポート                          |
| ----------- | -------------------------- | ------------------------------- |
| `hono`      | バックエンド API (Hono)    | http://localhost:3000           |
| `sveltekit` | フロントエンド (SvelteKit) | http://localhost:5174           |
| `postgres`  | データベース (PostgreSQL)  | localhost:5432（HTTP ではない） |
| `mailpit`   | メール確認 UI              | http://localhost:8025           |

---

## 2. 動作確認 URL

| 確認内容           | URL                                 |
| ------------------ | ----------------------------------- |
| API ヘルスチェック | http://localhost:3000/api/v1/health |
| API ルート         | http://localhost:3000/              |
| フロントエンド     | http://localhost:5174               |
| メール受信確認     | http://localhost:8025               |

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

# 監査ログの実DB rollback test（Docker PostgreSQL限定）
docker compose exec -T hono sh -lc 'AUDIT_INTEGRATION_DATABASE_URL="$DATABASE_URL" npm run test:integration:audit'

# 監査ログcleanupの実DB test（専用DBの作成・migration手順はdocs/07_testing_flow.mdを参照）
docker compose exec -T \
  -e AUDIT_CLEANUP_INTEGRATION_DATABASE_URL=postgresql://gensoko:secret@postgres:5432/gensoko_audit_cleanup_test \
  hono npm run test:integration:audit-cleanup

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

### 監査ログcleanupの手動確認

監査ログcleanup専用CLIは引数なしまたは`--dry-run`でpreviewだけを行う。保持日数は必須で、cleanup無効時もdry-runは実行できる。

    cd ~/labs/Gensoko

    # 推奨: dry-run（期限超過件数・cutoff・最低実行回数を確認し、削除しない）
    docker compose exec \
      -e AUDIT_LOG_RETENTION_DAYS=365 \
      -e AUDIT_LOG_CLEANUP_ENABLED=false \
      hono npm run cleanup:audit-logs -- --dry-run

    # 実削除: 保持期間・承認者・通知先・backup確認後だけ実行する
    docker compose exec \
      -e AUDIT_LOG_RETENTION_DAYS=365 \
      -e AUDIT_LOG_CLEANUP_ENABLED=true \
      hono npm run cleanup:audit-logs -- --execute

- 365日は暫定値であり、本番の正式承認前に`AUDIT_LOG_CLEANUP_ENABLED=true`へ変更しない
- `--execute`を指定してもcleanup有効設定が`false`なら削除せずskipする
- dry-runと本実行のログに監査ログID・内部ID・メール・username・生DB errorは出ない
- 最大10,000件または8分到達後も期限超過rowが残る場合は終了code 1になる。原因確認後に再実行する

backend/.env の DATABASE_URL は Docker Compose 内ホスト名 postgres を使うため、ホスト側の cd backend && npm run reset:weekly-scores は標準手順にしない。

### 定期バッチ wrapper の手動確認

GitHub Actions schedule と同じ入口を Docker 内で確認する場合は、BATCH_CRON を指定して npm run batch:scheduled を実行する。

    cd ~/labs/Gensoko

    # 週間スコアリセット相当（UTC 日曜 15:07 = JST 月曜 00:07）
    docker compose exec -e BATCH_CRON='7 15 * * 0' hono npm run batch:scheduled

    # 期限切れ GameQuestionSet cleanup 相当（毎時17分/47分（30分ごと））
    docker compose exec -e BATCH_CRON='17,47 * * * *' hono npm run batch:scheduled

    # 監査ログcleanup相当（UTC毎日18:37 = JST毎日03:37）
    docker compose exec \
      -e BATCH_CRON='37 18 * * *' \
      -e AUDIT_LOG_RETENTION_DAYS=365 \
      -e AUDIT_LOG_CLEANUP_ENABLED=false \
      hono npm run batch:scheduled

GitHub Actionsではworkflow_dispatchで最初に`target_environment`を選び、次に`weekly-reset`、`game-question-set-cleanup`、`audit-log-cleanup-dry-run`、`audit-log-cleanup-execute`を選択する。手動実行の既定は`staging`、scheduleは`production`である。監査ログの本実行は、選択したEnvironmentの`AUDIT_LOG_CLEANUP_ENABLED=true`が設定された場合だけ削除する。T19の確認では必ず`staging`を選び、`production`はrelease gate完了前に選択しない。

T19の期限境界確認はActionsの`Staging Audit Cleanup Fixtures`から`prepare`、`verify-cleaned`、`remove`を使用する。このworkflowは`staging`固定であり、`AUDIT_LOG_STAGING_FIXTURES_ENABLED=true`を検証中だけ設定する。実行順序と停止・後片付けは`docs/11_deployment.md`の「T19 staging fixtureによる境界・再実行・停止確認」に従い、ローカルshellやSupabase SQL Editorへ`DATABASE_URL`やfixture SQLを貼り付けない。

### production DB operation

本番DBの容量確認・backup・migrationはローカルshellから接続せず、Actionsの`Production Database Operations`を`develop` branchで実行する。

| operation        | 入力                      | 実行条件                                                         |
| ---------------- | ------------------------- | ---------------------------------------------------------------- |
| `capacity-check` | なし                      | 500MB（500,000,000 bytes）quotaに対する70%・85%閾値を確認        |
| `backup`         | なし                      | production Environmentに`BACKUP_ENCRYPTION_PASSPHRASE`が設定済み |
| `migrate-deploy` | `confirmed_backup_run_id` | 24時間以内に成功した`backup` run IDを指定                        |

backup ArtifactにはAES-256暗号化済みarchiveとSHA-256だけが含まれる。平文dump、`DATABASE_URL`、DB password、暗号化passphraseをActions log・Issue・PR・チャットへ貼らない。download・復号・復元手順は`docs/11_deployment.md`の「backupの手動実行と復元」に従う。

---

## 6. 管理者作成 CLI

管理者アカウントは UI や公開 API から作成せず、信頼された運用者が Docker Compose の `hono` コンテナ内で CLI を実行して作成する。

実行方法と入力項目を確認する場合は、DB 接続や作成処理を行わない `--help` を使用する。

    cd ~/labs/Gensoko
    docker compose exec hono npm run admin:create -- --help

### 推奨: 環境変数を一時的に渡す

    cd ~/labs/Gensoko

    (
      read -r -p "管理者ユーザー名: " ADMIN_USERNAME
      read -r -p "管理者メールアドレス: " ADMIN_EMAIL
      read -r -s -p "管理者パスワード: " ADMIN_PASSWORD
      printf "\n"

      export ADMIN_USERNAME ADMIN_EMAIL ADMIN_PASSWORD

      docker compose exec \
        -e ADMIN_USERNAME \
        -e ADMIN_EMAIL \
        -e ADMIN_PASSWORD \
        hono npm run admin:create
    )

- `--username`、`--email`、`--password` でも指定できるが、特にpasswordはshell historyやprocess listへ残る可能性があるため非推奨。引数でpasswordを指定するとCLIが警告する。
- 引数方式を避けられない場合は、npm自身が引数をechoしないよう `npm --silent run admin:create -- ...` を使う。ただし、shell historyやprocess listのリスクは解消されない。
- 引数と環境変数を混在させた場合は項目単位で引数を優先する。
- 管理者認証情報を `.env`、Compose file、repository、CI logへ保存しない。
- 入力と実行をsubshellの `(...)` 内に閉じ込めているため、正常終了・エラー・割り込みのいずれでも親shellに管理者認証情報を残さない。
- 環境変数方式も同一OS userからのprocess参照に対して完全な秘密保護ではないため、共有ホストでは実行しない。
- Dockerコンテナ操作権限とDB接続環境を持つ主体は、管理者作成権限を持つものとして扱う。
- 既存ユーザーとusernameまたはemailが重複した場合は失敗し、既存ユーザーのrole・password・状態は変更しない。

終了codeは、成功とhelpが `0`、重複・DB・実行時エラーが `1`、引数・入力validationエラーが `2`。

作成成功後にDB接続の終了処理だけが失敗した場合は、管理者は作成済みなので終了code `0`を維持する。警告に従って再実行せず、コンテナとDBの接続状態を確認する。

---

## 7. Prisma コマンド

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

## 8. Git ブランチ操作

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

## 9. Docker 停止・リセット

```bash
# コンテナ停止（データは保持）
docker compose stop

# コンテナ削除（データは保持）
docker compose down

# DB ボリュームごと削除（データリセット）
docker compose down -v
```
