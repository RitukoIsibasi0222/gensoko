# R6 アカウント完全削除 v0.1 ゲート実装計画

> 設計者ロール: シニアフルスタックエンジニア / セキュリティエンジニア / リリースマネージャー
>
> 2026-07-26以降のv0.1は[`portfolio-release-v0-1-minimal`](../portfolio-release-v0-1-minimal/plan.md)を正本とする。
> M1でproduction DB target、全User・legacy・関連row・AuditLogが`clear`で、M1Rでownerが一般公開・一般登録・実利用者data保存の実績なしを確認した場合、
> T35と既存利用者向けmigration/soakは「v0.1対象外」とし、M6のproduction本人退会smokeだけを公開条件にする。
> DB証拠または実利用者data不存在のowner確認が不明な場合は本計画の通常gateをすべて維持する。
> 2026-07-28のM3 dependency/lockfile更新後は旧M1 evidenceのdocs-only例外を使えないため、新しいrelease候補でM1Rを再確認するまでこの対象外判断をM5へ引き継がない。

## 概要

Release Task R6「完全削除の残る v0.1 gate を完了する」では、実装済みの本人・管理者によるアカウント物理削除を初回公開へ安全に載せ、削除後の旧 access token・refresh token・資格情報が拒否されることを確認する。staging legacy cleanupと既存利用者向けexpand migrationは、production DB証拠とM1Rのowner確認に基づいてv0.1対象外または必要を判断する。

本計画は、既存の [`account-data-complete-deletion`](../account-data-complete-deletion/plan.md) を置き換えない。同計画を完全削除機能全体の設計・実装履歴の正本とし、本計画では v0.1 公開に必要な残作業、証拠、停止条件、R13〜R16 との受け渡しだけを扱う。`deletedAt` の contract migration は初回公開に必須とせず、非参照版の production soak、cleanup 後 backup、旧 Artifact 失効、isolated restore drill が揃うまで列と隔離 SQL を保持する。

## 現状と確認済み事実

調査基点は 2026-07-22 の `develop`、commit `b63afdb` である。本計画作成時は repository の読み取りと文書編集だけを行い、test、build、Docker、Playwright、DB 接続、GitHub Actions、staging/production 操作は実行していない。

| 領域             | 確認済み事実                                                                                             | R6 への影響                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| API              | `DELETE /api/v1/users/me` は password 再確認後に User を物理削除し、成功時に refresh Cookie を削除する   | API 仕様変更ではなく実環境証拠が中心                    |
| DB               | User 所有 relation は cascade、共有 Element と承認期間内の AuditLog は保持する                           | 所有データ消去と保持例外を smoke で混同しない           |
| 認証             | 削除後 login、refresh、旧 access token の拒否を unit/integration で実装済み                              | production では値を記録せず status だけ確認する         |
| staging 性能     | cascade 50,000 answers / 5,000 sessions は 1,446.32ms で合格。ローカル初回 migration baseline も取得済み | managed DB の write 待ち証拠には昇格させない            |
| staging UI       | 本人退会、管理者強制退会、再登録は確認済み。Admin synthetic E2E は run 29802327100 で成功                | T35 legacy cleanup の dry/execute/再実行だけが未完了    |
| cleanup          | 完全一致 staging fixture、dry-run/execute CLI、staging/production manual workflow は実装済み             | 新規 cleanup 実装より既存 gate の承認付き実行を優先する |
| production       | `Production Database Operations` に backup、dry-run、execute、Artifact 検証があるが未実行                | R13 の DB 証拠と R14 の preflight 前に実行しない        |
| schema cleanup   | DB 列非参照 code と隔離 contract SQL は実装済みだが未適用                                                | v0.1 では列を保持し、不可逆 DDL を急がない              |
| privacy          | 監査内部 ID 365 日、backup 最大 7 日、復元時再削除、全損時 replay 残余リスクは承認済み                   | production cleanup の実行体制だけ T1B に残る            |
| production smoke | R5 の smoke は login・reload refresh・rotation・logout・refresh 拒否まで                                 | 本人削除用の一回限り account を別 workflow で扱う       |

## 目的と完了境界

R6全体は次のすべてを満たした時点で完了とする。M1Rが成立するv0.1公開では、1・2・5を公開後へ移して未完了のまま保持できる。

1. staging T35 で完全一致 synthetic legacy fixture の dry-run、execute、実行後 0 件、再実行 0 件、sentinel/Element 保持、flag `false` 復旧を確認する。
2. production cleanup の実行者、承認者、実行時間帯、通知先を T1B に記録する。架空の担当者や連絡先は置かない。
3. R13 の承認付き read-only 証拠から「空 DB 簡略化」または「通常移行」のどちらかを選び、対象外にする作業と維持する gate を記録する。
4. review 済み release 候補を R15 で配備した後、R16 で一回限り synthetic USER の本人削除、旧 access token 401、refresh 401、旧資格情報 401 を確認する。
5. production に既存・legacy row がある場合は、必要な expand migration と legacy cleanup を既存 runbook に従って完了する。0 件の証拠がある場合は未実行作業を「完了」ではなく「v0.1 対象外」として再着手条件付きで記録する。
6. `deletedAt` contract migration、cleanup 後 backup/失効、restore drill、長期 soak は、完了していなければ公開後タスクへ引き継ぐ。R6 完了を理由に元計画の checkbox を偽って完了にしない。

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`backend/src/services/user.service.ts`**

