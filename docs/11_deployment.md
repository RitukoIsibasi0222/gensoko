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
| SvelteKit | `http://localhost:5174` |
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
3. 「New Project」をクリック
4. 設定:
   - Project name: `gensoko`
   - Database Password: **強いパスワードを設定してメモしておく**
   - Region: Northeast Asia (Tokyo)
5. 作成完了後、「Settings」→「Database」→「Connection string」→「URI」をコピー

このURLを Cloudflare Workers の `DATABASE_URL` に設定します。

---

## 本番DBバックアップ・マイグレーション運用

### 基本方針

- 本番DBの変更は `prisma migrate deploy` でのみ適用する
- `prisma migrate deploy` は GitHub Actions の本番デプロイ中、Cloudflare Workers への API デプロイ前に実行する
- 実行前に Supabase のバックアップ取得状況または手動バックアップ時刻を確認する
- `DATABASE_URL`はGitHub Actions Secretとして管理し、リポジトリや`wrangler.toml`には書かない

### ロールバック方針

DBを即時に巻き戻す前提にはしない。まず直前のアプリケーションバージョンへロールバックできるよう、スキーマ変更は後方互換を維持する。

- 列追加は nullable または default 付きで追加し、旧コードが動く状態を保つ
- 既存列の削除・rename・not null 化・型変更は同一リリースで行わず、expand/contract 方式で分ける
- データ移行が必要な場合は、追加 → backfill → 新旧両対応 → 切替 → 旧列削除の順で進める
- 障害時は API / フロントを先に直前バージョンへ戻し、データ復元が必要な場合のみバックアップからの復元を判断する

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

| job | GitHub Actions cron | 意味 | 備考 |
|---|---|---|---|
| 週間スコアリセット | 7 15 * * 0 | UTC 日曜 15:07 = JST 月曜 00:07 | wrapper は Cloudflare 形式の 0 15 * * SUN も受け付ける |
| GameQuestionSet cleanup | 17,47 * * * * | 毎時17分/47分（30分ごと） | 問題セットの有効期限30分に合わせる |
| 監査ログcleanup | 37 18 * * * | UTC毎日18:37 = JST毎日03:37 | cleanup無効時は状態確認後にskipする |

### 必要なSecret・Variables

GitHub の Settings > Secrets and variables > Actions に以下を登録する。

| 種別 | 名前 | 値・扱い |
|---|---|---|
| Actions Secret | `DATABASE_URL` | 本番DB接続文字列。workflow・リポジトリ・ログへ直接書かない |
| Actions Variable | `AUDIT_LOG_RETENTION_DAYS` | 暫定`365`。正式承認後の値を設定する |
| Actions Variable | `AUDIT_LOG_CLEANUP_ENABLED` | release gate完了までは`false` |

保持期間・cleanup flagは秘密情報ではないためVariablesで管理する。`AUDIT_LOG_RETENTION_DAYS`の未設定・空文字・不正値は削除前に失敗する。cleanup flagはruntime環境変数自体が省略された場合だけ`false`になるが、workflowでは未登録Variableが空文字として渡りvalidation失敗になるため、`AUDIT_LOG_CLEANUP_ENABLED=false`を明示登録する。

### 手動実行・retry

GitHub Actions の Batch Jobs workflow は workflow_dispatch に対応している。失敗時や手動確認時は以下を選択して再実行する。

| 入力 | 実行内容 |
|---|---|
| weekly-reset | 週間スコアリセット |
| game-question-set-cleanup | 期限切れ GameQuestionSet cleanup |
| audit-log-cleanup-dry-run | 期限超過件数とcutoffをpreviewし、削除しない |
| audit-log-cleanup-execute | cleanup有効時だけ実削除する |

Actionsのscheduleは遅延・スキップされる可能性があるため、毎時00分付近を避けて7分・17分・37分・47分に分散している。workflowのconcurrency groupは`gensoko-batch-jobs`で固定し、scheduleと手動実行を直列化する。失敗時は安全ログを確認し、原因解消後にworkflow_dispatchで再実行する。

### 監査ログcleanupのrelease gate

次の全項目を記録するまで、productionの`AUDIT_LOG_CLEANUP_ENABLED`を`true`にしない。

| 項目 | 現在の記録 | 状態 |
|---|---|---|
| 正式保持期間 | 365日を暫定推奨 | 未承認 |
| 保持目的 | セキュリティインシデント・管理者操作の相関調査 | 承認待ち |
| 内部ID保持 | 監査rowと同期間だけ`actorId`・`targetId`を保持 | 承認待ち |
| 承認者 | プロダクトオーナーまたはプライバシー責任者 | 担当者未確定 |
| 一次対応者 | GitHub Actions・DB警告を確認する開発担当 | チーム未確定 |
| 通知先 | GitHub Actions failureとDB provider容量警告 | 受信者未設定 |
| backup/PITR | 初回実削除前に復元可能性と保持状態を確認 | 未確認 |

