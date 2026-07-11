# 監査ログ実装計画

> 設計者ロール: セキュリティ・監査設計に責任を持つシニアフルスタックエンジニア

- 進捗タスク: `docs/05_progress.md` フェーズ10「監査ログ実装（ログイン/PW変更/管理者操作・個人情報除外）」
- 計画書パス: `docs/plans/audit-log/plan.md`
- 主対象: backend のDB監査証跡
- 対象API: `POST /api/v1/auth/login`、`PATCH /api/v1/users/me` のパスワード変更、`POST /api/v1/auth/reset-password`、管理者の変更系API
- UI: 今回は非対象。監査ログ閲覧API・管理画面は既存仕様と進捗タスクに含まれない

## レビュー結果と改善方針

### この計画のまま実装すべきではない理由

初版は保存禁止項目と対象イベントを詳細に整理できているが、ログイン成功まで完全なbest-effortとするため「認証は成功したが監査証跡がない」状態を許すこと、Prisma mockだけでtransaction rollbackを保証しようとしていること、既存のraw errorログを監査対象外として見落としていることが重大な不足である。また、失敗イベントを識別情報なしで保存する設計はプライバシー面では安全だが、request IDもIPもない現状では個別調査に使えず、件数・時刻の傾向把握に限定される。この限界を明示しないまま「調査可能」と評価してはいけない。

本改善版では、ログイン成功・パスワード変更・パスワードリセット・管理者操作の成功ログを本体DB更新と同一transactionへ含め、成功証跡を必須化する。ログイン失敗と管理者の業務失敗だけをbest-effortとし、既存レスポンスを変えない。さらにDocker PostgreSQLを使う実DB確認を必須にし、raw errorオブジェクトを出力する既存ログも安全な固定ログへ変更する。

### DBの整合性と負荷

| 指摘内容 | 根拠: 確認できた事実 | 根拠: 推測 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|---|
| ログイン失敗による無制限増加 | `POST /auth/login` は失敗を監査対象とし、現行rate limitはプロセスメモリ内・IP単位。フェーズ11の本番rate limitは未完了 | 複数instanceや送信元分散ではDB書込み数が増える | 容量圧迫、index肥大化、認証DB負荷 | validation/429は非対象、既存rate limit維持、保持期間を本番前の決定事項にし、負荷試験と容量試算を追加 | High |
| 初版のindexは概ね妥当 | 想定検索は時系列、action、target単位。閲覧APIは未実装 | `result`単独filterが将来必要になる可能性 | 過剰indexはinsertを遅くする | 初期indexを時系列、action、targetに限定し、result indexは実クエリ後に追加 | Medium |
| User relationを持たない方針は妥当 | 現行User削除はsoft deleteだが、`docs/02_security.md`は完全削除を記載 | 将来physical deleteへ変わる可能性 | cascadeで監査証跡が消える | actorId/targetIdをrelationなしの内部ID snapshotとして保持 | High |
| mockだけではrollbackを保証できない | 現行テストはPrisma mock中心で、`docs/07_testing_flow.md`はintegration testを将来扱いとしている | callback mockは実PostgreSQLのatomicityとisolationを再現しない | 監査insert失敗時に本体だけcommitする不具合を見逃す | unit testに加え、Docker PostgreSQLで失敗注入または制約違反によるrollbackを手動・integration確認 | High |
| migrationはexpand-onlyにできる | 新規table/enum/indexのみで既存column変更やbackfillは不要 | 特になし | 既存データへの影響は小さい | table追加のみ。アプリrollback時もtableを残し、収集済み証跡をDROPしない | Low |
| actionをDB enumにすると運用負荷が高い | 新しい管理者操作の追加が想定される | action追加のたびにmigrationが必要 | deploy順序・rollbackが複雑化 | 安定したresultだけPrisma enum、action/target/reasonはTS許可リスト+strict runtime validation | Medium |

### API・コードの整合性

| 指摘内容 | 根拠: 確認できた事実 | 根拠: 推測 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|---|
| ログイン成功をbest-effortにすると成功証跡が欠落する | 初版はログイン成功・失敗の両方をbest-effortとしていた | audit insertだけ失敗してtoken発行が成功する可能性 | 要件上の「ログイン成功を記録」を保証できない | password検証後の状態更新・streak・refresh token作成・成功監査をtransaction化。成功監査失敗は500でrollback | High |
| transaction refactorでbcryptを内包する危険 | 現行`login()`はbcrypt比較をDB transaction外で行う | 安易な全体transaction化でbcrypt待ち中に接続を占有する | lock時間・pool枯渇 | user取得とbcrypt比較はtransaction外。成功後のDB mutationだけを短いtransactionにする | High |
| 失敗ログの調査能力が限定的 | request ID基盤は未実装。IP/User-Agent/email/hashは保存しない | 個別攻撃元や同一入力の相関は取れない | 「調査可能性」を過大評価する | 今回は時刻・件数傾向の把握に限定と明記。request ID連携はフェーズ11後の別migration | Medium |
| admin retry内で重複記録し得る | 現行admin mutationはSerializable transactionを最大2回試行する | retry callback外/内の位置を誤ると失敗・成功ログが複数になる | 同一操作の重複証跡 | 成功insertはtransaction callback内、失敗insertは全retry終了後の外側で1回だけ実行 | High |
| 既存raw errorログが秘密情報除外方針と衝突 | `forgot-password` routeは`console.error("[forgot-password] internal error:", err)`でerror objectを出力する | SMTP/DB errorに内部接続情報やメールが含まれる可能性 | 個人情報・内部情報の運用ログ漏えい | raw errorを出さず固定eventだけを出力する安全helperへ置換。外部通知はフェーズ11 | High |
| status文書不整合 | `docs/04_api.md`冒頭はロックを403とする一方、実装とlogin testは401 | frontendが誤ったstatusを前提にする可能性 | 監査追加時に無関係なAPI変更が混入 | 実装statusは変更せずdocsを401へ補正 | Medium |
| routeでの監査は重複しやすい | 成功判定とtransactionはserviceが所有する | routeとservice双方に追加される可能性 | 二重記録・項目差 | 監査責務はserviceのみ。route testはレスポンス回帰に限定 | High |
| 内部入力にもruntime検証が必要 | 監査APIは公開しないためroute zodは存在しない | `as`や将来コードから余分なkeyが渡る可能性 | metadataや秘密値混入 | `AuditEventInput`のdiscriminated unionとstrict zod schemaを共通service内で適用 | High |