- `createUserService(dependencies): UserService` — User service を構築する。
- `UserService.deleteCurrentUser(input: { userId: string; currentPassword: string }): Promise<void>` — password と最新状態を再確認し、物理削除と成功監査を同一 transaction で行う。

**`backend/src/jobs/deleteLegacySoftDeletedUsers.ts`**

- `deleteLegacySoftDeletedUsers(input: DeleteLegacySoftDeletedUsersInput): Promise<DeleteLegacySoftDeletedUsersResult>` — legacy soft-deleted User を dry-run または固定 batch で削除する。
- `DeleteLegacySoftDeletedUsersMode = "dry-run" | "execute"` — cleanup の実行モード。

**`backend/src/jobs/stagingAccountDeletionCleanupFixtures.ts`**

- `prepareStagingAccountDeletionCleanupFixtures(...)` — 完全一致 legacy target と active/suspended sentinel を作成する。
- `verifyStagingAccountDeletionCleanupFixtureIsolation(...)` — 未知の legacy row、fixture 不整合、Element 欠落を削除前に拒否する。
- `verifyStagingAccountDeletionCleanupFixturesWereCleaned(...)` — target と所有 row の 0 件、sentinel/Element 保持を確認する。
- `removeStagingAccountDeletionCleanupFixtures(...)` — staging synthetic fixture を冪等 cleanup する。

**`backend/src/jobs/stagingAccountDeletionPerformance.ts`**

- `getStagingAccountDeletionPreview(...)` — 最大 session/answer 件数、残存 fixture、Element 前提を read-only 取得する。
- `calculateAccountDeletionPerformanceThresholdMs(platformRequestTimeoutMs): number` — `Math.min(Math.floor(platformRequestTimeoutMs * 0.5), 5_000)` の基準を返す。
- `runStagingAccountDeletionPerformance(...)` — synthetic 所有 row を使って実 service 経路の削除時間を測る。

**`frontend/e2e/production-config.ts`**

- `loadProductionE2EConfig(environment): ProductionE2EConfig` — R5 production auth smoke の URL と専用認証 account を fail-closed 検証する。

**既存 workflow**

- `Staging Account Deletion Cleanup Fixtures` — `prepare` / `verify-isolated` / `verify-cleaned` / `remove`。
- `Staging Account Data Deletion` — staging synthetic-only の `dry-run` / `execute`。
- `Production Database Operations` — backup、migration、production cleanup dry-run/execute。
- `Production Auth Smoke` — R5 の非破壊 auth/refresh/logout smoke。

### release task との依存

| task    | R6 との関係                                                             |
| ------- | ----------------------------------------------------------------------- |
| R5      | production hostname、Cookie、refresh、専用 auth smoke の基礎を提供する  |
| R9      | production cleanup 前 24 時間以内 backup と Artifact 世代を提供する     |
| R11     | R6 code を含む release 候補 SHA の最終品質 gate を行う                  |
| R12     | staging の登録〜本人削除回帰を release 候補で再確認する                 |
| R13     | production User/legacy/関連 row の read-only 証拠から簡略化可否を決める |
| R14     | URL、Environment、flag、backup、rollback、承認体制を preflight する     |
| R15     | 必要な migration と app deploy を別承認で実行する                       |
| R16     | production 本人削除と旧認証拒否の最終証拠を取得する                     |
| R17/R18 | R6 の証拠と公開後へ残す contract/restore 作業を同期する                 |

### 重要な制約

- production DB の row 数、利用者不在、旧 version 未配備を推測しない。
- production DB query、migration、cleanup、deploy、Environment Variable 変更、smoke account 削除は、それぞれの直前承認なしに実行しない。
- cleanup は terminal やローカル shell から直接実行せず、Environment protection 付き workflow だけを使う。
- password、email、username、内部 ID、access token、refresh Cookie、Authorization、DB URL、Secret、raw error を log、Artifact、trace、video、screenshot、文書へ残さない。
- production 用の一回限り削除 account と、R5 の反復利用する auth smoke account を共用しない。
- staging synthetic fixture の ID・識別子を production の削除対象判定へ流用しない。
- `deletedAt` contract SQL を通常の Prisma migration directory へ移さない。
- schema から `deletedAt` を削除するまでは、旧列を暗黙 `RETURNING` しない明示 `select` 契約を維持する。
- R13 の証拠が 0 件以外、不明、接続先不一致なら簡略化せず通常 gate を維持する。

## 対象外

- 本計画作成 PR での staging/production workflow 実行、DB 操作、deploy、smoke 実行。
- 監査内部 ID 365 日保持方針、privacy 文面、backup 7 日境界の再設計。
- external deletion replay ledger の新規導入。承認済み残余リスクを維持する。
- `deletedAt` contract migration の前倒し適用。
- 非同期削除 queue。production 相当条件で同期 cascade が基準超過した場合だけ別計画を作る。
- R7 rate limit、R8 security headers/CORS/log、R9 backup、R10 A11Y の実装。
- production auth smoke account の削除や用途変更。

## 対象ファイル一覧

