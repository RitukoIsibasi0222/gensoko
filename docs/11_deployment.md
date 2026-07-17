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

| サービス               | 役割                   | 費用                                   |
| ---------------------- | ---------------------- | -------------------------------------- |
| **Vercel**             | SvelteKitの画面を配信  | **完全無料**（個人利用）               |
| **Cloudflare Workers** | Hono APIサーバー       | **完全無料**（日10万リクエストまで）   |
| **Supabase**           | PostgreSQLデータベース | **無料枠あり**（500MB・2プロジェクト） |

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

| サービス            | URL                     |
| ------------------- | ----------------------- |
| SvelteKit           | `http://localhost:5174` |
| Hono API            | `http://localhost:3000` |
| DB（Prisma Studio） | `http://localhost:5555` |
| メール確認          | `http://localhost:8025` |

### 本番環境

| サービス  | URL例                                                |
| --------- | ---------------------------------------------------- |
| SvelteKit | `https://gensoko.vercel.app`（または独自ドメイン）   |
| Hono API  | `https://gensoko-api.あなたのユーザー名.workers.dev` |

> 💡 独自ドメイン（例: `gensoko.com`）を取得した場合：
>
> - `gensoko.com` → Vercel（フロントエンド）
> - `api.gensoko.com` → Cloudflare Workers（API）
>   独自ドメインはどちらのサービスも無料で設定できます。

---

## CORS（クロスオリジン）設定

別ドメイン間の通信を許可するため、Honoに CORS ミドルウェアを設定します。

`backend/src/app.ts`では、CORS許可originとレート制限依存をapp factoryへ注入する。

```typescript
import type { RateLimitDependencies } from "./middleware/rateLimit/store.js";

type CreateAppOptions = {
  isProduction: boolean;
  rateLimit: RateLimitDependencies;
};
```

実装の正本は `backend/src/app.ts` とし、この文書へmiddleware全体を複製しない。

`NODE_ENV=production` では `FRONTEND_URL` を必須とし、未設定・空文字ならapp構築時にエラーで停止する。HTTP(S)のorigin形式だけを許可し、path、query、hash、認証情報付きURLは拒否する。localhostへのfallbackはdevelopment/testだけで使用する。

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
VITE_API_BASE_URL = https://gensoko-api.あなたのユーザー名.workers.dev/api/v1
```

---

## Cloudflare Workers へのデプロイ手順

### 1. Cloudflare アカウント作成

1. https://cloudflare.com にアクセス
2. 「Sign Up」でアカウント作成

### 2. Workers基盤の実装状況

2026-07-12時点で、Wrangler設定、Workers専用entrypoint、Cloudflare Prisma adapter、SQLite-backed Durable Object、Workers runtime testは未実装である。フェーズ12でこれらを同じ設計として追加してからデプロイ手順を確定する。

`backend/src/index.ts`はNode.js開発用entrypointであり、`@hono/node-server`とmemory storeを使用する。`wrangler`の`main`へ指定してはいけない。またproductionの`RATE_LIMIT_STORE=durable-object`をNode entrypointへ渡すと、memory storeへの危険なfallbackを防ぐため起動を拒否する。

フェーズ12では最低限、次を先に実装・レビューする。

1. Workers専用entrypointとCloudflare Prisma adapter
2. `wrangler.toml`または`wrangler.jsonc`のstaging/production設定
3. SQLite-backed Durable Object namespace、migration、binding
4. Workers runtime用Vitest poolと並行性・永続化・alarm test
5. `DATABASE_URL`、`JWT_SECRET`、`RATE_LIMIT_KEY_SECRET`のWrangler Secret登録
6. stagingでの実HTTP確認後にproduction deploy

実行可能な`wrangler dev`、test、deployコマンドは、採用した設定ファイルとpackage scriptがリポジトリへ追加されるまで本番手順として扱わない。

---

## Supabase のセットアップ手順

1. https://supabase.com にアクセス
2. 「Start your project」→ GitHubアカウントで登録
3. stagingは`gensoko-staging`、productionは別Free organizationの`gensoko-production`として作成する
4. 両projectを次の設定にする:
   - Database Password: password managerで生成・保存し、環境間で共用しない
   - Region: Northeast Asia (Tokyo)
   - Data API: 無効（GensokoはSupabase client libraryではなくPrismaからPostgreSQLへ接続する）
   - Automatic RLS: 無効
5. 作成完了後、`Connect`のPrisma設定からSession pooler（port 5432）のURIを取得する
6. GitHub Environmentごとの`DATABASE_URL`へ登録し、repository共通Secretには登録しない

Cloudflare Workers実行時の接続URLは、Actionsとは分離して`wrangler secret put DATABASE_URL`で設定する。

---

## 本番DBバックアップ・マイグレーション運用

### 基本方針

- 本番DBの変更は `prisma migrate deploy` でのみ適用する
- `prisma migrate deploy` は GitHub Actions の本番デプロイ中、Cloudflare Workers への API デプロイ前に実行する
- 実行前に24時間以内の暗号化backup workflowが成功し、Artifactが期限内であることを確認する
- `DATABASE_URL`はGitHub Actions Secretとして管理し、リポジトリや`wrangler.toml`には書かない

### Free planのbackup・容量監視

productionはSupabase Free planで運用する。[Supabase pricing](https://supabase.com/pricing)上、Free planはDB容量500MB（500,000,000 bytes）で、自動backup・PITR・Metrics endpointを利用できない。[Database Backups](https://supabase.com/docs/guides/platform/backups)でもFree projectは`supabase db dump`による外部backupが推奨されている。

`.github/workflows/production-database.yml`はproduction Environmentへ固定し、既存batchと同じ`gensoko-batch-jobs`concurrency groupでDB操作を直列化する。

| operation        | schedule                     | 内容                                                                                     |
| ---------------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| `capacity-check` | UTC毎日19:23（JST毎日04:23） | `pg_database_size(current_database())`でDB容量を取得し、500MBに対する使用率を確認        |
| `backup`         | UTC土曜19:41（JST日曜04:41） | roles・schema・dataをdumpし、AES-256で暗号化・復号検証してArtifactへ7日保存              |
| `migrate-deploy` | 手動のみ                     | 24時間以内に成功したbackup run IDと期限内Artifactを確認後、`prisma migrate deploy`を実行 |

容量閾値はFree quotaの70%=350MBを警告、85%=425MBを重大とする。どちらもworkflowを失敗させ、GitHub Actionsのfailed workflowメール通知へ接続する。workflowの値はDB本体の論理容量であり、最終確認はSupabase Dashboardのdatabase usageをsource of truthとする。

### 暗号化backup

production Environment Secretへ`BACKUP_ENCRYPTION_PASSPHRASE`を登録する。20文字以上の本番専用値をpassword managerで生成し、DB passwordと共用しない。復元時に必要なため、GitHubだけでなくpassword managerにも保存する。

backup workflowはSupabase公式手順に従い、次を作成する。

- `roles.sql`: custom role
- `schema.sql`: `supabase db dump`の標準動作でSupabase管理schemaを除外したschema（[CLI Reference](https://supabase.com/docs/reference/cli/supabase-db-dump)）
- `data.sql`: `--data-only --use-copy`で取得したdata

平文3ファイルを一時archiveへまとめ、GnuPGのAES-256 symmetric encryptionで暗号化する。同じpassphraseで復号し、3ファイルを再確認してから、暗号化ファイルとSHA-256だけをArtifactへuploadする。平文dumpと復号確認用archiveはrunner終了前に削除する。repositoryはpublicのため、平文dumpをcommit・Artifact・logへ出してはいけない。

### backupの手動実行と復元

初回migration前と、破壊的変更を含むmigration前は次の順序を守る。

1. Actions > Production Database Operations > Run workflowを開く。
2. branchは`develop`、operationは`backup`を選択する。
3. 成功後、run IDと`production-db-backup-{run ID}`Artifactの存在を確認する。
4. 24時間以内にoperation `migrate-deploy`を選び、`confirmed_backup_run_id`へrun IDだけを入力する。
5. backup確認stepと`prisma migrate deploy`の両方が成功したことを確認する。

復元はDB担当者の承認後だけ行う。対象Artifactをdownloadし、password managerからpassphraseを読み出して次の順に確認する。

```bash
sha256sum --check production-db-backup-<run-id>.tar.gz.gpg.sha256

printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" | gpg --decrypt \
  --batch \
  --pinentry-mode loopback \
  --passphrase-fd 0 \
  --output production-db-backup.tar.gz \
  production-db-backup-<run-id>.tar.gz.gpg

tar -xzf production-db-backup.tar.gz
```

復元先には新しいSupabase projectを用意し、現在のproductionへ直接上書きしない。`roles.sql`、`schema.sql`、`data.sql`の順で`psql --single-transaction --set ON_ERROR_STOP=1`を使って復元し、検証後に切替可否を判断する。復元作業中も接続URL、password、passphraseをterminal log・Issue・PR・チャットへ残さない。

### ロールバック方針

DBを即時に巻き戻す前提にはしない。まず直前のアプリケーションバージョンへロールバックできるよう、スキーマ変更は後方互換を維持する。

- 列追加は nullable または default 付きで追加し、旧コードが動く状態を保つ
- 既存列の削除・rename・not null 化・型変更は同一リリースで行わず、expand/contract 方式で分ける
- データ移行が必要な場合は、追加 → backfill → 新旧両対応 → 切替 → 旧列削除の順で進める
- 障害時は API / フロントを先に直前バージョンへ戻し、データ復元が必要な場合のみバックアップからの復元を判断する

## アカウント完全削除のrollout・legacy cleanup

> 2026-07-16時点: 物理削除backend、legacy cleanup CLI、staging/production manual workflowは実装済み。staging/productionのworkflowは未実行であり、本番適用済みとは扱わない。

### release gate

次をすべて記録するまで、物理削除backendの本番公開、production cleanup、`deletedAt` contract migrationを行わない。

- T30・T31のbackend/frontend品質checkとT32の専用DB integration testが成功している
- stagingでexpand migration、削除性能、本人退会・管理者強制退会・削除後auth・管理UIを確認している
- staging legacy cleanupでdry-run、execute、実行後0件、再実行0件を確認している
- Phase 2 backendとPhase 4 frontendを同じrelease windowで切り替え、旧soft-delete instanceをdrainできる
- T1Bのプライバシーポリシー、監査内部IDの正式保持、backup境界、全損時の削除replay方針、本番cleanup担当者・承認者・通知先が承認済みである
- production cleanup前の24時間以内の暗号化backupとdry-run Artifactを確認できる

### Environment設定

| Environment | 種別     | 名前                                           | 値・扱い                                                               |
| ----------- | -------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| staging     | Variable | `ACCOUNT_DATA_DELETION_EXECUTE_ENABLED`        | 通常`false`。T35の承認済みexecute中だけ`true`                          |
| staging     | Variable | `ACCOUNT_DATA_DELETION_BATCH_SIZE`             | 1〜100。既定25                                                         |
| staging     | Variable | `STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED` | 通常`false`。T33の承認済みmigration probe・cascade execute中だけ`true` |
| production  | Variable | `ACCOUNT_DATA_DELETION_EXECUTE_ENABLED`        | 通常`false`。T38の承認済みexecute中だけ`true`                          |
| production  | Variable | `ACCOUNT_DATA_DELETION_BATCH_SIZE`             | 1〜100。既定25                                                         |

`DATABASE_URL`、`STAGING_SUPABASE_PROJECT_REF`、`BATCH_ENVIRONMENT`は既存のEnvironment単位設定を使い、repository共通値やローカルshellへ複製しない。project refは接続先照合用の値だが、Actionsのenv一覧への表示を防ぐためEnvironment Secretで管理する。staging/productionで同じ接続文字列を共用しない。

### staging expand migration・性能runbook（T33）

T33はT35のlegacy cleanupと分離する。PR mergeと明示承認前にworkflowを実行せず、次の順序を変更しない。

1. `STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED=false`を確認する。
2. `Staging Account Deletion Performance`の`preview`を`develop`から実行する。出力は最大GameSession件数・最大GameAnswer件数、残存synthetic fixture User件数、fixture元Elementの有無だけで、既存Userを変更しない。残存fixtureが1件以上ならcascade executeを開始しない。
3. fixture元Elementがない場合は、`Staging Database Setup`の`seed-elements`へ`SEED_STAGING_ELEMENTS`を入力する。対象index migrationだけがpending、または全migration適用済みの場合に限り、118元素をPrisma `upsert`する。生ログは表示せず、削除は行わない。成功後にpreviewを再実行してElement有りを確認する。
4. 対象の`20260716112500_add_account_deletion_indexes`がstagingでpendingであることを確認する。既に適用済みなら同じDB上で計測済みと偽らず、isolated staging相当環境での再現計画を作る。
5. Environment flagを`true`へ変更する。
6. `Staging Database Setup`で`measure-account-deletion-indexes`を選び、`MEASURE_STAGING_ACCOUNT_DELETION_MIGRATION`と5,000〜120,000msのwrite probe時間を入力する。
7. workflowはproject ref・Session pooler host・port 5432・path `/postgres`を検証し、synthetic Userと3つのindex対象子rowだけへwriteしながら`prisma migrate deploy`を実行する。
8. `migrationResult`、`probeResult`、`migrationDurationMs`、`writeProbeMaxDurationMs`、`fixtureCleanupStatus`、適用後migration statusを記録する。probe失敗時も許可済みfieldだけを集計し、migration statusを最終確認してからjobを失敗させる。通常`CREATE INDEX`中のwrite待ちがmaintenance windowを超える場合はproductionへ進まない。
9. preview以上・上限以内のsession/answer件数とplatform request timeoutを決め、performance `execute`へ`MEASURE_STAGING_ACCOUNT_DELETION`を入力する。
10. 実`deleteCurrentUser` service経路の`durationMs`が`min(timeout * 0.5, 5,000)`以内であることを確認する。超過時はproduction公開をblockして非同期方式を再設計する。
11. 成功・失敗にかかわらずsynthetic User・所有row・synthetic成功監査が残っていないことを確認し、flagを`false`へ戻す。

workflowは`gensoko-batch-jobs`でmigration、性能確認、監査fixture、legacy cleanupを直列化する。既存User・legacy soft-deleted Userを削除せず、Prismaとprobeの生ログを表示せず、ログへ内部ID・PII・接続情報・生Errorを出さない。run URL、件数、時間、cleanup状態、合否だけを計画書へ記録する。

`Staging Database Setup`の既定`apply`は通常・将来migration用で、性能測定flagや確認文字列を要求しない。ただし対象account deletion index migrationがpendingの間は初回計測を迂回しないよう拒否する。対象以外も同時にpendingなら`measure-account-deletion-indexes`と`seed-elements`を拒否し、対象1件だけをpendingにできる適用順序またはisolated staging相当環境での再現計画を作る。

### staging runbook（T35）

Actionsの`Staging Account Data Deletion`を`develop` branchから実行する。T35のタスク境界で明示承認を得るまで実行せず、承認後も次の順序を変更しない。

1. `ACCOUNT_DATA_DELETION_EXECUTE_ENABLED=false`で`dry-run`を実行し、User件数、所有row件数、必要batch数、終了codeを記録する。
2. 旧API instanceのdrain、staging backup、承認記録を確認する。
3. flagを`true`へ変更し、operation `execute`と確認文字列`DELETE_LEGACY_SOFT_DELETED_USERS`を指定する。
4. CLI内の実行後dry-runが残件0件で成功したことを確認する。
5. 同じexecuteを再実行し、削除0件で成功する冪等性を確認する。
6. flagを`false`へ戻し、run URL、件数、所要時間、API/UI確認結果を計画書へ記録する。

失敗時は最初にflagを`false`へ戻す。処理済みbatchはcommit済みであり、再実行は残件から継続する。raw DB error、User ID、email、usernameをIssue・PR・チャットへ転載しない。

### production runbook（T38）

Actionsの`Production Database Operations`を`develop` branchから実行する。Environment protection ruleによる承認を維持し、次の順序を変更しない。

1. operation `backup`を実行し、24時間以内の成功run IDと期限内の暗号化Artifactを確認する。
2. `ACCOUNT_DATA_DELETION_EXECUTE_ENABLED=false`で`account-deletion-dry-run`を実行し、24時間以内の成功run IDと1日保持marker Artifactを確認する。
3. dry-run件数、必要batch数、DB負荷、旧instance drain、承認者、change recordを確認する。
4. flagを`true`へ変更し、`account-deletion-execute`へbackup run ID、dry-run run ID、確認文字列、承認者識別子、change record識別子を入力する。
5. workflow内の実行後dry-runが残件0件で成功し、step summaryへ承認記録が残ったことを確認する。
6. flagを直ちに`false`へ戻し、再度`account-deletion-dry-run`を実行して0件を確認する。
7. run URL、件数、所要時間、backup run ID、dry-run run ID、承認者、change recordを安全な運用記録へ残す。

### rollback・restore制約

- アプリケーションを旧versionへ戻しても、commit済みの物理削除User・所有rowは復元されない。障害時は新規削除を停止し、未処理batchだけを保留する
- backup復元は現在のproductionへ直接上書きせず、isolated projectで行う。復元dataにはbackup取得時点の削除対象Userが含まれる可能性がある
- isolated restore後に削除済みUserを再削除するreplay sourceと手順はT1Bで未承認である。T42のrestore drill完了前に、復元を完全削除保証済みと判断しない
- cleanup後backupの取得とcleanup前Artifactの7日失効確認はT41で行う。期限前のArtifactを手動削除せず、保持境界を運用記録へ残す
- 誤実行時はflagを`false`へ戻し、対象件数・実行時刻・run URL・承認記録だけを保存する。無承認のDB復元や、削除済み個人情報の別DBへの抽出を行わない

---

## GitHub Actions による自動デプロイ（CI/CD）

> 現時点では `.github/workflows/` は未作成。
> 以下はフェーズ12で追加する `.github/workflows/deploy.yml` のサンプル。

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-frontend:
    name: Deploy SvelteKit to Vercel
    runs-on: ubuntu-latest
    needs: deploy-backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          working-directory: frontend
          vercel-args: "--prod"

  deploy-backend:
    name: Deploy Hono to Cloudflare Workers
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Install dependencies
        working-directory: backend
        run: npm install
      - name: Deploy database migrations
        working-directory: backend
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: npx prisma migrate deploy
      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          workingDirectory: backend
```

