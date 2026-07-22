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

# account deletionの実DB test（専用DBの作成・migration手順はdocs/07_testing_flow.mdを参照）
docker compose exec -T \
  -e ACCOUNT_DELETION_INTEGRATION_DATABASE_URL=postgresql://gensoko:secret@postgres:5432/gensoko_account_deletion_test \
  hono npm run test:integration:account-deletion

# account deletion contract migrationの実DB test（専用DBの作成・migration手順はdocs/07_testing_flow.mdを参照）
docker compose exec -T \
  -e ACCOUNT_DELETION_CONTRACT_DATABASE_URL=postgresql://gensoko:secret@postgres:5432/gensoko_account_deletion_contract_test \
  hono npm run test:integration:account-deletion-contract

# Lint チェック
npm run lint

# Lint 自動修正
npm run lint:fix

# フォーマット確認
npm run format:check

# フォーマット適用
npm run format
```

### フロントエンド開発・Vercel buildコマンド

```bash
cd ~/labs/Gensoko/frontend

# 全テストを1回実行
npm run test:run

# Vercel adapter・API URL・Build Output・CI契約testだけを実行
npm run test:run -- src/build-config.test.ts src/lib/api/base-url.test.ts src/vercel-build-output.test.ts src/frontend-pr-quality.test.ts

# Lint・Svelte/TypeScript check・非破壊フォーマット確認
npm run lint
npm run check
npm run format:check

# 外部接続しないfixtureでPreview buildと成果物契約を確認
env \
  VERCEL_ENV=preview \
  VERCEL_GIT_COMMIT_REF=develop \
  VITE_API_BASE_URL=https://staging-api.example.invalid/api/v1 \
  npm run build:preview
```

`VITE_API_BASE_URL`は`/api/v1`まで含む公開URLで、Vite build時にbrowser bundleへ埋め込まれる。buildでは未設定・空白・credential・query・fragment・契約外pathを拒否し、Vercel Preview/productionではHTTPSを必須にする。secret、token、DB接続文字列を設定しない。Vercel stagingではPreviewかつ`develop` branch scopeだけにstaging API URLを登録し、productionと値を共用しない。実URLの登録やPreview deployは[deployment runbook](11_deployment.md)の承認境界に従う。

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

    # 実削除: productionでは全release gate完了と承認内容の再確認後だけ実行する
    docker compose exec \
      -e AUDIT_LOG_RETENTION_DAYS=365 \
      -e AUDIT_LOG_CLEANUP_ENABLED=true \
      hono npm run cleanup:audit-logs -- --execute

- 正式保持期間は2026-07-14承認済みの365日で、runtimeのsource of truthは`AUDIT_LOG_RETENTION_DAYS`とする
- productionでは、公開後実負荷baseline、アカウント完全削除のproduction gate、削除保留承認者など全release gateの完了を記録し、承認内容を再確認するまで`AUDIT_LOG_CLEANUP_ENABLED=false`を維持する
- `--execute`を指定してもcleanup有効設定が`false`なら削除せずskipする
- dry-runと本実行のログに監査ログID・内部ID・メール・username・生DB errorは出ない

### refresh token cleanupの手動確認

`cleanup:refresh-tokens`は引数なしまたは`--dry-run`では件数確認だけを行い、削除しない。`--execute`でも`REFRESH_TOKEN_CLEANUP_ENABLED=true`がなければ安全側でskipする。

```bash
cd backend
npm run cleanup:refresh-tokens -- --dry-run

# 実削除は承認済みEnvironmentのmanual Batch Jobsだけで行う
REFRESH_TOKEN_CLEANUP_ENABLED=true npm run cleanup:refresh-tokens -- --execute
```

- ローカルshellへstaging/productionの`DATABASE_URL`を渡さない。production DBへの適用・cleanup実行はR15以降の別承認対象。
- 500件batch、1回1万件、8分上限。`expiresAt < cutoff`だけを削除し、token hash・ID・DB URLをlogしない。

### production Worker dry-run / auth smoke

```bash
# G1〜G8の非秘密値を承認後にだけ設定する。欠落・不一致時は固定errorで停止する
cd backend
npm run workers:production:dry-run