2026-07-23のrepository実装で実際に変更したファイルへ同期した。実環境gateが残るため、R6全体の`## 実装完了`はまだ追加しない。

| ファイル                                                    | 変更種別 | 内容                                                                     |
| ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `docs/plans/r6-account-deletion-gates/plan.md`              | 修正     | 実装結果、task状態、対象ファイル、未実施gateを同期                       |
| `docs/05_progress.md`                                       | 修正     | repository実装済み・実環境gate未完了を同期                               |
| `docs/plans/portfolio-release-v0-1/plan.md`                 | 修正     | R6の正本リンクと進行状態を同期                                           |
| `docs/plans/account-data-complete-deletion/plan.md`         | 修正     | T1B記録欄、R6 TDD証拠、未完了gateを同期                                  |
| `docs/11_deployment.md`                                     | 修正     | R16 main/recovery-only、停止、flag復旧、証拠記録runbook                  |
| `frontend/e2e/production-account-deletion-config.ts`        | 新規     | 一回限り削除account、URL、reserved identity、確認文字列をfail-closed検証 |
| `frontend/e2e/production-account-deletion-config.test.ts`   | 新規     | production/staging混同、通常account、弱いpassword、不正URLを拒否         |
| `frontend/e2e/production-account-deletion-safety.ts`        | 新規     | refresh Cookie発行・削除契約を個別Set-Cookie単位で厳格検証               |
| `frontend/e2e/production-account-deletion-safety.test.ts`   | 新規     | Cookie属性、重複、別path、flatten誤検知の境界test                        |
| `frontend/e2e/production-account-deletion.spec.ts`          | 新規     | 本人削除、旧access/refresh/login拒否、exact recovery                     |
| `frontend/e2e/production-auth.spec.ts`                      | 修正     | browser/API response双方を扱う既存helperの型境界を明示                   |
| `frontend/e2e/production-config.ts`                         | 修正     | registrable domain所属判定を削除configと共有                             |
| `frontend/playwright.production-account-deletion.config.ts` | 新規     | destructive smokeを分離し、秘密を残す出力を無効化                        |
| `frontend/src/production-account-deletion-contract.test.ts` | 新規     | 専用config/spec/workflow、manual-only、Environment、recovery契約         |
| `frontend/tsconfig.e2e.json`                                | 新規     | Playwright E2E sourceを独立して型検査                                    |
| `frontend/e2e/login-form.ts`                                | 新規     | credential入力前のlogin hydration待機を共有                              |
| `frontend/e2e/admin-force-delete.spec.ts`                   | 修正     | 既存staging E2Eを共有login helperへ置換                                  |
| `frontend/src/staging-playwright-contract.test.ts`          | 修正     | 共有login helperの利用契約を追加                                         |
| `frontend/package.json`                                     | 修正     | production account deletion smoke専用script                              |
| `.github/workflows/production-account-deletion-smoke.yml`   | 新規     | confirmation、Environment、review済みSHA、main/recovery、秘密非出力      |

## API 仕様（関連エンドポイント）

R6 では API contract を変更しない。実装時に現行 API と smoke の不一致が見つかった場合は、先に本計画を再レビューし、`docs/04_api.md` を別 `docs:` commit で同期する。

### エラーレスポンス共通形式

```json
{ "error": "日本語の安全なメッセージ" }
```

### エンドポイント一覧

| メソッド | パス                   | 認証   | リクエスト                    | R6 の期待結果                                                        |
| -------- | ---------------------- | ------ | ----------------------------- | -------------------------------------------------------------------- |
| POST     | `/api/v1/auth/login`   | 不要   | `{ email, password }`         | 削除前 200、削除後の同じ資格情報は汎用 401                           |
| POST     | `/api/v1/auth/refresh` | Cookie | body なし                     | 削除後は 401、refresh Cookie を再発行しない                          |
| GET      | `/api/v1/users/me`     | Bearer | なし                          | 削除前 200、削除前に保持した access token では削除後 401             |
| DELETE   | `/api/v1/users/me`     | Bearer | `{ currentPassword: string }` | 200 `{ "message": "アカウントを削除しました" }`、refresh Cookie 削除 |

DELETE の異常系は現行どおり、入力不正 400、未認証 401、password 不一致または利用不可状態 403、最後の利用可能 ADMIN 409、rate limit 429、generic 500、fail-closed 503 とする。production smoke は synthetic `USER` だけを使い、ADMIN 削除を行わない。

## 実装前の意思決定 gate

| Gate | 決定・証拠                                                                    | 判断者                    | 未決・不合格時                       |
| ---- | ----------------------------------------------------------------------------- | ------------------------- | ------------------------------------ |
| G1   | production cleanup の実行者、承認者、時間帯、通知先。同一人物なら理由と補完策 | product/release owner     | T1B 未完了、production cleanup 停止  |
| G2   | T35 の各 run URL、件数、sentinel/Element、両 flag `false`                     | release/security reviewer | R6 を進行中のまま停止                |
| G3   | R13 の production read-only 集計と deployment/Artifact 証拠                   | product/security owner    | 通常移行 path を維持、簡略化しない   |
| G4   | 一回限り smoke account の reserved identity 規則と作成・検証・削除責任        | product/security owner    | workflow は fixture 値まで、実行停止 |
| G5   | R14 の release SHA、URLs、backup、flags、rollback、mail 到達性                | release manager           | migration/deploy/smoke 停止          |
| G6   | R15 の必要 migration と app deploy の明示承認                                 | release manager           | production 変更なし                  |
| G7   | R16 の本人削除・旧認証 401・recovery/flag 復旧証拠                            | release/security reviewer | R6 未完了、公開停止                  |