> `secrets.VERCEL_TOKEN` などは GitHub の「Settings > Secrets and variables > Actions」に登録します。

> `secrets.DATABASE_URL` は `prisma migrate deploy` 用です。Workers 実行時の接続URLは `wrangler secret put DATABASE_URL` で別途設定します。

---

## 定期バッチ運用（GitHub Actions schedule）

フェーズ9時点では Cloudflare Workers の wrangler.toml、Workers 用 Prisma 接続、デプロイ workflow が未整備のため、週間スコアリセット、GameQuestionSet cleanup、監査ログcleanupはGitHub Actions scheduleから既存Node CLIを実行する。

### 採用理由

- 既存のresetWeeklyScores、cleanupExpiredGameQuestionSets、cleanupExpiredAuditLogsはNode + Prisma adapter-pg前提で動作確認済み
- Workers runtime 用の Prisma adapter / Hyperdrive 方針が未確定
- Cron だけを Workers に置くと DB 接続や entrypoint 分離まで同時に必要になり、フェーズ12のデプロイ作業とスコープが衝突する
- GitHub Actions schedule なら DATABASE_URL を Actions Secret として渡し、既存の npm run batch:scheduled から同じ wrapper を実行できる

### 実行スケジュール

| job                     | GitHub Actions cron | 意味                            | 備考                                                     |
| ----------------------- | ------------------- | ------------------------------- | -------------------------------------------------------- |
| 週間スコアリセット      | 7 15 \* \* 0        | UTC 日曜 15:07 = JST 月曜 00:07 | wrapper は Cloudflare 形式の 0 15 \* \* SUN も受け付ける |
| GameQuestionSet cleanup | 17,47 \* \* \* \*   | 毎時17分/47分（30分ごと）       | 問題セットの有効期限30分に合わせる                       |
| 監査ログcleanup         | 37 18 \* \* \*      | UTC毎日18:37 = JST毎日03:37     | cleanup無効時は状態確認後にskipする                      |

