# Admin APIs ユーザー一覧 詳細 停止 ロール変更 強制退会 統計 実装計画

設計者ロール: シニアフルスタックエンジニア

- 進捗タスク: docs/05_progress.md の Admin APIs ユーザー一覧/詳細/停止/ロール変更/強制退会/統計
- 計画書パス: docs/plans/admin-apis/plan.md
- 主対象: 管理者専用 backend API
- 画面ルート: なし。後続タスクの 管理者ダッシュボード /admin で UI と frontend API client を扱う
- 対象 API: GET /api/v1/admin/users, GET /api/v1/admin/users/:id, PATCH /api/v1/admin/users/:id/status, PATCH /api/v1/admin/users/:id/role, DELETE /api/v1/admin/users/:id, GET /api/v1/admin/stats

## レビュー結果

### この計画のまま実装すべきではない理由

前回計画は admin API の大枠を整理できているが、docs/04_api.md の未確定仕様を補うだけでは、実装時に cursor pagination、最後の管理者保護、昇格できるユーザー条件、統計集計元、削除済みユーザーへの再操作、後続 UI の A11Y 契約で判断が割れる。特に ADMIN 降格・停止・強制退会は、既存 authMiddleware が DB の最新 role / isActive / emailVerified を見ている事実と整合させ、利用可能な管理者を 0 人にしない制約を service 層で固定してから実装する必要がある。

### DB の整合性と負荷

| 指摘内容 | 根拠: 確認できた事実 | 根拠: 推測 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|---|
| admin 一覧の cursor 仕様が不足している | User には createdAt と id があり、前回計画は createdAt desc, id desc を指定していた | cursor に user id だけを渡す実装になりやすい | 同一 createdAt の並び、次ページ条件、cursor 不存在時の status が実装者ごとにずれる | cursor user の createdAt と id を取得し、createdAt が cursor より古い、または createdAt が同じで id が cursor より小さい条件を使う | High |
| admin 検索と filter 用 index 追加の判断が未記録 | User には username/email unique はあるが、createdAt, role, isActive, deletedAt の複合 index はない | 管理画面のユーザー数が増えると一覧が scan / sort になる可能性がある | 何も記録しないと後続で性能問題か migration の必要性を判断しにくい | 本タスクでは DB 変更なし。admin-only かつ take limit plus 1 で bounded にし、実測で遅い場合に別計画で index を追加する | Medium |
| 統計 API が重い集計を選ぶ余地がある | UserStats に totalGames, totalCorrect, totalAnswered, masteredCount, weeklyScore, allTimeScore がある | GameAnswer.count や全件 scan を使うと成長時に重くなる | admin stats がゲーム回答数増加に比例して遅くなる | 全体正答率や回答数は UserStats aggregate sum を優先し、GameSession.count と WeakElement.count のみに留める | High |
| soft delete 方針との整合は妥当だが再操作仕様が曖昧 | deleteCurrentUser は物理削除せず isActive false, deletedAt now にする | admin 強制退会も同じ方針にすべき | 物理削除すると既存の監査・再登録不可方針と衝突する | admin 強制退会も soft delete。削除済みユーザーへの停止解除・ロール変更・強制退会は 409 に固定する | High |

### API コードの整合性