## production DB 証拠による分岐

### Path A: 空 DB 簡略化

R13 で active/suspended/legacy を含む User、対象所有 row、旧 production 配備、個人データを含む旧 backup がすべて 0/なしと承認付きで確認できた場合だけ選ぶ。

- legacy cleanup、既存利用者向け段階 migration、旧 backend 長期 soak、旧 backup 失効待ちは「完了」ではなく「v0.1 対象外」と記録する。
- expand index migration は公開 traffic 前・0 row である証拠、24 時間以内 backup、rollback 互換を R14 で確認して R15 の通常 migration として適用する。production を性能試験に使わない。
- T33 managed DB write 待ち再計測は、対象 table 0 row かつ未公開である証拠に基づく限定的な対象外判断とし、将来既存 data へ同 migration を適用する場合の再着手条件を残す。
- production 本人削除 smoke は省略しない。公開版 service、cascade、Cookie、旧認証拒否を production で確認する。

### Path B: 通常移行

User/legacy/関連 row が 1 件以上、証拠不明、接続先不一致、旧 production 配備または旧 backup が存在する場合に選ぶ。
schema v1のPath B判定自体は変更しないが、v0.1で実行するgateは次のように分ける。

- User/legacy/関連row/AuditLogが`present` / `unknown`、DB target不明、またはownerが実利用者data不存在を確認できない場合は、T33、R9 backup、T1B、旧instance drain、dry-run Artifact、expand migration、legacy cleanupを省略しない。
- DB 5項目が`clear`で、ownerが一般公開・一般登録・実利用者data保存の実績なしを確認し、provider・backup履歴だけが`present`の場合は、M1RによりT33、T35、T1B、旧instance drain、legacy cleanup、既存利用者向けmigrationをv0.1対象外にする。
- pending Prisma migrationがある場合だけ、新鮮な暗号化backupを確認して別承認でmigrationを適用する。migrationがなければbackup履歴や新規backupを公開前blockerにしない。
- app deploy後に新規退会が物理削除されることと、旧認証拒否を R16 で確認する。
- `deletedAt` 列は v0.1 中は保持する。T40〜T44 は公開後の soak/backup/restore 条件が揃うまで未完了で維持する。

## production 本人削除 smoke 設計

### account 境界

- R5 の反復用 auth smoke account と別の、削除を目的にした一回限り `USER` を使う。
- 公開 register と実メール verify を通して事前作成し、DB へ fixture を直接 insert しない。
- reserved username/email 規則、email domainのproduction registrable domain所属、期待 username、実行 confirmation がすべて一致しなければ login 前に停止する。
- credential は production Environment Secret から main/recovery job の process env だけへ渡し、`GITHUB_OUTPUT`、Artifact、summary、command line へ渡さない。

### main job

1. manual dispatch、review 済み SHA、production Environment approval、enable flag、confirmation、change record を検証する。
2. production frontend/API の HTTPS、approved host、same-site、`workers.dev` 非使用を値非表示で確認する。
3. synthetic `USER` で login し、profile の username/email/role が期待値と一致しなければ削除前に停止する。
4. access tokenとloginで実際に発行されたrefresh tokenをrunner memory内だけに保持し、設定画面の確認checkboxと削除buttonをkeyboardだけで操作して本人削除する。
5. 200、個別`Set-Cookie`の完全なrefresh Cookie削除契約、anonymous UIを確認する。
6. 削除前access tokenで`GET /users/me`が401、削除前refresh tokenを隔離requestで明示再送したrefreshが401かつtoken再発行なし、同じ資格情報のloginが401かつtoken発行なしであることを確認する。
7. status、run URL、review 済み SHA、実行日時、recovery 状態だけを summary に残す。

### recovery job

- main が非成功・cancel・timeout の場合、別 runner の `always()` job で同じ exact account だけを再確認する。
- login 401は「削除済み」と「Secret不一致・変更済み」を区別できないため成功扱いにせず`failed`とする。login 200かつprofileが期待identityと一致する場合だけ本人削除を再試行し、削除成功時だけ`completed`とする。
- profile不一致、401、その他の非200、5xx、network、非JSON、identity不明では削除せず`failed`とし、公開を停止する。
- mainとrecoveryはjobごとにproduction Environment保護を通る。required reviewer待ちでrecoveryが`Waiting`になった場合は、同じ証拠を確認して別途承認し、未承認のまま成功扱いにしない。
- hard kill で recovery 自体が動かなかった場合は、同じ review 済み SHA と Secret で recovery-only 再実行できる runbook を用意する。
- 成否にかかわらず operator が enable flag を `false` へ戻し、別画面で復旧を確認する。

## 設計上の決定事項

1. **R6 で元の完全削除計画を置き換えるか**
   - 選択: 置き換えない。R6 は v0.1 の残る gate と証拠 mapping だけを正本化する。
   - 根拠: 全体計画の実装履歴と公開前の実行順を混在させないため。