### 必要なSecret・Variables

GitHub の Settings > Environments で`staging`と`production`を分離し、それぞれに以下を登録する。repository共通の`DATABASE_URL`、`BATCH_ENVIRONMENT`、`AUDIT_LOG_RETENTION_DAYS`、`AUDIT_LOG_CLEANUP_ENABLED`は登録しない。

| Environment | 種別     | 名前                                 | 値・扱い                                                                            |
| ----------- | -------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| staging     | Secret   | `DATABASE_URL`                       | staging専用DB接続文字列。workflow・リポジトリ・ログへ直接書かない                   |
| staging     | Variable | `BATCH_ENVIRONMENT`                  | `staging`                                                                           |
| staging     | Variable | `AUDIT_LOG_RETENTION_DAYS`           | 検証用`365`                                                                         |
| staging     | Variable | `AUDIT_LOG_CLEANUP_ENABLED`          | 初期値`false`。実削除確認中だけ明示的に`true`へ変更する                             |
| staging     | Variable | `AUDIT_LOG_STAGING_FIXTURES_ENABLED` | 初期値`false`。T19のfixture操作中だけ`true`へ変更する                               |
| staging     | Secret   | `STAGING_SUPABASE_PROJECT_REF`       | staging Supabase project ref。接続先取り違え防止用。Actionsのenv一覧へ表示させない  |
| production  | Secret   | `DATABASE_URL`                       | production専用DB接続文字列。stagingと共用しない                                     |
| production  | Secret   | `BACKUP_ENCRYPTION_PASSPHRASE`       | 20文字以上のbackup暗号化専用値。password managerにも保存し、DB passwordと共用しない |
| production  | Variable | `BATCH_ENVIRONMENT`                  | `production`                                                                        |
| production  | Variable | `AUDIT_LOG_RETENTION_DAYS`           | 正式承認後の保持日数                                                                |
| production  | Variable | `AUDIT_LOG_CLEANUP_ENABLED`          | 全release gate完了までは`false`                                                     |