| 指摘内容 | 根拠: 確認できた事実 | 根拠: 推測 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|---|
| admin router が未 mount | backend/src/routes/admin/index.ts は TODO、backend/src/index.ts に /api/v1/admin route 登録がない | 実装者が route だけ作って mount を忘れる可能性がある | テスト用 app では通るが実 API が 404 になる | backend/src/index.ts の mount を独立タスクと route test / 手動確認に含める | High |
| 使える ADMIN の定義が曖昧 | authMiddleware は DB の role, isActive, emailVerified, lockedUntil を見て通過可否を決める | role=ADMIN だけで最後の管理者判定をすると、ログイン不能 ADMIN を数えてしまう | 実際にログインできる管理者が 0 人になる | usable admin を role=ADMIN, isActive=true, deletedAt=null, emailVerified=true, lockedUntil が null または期限切れと定義する | High |
| ADMIN 昇格条件が不足している | authMiddleware はメール未確認ユーザーを 403 にする | 未認証ユーザーを ADMIN にしても管理者として使えない | UI 上は ADMIN だがログインできない管理者が増える | role=ADMIN への変更は emailVerified=true, isActive=true, deletedAt=null のユーザーだけ許可する | Medium |
| access token 内 role との整合が未説明 | authMiddleware は JWT payload の role ではなく DB から取得した role を c.set user に使う | 実装者が古い JWT の role を気にして不要な token 失効を追加する可能性がある | 不要な副作用、または逆に降格即時反映の理解漏れが起きる | ロール変更後の認可は DB role が即時反映される。USER から ADMIN も次 request から有効。追加の refresh token 削除は不要と明記する | Medium |
| error response の詳細が docs より不足 | docs/04_api.md は admin endpoint 一覧と status 更新の簡易仕様のみ | 実装者が 404/409/400 の文言を任意に決める | frontend admin UI と status/message がずれる | admin API 詳細を実装と同時に docs/04_api.md へ追記し、日本語 message を固定する | High |

### アクセシビリティ A11Y

| 指摘内容 | 根拠: 確認できた事実 | 根拠: 推測 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|---|
| 本タスク自体に UI はない | frontend/src/routes に /admin はなく、Header.svelte に admin 導線もない | API 計画に UI 詳細を混ぜるとスコープが膨らむ | backend API の実装タスクが UI 実装まで引きずられる | 本タスクでは UI を作らない。後続 /admin で必要な A11Y 契約だけ記録する | Medium |
| 後続 UI の破壊的操作に A11Y 条件が必要 | 既存 /weak や /ranking は aria-busy, role alert, keyboard 操作、再試行導線を持つ | admin UI は停止・削除・ロール変更など確認操作が多い | keyboard / screen reader で危険操作の対象や結果を理解できない | 後続 UI 方針として table caption、行 action の aria-label、確認 dialog、focus return、loading/error/empty の aria-live を必須化する | High |

### テストの妥当性

| 指摘内容 | 根拠: 確認できた事実 | 根拠: 推測 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|---|
| route test の配置方針は妥当だが、同時実行・境界が不足 | 既存テストは endpoint ごとに test.ts を同階層配置している | status/role/delete は transaction 境界のテストが漏れやすい | race condition で最後の ADMIN 保護をすり抜ける | service test で transaction 内の count / findUnique / update / deleteMany 呼び出し条件を検証する | High |
| frontend test は本タスクの対象外にすべき | admin API client と /admin UI は未実装 | API タスクで frontend test を要求すると作業範囲が曖昧になる | 実装者が不要な client/UI を作り始める | frontend 自動テストは非スコープ。後続 UI 計画に API client、A11Y、keyboard test を引き継ぐ | Medium |
| error response 形式の test が必要 | 既存 route test は error body や validation details を検証している | admin API でも日本語 error と details がずれやすい | frontend が具体 message を表示できない | 各 route test に 400 validation、401、403、404、409、500 の body 形式を含める | High |

## 背景・目的

フェーズ10の管理者機能では、管理者 UI より先に backend API の契約と保護ロジックを固める必要がある。現状は admin middleware は実装済みだが、admin route は TODO で、API 設計書も endpoint 一覧以上の詳細を持たない。

本計画の目的は、管理者だけが安全にユーザー状態とロールを操作し、後続の /admin UI が迷わず接続できる admin API を TDD で実装することである。

## スコープ

- GET /api/v1/admin/users の一覧取得、検索、filter、cursor pagination。
- GET /api/v1/admin/users/:id の詳細取得。
- PATCH /api/v1/admin/users/:id/status の停止/解除。
- PATCH /api/v1/admin/users/:id/role のロール変更。
- DELETE /api/v1/admin/users/:id の強制退会 soft delete。
- GET /api/v1/admin/stats のサービス統計。
- admin service、route validation、route mount、backend unit/route test。
- docs/04_api.md、docs/05_progress.md、本 plan の更新。

## 非スコープ

- 管理者作成 CLI コマンド。
- 監査ログ table / service / UI。
- 管理者ダッシュボード /admin。
- frontend admin API client。
- Header の admin 導線。
- DB schema / migration 変更。
- 既存 users / ranking / weak API の仕様変更。
- 全 API 共通 rate limit の本番設計。

