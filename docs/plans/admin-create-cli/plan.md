# 管理者作成 CLI コマンド 実装計画

> 設計者ロール: シニアフルスタック／セキュリティエンジニア

- 進捗タスク: `docs/05_progress.md` の「管理者作成 CLI コマンド（UI 登録不可・環境変数両対応）」
- 計画書パス: `docs/plans/admin-create-cli/plan.md`
- 主対象: Docker Compose の `hono` コンテナで実行するバックエンド CLI
- 画面ルート: なし
- 新規公開 API: なし

## レビュー結果

### この計画のまま実装すべきではない理由

前案は、CLI と既存 Admin API の責務分離、管理者として必要な User 状態、秘密情報を出力しない方針、TDD の対象を広く整理できている。一方で、次の点を固めずに実装すると、`--help` や入力エラーだけでも Prisma と DB 設定へ依存する、Node.js の引数解析エラーから入力値を漏えいする、CLI 実行権限を持つ主体が無制限に管理者を作成できる運用境界が曖昧になる、同時実行保証をモックテストだけで過大評価する、といった問題が起きる。

また、共通 password helper への既存 auth/user service の移行はセキュリティ設定の一元化に有効だが、CLI 本体より回帰影響が広い。既存認証テストと build を必須にし、挙動変更を伴わない機械的 refactor として独立した作業単位にする必要がある。

### DB の整合性と負荷

| 指摘内容 | 根拠: 確認できた事実 | 根拠: 推測 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|---|
| DB schema 変更は不要 | `User.username` と `User.email` は必須かつ unique。`role`、`emailVerified`、`isActive`、`deletedAt` が既存 model にある | なし | 不要な migration を追加するとリリースとrollbackのリスクだけが増える | 既存 `User` への単一 `create` に限定し、schema/migrationを変更しない | High |
| unique 判定を事前検索だけに依存できない | DB に username/email の unique 制約がある。既存 `isUniqueConstraintViolation()` は `P2002` を判定できる | 同時起動時は、複数プロセスが事前検索を同時通過し得る | 重複作成、または生のPrismaエラー露出 | `User.create` の `P2002` を最終判定にし、固定された安全な重複エラーへ変換する | High |
| 明示的 transaction は不要 | 永続化対象は `User` 1行だけで、token/UserStatsを同時作成しない | 将来、複数レコード作成へ拡張される可能性はある | 不要なtransactionは実装とテストを複雑化する | 現時点は単一INSERT。複数書き込み追加時のみ再設計する | Medium |
| UserStats 初期作成は不要 | `User.stats` は任意で、既存login処理が `userStats.upsert()` を行う | なし | CLIだけが独自の初期化処理を持つとloginとの責務が重複する | CLIでは作成せず、既存loginの初回upsertを利用する | Medium |
| N+1・重いqueryは発生しない | 管理者作成は単一 `User.create`。username/email unique indexが存在する | bcrypt cost 12のCPU負荷はあるが、運用者が手動実行する低頻度CLIである | 大量実行時はCPU負荷が増える | バッチ作成機能には拡張せず、1実行1ユーザーに固定する | Low |
| rollbackで作成済み管理者は消えない | code/docsをrevertしても既存DB行は残る | 運用者がcode rollbackだけでデータも戻ると誤認する可能性がある | 意図しない管理者が残る、または自動削除で必要な管理者を失う | 自動削除しない。必要時は別の利用可能な管理者から既存Admin APIで明示的に退会処理する | High |

### API・コードの整合性