workflow jobは選択されたEnvironmentを参照する。手動実行は`staging`が既定で、scheduleは`production`を参照する。`BATCH_ENVIRONMENT`が選択環境と一致しない場合、または`DATABASE_URL`が未登録の場合は、DB処理や依存関係installの前に失敗する。

保持期間・cleanup flagは秘密情報ではないためEnvironment Variablesで管理する。`AUDIT_LOG_RETENTION_DAYS`の未設定・空文字・不正値は削除前に失敗する。cleanup flagはruntime環境変数自体が省略された場合だけ`false`になるが、workflowでは未登録Variableが空文字として渡りvalidation失敗になるため、`AUDIT_LOG_CLEANUP_ENABLED=false`を明示登録する。

### staging DBの初期構築

1. Supabase Dashboardでstaging専用projectを作成する。project名は`gensoko-staging`とし、productionと共用しない。
2. database passwordはpassword managerで生成・保存し、repository、文書、Issue、PR、チャットへ記載しない。
3. projectの`Connect`からSession pooler（port 5432）のURIを取得する。GitHub-hosted runnerから接続するため、IPv4対応のSession poolerを使用する。
4. GitHub repositoryのSettings > Environments > staging > Environment secretsで、URIを`DATABASE_URL`として登録する。
5. `.github/workflows/staging-database.yml`が`develop`へmergeされた後、Actions > Staging Database Setup > Run workflowで`develop`と通常の`apply`を選んで実行する。account deletion index migrationがpendingの場合は通常適用せず、T33 runbookの計測モードを使う。
6. `npx prisma migrate deploy`の成功と、適用済みmigration一覧をActions logで確認する。接続URLやpasswordをlogへ出さない。

Staging Database Setup workflowは手動実行専用で、GitHub Environmentを`staging`へ固定する。productionの選択肢、schedule、schema生成、seed処理は持たない。通常の`apply`とT33専用の`measure-account-deletion-indexes`を明示選択し、Environment識別子または`DATABASE_URL`が未設定ならmigration前に失敗する。

### 手動実行・retry

GitHub Actions の Batch Jobs workflow は workflow_dispatch に対応している。最初に`target_environment`を選び、次に`batch_job`を選ぶ。T19では必ず`staging`を選択する。`production`はT20のrelease gate完了前に選択しない。

| 入力                 | 選択肢                      | 実行内容                                    |
| -------------------- | --------------------------- | ------------------------------------------- |
| `target_environment` | `staging` / `production`    | 手動実行の接続先。既定は`staging`           |
| `batch_job`          | `weekly-reset`              | 週間スコアリセット                          |
| `batch_job`          | `game-question-set-cleanup` | 期限切れ GameQuestionSet cleanup            |
| `batch_job`          | `audit-log-cleanup-dry-run` | 期限超過件数とcutoffをpreviewし、削除しない |
| `batch_job`          | `audit-log-cleanup-execute` | cleanup有効時だけ実削除する                 |

Actionsのscheduleは遅延・スキップされる可能性があるため、毎時00分付近を避けて7分・17分・37分・47分に分散している。workflowのconcurrency groupは`gensoko-batch-jobs`で固定し、scheduleと手動実行を直列化する。失敗時は安全ログを確認し、原因解消後にworkflow_dispatchで再実行する。

### T19 staging fixtureによる境界・再実行・停止確認

`.github/workflows/staging-audit-cleanup-fixtures.yml`は手動実行専用で、GitHub Environmentを`staging`へ固定する。次の多重guardをすべて満たさない限りPrismaへ接続しない。

Batch Jobsと同じ`gensoko-batch-jobs` concurrency groupを使用し、fixture操作と監査ログcleanupを相互に直列化する。実行中のjobはcancelせず、先に開始した操作の完了を待つ。

- `BATCH_ENVIRONMENT=staging`
- `AUDIT_LOG_STAGING_FIXTURES_ENABLED=true`
- `STAGING_SUPABASE_PROJECT_REF`と`DATABASE_URL`のusername内project refが一致
- 接続先hostがSupabase poolerで、Session poolerのport 5432

fixtureは専用actionを持つ期限切れ1件と期限内1件だけである。公開API、raw SQL、実ユーザーID、メールアドレスなどのPIIは使用しない。`prepare`は既存fixtureだけを置換し、`verify-cleaned`は期限切れ0件・期限内1件を確認し、`remove`は専用fixtureだけを削除する。

T19では次の順序を変更しない。

1. `AUDIT_LOG_CLEANUP_ENABLED=false`のまま、`AUDIT_LOG_STAGING_FIXTURES_ENABLED=true`へ変更する。
2. Staging Audit Cleanup Fixturesで`prepare`を実行する。
3. Batch Jobsで`staging` / `audit-log-cleanup-dry-run`を実行し、期限超過1件・削除0件を確認する。
4. `AUDIT_LOG_CLEANUP_ENABLED=true`へ変更し、Batch Jobsで`staging` / `audit-log-cleanup-execute`を実行する。
5. Staging Audit Cleanup Fixturesで`verify-cleaned`を実行し、期限切れ0件・期限内1件を確認する。
6. Batch Jobsの同じexecuteを再実行し、削除0件を確認する。
7. `AUDIT_LOG_CLEANUP_ENABLED=false`へ戻し、executeでskipされることを確認する。
8. Staging Audit Cleanup Fixturesで`remove`を実行する。
9. `AUDIT_LOG_STAGING_FIXTURES_ENABLED=false`へ戻す。