## 現状調査結果

### 確認できた事実

- docs/plans/admin-apis/plan.md は本計画作成前には存在しない。
- docs/05_progress.md フェーズ10に Admin APIs ユーザー一覧/詳細/停止/ロール変更/強制退会/統計 が未完了で存在する。
- docs/04_api.md は admin endpoint 一覧と PATCH /admin/users/:id/status の簡易仕様のみを持つ。
- backend/src/routes/admin/index.ts は TODO のみ。
- backend/src/index.ts は /api/v1/admin router を mount していない。
- adminMiddleware は user がない場合 401、role が ADMIN でない場合 403 を返す。
- authMiddleware は DB から role, isActive, emailVerified, lockedUntil を取得し、JWT payload の role ではなく DB role を user に入れる。
- User には role, emailVerified, isActive, deletedAt, loginFailCount, lockedUntil, lastLoginAt, createdAt, updatedAt が存在する。
- deleteCurrentUser は soft delete 方針で、refresh token / password reset token / email verification token を削除する。
- UserStats は統計の累積値を持ち、ranking 用 index は存在する。
- /admin 画面、frontend admin API client、admin navigation はまだ存在しない。

### 推測

- 初期運用ではユーザー数が少なく、admin-only 一覧の scan / sort は許容できる可能性が高い。
- 将来的にユーザー数が増えると q contains、status filter、createdAt desc pagination に index や検索設計が必要になる可能性がある。
- 監査ログ実装時には、admin service の各 mutation に adminUserId, targetUserId, action, before/after を接続することになる。

## 実装方針

1. admin API の契約を docs/04_api.md に追記する。
2. backend/src/services/admin.service.ts を新規作成し、DB 操作と保護ロジックを route から分離する。
3. route では zod validation、auth/admin middleware、Date の ISO 変換、service error mapping に集中する。
4. mutation は transaction 内で対象ユーザー確認、usable admin 保護、更新、token 削除をまとめる。
5. admin response は必要な public/admin 表示情報だけを select し、passwordHash や token hash は返さない。
6. DB schema は変更せず、性能懸念は bounded query と後続 index 検討として記録する。
7. TDD で route test と service test を先に追加し、Red -> Green -> Refactor の流れで実装する。

## DB変更方針

- DB schema / migration は変更しない。
- 既存 User, UserStats, GameSession, WeakElement, token 系 model を利用する。
- admin list は take limit plus 1 で取得し、最大 100 件に制限する。
- cursor pagination は cursor user の createdAt/id を取得して条件を組み立てる。
- q 検索は username / email の contains とし、trim 後 100 文字以内に制限する。
- index 追加は本タスクでは行わない。実測で遅い場合、別計画で User createdAt/id, User role/createdAt, User isActive/deletedAt/createdAt などを検討する。
- DB 変更が必要になった場合は本計画を更新し、migration、npx prisma migrate deploy、Playwright または手動確認、rollback 方針を追加する。

## API変更方針

### 共通

- 全 endpoint は authMiddleware と adminMiddleware を通す。
- validation error は error=バリデーションエラー と details を返す。
- service error は error message と status を返す。
- 想定外 error は サーバーエラーが発生しました を返す。
- path id と query cursor/q は trim 後の値を一度だけ使う。

### usable admin の定義

最後の管理者保護で数える usable admin は以下をすべて満たすユーザーとする。

- role = ADMIN
- isActive = true
- deletedAt = null
- emailVerified = true
- lockedUntil = null または lockedUntil <= now

### GET /api/v1/admin/users

Query:

| パラメータ | 型 | 既定値 | 説明 |
|---|---|---|---|
| limit | number | 20 | 1〜100。未指定・空文字は 20 |
| cursor | string | なし | 前回 response の nextCursor。trim 後空文字は 400 |
| q | string | なし | username / email の部分一致。trim 後空文字は未指定扱い、最大100文字 |
| role | USER または ADMIN | なし | ロール filter |
| status | active または suspended または deleted | なし | 状態 filter |

Response 200 は users と nextCursor を返す。各 user には id, username, email, role, emailVerified, isActive, deletedAt, lockedUntil, lastLoginAt, createdAt, updatedAt, stats.totalGames, stats.accuracyRate, stats.weeklyScore, stats.allTimeScore を含める。