### UI / A11Y

| 指摘内容 | 根拠: 確認できた事実 | 根拠: 推測 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|---|
| 今回UIを追加しない判断は妥当 | `/admin`画面とfrontend admin API clientは未実装で、管理者ダッシュボードは別進捗タスク | API計画へUIを含めると範囲が膨らむ | backend監査基盤が遅延 | 今回はfrontend変更なしと明記 | Low |
| 後続閲覧UIのA11Y契約が不足すると実装がぶれる | 現時点で監査閲覧仕様はない | table/filter/paginationを視覚だけで作る可能性 | keyboard・screen readerで調査不能 | 後続計画にcaption、th scope、label、aria-busy/live、focus管理、色非依存を引き継ぐ | Medium |
| 既存画面の回帰確認は必要 | DB変更時はPlaywright必須 | audit失敗時500やtransaction変更がlogin/settings/reset表示に影響し得る | ユーザー導線の回帰 | login、settings、reset、代表admin操作をPlaywright確認 | High |

### テストの妥当性

| 指摘内容 | 根拠: 確認できた事実 | 根拠: 推測 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|---|
| 初版の禁止項目テストは妥当 | password/token/body/error等を列挙している | key名を変えたmetadata混入を見逃す可能性 | 秘密情報漏えい | strict schemaのunknown key拒否とPrisma createの完全なkey集合を検証 | High |
| transaction retry境界テストが不足 | adminはP2034 retryを持つ | retryごとにaudit rowが増える | 重複監査 | 1回目P2034・2回目成功、全retry失敗をテスト | High |
| 実DB確認が不足 | mock中心 | FKなし・enum・index・rollbackの実挙動差 | productionのみ失敗 | migrate deploy後にDocker DBでrow件数とrollbackを確認 | High |
| 既存API回帰を具体化すべき | login/password/adminには既存testがある | audit mock追加で既存mock shapeを壊す | unrelated test failure | endpoint別既存test全通過とstatus/body/Cookie不変を完了条件化 | High |
| frontend自動A11Y testは今回不要 | frontend変更なし | 特になし | 不要なscope拡大 | Playwrightで既存導線回帰のみ。閲覧UI追加時にcomponent/A11Y test | Low |

## 背景・目的

セキュリティ事故や権限操作の事後調査に必要な最小限の証跡として、「誰が・いつ・何を・どの対象へ行い・成功したか」をDBへ保存する。ログイン失敗のように操作者を特定できないイベントも、個人情報や認証情報を保存せず件数・発生時刻の傾向を把握できるようにする。

監査DBはHTTPアクセスログやエラートラッキングとは別責務とする。`docs/02_security.md`の外部ログ保存とrequest IDはフェーズ11の構造化ログ基盤で扱い、今回の監査tableへ未実装情報を推測で追加しない。

## スコープ

- 専用`AuditLog` Prisma modelとmigration。
- action、result、target type、安全なfailure reasonの一元管理。
- 許可リスト方式の共通監査service。
- ログイン成功・service到達後の失敗。
- 認証済みユーザーのパスワード変更成功。
- パスワードリセット成功。
- 管理者によるユーザー停止・解除・ロール変更・強制退会の成功と業務失敗。
- 成功操作のtransaction整合性と失敗操作のbest-effort方針。
- 個人情報・秘密情報・任意payloadの混入防止。
- 関連APIの既存status/body/Cookie回帰。
- Prisma検証、migration deploy、backend test、Playwright、実DBレコード確認。
- `forgot-password`のraw error object出力を固定された安全ログへ置換。
- `docs/04_api.md`、`docs/05_progress.md`、本planの更新。

## 非スコープ

- 監査ログ閲覧API・管理画面・frontend API client。
- 管理者の一覧・詳細・統計など参照系APIのアクセス監査。
- メール認証、forgot-password申請、username変更、logout、refreshの監査。
- validation失敗、rate limit 429、auth/admin middleware拒否のDB監査。
- IP、User-Agent、メールアドレスhash、session IDの保存。
- request ID基盤の新設。
- 外部ログ収集サービス・Sentry連携。
- 保持期間cleanup job。
- DB管理者による改ざんを防ぐWORM/署名/ハッシュチェーン。
- 既存APIの成功レスポンス・ステータスコード変更。

## 現状調査結果

### 確認できた事実