| 指摘内容 | 根拠: 確認できた事実 | 根拠: 推測 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|---|
| 新規作成と既存ユーザー昇格の境界は維持できる | 通常registerはroleを受け取らず、既存 `PATCH /admin/users/:id/role` が有効な既存ユーザーの昇格を担当する | なし | CLIがupdate/upsertを使うと、既存ユーザーを暗黙に昇格・再有効化する | CLIは `create` 専用。既存ユーザー重複時は必ず失敗する | High |
| roleだけADMINでは既存認証を通過できない | login/auth middlewareは `emailVerified` と `isActive` を確認し、DBの最新roleを使う | なし | 作成直後にログイン・Admin API利用ができない | `role=ADMIN`、`emailVerified=true`、`isActive=true`、`deletedAt=null` を明示する | High |
| `--help` がDB設定へ依存する設計になり得る | `prisma.ts` はmodule import時に `PrismaPg` adapterを生成する。既存CLIはprismaをtop-level importする | 前案どおりentrypointからserviceを静的importすると、help/validationだけでもprisma moduleが評価される | DATABASE_URL未設定時にhelpが表示できない、不要な接続初期化、テスト困難 | parse/help/validationを先に完了し、DB処理が必要になった時だけservice/prismaを遅延loadする | High |
| `parseArgs` の生エラーを表示できない | CLI出力にusername/email/passwordを含めてはならない | 未知optionや位置引数のエラーメッセージに、利用者が入力した文字列が含まれる可能性がある | 個人情報・秘密情報漏えい | Node.js例外の `message` を転記せず、`コマンド引数が正しくありません` に固定する | High |
| DB例外のmessageを信用できない | Prisma/DB errorは接続先、制約名、内部情報を含み得る | 将来の例外messageへ入力値が混入する可能性もある | 秘密情報・内部構造漏えい | error code/classで分岐し、CLI境界で固定メッセージへmapする。`console.error(error)`は禁止 | High |
| CLI実行権限が管理者作成権限になる | CLIはHTTP認証・Admin middlewareを経由せず、DBへ直接書き込む | 共有ホストや広いコンテナ操作権限があると、不正な管理者作成が可能 | 権限昇格 | 実行対象を信頼済み運用者に限定し、手順書へ権限境界を明記する。CLI内に公開認証を追加しない | High |
| password hash設定の重複がある | auth/user serviceにcost 12の `bcrypt.hash` が複数ある | CLIへ直接同じ処理を追加すると変更漏れが増える | cost変更時の不整合 | 共通 `hashPassword()` を追加し、cost 12の通常hashだけを段階的に移行する。既存テストとbuildを必須化する | Medium |
| email schemaがroute内で重複している | register/loginで同じ `z.string().email(...)` が使われる | CLIへ3つ目を追加するとmessage差異が生まれる | validationのずれ | `emailSchema` を共通化する。register/loginの公開挙動は変えない | Medium |
| passwordと識別子の同一値禁止がfield schemaだけでは表現できない | `docs/02_security.md` はusername/emailとの同一値を禁止するが、既存 `strongPasswordSchema` はfield単体schemaである | なし | emailと同じpasswordをCLIが受理する可能性 | CLIのobject-level validationで拒否する。通常registerへの追加は別タスク | Medium |
| `docs/04_api.md` の変更は不要 | CLIは新規公開APIを追加せず、既存APIのrequest/responseも変更しない | なし | 不要なAPI文書変更によるスコープ混在 | 完了時に更新不要を再確認して記録する | Low |

### UI / A11Y

| 指摘内容 | 根拠: 確認できた事実 | 根拠: 推測 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|---|
| Web UIのA11Yは対象外 | 画面ルート、component、frontend API clientを追加しない | なし | UI要件を混ぜるとCLI計画が肥大化する | frontendのARIA、focus、loading、empty stateテストは追加しない | Low |
| CLI出力の可読性は考慮が必要 | CLIは標準入出力で運用者へ結果を伝える | 色、絵文字、TTY制御へ依存するとログや読み上げで意味が失われる | 支援技術・CIログで結果を理解しにくい | 色だけに依存せず、ANSI必須にせず、短い日本語テキストと終了コードで状態を伝える | Medium |
| password入力は引数・環境変数方式のみ | interactive password promptは要件に含まれない | promptを追加すると非対話実行・自動化・テストが複雑になる | 仕様外拡張 | 本タスクではpromptを追加しない。環境変数方式を推奨する | Low |

### テストの妥当性

| 指摘内容 | 根拠: 確認できた事実 | 根拠: 推測 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|---|
| 入力・DB・entrypointを分ける方針は妥当 | 既存CLI testはmodule mock、`vi.resetModules()`、`vi.waitFor()` を使用する | なし | 1ファイルへまとめるとimport副作用testが肥大化する | pure input/runner、service、`.cli.ts` lifecycleを別testへ分ける | High |
| help/入力エラーでPrisma未loadを検証する必要がある | 遅延loadしなければDB設定へ依存する | 実装者が既存CLIのtop-level importをコピーする可能性が高い | helpがDB障害時に使えない | help、parse error、validation errorでservice/prisma loader未呼び出しをtestする | High |
| 出力安全性を部分一致だけで済ませられない | 禁止情報が明確に列挙されている | 例外messageを変更した際に漏えいが再発し得る | 秘密情報漏えい | stdout/stderr全体についてfixture値、hash、DB error message、stack、接続文字列が含まれないことを検証する | High |
| 同時実行をmockだけで保証できない | unit testは `P2002` mappingを検証できるが、実DB競合そのものは再現しない | mock testをrace testとして記録してしまう可能性がある | 保証範囲の過大評価 | unitではP2002 mapping、Docker手動確認では同一入力の並行実行を行い、1件だけ作成されることを確認する | Medium |
| 共通hash helper refactorの回帰範囲が広い | auth/register/reset-password、user password変更がbcryptを利用する | import変更で既存mockが壊れる可能性がある | CLI以外の認証回帰 | 関連testだけでなくbackend全testと `npm run build` を必須にする | High |
| frontend testは不要 | frontend変更がない | なし | 不要なA11Y/UI test追加 | backend unit testとDocker手動確認に限定する | Low |