各runのURL、cutoff、件数、終了code、秘密情報・内部ID・PII・raw errorがlogにないことを計画書へ記録する。途中失敗時は先にcleanupを`false`へ戻し、fixture workflowの`remove`を実行する。production Environmentではこのworkflowを実行できない。

### 監査ログcleanupのrelease gate

次の全項目を記録するまで、productionの`AUDIT_LOG_CLEANUP_ENABLED`を`true`にしない。

| 項目         | 現在の記録                                                      | 状態               |
| ------------ | --------------------------------------------------------------- | ------------------ |
| 正式保持期間 | 365日を暫定推奨                                                 | 未承認             |
| 保持目的     | セキュリティインシデント・管理者操作の相関調査                  | 承認待ち           |
| 内部ID保持   | 監査rowと同期間だけ`actorId`・`targetId`を保持                  | 承認待ち           |
| 承認者       | プロダクトオーナーまたはプライバシー責任者                      | 担当者未確定       |
| 一次対応者   | `RitukoIsibasi0222`                                             | 2026-07-14設定     |
| 通知先       | GitHub Actions failureの登録メール（failed workflowのみ）       | 2026-07-14設定     |
| 容量         | Supabase Free 500MB、警告350MB、重大425MB                       | workflow実行待ち   |
| backup/PITR  | Freeの自動backup・PITRなし。暗号化論理backupをArtifactへ7日保持 | 初回backup成功待ち |

正式決定時は値、目的、承認者、承認日、適用者、適用日時をこの表へ追記する。未確定欄を残したままcleanupを有効化しない。

### 監査ログcleanupの監視

定期jobの安全ログで次を確認する。

- 直近24時間の生成件数
- 最古・最新`occurredAt`
- cutoffより古いrowの存在
- 削除件数、実行時間、上限到達、削除後残件

正確な期限超過総件数は手動dry-runだけで取得する。全row数、`audit_logs` table・index容量、DB接続数、CPU・I/O・storage latency、backup/PITRはDB providerのDashboard・Metricsをsource of truthとし、容量取得のためのraw SQLをアプリへ追加しない。

| 項目            |                    警告 |                      重大 | 初動                                    |
| --------------- | ----------------------: | ------------------------: | --------------------------------------- |
| DB全体容量      |               quota 70% |                 quota 85% | 増加原因、cleanup結果、契約planを確認   |
| 期限超過残件    |     次回実行後も1件以上 | 最大件数到達または2回連続 | dry-run後に手動再実行し、DB負荷を確認   |
| cleanup失敗     |                     1回 |                   2回連続 | cleanupを無効化し、担当者が原因確認     |
| audit write失敗 |                     1件 |                  継続発生 | backendとDB状態を確認                   |
| 日次増加件数    | 初期7日間はbaseline収集 |          baseline後に決定 | LOGIN FAILURE急増とrate limit状態を確認 |

通知には内部ID、監査ログID、メール、username、秘密情報、生Errorを含めない。通知先が設定されるまで本番運用を完了扱いにしない。

### 監査ログcleanup runbook

1. 初回・保持期間変更前は`audit-log-cleanup-dry-run`を実行し、cutoff、期限超過件数、最古日時、最低実行回数を記録する。
2. backup/PITR、承認者、通知先を確認する。
3. Actions Variableの保持期間を承認値へ更新する。
4. 日次schedule直前を避けてmanual実行の時間を確保し、`AUDIT_LOG_CLEANUP_ENABLED=true`へ変更する。
5. `audit-log-cleanup-execute`を1回実行し、削除件数・実行時間・残件を確認する。
6. 日次scheduleの次回成功を確認する。

#### 失敗・上限到達

- raw DB errorを外部通知へ転載せず、Actionsの固定event、cutoff、件数、時間、残件状態を確認する
- 原因解消前に連続再実行しない。DB接続・負荷・設定値を確認してからdry-runする
- 最大10,000件または8分到達後も残件がある場合はworkflowが失敗する。対象外rowを削除せず、必要回数だけ手動再実行する
- cleanup本体は8分、batch実行stepは10分、依存関係install等を含むjob全体は20分で停止する。step timeoutやjob timeoutの場合はDB負荷と残件を確認し、直ちに再実行しない
- 2回連続失敗または原因不明の場合は`AUDIT_LOG_CLEANUP_ENABLED=false`へ戻す

#### 削除保留・停止

- インシデント調査や保持判断中は最初に`AUDIT_LOG_CLEANUP_ENABLED=false`へ変更する
- 保留理由、開始日時、承認者、見直し期限をこの文書へ記録する
- 全体停止だけをサポートし、個別row・ユーザー単位のlegal holdは行わない
- flagだけで不十分な場合は`.github/workflows/batch.yml`の監査cronを停止する。既存の週間・問題セットbatchは維持する

#### 誤削除・rollback

- cleanup flagを即時`false`へ戻し、監査ログへの新規書込みを継続できるか判断する
- 対象期間、cutoff、削除件数、実行者、実行時刻を安全な情報だけで記録する
- backup/PITRからの復元可否をDB担当者と判断し、無承認で本番DBを復元しない
- backendを旧versionへ戻す場合も、先にcleanupを無効化して旧codeへ日次cronが想定外実行されないようにする