- `docs/plans/audit-log/plan.md`は本計画作成前には存在しない。
- `docs/05_progress.md`フェーズ10に対象タスクがあり、Admin APIsは実装済み、管理者ダッシュボードは未実装。
- loginは`POST /api/v1/auth/login`。rate limit、zod validation、ブルートフォースlockを持つ。
- 認証済みパスワード変更は`PATCH /api/v1/users/me`のpassword payload branch。
- password resetは`POST /api/v1/auth/reset-password`。
- password変更/resetは既にPrisma transactionでpassword更新とtoken削除をまとめている。
- admin変更系はstatus、role、force deleteで、Serializable transactionとP2034 retryを持つ。
- admin参照系はusers list/detail/statsであり、今回の進捗名に参照監査の記載はない。
- `backend/src/types/index.ts`にrequest IDはない。
- `backend/src/index.ts`はHono `logger()`を使用するが、監査DB serviceはない。
- `forgot-password`はraw error objectを`console.error`へ渡している。
- Prisma v7.8、`PrismaPg` adapter、`prisma.config.ts`管理で、schema datasourceに`url`はない。
- User削除は現行service/adminともsoft delete。
- `docs/02_security.md`は監査対象にメール認証を含め、外部ログサービス保存と完全削除を記載するため、現行実装・進捗範囲と差がある。

### 推測・未確定事項

- 本番の監査ログ件数、保持期間、管理者の調査頻度は未確定。
- ログイン失敗をrequest IDや送信元なしで個別追跡することはできず、時刻と件数の傾向調査に限定される。
- 将来の監査閲覧APIでは時系列、action、target、resultのfilterが必要になる可能性が高い。
- DB管理者レベルの改ざん耐性が必要かは未確定。
- 退会時に内部IDだけの監査証跡を残すことがプライバシーポリシー上許容されるかは未確定。

## 監査対象と境界

| 操作 | success | failure | actor | target | failure reason |
|---|---:|---:|---|---|---|
| login | 対象 | service到達後のみ対象 | successはuser ID/role、failureはnull | successはUSER/user ID、failureはnull | failureは`AUTHENTICATION_FAILED`へ集約 |
| password change | 対象 | 非対象 | user ID/role | USER/同一user ID | — |
| password reset | 対象 | 非対象 | null | USER/token recordのuser ID | — |
| admin suspend | 対象 | service業務失敗を対象 | admin ID/ADMIN | USER/target ID | 安全な分類code |
| admin reactivate | 対象 | service業務失敗を対象 | admin ID/ADMIN | USER/target ID | 安全な分類code |
| admin role change | 対象 | service業務失敗を対象 | admin ID/ADMIN | USER/target ID | 安全な分類code |
| admin force delete | 対象 | service業務失敗を対象 | admin ID/ADMIN | USER/target ID | 安全な分類code |
| validation / 429 / middleware拒否 | 非対象 | 非対象 | — | — | — |
| admin参照、メール認証、username変更 | 非対象 | 非対象 | — | — | — |

## 保存項目と保存禁止項目

### 保存項目

- 監査ログID。
- 許可リスト内のaction。
- `SUCCESS`または`FAILURE`。
- actor内部User ID、操作時role。特定不能ならnull。
- target typeと内部ID。対象なし・特定不能ならnull。
- 許可リスト内の安全なfailure reason。successならnull。
- DB defaultによる発生日時。

### 保存禁止項目

- 平文・hash済みpassword、current/new/confirm password。
- JWT、refresh token、verify/reset token、token hash。
- Cookie、Authorization、session識別子。
- email、username、氏名。
- IP、User-Agent。
- request/response body、headers、query全体。
- Zod issue、Error、Prisma error、DB error message、stack、内部path。
- 操作前後のUser objectや差分JSON。
- 環境変数、秘密設定。
- 任意metadata、無制限Json payload。

## 実装方針

1. 監査eventの定数、型、strict zod schemaを`audit-events.ts`へ集約する。
2. `audit.service.ts`はschema検証後、明示した列だけで`auditLog.create`を呼ぶ。
3. service APIはrequest/body/headers/error/metadataを受け取らない。
4. 成功監査は本体の最終的なDB mutationと同一transactionへ含める。
5. loginのuser取得とbcrypt比較はtransaction外で実行し、成功後のDB mutationだけを短いtransactionへまとめる。
6. login成功時はJWT secret確認・JWT署名・refresh token raw値/hash生成をtransaction前に完了する。transaction内でアカウント状態とroleを再確認し、同じ状態の行だけを条件付き更新してから`lastLoginAt`/失敗回数、streak、refresh token row、成功監査を確定する。transaction commit後に署名失敗して成功証跡だけ残る順序を作らず、password検証後の停止・role変更競合も成功させない。
7. 既存`updateLoginStreak()`とrefresh token作成処理は`Prisma.TransactionClient`を受け取れる形へ分け、transaction内からglobal `prisma`へ抜けない。
8. login失敗はoriginal `AuthError`を保持したままbest-effortで1回記録する。
9. admin成功監査はSerializable callback内、失敗監査は全retry終了後に1回だけ記録する。
10. route/middlewareでは監査を書かず、serviceを唯一の記録責務とする。
11. best-effort失敗時はerror objectを出力せず、action/resultを含む固定安全ログだけを出す。
12. retention・閲覧・外部転送は後続判断として分離する。

## DB変更方針

### Prisma model案

```prisma
enum AuditResult {
  SUCCESS
  FAILURE
}

model AuditLog {
  id            String      @id @default(cuid())
  action        String
  result        AuditResult
  actorId       String?
  actorRole     Role?
  targetType    String?
  targetId      String?
  failureReason String?
  occurredAt    DateTime    @default(now())

  @@index([occurredAt(sort: Desc), id(sort: Desc)])
  @@index([action, occurredAt(sort: Desc)])
  @@index([targetType, targetId, occurredAt(sort: Desc)])
  @@map("audit_logs")
}
```