# R15 deploy後、R16の直前承認を得たmanual workflowだけで実行する
cd ../frontend
npm run test:e2e:production
```

- production Worker dry-runは実在hostname/resource IDをcommitせず、一時configを生成して削除する。deployは行わない。
- production smokeはtrace、screenshot、video、storageState、Cookie一覧を保存しない。
- このR5実装中はproduction deploy/workflow、production DB接続/migration、Secret参照、DNS/custom domain変更を実行しない。
- 最大10,000件または8分到達後も期限超過rowが残る場合は終了code 1になる。原因確認後に再実行する

### 既存soft-deleted User完全削除の手動確認

引数なしでは必ずdry-runになり、環境flagが`true`でも削除しない。実削除は旧API instanceのdrain、dry-run確認、承認、backup確認が完了した場合だけ行う。

    cd ~/labs/Gensoko

    # 推奨: dry-run（Userと所有tableの集計だけを行い、削除しない）
    docker compose exec \
      -e ACCOUNT_DATA_DELETION_EXECUTE_ENABLED=false \
      -e ACCOUNT_DATA_DELETION_BATCH_SIZE=25 \
      hono npm run delete:legacy-soft-deleted-users

    # 実削除: 環境flag・--execute・確認文字列の三重gateが必要
    docker compose exec \
      -e ACCOUNT_DATA_DELETION_EXECUTE_ENABLED=true \
      -e ACCOUNT_DATA_DELETION_BATCH_SIZE=25 \
      hono npm run delete:legacy-soft-deleted-users -- \
      --execute \
      --confirm=DELETE_LEGACY_SOFT_DELETED_USERS

- batch sizeは1〜100だけを許可し、既定値は25
- execute完了後はCLIがdry-runを再実行し、残件があれば終了code 1になる
- unknown・位置・重複引数、確認文字列不一致、環境設定不備はDB接続前に拒否する
- このCLIを`batch:scheduled`へ追加しない。本番実行は承認付きmanual workflowだけで行う
- ローカルshellからstaging/productionの`DATABASE_URL`を渡して実行しない。実環境では次のGitHub Actionsだけを入口とする

| Environment | workflow                         | operation                                               | 主なgate                                                                                                |
| ----------- | -------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| staging     | `Staging Account Data Deletion`  | `dry-run` / `execute`                                   | `develop`、staging固定、execute flag、確認文字列                                                        |
| production  | `Production Database Operations` | `account-deletion-dry-run` / `account-deletion-execute` | `develop`、production固定、24時間以内のbackup・dry-run、execute flag、確認文字列、承認者、change record |

- workflowは実装済みだが実環境では未実行である。privacy・監査保持・backup境界・全損時replayの残存リスクはR4で2026-07-22に承認済みである。staging executeはT35で明示承認を得てから行い、production cleanupの実行者・承認者・実行時間帯・通知先など残るT1B gateが確定するまでproduction executeを行わない
- staging dry-run/executeはT35、production dry-run/executeはT38のタスク境界で、`docs/11_deployment.md`のrunbookに従って実行する

### T33 staging expand migration・cascade性能確認

T33ではlegacy cleanup workflowを使わず、次の2つのmanual workflowを分離して使う。どちらも`develop`・staging Environment固定で、`gensoko-batch-jobs` concurrencyにより他のDB batchと直列化する。

| workflow                               | 用途                                                                  | DB変更                                 |
| -------------------------------------- | --------------------------------------------------------------------- | -------------------------------------- |
| `Staging Database Setup`               | 通常migration適用、対象expand migrationの初回性能測定、Element seed   | migration、計測fixture、Element upsert |
| `Staging Account Deletion Performance` | 既存Userの最大件数preview、実`deleteCurrentUser`経路のcascade時間測定 | execute時のsynthetic Userだけ          |

実行前にstaging Environmentへ`STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED=false`を登録する。previewは`false`のまま実行できる。migration write probeまたはperformance executeの明示承認中だけ`true`へ変更し、終了・失敗後は直ちに`false`へ戻す。

1. `Staging Account Deletion Performance`の`preview`を実行し、既存Userの最大GameSession・GameAnswer件数、`staleSyntheticFixtureUsers`、`fixtureSourceElementAvailable`だけを記録する。残存fixtureが1件以上、またはfixture元Elementがない場合はcascade executeを開始しない。残存fixtureがある場合は、原因確認と承認済みの後片付けを先に行う。
2. `fixtureSourceElementAvailable=false`の場合は、`Staging Database Setup`の`seed-elements`へ確認文字列`SEED_STAGING_ELEMENTS`を指定する。対象index migrationだけがpending、または全migration適用済みの場合に限り、既存seedの118元素をPrisma `upsert`し、削除は行わない。完了後にpreviewを再実行し、Element有りを確認する。
3. 対象migrationが未適用であることを確認する。初回適用後は同じindex作成時間を再測定できないため、計測workflowをmergeする前に適用しない。
4. flagを`true`へ変更し、`Staging Database Setup`で`measure-account-deletion-indexes`を選び、確認文字列`MEASURE_STAGING_ACCOUNT_DELETION_MIGRATION`と5,000〜120,000msのprobe時間を指定する。
5. summaryの`migrationResult`、`probeResult`、`migrationDurationMs`、`writeProbeMaxDurationMs`、`fixtureCleanupStatus`と、最終migration status成功を確認する。probe失敗時も最終status確認後にjob全体が失敗する。
6. preview値以上かつ上限以内（GameSession 5,000、GameAnswer 50,000）の件数、platform request timeout、確認文字列`MEASURE_STAGING_ACCOUNT_DELETION`を指定し、performance `execute`を実行する。
7. `durationMs <= min(platform timeoutの50%, 5,000ms)`、synthetic fixture cleanup成功を確認する。
8. flagを`false`へ戻す。

通常または将来のstaging migrationは`Staging Database Setup`の`apply`を使い、性能測定flag・確認文字列を要求しない。ただし対象account deletion index migrationがpendingの間は`apply`が意図的に失敗し、初回性能測定の迂回適用を防ぐ。対象以外も同時にpendingなら計測値を混在させず、対象1件だけをpendingにできる適用順序を再計画する。

既存User ID、email、username、DATABASE_URL、project ref、host、生ErrorをActions log・Issue・PR・チャットへ転記しない。migration/probe失敗時は生ログを表示せず、上記の許可済み分類だけを使う。preview最大値が上限を超える、残存fixtureがある、Elementが0件、または同期削除が基準を超える場合は本番公開を停止し、fixture上限を安易に引き上げず原因確認または非同期削除方式の再設計を行う。T35の`Staging Account Data Deletion` executeはこの手順では実行しない。

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

| operation                  | 入力                                                     | 実行条件                                                         |
| -------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| `capacity-check`           | なし                                                     | 500MB（500,000,000 bytes）quotaに対する70%・85%閾値を確認        |
| `backup`                   | なし                                                     | production Environmentに`BACKUP_ENCRYPTION_PASSPHRASE`が設定済み |
| `migrate-deploy`           | `confirmed_backup_run_id`                                | 24時間以内に成功した`backup` run IDを指定                        |
| `account-deletion-dry-run` | なし                                                     | legacy soft-deleted Userと所有rowの件数をpreviewし、削除しない   |
| `account-deletion-execute` | backup/dry-run run ID、確認文字列、承認者、change record | 24時間以内の両runと期限内Artifact、execute flagを検証後に削除    |

`backup`の自動scheduleはR9実装branchでUTC毎日19:41（JST毎日04:41）の`41 19 * * *`へ変更済みである。`capacity-check`の`23 19 * * *`とmanual dispatchは維持する。review・`develop`へのmerge後に日次scheduleを2回以上観測し、同一確認時点で未失効Artifact 2世代以上を確認するまでR9は完了扱いにしない。観測を早めるためのmanual dispatchは行わない。

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