正式決定時は値、目的、承認者、承認日、適用者、適用日時をこの表へ追記する。未確定欄を残したままcleanupを有効化しない。

### 監査ログcleanupの監視

定期jobの安全ログで次を確認する。

- 直近24時間の生成件数
- 最古・最新`occurredAt`
- cutoffより古いrowの存在
- 削除件数、実行時間、上限到達、削除後残件

正確な期限超過総件数は手動dry-runだけで取得する。全row数、`audit_logs` table・index容量、DB接続数、CPU・I/O・storage latency、backup/PITRはDB providerのDashboard・Metricsをsource of truthとし、容量取得のためのraw SQLをアプリへ追加しない。

| 項目 | 警告 | 重大 | 初動 |
|---|---:|---:|---|
| DB全体容量 | quota 70% | quota 85% | 増加原因、cleanup結果、契約planを確認 |
| 期限超過残件 | 次回実行後も1件以上 | 最大件数到達または2回連続 | dry-run後に手動再実行し、DB負荷を確認 |
| cleanup失敗 | 1回 | 2回連続 | cleanupを無効化し、担当者が原因確認 |
| audit write失敗 | 1件 | 継続発生 | backendとDB状態を確認 |
| 日次増加件数 | 初期7日間はbaseline収集 | baseline後に決定 | LOGIN FAILURE急増とrate limit状態を確認 |

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

| 層 | 役割 | 制限の性質 |
|---|---|---|
| Cloudflare WAF | Hono到達前に大量のIP/burstアクセスを遮断 | Honoより高い閾値の粗いedge防御 |
| Hono + SQLite-backed Durable Object | route、検証済みemail、認証済みuserを使って判定 | `docs/02_security.md` の正確なpolicy |

- productionでは `RATE_LIMIT_STORE=durable-object` を必須とし、memory storeへ暗黙fallbackしない。
- `RATE_LIMIT_KEY_SECRET` はJWTとは別の256-bit以上のランダム値をWrangler Secretとして設定する。値はログ、文書、PRへ記載しない。
- Durable Object binding名はWorkers基盤の命名規則を確認後に確定する。候補は `RATE_LIMIT_COUNTER` とする。
- productionのIP actorには検証済み `CF-Connecting-IP` だけを使い、`X-Forwarded-For` と `X-Real-IP` は無視する。
- `POST /auth/register` はIPと操作別email、`POST /game/sessions` はIPとuserの独立バケットで制限する。正式値は `docs/02_security.md` をsingle sourceとして参照する。

### WAFルール候補

契約プラン確認後、app上限よりedgeを厳しくしない値を選ぶ。次は確定前の候補であり、実値は設定日・設定者とともに記録する。

| zone plan | rule候補 | match | 閾値候補 |
|---|---|---|---:|
| Free | general | `/api/v1/*`、health除外 | 40回/10秒/IP |
| Pro | general | `/api/v1/*`、health除外 | 240回/60秒/IP |
| Pro | auth | register/login/forgot/resetのOR | 20回/60秒/IP |
| Business以上 | general | `/api/v1/*`、health/OPTIONS除外 | 120回/60秒/IP |
| Business以上 | auth | 4 auth path + POST | 20回/600秒/IP |
| Business以上 | game submit | POST `/api/v1/game/sessions` | 40回/60秒/IP |

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
[ ] Supabaseプロジェクト作成・接続URLの取得
[ ] Vercelアカウント作成・プロジェクトインポート
[ ] Vercelに VITE_API_BASE_URL 環境変数を設定
[ ] Cloudflareアカウント作成・Wranglerインストール
[ ] wrangler.toml 作成
[ ] Cloudflare Workers に production の FRONTEND_URL を設定（未設定では起動不可）
[ ] DATABASE_URL、JWT_SECRET、RATE_LIMIT_KEY_SECRET をWrangler Secretsに設定
[ ] staging/productionのSQLite-backed Durable Object namespace・migration・bindingを分離
[ ] productionでRATE_LIMIT_STORE=durable-object以外を拒否することを確認
[ ] 本番API hostnameが対象zoneのWAFを通り、直接到達・迂回経路がないことを確認
[ ] GitHub Actions の DATABASE_URL Secret を設定（migrate deploy 用）
[ ] GitHub Actions Variables に AUDIT_LOG_RETENTION_DAYS と AUDIT_LOG_CLEANUP_ENABLED=false を設定
[ ] 本番DBバックアップ取得状況を確認
[ ] 監査ログの正式保持期間・内部ID保持・承認者・通知先を記録
[ ] DB容量70%/85%警告とGitHub Actions failureの受信者を設定
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