- User relationは持たない。actor/target削除で監査証跡をcascade deleteしない。
- action/target/reasonは追加頻度を考慮してDB enumにせず、書込みserviceの許可リストで制御する。
- native `VarChar`長は既存ID形式と将来拡張を不必要に拘束するため初期案では付けない。容量対策は任意payloadを持たないことで行う。
- `result`単独indexは低選択性のため追加しない。
- N+1は発生しない。監査insertは1操作1rowで、User relationのincludeを行わない。
- migrationは新規table/enum/indexのみのexpand-only。backfillなし。
- code rollback時もtableを保持し、収集済みログを削除しない。

## API変更方針

新しい公開APIは追加しない。以下の既存APIに内部副作用を追加するが、request/response/status/Cookieを変更しない。

| method/path | 認証・認可 | 既存status | 監査副作用 |
|---|---|---|---|
| `POST /api/v1/auth/login` | 不要、rate limitあり | 200/400/401/403/429/500 | service到達後のsuccess/failure。validation/429は非対象 |
| `PATCH /api/v1/users/me` password branch | auth必須、password branchのみrate limit | 200/400/401/403/429/500 | successのみ |
| `POST /api/v1/auth/reset-password` | 不要、rate limitあり | 200/400/404/429/500 | successのみ |
| `PATCH /api/v1/admin/users/:id/status` | auth+ADMIN | 200/400/401/403/404/409/500 | suspend/reactivateのsuccessとservice業務failure |
| `PATCH /api/v1/admin/users/:id/role` | auth+ADMIN | 200/400/401/403/404/409/500 | successとservice業務failure |
| `DELETE /api/v1/admin/users/:id` | auth+ADMIN | 200/400/401/403/404/409/500 | successとservice業務failure |

- login lock中は現行実装/testどおり401。`docs/04_api.md`の403記載を補正する。
- audit必須insert失敗は既存の想定外error経路で500「サーバーエラーが発生しました」。内部理由を返さない。
- username変更、admin参照APIには監査副作用を追加しない。

## 公開インターフェース案

```typescript
import { AuditResult, type Prisma, type Role } from "@prisma/client";

export const AUDIT_ACTIONS = {
  LOGIN: "LOGIN",
  PASSWORD_CHANGE: "PASSWORD_CHANGE",
  PASSWORD_RESET: "PASSWORD_RESET",
  ADMIN_USER_SUSPEND: "ADMIN_USER_SUSPEND",
  ADMIN_USER_REACTIVATE: "ADMIN_USER_REACTIVATE",
  ADMIN_USER_ROLE_CHANGE: "ADMIN_USER_ROLE_CHANGE",
  ADMIN_USER_FORCE_DELETE: "ADMIN_USER_FORCE_DELETE",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_TARGET_TYPES = { USER: "USER" } as const;
export type AuditTargetType =
  (typeof AUDIT_TARGET_TYPES)[keyof typeof AUDIT_TARGET_TYPES];

export const AUDIT_FAILURE_REASONS = {
  AUTHENTICATION_FAILED: "AUTHENTICATION_FAILED",
  TARGET_NOT_FOUND: "TARGET_NOT_FOUND",
  SELF_OPERATION_DENIED: "SELF_OPERATION_DENIED",
  LAST_ADMIN_PROTECTED: "LAST_ADMIN_PROTECTED",
  TARGET_STATE_CONFLICT: "TARGET_STATE_CONFLICT",
  SERIALIZATION_CONFLICT: "SERIALIZATION_CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type AuditFailureReason =
  (typeof AUDIT_FAILURE_REASONS)[keyof typeof AUDIT_FAILURE_REASONS];

export type AuditEventInput =
  | {
      action: AuditAction;
      result: typeof AuditResult.SUCCESS;
      actorId: string | null;
      actorRole: Role | null;
      targetType: AuditTargetType | null;
      targetId: string | null;
      failureReason: null;
    }
  | {
      action: AuditAction;
      result: typeof AuditResult.FAILURE;
      actorId: string | null;
      actorRole: Role | null;
      targetType: AuditTargetType | null;
      targetId: string | null;
      failureReason: AuditFailureReason;
    };

export type AuditLogClient = Pick<Prisma.TransactionClient, "auditLog">;

export function recordAuditEvent(
  client: AuditLogClient,
  input: AuditEventInput,
): Promise<void>;

export function recordAuditEventBestEffort(input: AuditEventInput): Promise<boolean>;
```

- `AuditResult`のruntime値は`@prisma/client`生成物を利用し、同じ値を別定数へ重複定義しない。
- password、email、token、request、headers、body、error、metadataを入力型へ追加しない。

## UI / A11Y方針

- 今回はfrontend変更なし。
- DB変更の回帰として既存login/settings/reset/admin導線をPlaywright確認する。
- 後続の監査閲覧UIでは以下を必須とする。
  - tableに`caption`、headerに`scope`を設定する。
  - filterに可視labelを付け、keyboardだけで適用・解除できる。
  - result/role/actionを色だけで表現しない。
  - loadingは`aria-busy`、errorは`role="alert"`、件数変化は適切な`aria-live`で通知する。
  - filter適用後とpagination後のfocus移動方針を定義する。
  - 空状態、取得失敗、再試行を支援技術でも理解可能にする。

## テスト方針