### Cloudflare Workers Cron へ移行する条件

フェーズ12で Workers 本番基盤を整備するときに、以下を満たせたら Cloudflare Workers Cron Trigger へ移行する。

- backend/wrangler.toml を作成し、triggers.crons を設定する
- Hono app 構築と Node server 起動を分離し、Workers 用 entrypoint を追加する
- Workers runtime で Prisma / Supabase に接続する方式を確定する
- wrangler dev または Cloudflare dashboard で scheduled handler を確認する

## オブザーバビリティ設定

- 本番 API の `500` 系エラーを Sentry 等のエラートラッキング、または Cloudflare Workers の構造化ログで検知できるようにする
- API レスポンスとログを紐づけるため、リクエストごとに `requestId` を発行する
- ログには `method` / `path` / `status` / `durationMs` / `requestId` を含める
- パスワード・トークン・Cookie・メールアドレスなどの秘密情報や個人情報はログや外部監視サービスに送らない
- `500` 系エラーが発生したら開発者へ通知されるよう、通知先を設定する

---

## 本番レート制限設定

> 2026-07-12時点: Honoのpolicy・HMAC key・middleware・route配線とフロントエンド回帰テストまでは実装済み。Durable Object、Workers binding、WAF、staging/production実機確認は未完了であり、本番適用済みとは扱わない。

### リリースゲート

次の値はリポジトリだけでは確定できない。staging設定前に担当者と確認し、確認結果をこの節へ記録する。

- Cloudflare zone plan（Free / Pro / Business / Enterprise）とWorkers plan（Free / Paid）
- 本番API hostname、対象zone、custom domainまたはWorkers route
- `workers.dev`を含むWAF迂回経路がなく、公開trafficが必ず対象zoneを通ること
- 使用可能なWAF Rate Limiting Rule数、field、period、custom response、Security Events閲覧権限
- stagingとproductionのDurable Object namespace、migration、binding、secretを分離できること
- 1リクエスト当たりのDurable Object RPC数、alarm数、想定日次利用量、Paid移行条件

これらが未確認の場合、Honoの先行実装を完了しても `docs/05_progress.md` を完了 `[x]` にしない。

### 二層の責務

| 層                                  | 役割                                           | 制限の性質                           |
| ----------------------------------- | ---------------------------------------------- | ------------------------------------ |
| Cloudflare WAF                      | Hono到達前に大量のIP/burstアクセスを遮断       | Honoより高い閾値の粗いedge防御       |
| Hono + SQLite-backed Durable Object | route、検証済みemail、認証済みuserを使って判定 | `docs/02_security.md` の正確なpolicy |

- productionでは `RATE_LIMIT_STORE=durable-object` を必須とし、memory storeへ暗黙fallbackしない。
- `RATE_LIMIT_KEY_SECRET` はJWTとは別の256-bit以上のランダム値をWrangler Secretとして設定する。値はログ、文書、PRへ記載しない。
- Durable Object binding名はWorkers基盤の命名規則を確認後に確定する。候補は `RATE_LIMIT_COUNTER` とする。
- productionのIP actorには検証済み `CF-Connecting-IP` だけを使い、`X-Forwarded-For` と `X-Real-IP` は無視する。
- `POST /auth/register` はIPと操作別email、`POST /game/sessions` はIPとuserの独立バケットで制限する。正式値は `docs/02_security.md` をsingle sourceとして参照する。

### WAFルール候補

契約プラン確認後、app上限よりedgeを厳しくしない値を選ぶ。次は確定前の候補であり、実値は設定日・設定者とともに記録する。

| zone plan    | rule候補    | match                           |      閾値候補 |
| ------------ | ----------- | ------------------------------- | ------------: |
| Free         | general     | `/api/v1/*`、health除外         |  40回/10秒/IP |
| Pro          | general     | `/api/v1/*`、health除外         | 240回/60秒/IP |
| Pro          | auth        | register/login/forgot/resetのOR |  20回/60秒/IP |
| Business以上 | general     | `/api/v1/*`、health/OPTIONS除外 | 120回/60秒/IP |
| Business以上 | auth        | 4 auth path + POST              | 20回/600秒/IP |
| Business以上 | game submit | POST `/api/v1/game/sessions`    |  40回/60秒/IP |

- Free/Proではmethodをmatch条件に使えない場合があり、OPTIONSもedge countへ含まれ得る。HonoではOPTIONSを除外したまま、edge閾値に余裕を持たせる。
- custom JSON responseを利用できないplanでは、edge responseは非JSONまたはCORS network errorになり得る。Honoの日本語JSON契約には含めない。
- Dashboard上の設定だけで終わらせず、rule名、zone、expression、characteristics、period、requests、mitigation timeout、action、rule order、設定者、確認日をこの文書へ転記する。account ID、zone ID、tokenは記載しない。

### 適用・確認手順

1. Workers基盤を取り込み、staging用SQLite-backed Durable Object namespace、migration、binding、secretを設定する。
2. stagingでHono limiterを有効化し、正常応答、429、store障害時503、alarm cleanupを確認する。
3. WAF ruleを安全な高閾値でstaging hostnameへ適用し、Security Eventsとorigin到達を確認する。
4. false positiveがないことを確認後、契約プランに合う計画値へ下げる。
5. productionへDO migration/binding、Worker、WAFの順で適用する。
6. Hono 429率、WAF block、DO error、503率、login成功率、game submit成功率を確認する。

### 障害時・ロールバック