2. **`deletedAt` contract migration を v0.1 必須にするか**
   - 選択: 必須にしない。列と隔離 SQL を保持し、非参照 code を使う。
   - 根拠: User 物理削除の成立に列 drop は不要で、soak・旧 Artifact 失効・restore drill 前の不可逆 DDL は rollback を悪化させるため。

3. **R13 より前に production cleanup の要否を決めるか**
   - 選択: 決めない。0 件の承認付き証拠がない限り Path B を既定とする。
   - 根拠: 利用者不在を推測して移行 gate を省略しないため。

4. **空 DB なら T33 の managed DB 再計測をどう扱うか**
   - 選択: 未公開・対象 row 0 件・旧配備なしが証拠化された場合だけ v0.1 対象外候補とする。
   - 根拠: 0 row の index 作成は既存利用者の write を block しないが、将来 data あり環境へ適用する性能証拠にはならないため。

5. **production 本人削除を既存 auth smoke に追加するか**
   - 選択: 専用 workflow/spec に分離する。
   - 根拠: R5 account を破壊せず、不可逆操作の approval、identity preflight、recovery を独立させるため。

6. **production synthetic account を DB fixture で作るか**
   - 選択: 作らない。公開 register と mail verify を通した一回限り account を事前準備する。
   - 根拠: production DB へのテスト専用直接 write を増やさず、実利用者と同じ経路を確認するため。

7. **失敗時に screenshot/trace/video を残すか**
   - 選択: production destructive smoke では無効化する。
   - 根拠: email、username、session UI、token 周辺情報が Artifact へ残る危険を避けるため。

8. **smoke 失敗時に account が残った場合どうするか**
   - 選択: exact identity を再検証する別 runner recovery だけが本人削除を再試行する。
   - 根拠: cleanup 漏れを減らしつつ、identity 不明時の誤削除を防ぐため。

9. **R6 の完了と元計画 T45 を同一視するか**
   - 選択: 同一視しない。
   - 根拠: R6 は v0.1 境界であり、contract migration・restore drill・長期 soak は公開後も正当に未完了となり得るため。

## 公開インターフェース案

実装コードではなく、実装時に固定する型シグネチャ案を示す。

```typescript
export type ProductionAccountDeletionE2EConfig = Readonly<{
  baseUrl: string;
  apiBaseUrl: string;
  registrableDomain: string;
  email: string;
  username: string;
  password: string;
  confirmation: "DELETE_PRODUCTION_SYNTHETIC_ACCOUNT";
}>;

export function loadProductionAccountDeletionE2EConfig(
  environment: NodeJS.ProcessEnv,
): ProductionAccountDeletionE2EConfig;

export type ProductionAccountDeletionRecoveryStatus = "completed" | "failed";
```

config loader は値を error message に含めず、URL、reserved identity、password byte 境界、confirmation のどれかが不正なら browser/API request 前に例外を投げる。

## TDD・検証方針

実装タスクでは `docs/07_testing_flow.md` に従い、変更対象 test だけで Red → Green → Refactor を行う。外部 workflow の成功を unit test の代わりにせず、workflow contract をローカルで固定してから別承認で実環境確認する。

### Red

- production/staging URL 混同、通常 account、reserved identity 不一致、production registrable domain外のemail、弱い/73 byte 以上 password、confirmation 不一致を拒否する config test を先行する。
- flatten済みheaderの誤検知を避け、個別`Set-Cookie`の発行・削除属性、path、重複を固定するbehavior testを先行する。
- destructive spec が専用 config、本人削除、旧 access/refresh/login 401 を要求する source contract を先行する。
- workflow が manual-only、production Environment、enable flag、confirmation、main/recovery、secret 非出力、trace/video/screenshot 無効を要求する contract test を先行する。

### Green

- config loader、専用 Playwright spec/config、manual workflow、recovery を最小実装する。
- app source、API contract、DB schema は、既存挙動に不備がない限り変更しない。

### Refactor

- URL/identity/password validationをconfig loaderに一元化し、registrable domain所属判定を既存production configと共有して、spec/workflowへ正規表現や判定を複製しない。
- E2E source専用TypeScript設定を追加し、source contractだけでは検出できないbrowser/API response型のずれも品質gateで検出する。
- production auth smoke と安全に共有できる URL validation だけを helper 化し、account credential と destructive gate は共有しない。

## テストケース一覧