- AGENTS.mdに従い、各実装単位でRed→Green→Refactorを実施する。
- `audit.service.test.ts`を実装ファイルと同じ`services/`へ置く。
- endpoint testは既存の`login.test.ts`、`reset-password.test.ts`、`users/update-me.test.ts`、admin endpoint別testを維持する。
- business/transaction検証はservice testへ置く。
- Prisma mockへ`auditLog.create`とtransaction clientを追加する。
- mock testでは呼出し回数、完全なcreate引数、retry境界、error mappingを検証する。
- 実PostgreSQL確認ではmigration、enum、index、rollback、1操作1rowを確認する。
- frontend自動testは追加しない。Playwrightで既存画面回帰を確認する。

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/prisma/schema.prisma` | 修正 | AuditLog/AuditResult追加 |
| `backend/prisma/migrations/20260711105051_add_audit_logs/migration.sql` | 新規 | table/enum/index追加 |
| `backend/src/services/audit-events.ts` | 新規 | action/target/reason/strict schema |
| `backend/src/services/audit.service.ts` | 新規 | 必須・best-effort記録service |
| `backend/src/services/audit.service.test.ts` | 新規 | 共通監査処理test |
| `backend/src/services/auth.service.ts` | 修正 | login/reset監査、login成功DB mutation transaction化 |
| `backend/src/routes/auth/index.ts` | 修正 | raw error objectを安全な固定ログへ置換 |
| `backend/src/routes/auth/login.test.ts` | 修正 | login監査と回帰test |
| `backend/src/routes/auth/forgot-password.test.ts` | 修正 | raw error非出力test |
| `backend/src/routes/auth/reset-password.test.ts` | 修正 | reset監査test |
| `backend/src/services/user.service.ts` | 修正 | password変更成功監査 |
| `backend/src/services/user.service.test.ts` | 修正 | transaction/秘密除外test |
| `backend/src/services/admin.service.ts` | 修正 | admin監査descriptorとretry境界 |
| `backend/src/services/admin.service.test.ts` | 修正 | admin success/failure/retry test |
| `docs/04_api.md` | 修正 | 監査副作用、login status不整合補正 |
| `docs/09_startup_commands.md` | 修正 | schema変更後のPrisma Client再生成条件を明記 |
| `docs/05_progress.md` | 修正 | 実装中/完了とplan link |
| `docs/plans/audit-log/plan.md` | 修正 | 本計画と実装完了記録 |

## テストケース一覧

### 共通監査service

| ケース | 期待結果 |
|---|---|
| success必須項目 | `auditLog.create`が1回、許可列だけで呼ばれる |
| failure必須項目 | failureReason必須で保存される |
| successにfailureReason | strict schemaで拒否 |
| failureでreasonなし | strict schemaで拒否 |
| actor null | 安全に保存可能 |
| target null | targetType/targetIdともnullで保存可能 |
| targetTypeとtargetIdの片方だけ指定 | schemaで拒否 |
| 未定義action/target/reason | schemaで拒否しDB未呼出し |
| password/email/token/Cookie/Authorization追加 | unknown keyとして拒否 |
| body/headers/error/metadata追加 | unknown keyとして拒否 |
| occurredAt | 呼出し側から受け取らずDB defaultを使用 |
| best-effort insert失敗 | falseを返しraw errorを出力しない |

### login

| ケース | 期待結果 |
|---|---|
| success | `LOGIN/SUCCESS`が1件、actor/targetはuser ID |
| success audit失敗 | user update/streak/refresh token/auditがrollbackし500、Cookie/token非発行 |
| password検証後に停止 | transaction内再確認で403、success処理・success監査なし |
| transaction内再確認直後に状態変更 | 条件付き更新0件を409へ変換し、再試行を求める |
| user不存在 | `LOGIN/FAILURE`、actor/target null |
| password不一致 | user不存在と同じ監査形状 |
| stopped/deleted/unverified/locked | 個人情報なし、reasonは共通 |
| validation 400 | 監査なし |
| rate limit 429 | 監査なし |
| failure audit失敗 | original 401/403を維持 |
| transaction内bcrypt | 呼ばれないことをtest可能な構造にする |
| response | 既存status/body/HttpOnly Cookie不変 |

### password変更/reset

| ケース | 期待結果 |
|---|---|
| password変更success | 本体更新/token削除/`PASSWORD_CHANGE`が同一transaction |
| current password不一致 | 監査なし |
| success audit失敗 | password更新/token削除ともrollback、500 |
| reset success | token消費/password更新/token削除/`PASSWORD_RESET`が同一transaction |
| reset actor | null、targetはrecord.userId |
| reset無効/期限切れ/二重使用 | 監査なし |
| 秘密情報 | password/hash/reset tokenがcreate引数にない |
| Cookie/status | 既存挙動不変 |

### admin変更系

| ケース | 期待結果 |
|---|---|
| suspend/reactivate | actionを正しく分け、1件success |
| role change | actor/targetを分離し、変更前後roleを保存しない |
| force delete | soft delete/token削除/auditを同一transaction |
| self operation | `SELF_OPERATION_DENIED`を1件failure |
| target不存在 | `TARGET_NOT_FOUND`を1件failure。未検証path値は保存せずtargetはnull |
| last admin | `LAST_ADMIN_PROTECTED`を1件failure |
| target state競合 | `TARGET_STATE_CONFLICT`を1件failure |
| P2034後にretry成功 | success監査は最終transactionの1件だけ |
| 全retry失敗 | `SERIALIZATION_CONFLICT` failureを外側で1件。対象未確認のためtargetはnull |
| success audit失敗 | 本体更新をrollback |
| validation/401/403 | 監査なし |
| response | 既存日本語error/status不変 |

### 実DB・回帰

| ケース | 期待結果 |
|---|---|
| migration deploy | 既存データを変更せず成功 |
| schema/index確認 | 想定table/enum/indexのみ追加 |
| rollback確認 | 必須audit insert失敗時に本体rowが変化しない |
| 1操作1row | login/password/adminの各successで1件のみ |
| 保存禁止項目検索 | DB rowにemail/password/token/body/stackなし |
| 既存test | login/password/adminを含む全backend test通過 |
| Playwright login | success/failure表示とCookieに回帰なし |
| Playwright settings/reset | password導線に回帰なし |
| Playwright admin | ADMIN成功、USER拒否を維持 |

## リリース・移行方針

1. migrationを先に適用できるexpand-only構造にする。
2. 本番deploy順はmigration deploy→backend codeとする。
3. migration前に本番バックアップ取得時刻を確認する。
4. 既存データbackfillは行わず、deploy後のイベントから記録する。
5. deploy直後にlogin success/failure、password、代表admin操作のrowを確認する。
6. audit write errorの安全ログを監視し、発生時はbackend rollbackを判断する。
7. 保持期間未決定のまま長期運用しない。本番公開前に容量試算・保持・削除方針を決定する。

## ロールバック方針

- backend不具合時は監査接続codeをrevertし、追加table/enum/indexは残す。
- 収集済み監査ログを失うため、通常rollbackで`DROP TABLE audit_logs`を行わない。
- migration自体に問題があり未使用・空tableであることを確認できた場合のみ、別の明示的migrationを検討する。
- password/admin transaction変更をrevertする場合、既存token無効化・Serializable transaction挙動へ完全に戻ることを既存testで確認する。
- rollback後も既存API status/body/Cookieを維持する。

## リスクと対策

| リスク | 対策 |
|---|---|
| 個人情報・認証情報混入 | discriminated union、strict schema、許可列だけのcreate、Jsonなし |
| metadata経由の漏えい | metadata引数・列を作らない |
| login failureからユーザー列挙 | actor/target null、理由codeを共通化 |
| login failureの調査力不足 | 時刻・件数傾向に限定と明記し、request IDは後続 |
| 大量ログでDB圧迫 | validation/429除外、rate limit維持、保持方針を本番前決定 |
| 監査失敗と本体成功の不整合 | successは同一transaction、failureのみbest-effort |
| transaction長期化 | bcrypt・外部I/Oをtransaction外に置く |
| admin retryによる重複 | successはcallback内、terminal failureはretry外で1回 |
| 一部admin mutationの記録漏れ | 共通helperのaudit descriptor必須化 |
| actor削除で証跡消失 | User relationなし |
| raw errorログ漏えい | error objectを固定安全ログへ置換 |
| 閲覧APIの情報露出 | 今回追加しない。後続で専用response型とADMIN認可 |
| DB enum運用負荷 | resultだけenum、拡張頻度の高い値はTS許可リスト |
| mockと実DB差 | Docker PostgreSQLでrollback・row件数確認 |
| 無制限保持 | retention決定とcleanupを後続必須課題化 |
| DB管理者改ざん | 今回の保証外。DB権限分離/外部WORMを別設計 |

## 作業手順

1. 本plan、進捗、API、規約、編集ガイド、schema、関連service/route/testを再読する。
2. `docs/05_progress.md`を`[-]`へ更新する。
3. Prisma model/migrationを追加し、format/validate/generateを確認する。
4. 共通監査service testをRedで追加する。
5. event定数・schema・serviceを実装してGreen→Refactorする。
6. login監査testをRedで追加し、成功DB mutation transactionと失敗best-effortを実装する。
7. password変更/reset監査testをRedで追加し、既存transactionへ監査insertを統合する。
8. admin監査testをRedで追加し、descriptor・retry境界を実装する。
9. `forgot-password`のraw errorログtestを追加し、安全ログへ置換する。
10. 保存禁止項目・重複防止・既存response回帰testを補強する。
11. format、lint、build、全testを実行する。
12. Docker内で`npx prisma migrate deploy`を実行する。
13. 実DBでrollback、1操作1row、保存禁止項目を確認する。
14. Playwrightでlogin/settings/reset/代表admin操作を確認する。
15. `docs/04_api.md`、`docs/05_progress.md`、本planを実態に合わせる。
16. DB、機能、test、docsを目的別commitに分けてpushし、PRを作成する。

## タスクリスト

| ID | 内容 | ファイル | 完了条件 | 依存 | 優先度 |
|---|---|---|---|---|---|
| T1 | 仕様・実装・矛盾の再確認 | 指定docs、関連backend | 対象/非対象/未確定事項を確定 | なし | High |
| T2 | 進捗を実装中へ更新 | `docs/05_progress.md` | `[-]`とplan link | T1 | High |
| T3 | schema/migration追加 | Prisma files | expand-only、validate/generate成功 | T1 | High |
| T4 | 共通監査service Red test | `audit.service.test.ts` | 許可/禁止/null/unknown keyがRed | T3 | High |
| T5 | event型・schema・service実装 | audit service files | T4 Green、任意payload不可 | T4 | High |
| T6 | login監査 Red test | `login.test.ts` | success/failure/rollback/回帰がRed | T5 | High |
| T7 | login監査実装 | `auth.service.ts` | success atomic、failure best-effort、T6 Green | T6 | High |
| T8 | password/reset監査 Red test | user/reset tests | success/rollback/秘密除外がRed | T5 | High |
| T9 | password/reset監査実装 | auth/user services | 本体とauditがatomic、T8 Green | T8 | High |
| T10 | admin監査 Red test | `admin.service.test.ts` | 全action/failure/retry/重複がRed | T5 | High |
| T11 | admin監査実装 | `admin.service.ts` | descriptor必須、success atomic、failure1件 | T10 | High |
| T12 | raw errorログ修正 | auth route/test | error object非出力、既存200維持 | T5 | High |
| T13 | 横断security test | 関連tests | 禁止項目・重複・response回帰 | T7,T9,T11,T12 | High |
| T14 | Prisma/migration実DB確認 | backend/Docker | deploy、index、rollback成功 | T13 | High |
| T15 | 品質チェック | backend | format/lint/build/all test成功 | T13 | High |
| T16 | Playwright回帰 | login/settings/reset/admin | 主要導線成功、裏500なし | T14,T15 | High |
| T17 | 手動DB確認 | `audit_logs` | 1操作1row、禁止情報なし | T14 | High |
| T18 | docs実装完了更新 | API/progress/plan | 実態一致、`[x]`、完了欄 | T16,T17 | High |

- [x] T1: 仕様・実装・矛盾の再確認
- [x] T2: 進捗を実装中へ更新
- [x] T3: Prisma schema/migration追加
- [x] T4: 共通監査service Red test
- [x] T5: event型・strict schema・共通service実装
- [x] T6: login監査 Red test
- [x] T7: login成功atomic・失敗best-effort実装
- [x] T8: password変更/reset監査 Red test
- [x] T9: password変更/reset監査実装
- [x] T10: admin監査 Red test
- [x] T11: admin監査とretry境界実装
- [x] T12: raw errorログ安全化
- [x] T13: 秘密情報除外・重複防止・回帰test
- [x] T14: Prisma/migration/実DBrollback確認
- [x] T15: format/lint/build/all test
- [x] T16: Playwright主要導線確認
- [x] T17: 手動DBレコード確認
- [x] T18: API・進捗・plan実装完了更新

## セキュリティ確認項目

- [x] password/passwordHash/current/new/confirmを保存しない。
- [x] JWT/refresh/verify/reset tokenとtoken hashを保存しない。
- [x] Cookie/Authorization/session IDを保存しない。
- [x] email/username/氏名/IP/User-Agentを保存しない。
- [x] request/response/body/headers/query/error/stackを保存しない。
- [x] 任意metadata/Json列がない。
- [x] login failureのactor/targetはnullで理由は共通。
- [x] actorIdとtargetIdを分離する。
- [x] route/middlewareで重複記録しない。
- [x] success監査は本体transaction内。
- [x] admin retryで重複しない。
- [x] auth/admin/rate limitを弱めない。
- [x] audit update/delete APIがない。
- [x] raw error objectを運用ログへ出さない。
- [x] datasourceに`url =`を追加せずPrismaPgを維持する。

## 手動確認項目

- login success後に`LOGIN/SUCCESS`が1件だけ保存される。
- login failure後にemail/password/user IDを含まないfailureが1件保存される。
- user不存在とpassword不一致のrow形状が同じである。
- password変更/reset後に秘密情報を含まないsuccessが1件保存される。
- admin停止/解除/role/force deleteでactorId/action/targetType/targetId/resultが正しい。
- actorとtargetが異なる操作で取り違えがない。
- audit insert失敗時、login success/password/adminの本体更新がrollbackする。
- login failure audit失敗時もoriginal 401/403が維持される。
- DB rowにpassword/token/Cookie/Authorization/email/username/body/stackがない。
- APIの既存response/status/Set-Cookieが変わらない。
- migration deployが既存データを壊さない。
- Playwrightでlogin/settings/reset/adminの主要導線と裏500なしを確認する。
- 大量failure時のrate limit、row増加、DB容量影響を確認する。

## 確認事項

1. 保持期間とcleanup jobを本番公開前に決定する。暫定的な無期限保持を恒久運用にしない。
2. 退会時に内部IDだけの監査証跡を保持する方針をプライバシーポリシーと整合させる。
3. `docs/02_security.md`にあるメール認証監査を後続追加するか決める。
4. 外部ログサービスはDB監査とは別にフェーズ11で実装する。
5. request ID基盤導入後、nullable列追加または外部ログ相関方式を検討する。
6. DB role分離、append-only権限、外部WORMが必要か決める。
7. 監査閲覧API/UIの要否と閲覧可能roleを管理者ダッシュボード計画で決める。

## 実装完了

- 完了日: 2026-07-11
- 実装ブランチ: `feature/audit-log`
- PR: 未作成（チャットで内容確認後に作成）

### 計画からの変更点

- 公開API・UIの追加はなく、計画したbackend監査範囲をそのまま実装した。
- 管理者画面は未実装のため、Playwright確認では既存画面の代わりにBrowserから公開HTTP APIを呼び、USERの403拒否とADMINの停止・解除成功を確認した。
- DockerのHono containerはschema変更前のPrisma Clientを保持していたため、container内で`prisma generate`後にHonoだけを再起動してから回帰確認した。これは成果物の変更ではなく、ローカル検証環境の生成物更新である。
- 大量login failure時の負荷・容量試験は実施していない。rate limitの本番化、保持期間、容量試算と合わせて後続課題とする。
- 実装後レビューで、管理者APIの未検証path値が失敗監査の`targetId`へ入る問題を確認した。DBで対象を確認できた失敗だけ内部IDを保存し、対象不存在・retry枯渇ではtargetをnullにする安全側の設計へ修正した。
- 実装後レビューで、password検証後に管理者停止が完了すると古い状態のままlogin成功を返す競合を確認した。成功transaction内の再確認と条件付き更新を追加し、停止済みは403、再確認直後の競合は409としてsuccess token・success監査を確定しないよう修正した。

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/prisma/schema.prisma` | 修正 | `AuditResult`と`AuditLog`、検索用indexを追加 |
| `backend/prisma/migrations/20260711105051_add_audit_logs/migration.sql` | 新規 | enum・table・indexをexpand-onlyで追加 |
| `backend/src/services/audit-events.ts` | 新規 | action・target・failure reasonとstrict schemaを一元化 |
| `backend/src/services/audit.service.ts` | 新規 | 必須監査とbest-effort監査を許可列だけで保存 |
| `backend/src/services/audit.service.test.ts` | 新規 | 許可値・禁止項目・null整合性・安全ログを検証 |
| `backend/src/services/auth.service.ts` | 修正 | login成功のatomic化・状態競合防止、login失敗・reset成功監査を追加 |
| `backend/src/routes/auth/index.ts` | 修正 | forgot-passwordのraw error出力を固定eventへ変更 |
| `backend/src/routes/auth/login.test.ts` | 修正 | login成功・失敗・rollback・回帰testを追加 |
| `backend/src/routes/auth/forgot-password.test.ts` | 修正 | raw error非出力testを追加 |
| `backend/src/routes/auth/reset-password.test.ts` | 修正 | reset成功監査と秘密情報除外testを追加 |
| `backend/src/services/user.service.ts` | 修正 | password変更成功監査を既存transactionへ追加 |
| `backend/src/services/user.service.test.ts` | 修正 | password変更のatomic性・秘密情報除外testを追加 |
| `backend/src/services/admin.service.ts` | 修正 | 管理者action descriptorとretry境界の監査を追加 |
| `backend/src/services/admin.service.test.ts` | 修正 | success/failure/P2034 retry/重複防止testを追加 |
| `docs/04_api.md` | 修正 | 監査副作用・対象外・秘密除外とlogin status/Cookie pathを実装へ整合 |
| `docs/09_startup_commands.md` | 修正 | schema変更・branch切替後のPrisma Client再生成を明記 |
| `docs/05_progress.md` | 修正 | 対象タスクを完了へ更新 |
| `docs/plans/audit-log/plan.md` | 修正 | 実績、検証結果、後続課題を反映 |