## 背景・目的

一般ユーザー向け UI や公開 API を経由せず、信頼された運用者が Docker Compose の `hono` コンテナ内から新しい管理者アカウントを作成できるようにする。

username、email、passwordをコマンド引数または環境変数から受け取り、既存のZod validation、bcryptjs、Prisma v7、Docker運用と整合させる。既存ユーザーの昇格・上書き・再有効化は行わず、重複時は安全に失敗する。

## スコープ

- 新規管理者1件を作成するバックエンドCLI。
- `--username`、`--email`、`--password`。
- `ADMIN_USERNAME`、`ADMIN_EMAIL`、`ADMIN_PASSWORD`。
- 項目単位でコマンド引数を優先し、未指定項目だけ環境変数で補完する。
- 入力解決、正規化、Zod validation、管理者作成service、CLI lifecycleの分離。
- bcrypt cost 12の共通hash helper。
- username/email unique制約違反の安全な変換。
- `--help`、未知option拒否、位置引数拒否。
- npm scriptとDocker Compose内の運用手順。
- backend unit test、全体回帰test、Docker手動確認。
- `docs/05_progress.md`、`docs/09_startup_commands.md`、`docs/12_task_guide.md`、本計画の更新。

## 非スコープ

- 監査ログ実装。
- 管理者ダッシュボード `/admin`。
- 管理者登録画面。
- 通常登録画面・登録APIへのrole選択追加。
- 管理者作成用の公開API。
- 既存ユーザーを管理者へ昇格する処理。
- Admin APIの追加・変更。
- frontend API client、store、component、page。
- メール認証メール送信。
- EmailVerification、PasswordResetToken、RefreshTokenの生成。
- password自動生成、interactive password prompt。
- 管理者認証情報の設定ファイルへの永続保存。
- メールアドレス全体の小文字化方針変更。
- DB schema、migration、indexの変更。
- 本番Cloudflare Workers向けbootstrap job。

## 現状調査結果

### 確認できた事実

- `docs/05_progress.md` フェーズ10に対象タスクが未実装で存在する。
- 本計画作成前に `docs/plans/admin-create-cli/plan.md` は存在しない。
- `User.username`、`User.email` は必須かつunique。
- `User.role` のdefaultは `USER`。
- `User.stats` は任意relation。
- 通常registerはroleを受け取らず、`USER` を作成する。
- loginは `emailVerified=true`、`isActive=true`、ロック中でないことを確認する。
- auth middlewareはDBの最新roleを利用する。
- 既存Admin APIは、有効かつメール認証済みの既存ユーザーを `ADMIN` へ変更できる。
- `backend/src/lib/prisma.ts` は `PrismaPg` adapterを使用するPrisma v7 singletonを公開する。
- `backend/src/lib/normalize.ts` は `normalizePassword()` を公開する。
- `backend/src/lib/validation/auth.ts` は `usernameSchema` と `strongPasswordSchema` を公開する。
- `backend/src/lib/prisma-errors.ts` は `P2002` 判定helperを公開する。
- package scriptのTypeScript CLIは `tsx` を使用する。
- 既存CLIは `process.exitCode` と `prisma.$disconnect()` を使用する。
- `backend/.env.example` に管理者作成用環境変数はない。
- `docker compose exec -e` で実行プロセスへ環境変数を設定できる。
- 関連する `docs/prs/*.md` に本CLIの実装記録はない。

### 推測