Status filter:

- active: isActive = true, deletedAt = null
- suspended: isActive = false, deletedAt = null
- deleted: deletedAt != null

### GET /api/v1/admin/users/:id

Response 200 は user を返す。詳細には一覧項目に加えて loginFailCount と stats.totalCorrect, stats.totalAnswered, stats.masteredCount, stats.currentStreak, stats.lastActiveDate, stats.updatedAt を含める。passwordHash と token hash は返さない。

### PATCH /api/v1/admin/users/:id/status

Request は isActive boolean のみ受け付ける。

Rules:

- 自分自身は停止/解除できない。
- usable admin が 0 人になる停止は 409。
- 削除済みユーザーの停止/解除は 409。
- 停止時は lockedUntil を null にし、refresh token / password reset token / email verification token を削除する。
- 解除時は isActive true, lockedUntil null にする。token は再発行しない。

### PATCH /api/v1/admin/users/:id/role

Request は role USER または ADMIN のみ受け付ける。

Rules:

- 自分自身の role は変更できない。
- usable admin が 0 人になる降格は 409。
- 停止済み・削除済みユーザーの role は変更できない。
- ADMIN へ昇格できるのは emailVerified=true, isActive=true, deletedAt=null のユーザーのみ。
- auth は DB role を参照するため、降格は次 request から即時反映される。refresh token の削除は不要。

### DELETE /api/v1/admin/users/:id

Rules:

- 物理削除ではなく soft delete。
- 自分自身は強制退会できない。
- usable admin が 0 人になる強制退会は 409。
- 既に削除済みのユーザーは 409 ユーザーは既に削除されています。
- isActive false, deletedAt now, lockedUntil null を設定する。
- refresh token / password reset token / email verification token を削除する。

### GET /api/v1/admin/stats

Response 200 は以下を返す。

- users.total, users.active, users.suspended, users.deleted, users.admins, users.emailVerified
- games.totalSessions, games.totalAnswered, games.averageAccuracyRate
- learning.totalWeakElements, learning.totalMasteredCount

集計元:

- users: prisma.user.count
- admins: usable admin ではなく role=ADMIN, deletedAt=null の表示用 count
- games.totalSessions: prisma.gameSession.count
- games.totalAnswered / averageAccuracyRate: prisma.userStats.aggregate sum totalAnswered / totalCorrect
- learning.totalWeakElements: prisma.weakElement.count
- learning.totalMasteredCount: prisma.userStats.aggregate sum masteredCount

## UI / A11Y方針

- 本タスクでは UI を実装しない。
- 後続 /admin UI 計画では、以下を必須条件にする。
  - ユーザー一覧は table, caption, th scope を使う。
  - 状態や role を色だけで表現しない。
  - 各行の停止/解除/ロール変更/強制退会ボタンに対象ユーザー名を含む aria-label を付ける。
  - 破壊的操作は確認 dialog または確認フォームを挟み、Esc / Cancel / Enter の keyboard 操作を保証する。
  - 操作完了後は操作元ボタンまたは行の安全な位置へ focus を戻す。
  - loading は aria-busy、error は role alert、空状態と再試行導線は画面内に出す。
  - submit 中は二重実行を防ぎ、button disabled と aria-disabled 相当の状態が伝わるようにする。

## テスト方針

- backend は Vitest で service test と route test を追加する。
- route test は endpoint ごとに同じ backend/src/routes/admin/ 配下へ分ける。
- service test は Prisma mock で where, select, orderBy, take, transaction 内処理を検証する。
- 最初に Red として test を追加し、失敗を確認してから実装する。
- frontend test は本タスクでは追加しない。後続 /admin UI / client 計画で扱う。
- DB schema 変更なしのため migration / Playwright は不要。ただし手動 API 確認は行う。

## リリース・移行方針

- DB migration は発生しない。
- API 追加のみのため、既存ユーザーへのデータ移行は不要。
- リリース前に backend lint / format:check / test を通す。
- docs/04_api.md を先に更新し、後続 frontend 実装が API 契約に従える状態にする。
- 管理者作成 CLI が未完了の間は、開発環境で ADMIN ユーザーを用意する手順を手動確認に記録する。