| ケース                                                                                   | 期待結果                                                         |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| config: approved HTTPS frontend/API、reserved identity、強い password、confirmation 一致 | config を返す                                                    |
| config: localhost、HTTP、staging/provider URL、cross-site、不正 API path                 | request 前に拒否                                                 |
| config: reserved username/email 規則不一致                                               | login 前に拒否し、値を error へ出さない                          |
| config: reserved local-partだがproduction registrable domain外                           | login前に拒否                                                    |
| config: password 空、弱い、73 UTF-8 bytes 以上                                           | request 前に拒否                                                 |
| workflow: push/pull_request/schedule から destructive job 起動                           | contract test が失敗                                             |
| workflow: production Environment/enable flag/confirmation/reviewer 欠落                  | job を開始しない                                                 |
| workflow: credential を output/summary/CLI 引数へ渡す                                    | contract test が失敗                                             |
| smoke: profile identity/role 不一致                                                      | DELETE を送らず失敗                                              |
| smoke: 本人削除成功                                                                      | keyboardだけで完結し、200、Cookie clear、anonymous UI            |
| smoke: 削除前 access token                                                               | 削除後 `GET /users/me` 401                                       |
| smoke: refresh                                                                           | 削除前tokenを明示再送後401、Cookie再発行なし                     |
| smoke: Cookie headerがflatten、重複、別path、属性不足                                    | 契約不一致として失敗                                             |
| smoke: 同じ資格情報 login                                                                | 汎用 401、内部状態非出力                                         |
| recovery: main 前半失敗、exact account が存在                                            | profile 再検証後に削除し `completed`                             |
| recovery: account削除済みまたはSecret不一致でlogin 401                                   | 判別不能のため`failed`、公開停止                                 |
| recovery: identity不明、その他の非200、5xx、network、非JSON                              | 削除せず`failed`、公開停止                                       |
| T35: exact fixture の dry-run                                                            | legacy target 1、所有 row 2、未知 row 0                          |
| T35: execute と再実行                                                                    | 初回削除成功、再実行 0 件、sentinel/Element 保持                 |
| Path A                                                                                   | 0 件・旧配備なし証拠を記録し、対象外項目と再着手条件を残す       |
| Path B                                                                                   | T33/T36〜T38 を省略せず、backup・dry-run・drain・approval を要求 |

## タスクリスト3回レビュー

### v1 初版

- 現状証拠、T1B、T35、production DB 分岐、production 本人削除 smoke、文書同期を列挙した。
- production cleanup と contract migration を一続きの作業として候補化した。

### v2 セキュリティ・型・エラー観点

- auth smoke account と削除 account を分離した。
- exact identity preflight、manual-only、Environment approval、enable flag、confirmation、main/recovery、秘密非出力を追加した。
- network/5xx/非 JSON/identity 不明では削除せず fail-closed とした。
- config 型の `confirmation` を文字列 literal にし、値を error へ含めない契約を追加した。

### v3 既存実装・DB・テスト観点

- 既存 T35 fixture/workflow と production cleanup workflow を再利用し、重複 cleanup 実装を除外した。
- R13 の 0 件証拠がある場合だけ Path A、その他は Path B とした。
- 既存 integration 成功と production 実環境証拠を分離した。
- `deletedAt` contract migration を v0.1 必須から外し、元計画の未完了状態を維持した。

### v4 確定

- repository で完了できる code/contract/doc、承認付き staging、R13 判断、R14〜R16 production の 4 境界へ分割した。
- R6 完了条件を本人削除・旧認証拒否・必要な移行判断へ絞り、不可逆 DDL と長期運用証拠を公開後へ引き継いだ。
- production 操作は本計画 PR で行わず、各実行時の直前承認を維持した。

## 最終タスクリスト

| タスクID | 内容                                           | ファイル・環境            | 優先度 | 完了条件                                                  |
| -------- | ---------------------------------------------- | ------------------------- | ------ | --------------------------------------------------------- |
| T1       | 現状・R6 境界・既存証拠を同期                  | 本計画/既存計画           | 高     | 未実施を完了扱いせず基点 SHA を記録                       |
| T2       | production 削除 config の Red test             | frontend e2e              | 高     | 不正 URL/identity/password/confirmation で失敗            |
| T3       | production 削除 config を実装                  | frontend e2e              | 高     | fail-closed、値非出力、型整合                             |
| T4       | destructive spec/workflow contract の Red test | frontend/workflow         | 高     | 専用 spec/workflow 不在で意図どおり失敗                   |
| T5       | 本人削除 smoke と recovery を実装              | frontend/workflow         | 高     | delete、旧 access/refresh/login 401、exact recovery       |
| T6       | R6 runbook と T1B 記録欄を同期                 | docs                      | 高     | staging/production 順序、停止、復旧、記録形式が一致       |
| T7       | 実装の対象・関連 test と最終品質 gate          | frontend/backend          | 高     | 対象 test→関連 test→最終 gate 成功                        |
| T8       | T35 staging cleanup を別承認で実行             | staging Actions           | 高     | dry/execute/0 件再実行、sentinel 保持、flags false        |
| T9       | production cleanup 体制を承認                  | docs/運用                 | 高     | 実行者、承認者、時間帯、通知先、必要な補完策を実値で記録  |
| T10      | R13 の証拠で Path A/B を選択                   | production read-only/docs | 高     | 不明時は Path B、対象外は再着手条件付き                   |
| T11      | R14 preflight へ R6 gate を統合                | production/docs           | 高     | SHA、URL、backup、flags、account、rollback 確認           |
| T12      | R15 で選択 path の migration/deploy            | production                | 高     | 別承認、必要操作だけ、run URL 記録                        |
| T13      | R16 で本人削除 smoke を実行                    | production Actions        | 高     | delete、旧 access/refresh/login 401、recovery、flag false |
| T14      | R6・元計画・進捗・release record を同期        | docs                      | 高     | R6 完了/進行中と元計画未完了が実態一致                    |
| T15      | contract/restore/soak 残作業を引継ぐ           | docs/issues               | 中     | owner、残余リスク、再着手条件を記録                       |