### TDD実施記録

| フェーズ | 対象 | 結果 |
|---|---|---|
| Red | 共通監査service | 未実装moduleによりtest collection失敗を確認 |
| Green | 共通監査service | 23件全通過 |
| Red | login監査 | 新規8件失敗、既存18件通過を確認 |
| Green | login監査 | 26件全通過 |
| Red | password変更・reset監査 | 新規4件失敗、既存22件通過を確認 |
| Green | password変更・reset監査 | 26件全通過 |
| Red | 管理者操作監査 | 新規15件失敗、既存7件通過を確認 |
| Green | 管理者操作監査 | 22件全通過。横断test追加後の現行件数は23件 |
| Red | forgot-password安全ログ | 新規2件失敗、既存3件通過を確認 |
| Green | forgot-password安全ログ | 5件全通過 |
| Red | レビュー修正: 未検証target ID除外 | 新規・変更4件失敗、既存21件通過を確認 |
| Green | レビュー修正: 未検証target ID除外 | 管理者service 25件全通過 |
| Red | レビュー修正: login状態競合 | 新規2件失敗、既存26件通過を確認 |
| Green | レビュー修正: login状態競合 | login route 28件全通過 |
| Refactor | 全backend | 重複整理とformat後、48 files・439 tests全通過 |