- false positive時は最初にWAF ruleをdisableまたは以前の高い閾値へ戻し、Honoの制限は維持する。
- Hono/DO実装に問題がある場合は以前のWorker versionへ戻す。productionでmemory storeを有効にしない。
- Durable Object障害時は一般APIとquestionsをfail-open、auth/account/game submitをfail-closed 503とする。全policyを一括fail-openにしない。
- 旧Workerへ戻した直後にDO namespaceを削除しない。traffic停止とrollback安定を確認後、別作業でcleanupする。
- HMAC secretの変更は全バケットをリセットするため、緊急時以外はmaintenance承認を必須とする。

---

## 本番デプロイのチェックリスト

```
[x] Supabase staging・production project作成、Session pooler接続設定
[ ] Vercelアカウント作成・プロジェクトインポート
[ ] Vercelに VITE_API_BASE_URL 環境変数を設定
[ ] Cloudflareアカウント作成・Wranglerインストール
[ ] wrangler.toml 作成
[ ] Cloudflare Workers に production の FRONTEND_URL を設定（未設定では起動不可）
[ ] DATABASE_URL、JWT_SECRET、RATE_LIMIT_KEY_SECRET をWrangler Secretsに設定
[ ] staging/productionのSQLite-backed Durable Object namespace・migration・bindingを分離
[ ] productionでRATE_LIMIT_STORE=durable-object以外を拒否することを確認
[ ] 本番API hostnameが対象zoneのWAFを通り、直接到達・迂回経路がないことを確認
[x] GitHub Actions production Environmentの DATABASE_URL Secret を設定（migrate deploy 用）
[x] GitHub Actions Variables に AUDIT_LOG_RETENTION_DAYS と AUDIT_LOG_CLEANUP_ENABLED=false を設定
[-] 本番DB暗号化backup workflowを実装し、初回Artifactを確認
[ ] 監査ログの正式保持期間・内部ID保持・承認者・通知先を記録
[-] DB容量70%/85% workflowを実装し、GitHub Actions failureの受信者を設定（初回run待ち）
[ ] production dry-runと初回executeの結果を記録
[ ] prisma migrate deploy の実行タイミングを確認
[ ] wrangler deploy で初回デプロイ
[ ] GitHub Actions の Secrets 設定（CI/CD）
[ ] エラートラッキングまたは構造化ログの通知先を設定
[ ] WAF ruleの全設定値・設定者・確認日・rollback手順を記録
[ ] Honoの429/503/Retry-AfterとWAFのedge responseをstaging実HTTPで確認
[ ] DO request/alarm/storage利用量とFree/Paid移行条件を確認
[ ] 本番環境での動作確認（ログイン・ゲーム・メール）
[ ] CORS設定の確認（フロントエンドのURLが正しく許可されているか）
```

| サービス             | 役割                   | 費用目安                 |
| -------------------- | ---------------------- | ------------------------ |
| **Firebase Hosting** | SvelteKitの画面を配信  | 無料枠あり（月10GBまで） |
| **Railway**          | LaravelのAPIサーバー   | 月5〜10ドル程度          |
| **Railway**          | PostgreSQLデータベース | 上記に含む               |

---

## Firebase Hosting の基本知識

### できること・できないこと

| できること                     | できないこと                           |
| ------------------------------ | -------------------------------------- |
| HTML / CSS / JS ファイルの配信 | PHP / Python / Ruby などのサーバー処理 |
| SvelteKit のビルド成果物を公開 | データベースの直接操作                 |
| 独自ドメインの設定（無料）     | Laravel を動かすこと                   |
| 世界中のCDNで高速配信          |                                        |

### SvelteKit のビルド設定

Firebase Hosting に乗せるには SvelteKit を「静的サイト」としてビルドする必要があります。

`frontend/svelte.config.js` に以下を設定：

```javascript
import adapter from "@sveltejs/adapter-static";

export default {
  kit: {
    adapter: adapter({
      fallback: "index.html", // SPAとして動作させる設定
    }),
  },
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

| サービス    | URL                     |
| ----------- | ----------------------- |
| SvelteKit   | `http://localhost:5173` |
| Laravel API | `http://localhost:80`   |

### 本番環境

| サービス    | URL                                             | サービス         |
| ----------- | ----------------------------------------------- | ---------------- |
| SvelteKit   | `https://gensoko.web.app`（または独自ドメイン） | Firebase Hosting |
| Laravel API | `https://gensoko-api.railway.app`               | Railway          |

> 💡 **独自ドメイン**（例: `gensoko.com`）を取得した場合：
>
> - `gensoko.com` → Firebase Hosting（フロントエンド）
> - `api.gensoko.com` → Railway（API）
>   これにより URL が分かりやすくなります。独自ドメインは Firebase Hosting に無料で設定できます。

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
          node-version: "22"
      - name: Install & Build
        working-directory: frontend
        run: |
          npm install
          npm run build
        env:
          VITE_API_BASE_URL: ${{ secrets.VITE_API_BASE_URL }}
      - name: Deploy to Firebase
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          channelId: live
          projectId: gensoko

  # Railwayはpush時に自動デプロイされるので設定不要
```

> ✅ `secrets.VITE_API_BASE_URL` などの秘密情報は GitHub の「Settings > Secrets」に登録します
> ✅ Railway は GitHub と連携すると push 時に自動でデプロイされます（設定不要）

---

## 本番環境の環境変数まとめ

### SvelteKit（frontend/.env.production）

```env
# Laravelのデプロイ先URL（Railwayが発行したURL）
VITE_API_BASE_URL=https://gensoko-api.railway.app/api/v1
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