- [x] T1: 現状・R6 境界・既存証拠を同期する
- [x] T2: production 削除 config の Red test を作成する
- [x] T3: production 削除 config を実装する
- [x] T4: destructive spec/workflow contract の Red test を作成する
- [x] T5: 本人削除 smoke と recovery を実装する
- [x] T6: R6 runbook と T1B 記録欄を同期する
- [x] T7: 対象・関連 test と最終品質 gate を通す
- [ ] T8: T35 staging cleanup を別承認で実行する
- [ ] T9: production cleanup 体制を承認する
- [x] T10: R13 の証拠で Path A/B を選択する

2026-07-28にrelease候補`7a6979761428759c744ba3bf9c1ed16527c7b33d`のR13/M1 read-only run [30321699906](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30321699906)を承認付きで1回実行した。safe Artifactのexact schema、対象SHA、11 status、decision再計算をreviewし、Vercel production deployment、GitHub production deployment、production backup historyが`present`だったためschema v1ではPath Bを選択した。T10は完了し、M1は未完了のまま維持する。

同日、owner `RitukoIsibasi0222`は一般公開・一般登録・実利用者data保存の実績なしを確認した。DB target、全User、legacy User、User関連row、AuditLogが`clear`であるため、親release計画のM1Rに従いT33、T35、T1B、旧instance drain、dry-run、legacy cleanup、既存利用者向けmigrationをv0.1対象外とする。M2 staging campaignは公開後へ移し、M3品質gateへ進む。

M3はreview済み実行SHA `c127b72bae8bc00956bf7a978b5a64242d466a4b`で完了した。ただし依存更新により`backend/package.json`とlockfileが旧M1 evidence SHAから変わったため、現在のrelease候補ではM1Rを再確認するまでT11以降とM5へ進まない。旧Path Bとowner判断は履歴として保持し、schema v2 / Path C engineや既存data削除で判定を変えない。

- [ ] T11: R14 preflight へ R6 gate を統合する
- [ ] T12: R15 で選択 path の migration/deploy を実行する
- [ ] T13: R16 で production 本人削除 smoke を実行する
- [x] T14: R6・元計画・進捗・release record を同期する
- [ ] T15: contract/restore/soak 残作業を公開後へ引き継ぐ

## リポジトリ実装記録（2026-07-23）

- 実装ブランチ: `feature/r6-account-deletion-gates`
- config guard commit: `a87da89 feat: 本番アカウント削除smokeの設定guardをTDD実装`
- smoke/recovery commit: `027352b feat: 本番アカウント完全削除smokeとrecoveryをTDD実装`
- strict review follow-up commit: `14752bf fix: 本番削除smokeの旧refresh検証とrecovery判定を厳格化`

### Red → Green → Refactor

- Red: config module不在により専用config testが失敗することを確認した。専用spec/config/workflow追加前はsource contract 7件が意図した理由で失敗した。共有login hydration helper追加前はstaging contractがhelper不在で失敗した。
- Green: reserved identity、同一site HTTPS、password、固定確認句のconfig guardと、本人削除・旧access/refresh/login 401・exact recoveryを実装した。workflowはmanual-only、production Environment、review済みSHA、enable flag、confirmation、承認者、change recordをfail-closed検証する。
- Refactor: login hydration待機を`frontend/e2e/login-form.ts`へ一元化し、staging Admin E2Eとproduction本人削除smokeで共有した。credentialやdestructive gateは共有していない。
- 初回確認済み: 関連5 files・49 tests、frontend全体61 files・661 tests、ESLint、Prettier、`npm run check` 0 errors / 0 warnings、実行なしのPlaywright `--list` 2件。

### 厳格レビューfollow-up

- Red: Cookie helper不在、production domain外emailの許可、旧refresh token未再送、recovery 401成功扱い、E2E型検査script不在を、それぞれ対象testの意図した失敗で確認した。型検査追加時には既存production auth helperのbrowser/API response型のずれも検出した。
- Green: loginで実際に発行されたrefresh tokenをmemoryだけに保持し、削除後の隔離requestへ明示再送するよう修正した。Cookieは個別`Set-Cookie`単位で値・path・`HttpOnly`・`Secure`・`SameSite=Strict`・`Max-Age`・重複を検証する。recoveryは401を含む非200をすべて`failed`とし、exact profileの200後に削除成功した場合だけ`completed`とした。
- Refactor: registrable domain所属判定とCookie契約をhelperへ一元化し、main/recovery/source contractで重複判定を作らない形にした。E2E専用`tsconfig`と`check:e2e`を追加し、確認checkboxはSpace、削除buttonはEnterで操作するproduction smoke契約へ強化した。
- DB再レビュー: schema/migration変更はなく、cascade対象外部キーの先頭index・unique・主キーを確認した。本人削除は単一transactionでN+1を発生させず、expand/contract順序も変更しない。既存data量・同時write・rollbackの実環境証拠にはならないため、T33、T35、R13〜R16は未完了のまま維持する。
- 最終品質gate: 関連6 files・63 tests、frontend全体62 files・675 tests、ESLint、Prettier、`npm run check` 0 errors / 0 warnings、`npm run check:e2e`、実credentialを使わないPlaywright `--list` 2件が成功した。

### 計画からの変更点