### 検証結果

| 種別 | コマンド・確認内容 | 結果 |
|---|---|---|
| Prisma | `prisma format`、`prisma validate`、`prisma generate` | 成功 |
| Migration deploy | Docker PostgreSQLへ`prisma migrate deploy` | 成功。14 migrations適用済みを確認 |
| Schema/index | 実DBの`audit_logs`、enum、3 indexを確認 | 計画どおり |
| Rollback | 一時検証scriptで本体更新後の監査insertを意図的に失敗 | transaction全体がrollbackし、対象user未更新・監査row未追加 |
| Format/Lint/Build/Test | backend format、lint、format check、build、全test | 全成功。48 files・439 tests通過 |
| Playwright: login | 誤password、正常login、reload後の認証状態 | 401表示、正常redirect/toast、認証維持を確認 |
| Playwright: password | settingsからpassword変更、reset tokenで再設定 | どちらも成功しloginへ遷移 |
| Playwright: admin | USERで停止API、ADMINで一時userの停止・解除 | USERは403、ADMINは両操作成功 |
| Browser console/backend | console errorと確認対象requestの500 | console errorなし、確認対象に500なし |
| 実DBレコード | 一時user/adminで対象操作後に許可列を確認 | 期待8件。LOGIN failure 1、LOGIN success 3、password change 1、reset 1、suspend 1、reactivate 1 |
| 秘密情報・重複 | 8 rowの形状、USERのmiddleware拒否、actor/target | 個人情報・秘密情報なし、拒否時rowなし、actor/target正常。検証dataは削除済み |

### 後続確認事項

- 保持期間・cleanup: 本番公開前に件数試算、保持期間、削除jobを決める。大量failureの負荷・容量試験も同時に行う。
- 外部ログ・request ID: フェーズ11の構造化ログで実装し、DB監査との相関方法を決める。
- 閲覧API/UI: 必要性、閲覧可能role、filter、pagination、A11Yを管理者ダッシュボード計画で設計する。
- メール認証監査: `docs/02_security.md`との範囲差を整理し、後続追加の要否を決める。
- 退会時の監査証跡: relationを持たない内部IDの保持をプライバシーポリシーと整合させる。
- DB権限分離・改ざん耐性: append-only権限、管理DB role分離、外部WORMの必要性を判断する。