## ロールバック方針

- DB 変更なしのため rollback migration は不要。
- 問題が出た場合は admin router mount と routes/admin / services/admin.service.ts の実装 commit を revert すれば既存 API 影響を戻せる。
- docs/04_api.md の admin 詳細は実装 revert と同じ commit 単位で戻す。
- 万一 DB index や schema 変更を追加した場合は、本計画を更新し、rollback migration または expand/contract 手順を別途定義する。

## リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| router mount 漏れ | 実 API が 404 | backend/src/index.ts 更新と手動確認を必須タスク化 |
| 最後の usable admin を失う | 管理不能になる | usable admin 定義を service test で固定 |
| soft delete と物理削除の混在 | 監査・再登録方針が崩れる | 強制退会は soft delete に固定 |
| token 削除漏れ | 停止/削除後も refresh できる | mutation transaction で token deleteMany を検証 |
| response に機密情報混入 | passwordHash/token hash 漏洩 | Prisma select を明示し、test で含まれないことを確認 |
| q contains が遅い | ユーザー増加時に admin list が遅い | 最大 limit と q 長を制限し、index は実測後の別計画 |
| 統計 API が全回答 scan になる | 回答数増加で遅い | UserStats.aggregate を優先 |
| frontend scope 混入 | API タスクが肥大化 | frontend admin client/UI は非スコープに固定 |
| A11Y が後続へ伝わらない | 管理 UI が keyboard / screen reader で使いづらい | 後続 UI の必須 A11Y 契約を本 plan に残す |

## 作業手順

1. docs/plans/admin-apis/plan.md, docs/05_progress.md, docs/04_api.md, docs/08_conventions.md, docs/13_codex_editing.md, 関連 backend 実装を読む。
2. docs/05_progress.md の対象タスクを [-] にする。
3. docs/04_api.md に admin API 詳細仕様を追記する。
4. service test を Red として追加する。
5. route test を endpoint ごとに Red として追加する。
6. backend/src/services/admin.service.ts を実装する。
7. backend/src/routes/admin/index.ts を実装する。
8. backend/src/index.ts に admin router を mount する。
9. backend format / lint / test を実行する。
10. Docker 起動環境で ADMIN / USER token を使った手動 API 確認を行う。
11. docs/05_progress.md と本 plan の checkbox を更新する。
12. 本 plan に 実装完了 セクションを追記する。

## タスクリスト