- 初期運用では1件ずつ低頻度で実行されるため、bcrypt cost 12のCPU負荷は許容できる可能性が高い。
- 将来の本番環境がdevDependenciesを除外する場合、`tsx` CLIはそのまま実行できない可能性が高い。
- shared hostでコンテナ操作権限が広く付与されている場合、CLI自体が権限昇格経路になる可能性がある。
- メールアドレスの大文字小文字を区別する現在のDB/認証挙動は、将来別途正規化方針を検討する必要がある可能性がある。

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/lib/password.ts` | 新規 | cost 12を一元管理する `hashPassword()` |
| `backend/src/lib/password.test.ts` | 新規 | bcrypt呼び出しとcostを検証 |
| `backend/src/lib/validation/auth.ts` | 修正 | 共通 `emailSchema` を追加 |
| `backend/src/routes/auth/index.ts` | 修正 | register/loginで共通email schemaを利用。公開挙動は変更しない |
| `backend/src/services/auth.service.ts` | 修正 | 通常password hashを共通helperへ移行 |
| `backend/src/services/user.service.ts` | 修正 | password変更時のhashを共通helperへ移行 |
| `backend/src/services/admin-create.service.ts` | 新規 | 新規管理者作成とP2002変換 |
| `backend/src/services/admin-create.service.test.ts` | 新規 | DB保存内容、重複、想定外エラーtest |
| `backend/src/scripts/createAdmin.ts` | 新規 | 引数解析、入力解決、正規化、validation、CLI結果生成 |
| `backend/src/scripts/createAdmin.test.ts` | 新規 | pure CLI logic test |
| `backend/src/scripts/createAdmin.cli.ts` | 新規 | 遅延dependency load、標準入出力、終了コード、切断処理 |
| `backend/src/scripts/createAdmin.cli.test.ts` | 新規 | entrypoint lifecycleと秘密情報非出力test |
| `backend/package.json` | 修正 | `admin:create` script |
| `docs/09_startup_commands.md` | 修正 | Docker内運用手順と権限境界 |
| `docs/12_task_guide.md` | 修正 | username不足・旧ts-node例を修正 |
| `docs/05_progress.md` | 修正 | 実装中・完了状態を更新 |
| `docs/plans/admin-create-cli/plan.md` | 新規 | 本計画と実装完了記録 |

次は変更しない。

- `backend/.env.example`: 認証情報の `.env` 常設を誘発しないため、変数名と一時注入手順は運用文書だけに記載する。
- `backend/src/lib/normalize.ts`: 既存 `normalizePassword()` を再利用する。
- `backend/src/lib/prisma-errors.ts`: 既存P2002 helperを再利用する。
- `backend/src/services/admin.service.ts`、`backend/src/routes/admin/index.ts`: 既存ユーザー昇格の責務を維持する。
- `backend/src/types/index.ts`: Hono/JWT型の変更は不要。
- `backend/prisma/schema.prisma`、`backend/prisma/migrations/`: DB変更なし。
- `docker-compose.yml`: `exec -e` で一時注入できるため変更なし。
- `docs/04_api.md`: 公開API変更なし。完了時に更新不要を再確認する。
- `frontend/**`: UI変更なし。

## 実装方針

1. `node:util` の `parseArgs` を使用し、追加dependencyを導入しない。
2. 引数解析例外の生messageは使用せず、安全な固定メッセージへ変換する。
3. 引数と環境変数を項目単位で解決し、明示された空値はfallbackさせない。
4. username/emailはtrim、passwordは既存 `normalizePassword()` で一度だけ正規化する。emailは小文字化しない。
5. 正規化済みの同じobjectをvalidationとserviceへ渡す。
6. `usernameSchema`、`strongPasswordSchema`、共通化した `emailSchema` を再利用する。
7. CLI object-level validationでpasswordとusername/emailの同一値を拒否する。
8. pure CLI logic、DB service、`.cli.ts` entrypointを分離する。
9. help、parse error、validation errorはDB dependencyをloadする前に終了する。
10. DB処理が必要になった場合だけservice/prismaを遅延loadする。
11. `hashPassword()` で通常hashのcost 12を一元管理する。
12. `User.create` のみを実行し、update/upsert/token作成は行わない。
13. `P2002` は `AdminCreateError` のcodeへ変換し、CLIが固定メッセージへmapする。
14. stdout/stderrは結果objectから固定文言だけを出力する。
15. DB dependencyをloadした経路では、成功・失敗の双方でdisconnectを試行する。

## DB変更方針

- schema/migration/index変更なし。
- `User.create` に次を明示する。
  - `role = "ADMIN"`
  - `emailVerified = true`
  - `isActive = true`
  - `deletedAt = null`
- `loginFailCount`、`lockedUntil`、日時は既存defaultを利用する。
- UserStats、EmailVerification、PasswordResetToken、RefreshTokenは作成しない。
- transactionは使わない。単一INSERTから複数書き込みへ変わる場合は計画を更新する。
- 重複の最終保証はDB unique制約とする。
- 生SQLは使わない。

DB変更が発生した場合は作業を止め、本計画へmigration、`prisma migrate deploy`、Prisma Client再生成、Docker適用、Playwright、rollback migrationを追加する。

## API変更方針

新規公開APIおよび既存API変更はない。

| API | 既存責務 | CLIとの境界 |
|---|---|---|
| `POST /api/v1/auth/register` | 通常USERの登録とメール認証開始 | CLIは利用せず、role入力も追加しない |
| `POST /api/v1/auth/login` | 有効・認証済みユーザーのログイン | CLI作成管理者の動作確認に利用する |
| `PATCH /api/v1/admin/users/:id/role` | 既存ユーザーの昇格・降格 | CLIは既存ユーザーを更新しない |

- HTTP statusやAPI error responseは変更しない。
- CLI errorはHTTP statusを持たず、終了コードと固定日本語メッセージで表現する。
- `docs/04_api.md` は完了時に更新不要を再確認する。

## UI / A11Y方針

- Web UI、frontend、ARIA、focus管理、loading/error/empty stateは本タスクの対象外。
- CLIはANSI color、絵文字、画面位置制御へ依存しない。
- stdoutとstderrを用途別に分け、短い日本語テキストと終了コードで状態を伝える。
- `--help` はTTY以外でも読めるplain textにする。
- interactive promptは追加せず、非対話実行可能性を維持する。

## CLI利用仕様

### 入力

| 入力 | 引数 | 環境変数 |
|---|---|---|
| username | `--username` | `ADMIN_USERNAME` |
| email | `--email` | `ADMIN_EMAIL` |
| password | `--password` | `ADMIN_PASSWORD` |

- 引数を優先し、引数が `undefined` の項目だけ環境変数で補完する。
- 引数で空文字・空白だけを明示した場合、環境変数へfallbackせず入力エラーにする。
- 環境変数の空文字・空白だけも入力エラーにする。
- 未知option、位置引数、値がないoptionは終了コード2。
- `--help` は作成処理とDB dependency loadを行わず終了コード0。

### 終了コード

| code | 条件 |
|---|---|
| `0` | 作成成功、`--help` |
| `1` | 重複、DB設定不足、DB/Prismaエラー、想定外エラー |
| `2` | 引数解析、必須値不足、空値、validationエラー |

`process.exit()` は使わず `process.exitCode` を設定する。

### 安全な出力

| 状況 | stream | 固定方針 |
|---|---|---|
| 成功 | stdout | `管理者アカウントを作成しました` |
| help | stdout | option名、環境変数名、優先順位、警告。実データ例なし |
| password引数使用 | stderr | 環境変数方式を推奨する警告 |
| 引数解析失敗 | stderr | `コマンド引数が正しくありません` |
| validation失敗 | stderr | 入力値を含まない既存日本語validation message |
| 重複 | stderr | `ユーザー名またはメールアドレスは既に使用されています` |
| DB設定不足 | stderr | `データベース接続設定がありません` |
| DB/想定外エラー | stderr | `管理者アカウントの作成に失敗しました` |
| disconnect失敗 | stderr | 内部詳細を含まない終了処理の一般警告 |

次は出力しない。

- username/email/passwordの値。
- passwordHash、User ID。
- DB接続文字列、環境変数名 `DATABASE_URL`。
- Prisma errorのmessage、code、meta、query、stack。
- `parseArgs` errorの生message。

### Docker Compose運用

標準手順は環境変数方式とし、信頼された運用者だけが実行する。

```bash
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

unset ADMIN_USERNAME ADMIN_EMAIL ADMIN_PASSWORD
```

- password引数方式はprocess list・shell historyへ残る可能性があるため非推奨。
- 環境変数も同一OS userやprocess introspectionに対して完全な秘密保護ではない。共有ホストでは実行しない。
- `.env`、Compose file、repository、CI logへ管理者認証情報を保存しない。
- `docker compose exec` 権限とDB接続環境を持つ主体は管理者作成権限を持つものとして扱う。

## 公開インターフェース案

実装コードではなく責務を固定する型シグネチャ案とする。

```typescript
export type ParsedCreateAdminArguments = {
  username?: string;
  email?: string;
  password?: string;
  help: boolean;
};

export type ResolvedCreateAdminInput = {
  username: string | undefined;
  email: string | undefined;
  password: string | undefined;
  passwordSource: "argument" | "environment" | "missing";
};

export type NormalizedCreateAdminInput = {
  username: string;
  email: string;
  password: string;
};

export type CreateAdminCliExitCode = 0 | 1 | 2;

export type CreateAdminCliResult = {
  exitCode: CreateAdminCliExitCode;
  stdout: readonly string[];
  stderr: readonly string[];
};

export type CreateAdminRuntimeDependencies = {
  createAdmin: (input: NormalizedCreateAdminInput) => Promise<void>;
  disconnect: () => Promise<void>;
};

export function parseCreateAdminArguments(
  argv: readonly string[],
): ParsedCreateAdminArguments;

export function resolveCreateAdminInput(
  args: ParsedCreateAdminArguments,
  env: NodeJS.ProcessEnv,
): ResolvedCreateAdminInput;

export function normalizeAndValidateCreateAdminInput(
  input: ResolvedCreateAdminInput,
): NormalizedCreateAdminInput;

export function hashPassword(password: string): Promise<string>;

export class AdminCreateError extends Error {
  readonly code: "DUPLICATE_USER";
}

export function createAdmin(input: NormalizedCreateAdminInput): Promise<void>;

export function runCreateAdminCommand(input: {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  loadDependencies: () => Promise<CreateAdminRuntimeDependencies>;
}): Promise<CreateAdminCliResult>;

export function main(): Promise<void>;
```

## テスト方針

- `docs/07_testing_flow.md` に従い Red → Green → Refactor で進める。
- pure input/runner test: `backend/src/scripts/createAdmin.test.ts`。
- DB service test: `backend/src/services/admin-create.service.test.ts`。
- password helper test: `backend/src/lib/password.test.ts`。
- entrypoint lifecycle test: `backend/src/scripts/createAdmin.cli.test.ts`。
- Prisma、bcrypt、遅延dependency loader、stdout/stderrをmockする。
- unit testではP2002 mappingを検証し、実DBの同時実行はDocker手動確認として区別して記録する。
- frontend test、Playwrightは追加しない。DB/frontend変更がないためである。
- shared hash helper移行の回帰確認としてbackend全testとTypeScript buildを実行する。

### 品質チェック

```bash
cd backend
npm run format
npm run lint
npm run format:check
npm run test -- --run
npm run build
```

repository rootで `git diff --check` も実行する。

## テストケース一覧

### 入力解析・解決

| ケース | 期待結果 |
|---|---|
| 引数3項目 | 引数だけで解決 |
| 環境変数3項目 | 環境変数だけで解決 |
| 引数と環境変数の項目単位混在 | 各項目を正しく補完 |
| 同一項目を両方に指定 | 引数を優先 |
| 引数が空文字、環境変数が有効 | fallbackせず終了コード2 |
| 引数が空白だけ | 終了コード2 |
| 環境変数が空文字・空白だけ | 終了コード2 |
| 各必須項目が `undefined` | 終了コード2 |
| 未知option | 固定引数エラー、終了コード2 |
| 位置引数 | 入力値を出力せず終了コード2 |
| option値なし | 固定引数エラー、終了コード2 |
| `--help` | DB loader/service未呼び出し、終了コード0 |
| helpと作成option混在 | helpを優先し作成しない |

### validation・正規化

| ケース | 期待結果 |
|---|---|
| 正常username/email/password | validation成功 |
| username 3文字未満・20文字超過 | 日本語validationエラー |
| username不正文字 | 日本語validationエラー |
| email不正 | 日本語validationエラー |
| password 8文字未満 | 日本語validationエラー |
| 大文字・小文字・数字・記号の各不足 | 対応する日本語validationエラー |
| password内部space | 日本語validationエラー |
| passwordがusernameまたはemailと同一 | validationエラー |
| username/email前後空白 | 一度だけtrimした値をvalidationとserviceへ渡す |
| password前後空白 | `normalizePassword()` の結果をvalidationとhashへ渡す |
| email大文字 | 小文字化しない |
| validation成功後 | service入力が正規化済みobjectと完全一致 |

### password hash・DB作成

| ケース | 期待結果 |
|---|---|
| password hash | bcrypt cost 12 |
| User.create | 平文passwordを渡さずpasswordHashだけを渡す |
| 正常作成 | `role=ADMIN`、`emailVerified=true`、`isActive=true`、`deletedAt=null` |
| token/UserStats model | createを呼ばない |
| username重複P2002 | 既存userを更新せず安全な重複エラー |
| email重複P2002 | 既存userを更新せず安全な重複エラー |
| 既存USER/ADMIN重複 | role、password、状態を変更しない |
| 想定外Prisma error | 生errorを出力せず終了コード1 |
| auth/user service回帰 | 共通helper移行後もcost 12と既存挙動を維持 |

### CLI lifecycle・安全性

| ケース | 期待結果 |
|---|---|
| 成功 | 終了コード0、DB dependency load、disconnectを各1回 |
| 重複 | 終了コード1、disconnectを1回 |
| DB error | 終了コード1、disconnectを1回 |
| help | DB dependencyをloadせず終了コード0 |
| parse/validation error | DB dependencyをloadせず終了コード2 |
| DB設定不足 | DB moduleをloadせず安全な固定エラー、終了コード1 |
| disconnect失敗・作成成功 | 終了コード0を維持し一般警告のみ |
| disconnect失敗・作成失敗 | 元の終了コード1を維持 |
| password引数使用 | 環境変数推奨警告 |
| password環境変数使用 | 引数警告なし |
| stdout/stderr全体 | username、email、password、hash、ID、接続文字列を含まない |
| parseArgs error | 生messageを含まない |
| Prisma error | message、code、meta、stackを含まない |

### Docker手動確認

| ケース | 期待結果 |
|---|---|
| 環境変数方式 | 管理者作成成功 |
| 引数方式 | 作成成功と安全な警告 |
| DB状態 | ADMIN、認証済み、有効、未削除、hash保存 |
| login | 既存login APIで成功 |
| Admin API | 既存管理者APIへアクセス可能 |
| 通常register | ADMINを作成できない |
| 同一username/email再実行 | 既存userを変更せず失敗 |
| 同一入力を2processで並行実行 | 1件だけ作成され、片方は重複失敗 |
| CLI出力 | 禁止情報・DB詳細なし |
| 実行後 | ADMIN環境変数をunset |

## リリース・移行方針

- DB migration、既存データmigration、API deploy順序は発生しない。
- CLI codeとnpm scriptをbackend releaseへ含める。
- Docker Compose開発・運用環境では `tsx` とdevDependenciesが利用可能であることを確認する。
- devDependenciesを除外する本番runtimeでCLIが必要な場合は、build済みentrypointまたは専用ops jobを別計画で設計する。
- リリース前にformat、lint、format check、全test、build、Docker手動確認を完了する。
- 管理者認証情報をrepository、image、Compose config、CI artifactへ含めない。

## ロールバック方針

- DB変更なしのためrollback migrationは不要。
- CLI、service、npm script、docsは変更種別ごとのcommitをrevertする。
- shared password helper refactorはauth/user serviceと一体でrevertし、既存testを通す。
- code rollbackで作成済み管理者を自動削除しない。
- 不要な検証用管理者は、別の利用可能な管理者から既存Admin APIで明示的に退会させる。
- 最後の利用可能な管理者を削除・降格しない。
- DB変更が追加された場合は本方針を無効とし、計画更新後に作業する。

## リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| password引数がhistory/process listへ残る | 認証情報漏えい | 環境変数方式を標準化し、引数使用時に警告 |
| 環境変数を `.env` へ常設 | 長期漏えい | `.env.example`へ追加せず、一時export/unsetを文書化 |
| CLI実行権限が広い | 不正な管理者作成 | trusted operatorだけにDocker/DB操作権限を限定 |
| parseArgsの生error出力 | 入力値漏えい | 固定メッセージへmap |
| Prisma error出力 | DB内部情報漏えい | code判定と固定メッセージ、stack非出力 |
| helpがDB設定へ依存 | 障害時にusage確認不能 | help/input検証をDB load前に完了 |
| 空引数がenvへfallback | 意図しないuser作成 | 未指定と明示空値を区別 |
| 正規化値と保存値のずれ | login不能・重複ずれ | 一度だけ正規化したobjectを共用 |
| email casing差異 | 重複・login挙動の混乱 | 本タスクはtrimのみ、全体正規化は別計画 |
| bcrypt設定重複 | cost変更漏れ | helper一元化と既存認証回帰test |
| concurrency race | 重複または内部error | DB unique + P2002 mapping + 実DB並行手動確認 |
| 既存userを暗黙更新 | 認可境界破壊 | create専用、update/upsert禁止test |
| disconnect失敗を作成失敗扱い | operator再実行・重複 | 作成結果codeを維持し一般警告 |
| tsxが本番にない | productionで実行不能 | Docker Composeを標準対象、本番opsは別計画 |

## 作業手順

1. 本計画、`docs/05_progress.md`、規約、認証・admin・CLI既存実装を再確認する。
2. `docs/05_progress.md` の対象タスクを `[-]` にする。
3. pure CLI input/runner testをRedで追加する。
4. password helperとadmin create service testをRedで追加する。
5. CLI lifecycle testをRedで追加する。
6. `emailSchema` と `hashPassword()` を実装し、既存auth/user serviceを挙動変更なしで移行する。
7. admin create serviceを実装する。
8. pure CLI logicを実装する。
9. 遅延dependency loadを行う `.cli.ts` entrypointを実装する。
10. `admin:create` npm scriptを追加する。
11. Docker運用・task guideを更新する。
12. Refactor、format、lint、format check、全test、build、`git diff --check` を実行する。
13. Dockerで環境変数方式、引数方式、並行実行、login、Admin APIを手動確認する。
14. `docs/04_api.md` 更新不要とDB変更なしを再確認する。
15. 進捗、本計画checkbox、実装完了記録を更新する。

## タスクリスト

| タスクID | 内容 | 対象ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存仕様再確認と進捗開始更新 | docs、関連backend | 責務境界と非スコープを確認し、進捗が `[-]` | High |
| T2 | CLI契約確定 | 本plan | 入力、優先順位、終了code、固定出力、権限境界が確定 | High |
| T3 | pure CLI Red test | `createAdmin.test.ts` | 入力・正規化・validation・DB未load testが失敗 | High |
| T4 | hash/service Red test | `password.test.ts`、`admin-create.service.test.ts` | hash、保存状態、P2002、非更新testが失敗 | High |
| T5 | lifecycle Red test | `createAdmin.cli.test.ts` | exit、遅延load、disconnect、安全出力testが失敗 | High |
| T6 | 共通validation/hash helper | validation、password、auth/user service | 共通化され既存挙動を維持 | High |
| T7 | admin create service | `admin-create.service.ts` | 単一create、ADMIN状態、P2002変換を実装 | High |
| T8 | pure CLI logic | `createAdmin.ts` | parse、resolve、normalize、validate、result mappingを実装 | High |
| T9 | entrypoint/npm script | `.cli.ts`、`package.json` | 遅延load、exitCode、disconnect、npm実行を実装 | High |
| T10 | 運用文書更新 | `docs/09_startup_commands.md`、`docs/12_task_guide.md` | 推奨env方式、権限境界、unset、tsx手順を記載 | High |
| T11 | Refactor・format | backend | 重複除去、`npm run format` 成功 | High |
| T12 | lint・format check・build | backend | 3コマンド成功 | High |
| T13 | 全test | backend | `npm run test -- --run` 成功 | High |
| T14 | Docker手動確認 | Docker環境 | 作成、login、Admin API、重複、並行、安全出力を確認 | High |
| T15 | 変更要否再確認 | schema、`docs/04_api.md` | DB/API変更なしと追加検証不要理由を記録 | Medium |
| T16 | 進捗・plan完了更新 | progress、本plan | `[x]`、checkbox、実装完了記録を更新 | High |

- [ ] T1: 既存仕様再確認と進捗開始更新
- [ ] T2: CLI契約確定
- [ ] T3: pure CLI Red test
- [ ] T4: hash/service Red test
- [ ] T5: lifecycle Red test
- [ ] T6: 共通validation/hash helper
- [ ] T7: admin create service
- [ ] T8: pure CLI logic
- [ ] T9: entrypoint/npm script
- [ ] T10: 運用文書更新
- [ ] T11: Refactor・format
- [ ] T12: lint・format check・build
- [ ] T13: 全test
- [ ] T14: Docker手動確認
- [ ] T15: 変更要否再確認
- [ ] T16: 進捗・plan完了更新

## 実装完了時の更新ルール

- 対象ファイル一覧と実際の変更を一致させる。
- 完了taskを `[x]` にする。
- 計画変更、TDD記録、品質check、Docker手動確認を記録する。
- DB/API/frontend変更が追加された場合は、必要なmigration・文書・Playwrightを追記する。
- `docs/05_progress.md` を `[x]` にする。
- 次の `## 実装完了` を更新する。

## 実装完了

- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/admin-create-cli
- PR: #N

### 計画からの変更点

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|

### TDD実施記録

| フェーズ | 内容 | 結果 |
|---|---|---|
| Red | | |
| Green | | |
| Refactor | | |

### 品質チェック

| コマンド | 結果 |
|---|---|
| `npm run lint` | |
| `npm run format:check` | |
| `npm run test -- --run` | |
| `npm run build` | |
| `git diff --check` | |

### 手動確認結果