- login hydration待機の重複を避けるため、計画外だった`frontend/e2e/login-form.ts`を追加し、既存staging spec/contractを共有helperへ更新した。
- API、app route、DB schema、migrationは変更していない。現行API contractとsmokeの期待値が一致したため、`docs/04_api.md`の仕様変更は不要と判断した。
- T8〜T13の実環境操作とT15の公開後引継ぎは未完了である。production/staging接続、GitHub Actions、DB操作、deploy、account作成・削除は本実装では行っていない。
- R6全体の完了条件は満たしていないため、`## 実装完了`は追加せず進行中を維持する。

## 最終タスクリスト（タブ区切り）

```text
タスクID	タスク内容	ファイル・環境	優先度
T1	現状・R6境界・既存証拠を同期	本計画・既存計画	高
T2	production削除configのRed test	frontend e2e	高
T3	production削除configを実装	frontend e2e	高
T4	destructive spec・workflow contractのRed test	frontend・workflow	高
T5	本人削除smokeとrecoveryを実装	frontend・workflow	高
T6	R6 runbookとT1B記録欄を同期	docs	高
T7	対象・関連testと最終品質gate	frontend・backend	高
T8	T35 staging cleanupを別承認で実行	staging Actions	高
T9	production cleanup体制を承認	docs・運用	高
T10	R13の証拠でPath A/Bを選択	production read-only・docs	高
T11	R14 preflightへR6 gateを統合	production・docs	高
T12	R15で選択pathのmigration・deploy	production	高
T13	R16でproduction本人削除smokeを実行	production Actions	高
T14	R6・元計画・進捗・release recordを同期	docs	高
T15	contract・restore・soak残作業を引継ぐ	docs・issues	中
```

## 証拠記録形式

秘密値・PII・内部 ID を含めず、該当しない field は `not-applicable` と理由を記録する。

```text
確認日: YYYY-MM-DD
review済みSHA: <commit>
確認者/承認者: <非秘密識別子>
選択path: A（空DB簡略化）/ B（通常移行）
R13 read-only run: <URL>
staging T35 runs: <URLs>
backup/dry-run/migration/deploy runs: <URLs or not-applicable + reason>
production account deletion smoke: <URL>
delete response: 200
old access / refresh / login: 401 / 401 / 401
recovery: completed / failed
execute/fixture/smoke flags restored: yes/no
残余リスク・公開後タスク: <非秘密の要約>
```

### 2026-07-28 R13/M1証拠記録

- 確認日: 2026-07-28
- review済みSHA: `7a6979761428759c744ba3bf9c1ed16527c7b33d`
- 選択path: B（通常移行）
- R13 read-only run: [30321699906](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30321699906)
- DB・Cloudflare・履歴/copy attestation・変更凍結attestation: `clear`
- Vercel production deployment・GitHub production deployment・production backup history: `present`
- Artifact: schema version 1、exact allowlist、SHA・timestamp・decision再計算一致
- 未実施: staging T35、backup/dry-run/migration/deploy、production account deletion smoke
- M1R判断: ownerが一般公開・一般登録・実利用者data保存の実績なしを確認済み
- v0.1対象外: T33、T35、T1B、旧instance drain、dry-run、legacy cleanup、既存利用者向けmigration
- 再開条件: DB 5項目またはowner確認が不明になる、または実利用者dataを引き継ぐ時は通常gateへ戻る

## 停止・rollback・recovery 条件

- T35 で未知 legacy row、fixture 不整合、Element 欠落、sentinel 変化、cleanup failure があれば両 flag を `false` に戻して停止する。
- R13 のDB接続先・集計が不明、またはownerが実利用者data不存在を確認できない場合はM1Rを選ばない。
- 実利用者dataを引き継ぐPath Bでmanaged DB性能証拠または安全なmigration再設計がなければT36/R15を停止する。
- production preflightでreview済みSHA、rollbackまたは公開停止手順、approvalのいずれかが欠ければ変更操作を行わない。backupはpending Prisma migrationがある場合だけ必須とする。
- smoke の profile identity が一致しない場合は DELETE を送らない。
- 本人削除後は通常 rollback で User/所有 row を復元しない。障害時は新規削除と deploy を停止し、app を互換な直前版へ戻す。
- DB restore が必要な場合は production へ直接上書きせず、isolated project、再削除、traffic 切替前承認を既存 runbook どおり要求する。
- cleanup/contract migration の失敗を理由に raw DB error や対象 ID をチャット・PRへ転載しない。

## 実装完了時の文書同期

実装完了時は次を必ず実態へ合わせる。

- 本計画の対象ファイル一覧、checkbox、Red/Green/Refactor、実際の変更ファイル。
- `docs/plans/account-data-complete-deletion/plan.md` の T1B、T33、T35、T36〜T45。未実施は未完了のまま維持する。
- `docs/plans/portfolio-release-v0-1/plan.md` と `docs/05_progress.md` の R6 状態。
- `docs/11_deployment.md` の実行順、停止条件、run URL、flag 復旧。
- R13〜R18 に引き継ぐ証拠と、v0.1 対象外項目の再着手条件。

R6 は code merge だけ、staging T35 だけ、または production deploy だけでは完了にしない。選択 path の証拠と R16 本人削除 smoke が揃い、元計画の未完了作業が正しく引き継がれた時点で完了とする。