| タスクID | 内容 | 対象ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存仕様・既存実装を再確認し admin API 契約を確定 | docs/04_api.md, docs/05_progress.md, backend 関連ファイル | 未確定 status / response / usable admin 定義が確定している | High |
| T2 | docs/04_api.md に admin API 詳細を追記 | docs/04_api.md | 全 endpoint の request / response / error が記載される | High |
| T3 | service test を追加 | backend/src/services/admin.service.test.ts | 一覧、詳細、status、role、delete、stats の Red test がある | High |
| T4 | route test を追加 | backend/src/routes/admin/*.test.ts | endpoint ごとに auth/admin/validation/service error が検証される | High |
| T5 | admin service の型・エラー・共通 helper を実装 | backend/src/services/admin.service.ts | AdminUserError, Date/統計正規化、usable admin helper が実装される | High |
| T6 | ユーザー一覧・詳細 service を実装 | backend/src/services/admin.service.ts | filter、cursor、select、stats 整形が実装される | High |
| T7 | status / role / force delete service を実装 | backend/src/services/admin.service.ts | transaction、自己操作拒否、最後の usable admin 保護、token 削除が実装される | High |
| T8 | admin stats service を実装 | backend/src/services/admin.service.ts | UserStats.aggregate 中心の集計が実装される | Medium |
| T9 | admin route を実装 | backend/src/routes/admin/index.ts | zod validation、middleware、error mapping、ISO 変換が実装される | High |
| T10 | admin router を mount | backend/src/index.ts | /api/v1/admin が登録される | High |
| T11 | 品質チェック | backend | format:check / lint / test が通る、または失敗理由が記録される | High |
| T12 | 手動 API 確認 | Docker 起動環境 | ADMIN/USER/未認証で主要 endpoint を確認済み | Medium |
| T13 | 進捗・計画書更新 | docs/05_progress.md, 本 plan | checklist と実装完了セクションが更新される | High |

- [ ] T1: 既存仕様・既存実装を再確認し admin API 契約を確定
- [ ] T2: docs/04_api.md に admin API 詳細を追記
- [ ] T3: service test を追加
- [ ] T4: route test を追加
- [ ] T5: admin service の型・エラー・共通 helper を実装
- [ ] T6: ユーザー一覧・詳細 service を実装
- [ ] T7: status / role / force delete service を実装
- [ ] T8: admin stats service を実装
- [ ] T9: admin route を実装
- [ ] T10: admin router を mount
- [ ] T11: 品質チェック
- [ ] T12: 手動 API 確認
- [ ] T13: 進捗・計画書更新

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| 全 endpoint 未認証 | 401 認証が必要です |
| 全 endpoint USER role | 403 管理者権限が必要です |
| 全 endpoint ADMIN role | service が呼ばれる |
| GET /admin/users query 未指定 | limit=20, filter なし |
| GET /admin/users limit 空文字 | 既定値 20 |
| GET /admin/users limit 0 または 101 | 400 validation |
| GET /admin/users cursor 空文字 | 400 validation |
| GET /admin/users cursor 不存在 | 400 カーソルが正しくありません |
| GET /admin/users q 前後空白 | trim 後の値で username/email 検索 |
| GET /admin/users role ADMIN status active | role/status の AND 条件 |
| GET /admin/users 次ページあり | take limit plus 1 から nextCursor を返す |
| GET /admin/users 空状態 | users は空配列、nextCursor は null |
| GET /admin/users/:id id 空相当 | 400 validation |
| GET /admin/users/:id 対象なし | 404 ユーザーが見つかりません |
| GET /admin/users/:id 正常系 | passwordHash/token を含まない |
| PATCH /admin/users/:id/status body 不正 | 400 validation |
| status 停止成功 | isActive=false, lockedUntil=null, token deleteMany |
| status 解除成功 | isActive=true, lockedUntil=null |
| status 自己操作 | 409 自分自身には実行できません |
| status 最後の usable ADMIN 停止 | 409 最後の管理者は変更できません |
| status 削除済みユーザー | 409 |
| role 不正値 | 400 validation |
| role USER から ADMIN 正常系 | 200、role が ADMIN |
| role ADMIN から USER 正常系 | 200、role が USER |
| role 自己操作 | 409 |
| role 最後の usable ADMIN 降格 | 409 |
| role 未認証メールユーザーを ADMIN 化 | 409 |
| role 停止/削除済みユーザー | 409 |
| DELETE 正常系 | soft delete、token deleteMany、200 |
| DELETE 自己操作 | 409 |
| DELETE 最後の usable ADMIN | 409 |
| DELETE 対象なし | 404 |
| DELETE 既に削除済み | 409 ユーザーは既に削除されています |
| stats 0件 | すべて 0、accuracyRate 0 |
| stats 集計あり | UserStats.aggregate の sum から正答率を算出 |
| service 予期しない例外 | route は 500 サーバーエラーが発生しました |
| response shape | Date は ISO string、機密 field は含まない |

## 実装完了時の更新ルール

実装完了時は以下を必ず行う。

- docs/04_api.md の admin API 仕様が実装・テストと一致しているか確認する。
- docs/05_progress.md の対象タスクを [x] に更新する。
- 本 plan の checklist を [x] に更新する。
- 計画になかった変更ファイルがあれば、対象ファイル一覧または実装完了セクションに追記する。
- DB 変更が発生した場合は、migration、npx prisma migrate deploy、Playwright または手動確認結果を記録する。
- 実装完了 セクションを追記する。

実装完了セクションのテンプレート:

## 実装完了
- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/admin-apis
- PR: #N

### 計画からの変更点
- なし

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| docs/04_api.md | 修正 | admin API 詳細仕様を追記 |
| backend/src/services/admin.service.ts | 新規 | admin service を実装 |
| backend/src/routes/admin/index.ts | 修正 | admin routes を実装 |
| backend/src/index.ts | 修正 | admin router を mount |
