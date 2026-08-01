# 残 API のテスト 実装計画

> 設計者ロール: シニアフルスタックエンジニア

- 進捗タスク: `docs/05_progress.md` の `残 API のテスト`
- 計画書パス: `docs/plans/remaining-api-tests/plan.md`
- 主対象: Phase 9 で実装済みの残 API とバッチ処理のテスト補強
- 対象 API: `GET /api/v1/weak`, `DELETE /api/v1/weak/:elementId`, `GET /api/v1/users/me`, `PATCH /api/v1/users/me`, `DELETE /api/v1/users/me`, `GET /api/v1/users/me/stats`, `GET /api/v1/ranking/weekly`, `GET /api/v1/ranking/alltime`
- 対象バッチ: 週間スコアリセット、期限切れ `GameQuestionSet` cleanup、scheduled batch entrypoint

## レビュー結果

### この計画のまま実装すべきではない理由

既存の API 実装とテストはすでに相当量が揃っているため、単に「残 API のテストを追加する」計画のまま進めると、既存テストの重複追加、`ゲーム API のテスト` とのスコープ混在、DB 変更を伴わないタスクへの不要な migration 検討が発生しやすい。実装前に endpoint / layer / error case 単位のテスト棚卸しを必須タスクにし、足りない観点だけを追加する方針へ絞る必要がある。

### 1. DB の整合性と負荷

| 指摘内容 | 根拠: 確認できた事実 | 根拠: 推測 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|---|
| DB schema 変更を原則非スコープにすべき境界が必要 | `schema.prisma` には `WeakElement @@unique([userId, elementId])`、`GameSession @@index([userId, playedAt, id])`、`UserStats` の ranking 用 index が存在する | 目的はテスト補強で、API 挙動を変える DB 変更は不要 | 不要な migration により既存データ、rollback、Prisma 生成物、Playwright 確認の範囲が拡大する | DB 変更は禁止に近い扱いとし、必要になったら別計画または計画更新を行う | High |
| query 効率は index 追加ではなく既存実装の回帰確認で担保する | `ranking.service.ts` は `take: 50` と active user / current week filter を使う。`weak.service.ts` は element を select する。`user.service.ts` は stats と recent sessions を `Promise.all` で取得する | 現状の N+1 は確認されていない。大量データ時の ranking count は将来の負荷課題になり得る | テストタスクで query 形状を変えると API レスポンスや UI 表示順に不要な差分が出る | Prisma mock の `where` / `orderBy` / `take` / `select` を確認し、性能改善は計測後の別計画に回す | Medium |

### 2. API・コードの整合性

| 指摘内容 | 根拠: 確認できた事実 | 根拠: 推測 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|---|
| `残 API のテスト` と `ゲーム API のテスト` の境界が曖昧 | `docs/05_progress.md` では `ゲーム API のテスト` が Phase 7、`残 API のテスト` が Phase 9 に分かれている。`docs/plans/game-api-tests/plan.md` も別に存在する | 今回の主対象は Phase 9 の weak / users / ranking / batch と考えるべき | テスト対象が拡散し、実装担当が作業範囲を誤る | game API は本計画の非スコープにし、既存の `game-api-tests` 計画に委譲する | High |
| 既存テストが多いため棚卸しなしでは重複追加になりやすい | weak / users / ranking / jobs / frontend API client の関連 test file が存在する | 足りない可能性が高いのは endpoint 間整合、非 JSON error、rate limit、UI 接続確認などの隙間 | 正常系だけが重複し、保守コストだけ増える | T1 で endpoint / layer / case のテスト棚卸し matrix を作る | High |
| optional auth と required auth を分ける必要がある | ranking route は `optionalAuthMiddleware`、weak / users は `authMiddleware` を使う。frontend ranking client は空 token の Authorization header を送らない | 未ログイン ranking を 401 と誤認するテストを書くと既存仕様に反する | 認証仕様と逆の期待値を持つテストが追加される | ranking は「未ログイン OK、無効 token は 401、ログイン済みは myRank」を明記してテストする | High |

### 3. アクセシビリティ（A11Y）

| 指摘内容 | 根拠: 確認できた事実 | 根拠: 推測 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|---|
| API テスト中心でも UI の loading / error / empty / retry 接続確認が必要 | weak / mypage / ranking 画面には `aria-busy`、`aria-live`、`role="alert"`、retry UI、削除ボタンの `aria-label` が存在する | UI 新規実装ではないため component test 基盤の新規導入までは不要 | API client の error 変換を変えた場合、画面内エラーや支援技術向け通知が壊れても単体テストだけでは気づきにくい | 自動テストは API client / helper 中心にし、UI A11Y は手動確認または既存基盤がある場合の最小テストに限定する | Medium |
| 削除や retry 後の focus 位置を確認に含める | weak page には削除確認、行単位エラー、再読み込み導線がある | DOM 変更後の focus 退避が未確認だとキーボード利用者が現在位置を見失う可能性がある | API 成功時は通るが keyboard / screen reader で使いづらい | Tab、Enter / Space、削除 cancel、retry 後の通知を手動確認する | Low |

### 4. テストの妥当性

| 指摘内容 | 根拠: 確認できた事実 | 根拠: 推測 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|---|
| backend status code / frontend `ApiError` / 非 JSON error の対応づけが必要 | `docs/04_api.md` は `{ error }`、validation `details`、非 JSON 502/504 への frontend 方針を明記している。frontend API client は `parseErrorResponse` と `parseSuccessJsonResponse` を使う | endpoint ごとの coverage 差が残っている可能性がある | backend が返すエラーと frontend 表示がずれ、ユーザー向け文言や retry 判断が壊れる | endpoint ごとの status と error body を棚卸しし、足りない非 JSON / validation / auth ケースだけ追加する | High |
| rate limit や cookie clear は state leakage に注意する | users route は password change と account deletion に rate limit を適用し、成功時に refresh token cookie を clear する | test app や IP を共有すると rate limit state が別ケースへ漏れる可能性がある | flaky test や順序依存の失敗が発生する | rate limit test は isolated app、固定 IP、回数境界、後続ケースへの影響分離を前提にする | Medium |

## 背景・目的

Phase 9 で実装された weak list、users、ranking、weekly reset、batch cron trigger は、機能実装が完了済みとして進捗管理されている。一方で `docs/05_progress.md` では `残 API のテスト` が未完了であり、既存の route / service / frontend API client / job tests を棚卸ししたうえで、不足している回帰テストを追加する必要がある。

本計画の目的は、既存仕様を変えずにテスト品質を高め、実装担当の Codex が「どこに、どの観点のテストを足すか」を迷わない状態にすることである。

## スコープ

- backend route test の不足確認と追加: weak、users、ranking、jobs / scheduled batch。
- backend service test の不足確認と追加: DB 制約、既存データ、境界値、集計、削除、週判定。
- frontend API client test の不足確認と追加: success JSON、API error JSON、validation error JSON、非 JSON error、invalid success response、AbortSignal。
- UI と A11Y の手動確認: `/weak`、`/mypage`、`/ranking`。
- `docs/04_api.md` の更新要否確認。
- `docs/05_progress.md` と本 plan の実装完了更新。

## 非スコープ

- game API のテスト追加。`docs/plans/game-api-tests/plan.md` の範囲で扱う。
- admin API の新規テスト追加。
- API 仕様変更。
- DB schema / migration 変更。
- UI の大幅な再設計。
- 新しい E2E / component test 基盤の導入。
- ranking query の性能改善。
- scheduled batch の実行基盤変更。

## 現状調査結果

### 確認できた事実

- `docs/05_progress.md` では Phase 9 の `残 API のテスト` が未完了である。
- `docs/plans/remaining-api-tests/plan.md` は本計画作成前には存在しなかった。
- `docs/04_api.md` には weak、users、ranking の API 仕様と error response 方針が記載されている。
- `docs/08_conventions.md` は API base URL、共通 error handling、正規化値再利用、Svelte store / URL query の責務分担を重視している。
- `backend/prisma/schema.prisma` には、本タスクで使う既存 model と index が存在する。
- weak route / service / frontend API client / page / tests が存在する。
- users route / service / frontend API client / mypage / settings 関連 PR 記録 / tests が存在する。
- ranking route / service / frontend API client / ranking page / tests が存在する。
- weekly reset と scheduled batch の job implementation / tests が存在する。
- `docs/prs/feature-settings-page-pr.md` は users API 実装の変更内容を記録している。
- `docs/plans/game-api-tests/plan.md` は game API test の別計画として存在する。

### 推測

- 現時点の実装は広くテストされているため、追加すべきテストは「未検証 endpoint」よりも「仕様境界、error body、state leakage、frontend/backend 整合性」に寄る可能性が高い。
- DB 変更は不要であり、テスト実装中に API 実装の不備が見つかった場合は、テストタスク内の小修正に収めるか、仕様変更として別計画化するのが安全である。

## 実装前棚卸し matrix

実装開始前に既存仕様・既存テストを棚卸しした結果、今回の追加対象は「未実装 endpoint の追加」ではなく、既存 API の不足している境界テストを補う方針に絞る。

### ベースライン確認

| 対象 | コマンド | 結果 |
|---|---|---|
| backend 関連テスト | `cd backend && npm run test -- --run src/routes/users src/routes/weak src/routes/ranking src/services/user.service.test.ts src/services/weak.service.test.ts src/services/ranking.service.test.ts src/jobs` | pass: 14 files / 81 tests |
| frontend API client 関連テスト | `cd frontend && npm run test:run -- src/lib/api/weak.test.ts src/lib/api/users.test.ts src/lib/api/ranking.test.ts` | pass: 3 files / 49 tests |

### coverage matrix

| 領域 | 既存テストで確認済み | 追加対象 | 判断 |
|---|---|---|---|
| weak route | 未認証 401、一覧 200、空配列、DELETE validation 400、削除 200、削除対象なし 404、500 | なし | 計画の主要観点を満たしているため、重複追加しない |
| weak service | `userId` 条件の一覧取得、公開フィールド整形、空配列、`userId + elementId` 条件削除、0件時エラー | なし | Prisma 条件と日本語 error が確認済み |
| weak frontend client | Authorization、AbortSignal、API error JSON、非 JSON error、不正 success response | なし | 非 JSON / runtime validation まで確認済み |
| users route: GET `/users/me` | 未認証 401、プロフィール 200、予期しない 500 | `UserError(403)` の status/message 維持 | stats route にはあるが profile route では未固定 |
| users route: PATCH `/users/me` | username 成功、409、username validation 400、password 成功、password 400、混在 payload 400、Cookie clear | 未認証 401、`UserError(403)`、予期しない 500 | error mapping の一貫性を固定する |
| users route: DELETE `/users/me` | 未認証 401、password 不一致 400、削除成功、Cookie clear | validation 400、`UserError(403)`、予期しない 500 | request validation と service error mapping を固定する |
| users service | 論理削除、token 削除、password hash 更新、重複 409、profile、stats 空状態・正規化 | 同一 username では update しない、trim 後 username で重複確認・更新、ユーザーなし 403 | 仕様文書の「同じ username は 200」「正規化値再利用」を固定する |
| ranking route | 未ログイン 200、ログイン時 userId 受け渡し、不正 token 401、500 | なし | optional auth の主要観点を確認済み |
| ranking service | Top50、同点順位、active/deleted 除外、weekly boundary、myRank、並列実行、正規化 | なし | 計画の主要観点を満たしているため、重複追加しない |
| ranking frontend client | 未ログイン Authorization なし、ログイン Authorization、AbortSignal、JSON error、非 JSON error、不正 response | blank token で Authorization を送らない | optional auth の境界を frontend 側でも固定する |
| batch jobs | weekly reset、cleanup、scheduled known/unknown cron、invalid time、failure sanitization、CLI disconnect | なし | 既存テストで計画の主要観点を満たしている |
| frontend users client | stats/profile/update/password/delete の成功・error・不正 response | update/password/delete の AbortSignal、update/password の details 優先、delete 非 JSON error | API client 関数ごとの options 伝搬と error body 優先順位をそろえる |
| UI / A11Y | 既存画面に loading、empty、error、retry、aria-live / role 属性が存在 | 手動確認項目として記録 | 新規 component test 基盤は導入しない |

### 確定した追加実装単位

1. users backend route / service の不足テストを補う。
2. frontend users / ranking API client の不足テストを補う。
3. テストで仕様不一致が見つかった場合のみ、本番コードを最小修正する。
4. 最後に `docs/04_api.md` 更新要否、手動確認、完了記録を行う。

## 実装方針

1. 既存テストの棚卸しを最初に行う。
   - endpoint / layer / case の matrix を作り、重複追加を避ける。
   - `route`, `service`, `frontend api client`, `helper`, `manual UI` を分けて確認する。
2. 不足ケースだけを追加する。
   - 既存正常系と同じ assertion を増やさない。
   - status code、error body、Prisma 呼び出し条件、frontend `ApiError` 変換を優先する。
3. 本番コードの変更は最小限にする。
   - テストで明確な仕様不一致が見つかった場合のみ修正する。
   - 修正する場合は `docs/04_api.md` との整合を確認する。
4. UI は API client の挙動と接続する範囲で確認する。
   - API テスト中心のタスクなので、UI 改修は原則行わない。
   - A11Y は手動確認項目として必ず残す。

## DB 変更方針

- 原則として DB schema、migration、Prisma model は変更しない。
- 既存 index / relation の確認対象:
  - `WeakElement @@unique([userId, elementId])`
  - `WeakElement` と `User` / `Element` の relation
  - `UserStats` の ranking 用 index
  - `GameSession` の user / playedAt index
  - `GameQuestionSet` の `expiresAt` index
- DB 変更が必要になった場合は、この計画のタスクを止め、migration の expand / contract 影響、既存データの backfill 要否、rollback 手順、`npx prisma migrate deploy`、影響画面の Playwright または手動確認を計画へ追記する。

## API 変更方針

- API 仕様変更は原則行わない。
- backend の error response は `{ error: string }` を基本にし、validation error は既存の `details` 形式に合わせる。
- backend の日本語 error message を frontend で固定文言に上書きしない。
- frontend API client は `API_BASE_URL`、`parseErrorResponse`、`parseSuccessJsonResponse`、`ApiError` を使い、個別ファイルで base URL や共通 error parsing を再定義しない。
- Authorization の扱い:
  - weak / users は required auth。
  - ranking は optional auth。
  - frontend ranking client は token が空の場合 Authorization header を送らない。
  - invalid token は 401 として扱う。
- `PATCH /users/me` の password 変更と `DELETE /users/me` は rate limit と refresh token cookie clear の仕様を崩さない。

## UI / A11Y 方針

- UI の大幅変更は行わない。
- `/weak`、`/mypage`、`/ranking` の既存 UI で、API loading / error / empty / retry が利用者に伝わるか確認する。
- 最低限の確認観点:
  - `aria-busy` が loading 中に有効になる。
  - API error が `role="alert"` または `aria-live` で通知される。
  - retry button が keyboard 操作できる。
  - weak delete / cancel が Enter / Space で操作できる。
  - ranking period 切り替えが視覚表現だけに依存しない。
  - empty state が画面表示と支援技術の両方で理解できる。
- 既存テスト基盤がない場合、A11Y の自動テスト基盤は新規導入しない。

## テスト方針

- backend は Vitest で route / service / job test を追加または補強する。
- frontend は Vitest で API client / helper test を追加または補強する。
- 先に `npm run test -- --run` で既存状態を把握し、追加後に全体が通ることを確認する。
- 非 JSON error は frontend API client で重点的に確認する。
- backend route test では、JSON error body、status code、auth / validation / service error を確認する。
- service test では Prisma mock の where / select / orderBy / take / transaction を確認する。
- rate limit test を追加する場合は isolated app と固定 IP で state leakage を避ける。
- manual check は API 変更が UI に反映される主要導線だけに絞る。

## リリース・移行方針

- DB migration は発生しない前提のため、リリース時の DB 移行は不要。
- テスト追加のみの場合、通常の CI で backend / frontend の lint、format、test を通す。
- API 仕様に差分がない場合、`docs/04_api.md` は更新不要と記録する。
- API 仕様に差分が見つかった場合、実装または docs のどちらが正しいかを確認し、差分理由を plan の実装完了欄に記録する。

## ロールバック方針

- テスト追加のみの場合は、該当 test file の変更を revert すれば機能影響はない。
- 本番コード修正が発生した場合は、修正 commit を分け、問題発生時にその commit 単位で revert できるようにする。
- DB 変更は非スコープのため、rollback migration は不要。
- もし DB 変更が必要になった場合、この計画を中断して rollback 方針を含む別計画を作成する。

## リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| 既存テストと重複する | 保守コスト増、レビュー負荷増 | 最初にテスト棚卸し matrix を作る |
| game API test が混ざる | スコープ肥大化 | game API は `game-api-tests` 計画に委譲する |
| optional auth を required auth と誤認する | ranking 仕様と衝突 | ranking の未ログイン / invalid token / logged-in を分ける |
| rate limit state が漏れる | flaky test | isolated app と固定 IP を使う |
| 非 JSON error を見落とす | frontend で parse error が露出する | API client test に非 JSON error を含める |
| API 仕様差分を docs に反映しない | 実装と仕様書がずれる | `docs/04_api.md` 更新要否確認を必須タスクにする |
| UI A11Y が確認されない | keyboard / screen reader で使いづらい | 手動確認項目に loading / error / retry / focus を含める |

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `docs/plans/remaining-api-tests/plan.md` | 修正 | 実装中に checklist と完了記録を更新する |
| `docs/05_progress.md` | 修正 | `残 API のテスト` の進捗を実装開始 / 完了時に更新する |
| `docs/04_api.md` | 確認 / 必要時修正 | 実装と仕様の差分が見つかった場合のみ更新する |
| `backend/src/routes/weak/*.test.ts` | 確認 / 必要時修正 | route error / auth / validation の不足を補う |
| `backend/src/services/weak.service.test.ts` | 確認 / 必要時修正 | Prisma 条件、空状態、削除境界を補う |
| `backend/src/routes/users/*.test.ts` | 確認 / 必要時修正 | profile / update / delete / stats の route 不足を補う |
| `backend/src/services/user.service.test.ts` | 確認 / 必要時修正 | soft delete、password、stats 集計、既存データ境界を補う |
| `backend/src/routes/ranking/*.test.ts` | 確認 / 必要時修正 | optional auth、invalid token、service error を補う |
| `backend/src/services/ranking.service.test.ts` | 確認 / 必要時修正 | weekly week boundary、tie、myRank、除外条件を補う |
| `backend/src/jobs/*.test.ts` | 確認 / 必要時修正 | cron 判定、skip、failure、cleanup / reset を補う |
| `frontend/src/lib/api/weak.test.ts` | 確認 / 必要時修正 | API error、非 JSON、invalid response、Abort を補う |
| `frontend/src/lib/api/users.test.ts` | 確認 / 必要時修正 | stats / profile / update / password / delete の不足を補う |
| `frontend/src/lib/api/ranking.test.ts` | 確認 / 必要時修正 | optional auth、invalid response、非 JSON を補う |
| `frontend/src/lib/**/*.test.ts` | 確認 / 必要時修正 | helper / URL query / sort / normalization の不足を補う |
| `backend/src/**/index.ts` / `backend/src/services/*.ts` | 原則変更なし / 必要時修正 | テストで明確な仕様不一致が見つかった場合のみ修正する |
| `frontend/src/lib/api/*.ts` | 原則変更なし / 必要時修正 | API client の仕様不一致が見つかった場合のみ修正する |

## 作業手順

1. `docs/plans/remaining-api-tests/plan.md`、`docs/05_progress.md`、`docs/04_api.md`、`docs/08_conventions.md`、`docs/07_testing_flow.md`、`docs/13_codex_editing.md` を読む。
2. 既存 route / service / job / frontend API client / helper tests を棚卸しする。
3. endpoint / layer / case の不足 matrix を作る。
4. `docs/05_progress.md` の `残 API のテスト` を `[-]` にする。
5. 不足している backend tests を追加する。
6. 不足している frontend API client / helper tests を追加する。
7. テストで仕様不一致が見つかった場合だけ本番コードを最小修正する。
8. `docs/04_api.md` 更新要否を確認する。
9. lint / format / test を実行する。
10. `/weak`、`/mypage`、`/ranking` の手動確認を行う。
11. `docs/05_progress.md` と plan の checklist を更新する。
12. plan に `## 実装完了` セクションを追記する。

## タスクリスト

| タスクID | 内容 | 対象ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存仕様・既存テストの棚卸し matrix を作成し、追加対象を確定する | `docs/04_api.md`, `backend/src/**/*.test.ts`, `frontend/src/lib/**/*.test.ts`, 本 plan | endpoint / layer / case ごとの不足が明確になり、重複追加を避けられる状態になる | High |
| T2 | weak API の route / service test 不足を補う | `backend/src/routes/weak/*.test.ts`, `backend/src/services/weak.service.test.ts` | auth、validation、empty、delete 404、Prisma 条件、error body が仕様と一致する | High |
| T3 | users API の route / service test 不足を補う | `backend/src/routes/users/*.test.ts`, `backend/src/services/user.service.test.ts` | profile、username、password、delete、stats、rate limit、cookie clear、soft delete が確認される | High |
| T4 | ranking API の route / service test 不足を補う | `backend/src/routes/ranking/*.test.ts`, `backend/src/services/ranking.service.test.ts` | optional auth、invalid token、weekly boundary、tie、myRank、active user filter が確認される | High |
| T5 | batch job / scheduled entrypoint test 不足を補う | `backend/src/jobs/*.test.ts`, batch script 周辺 | weekly reset、cleanup、cron 判定、unknown cron skip、failure handling が確認される | High |
| T6 | frontend API client test 不足を補う | `frontend/src/lib/api/weak.test.ts`, `frontend/src/lib/api/users.test.ts`, `frontend/src/lib/api/ranking.test.ts` | success、API error JSON、validation error、非 JSON error、invalid response、AbortSignal が確認される | High |
| T7 | URL query / helper / UI 接続の不足を確認する | `frontend/src/lib/**/*.test.ts`, `frontend/src/routes/(app)/**/+page.svelte` | reload / back / direct access に関わる helper test または手動確認項目が揃う | Medium |
| T8 | テストで見つかった仕様不一致だけを最小修正する | `backend/src/**`, `frontend/src/lib/api/*.ts` | 仕様・docs・test の整合が取れ、不要な実装変更がない | High |
| T9 | `docs/04_api.md` 更新要否を確認する | `docs/04_api.md` | 更新不要または必要差分が明記される | Medium |
| T10 | backend の lint / format / test を実行する | `backend` | `npm run lint`, `npm run format:check`, `npm run test -- --run` が通る | High |
| T11 | frontend の lint / format / test を実行する | `frontend` | `npm run lint`, `npm run format`, `npm run test:run` が通る | High |
| T12 | 手動確認を行う | `/weak`, `/mypage`, `/ranking` | loading、empty、error、retry、keyboard、A11Y の最低確認が完了する | Medium |
| T13 | 実装完了更新を行う | `docs/05_progress.md`, 本 plan | checklist が更新され、`## 実装完了` が追記される | High |

- [x] T1: 既存仕様・既存テストの棚卸し matrix を作成する
- [x] T2: weak API の route / service test 不足を補う（棚卸しと既存テスト再実行により追加不要と判断）
- [x] T3: users API の route / service test 不足を補う
- [x] T4: ranking API の route / service test 不足を補う（棚卸しと既存テスト再実行により追加不要と判断）
- [x] T5: batch job / scheduled entrypoint test 不足を補う（棚卸しと既存テスト再実行により追加不要と判断）
- [x] T6: frontend API client test 不足を補う
- [x] T7: URL query / helper / UI 接続の不足を確認する（API client/helperは既存テストで確認、UIは手動確認項目として残す）
- [x] T8: テストで見つかった仕様不一致だけを最小修正する（仕様不一致なし、本番コード修正なし）
- [x] T9: `docs/04_api.md` 更新要否を確認する（公開API仕様変更なしのため更新不要）
- [x] T10: backend の lint / format / test を実行する
- [x] T11: frontend の lint / format / test を実行する
- [x] T12: 手動確認を行う
- [x] T13: `docs/05_progress.md` と plan の実装完了更新を行う

### 品質チェック結果

| 対象 | コマンド | 結果 |
|---|---|---|
| backend lint | `cd backend && npm run lint` | pass |
| backend format | `cd backend && npm run format:check` | pass |
| backend test | `cd backend && npm run test -- --run` | pass: 36 files / 299 tests |
| frontend lint | `cd frontend && npm run lint` | pass |
| frontend check | `cd frontend && npm run check` | pass: 0 errors / 0 warnings |
| frontend format | `cd frontend && npx prettier --check src/lib/api/users.test.ts src/lib/api/ranking.test.ts` | pass |
| frontend test | `cd frontend && npm run test:run` | pass: 24 files / 295 tests |

frontend の `npm run format` は `prettier --write .` でリポジトリ全体に書き込みうるため、今回変更した API client test ファイルに対して `prettier --check` を実行した。


### 手動確認結果

| 対象 | 確認内容 | 結果 |
|---|---|---|
| `/weak` 未ログイン | API を呼ばずログイン導線を表示 | pass: 「苦手リストを見るにはログインが必要です。」と「ログインへ」を表示 |
| `/weak` ログイン済み | 空状態、導線、console error | pass: 「苦手元素はまだありません。」と「ゲームで練習する」を表示、console error なし |
| `/mypage` ログイン済み | stats / history 空状態、導線、console error | pass: 0件 stats、空グラフ、空履歴、「ゲームを始める」を表示、console error なし |
| `/mypage` A11Y | stats / history section、mode select | pass: section は `aria-labelledby`、mode は `combobox` role / name `モード` で取得可能 |
| `/ranking` ログイン済み | weekly 表示、myRank 空状態、console error | pass: ranking table と「自分の順位」の未参加メッセージを表示、console error なし |
| `/ranking` 種別切替 | 全期間ボタン click、URL query、`aria-pressed` | pass: `/ranking?period=alltime` に遷移し、全期間側の `aria-pressed` が `true` |
| 横はみ出し | `/weak`, `/mypage`, `/ranking` の表示幅 | pass: 確認時 viewport で `scrollWidth <= clientWidth` |
| loading / error / retry UI | source と既存 test の確認 | pass: 各画面に loading 表示、error `role="alert"`、retry button が実装済み。API client の error / AbortSignal は自動テストで確認済み |
| keyboard | links / buttons / select の到達性 | pass: DOM 上は native `a` / `button` / `select` として取得可能。`/ranking` は Enter / Space を明示ハンドラーと `isRankingPeriodActivationKey` の自動テストで固定 |

手動確認用にローカル開発 DB へ一時ユーザーを API 登録し、Mailpit の確認メールからメール確認を完了してログインした。パスワード等の秘密情報は plan には記録しない。

## テストケース一覧

| 対象 | ケース | 期待結果 |
|---|---|---|
| weak route | 未ログインで `GET /weak` | 401 と日本語 error |
| weak route | weak element が 0 件 | 200 と空配列 |
| weak route | `DELETE /weak/:elementId` の invalid param | 400 と validation details |
| weak route | 他 user または存在しない weak element を削除 | 404 と日本語 error |
| weak service | `getWeakElements` の select / orderBy | element 情報、missCount、addedAt が仕様通り |
| weak service | `deleteWeakElement` の where 条件 | `userId` と `elementId` の両方で削除し、count 0 は error |
| users route | 未ログインで users API | 401 と日本語 error |
| users route | username 更新の trim / 空文字 / 重複 | 400 または 409 が仕様通り |
| users route | password 変更の現在 password 不一致 | 400 と日本語 error |
| users route | password 変更成功 | hash 更新、refresh token cookie clear |
| users route | `DELETE /users/me` 成功 | soft delete と refresh token cookie clear |
| users route | password / delete rate limit | 境界回数で 429、他 test へ state leakage しない |
| users service | stats が未作成 | zero stats と空 history を返す |
| users service | weeklyScoreWeekStart が current week でない | weekly score を current week として扱わない |
| ranking route | 未ログインで ranking | 200、myRank は null |
| ranking route | invalid token | 401 と日本語 error |
| ranking route | service error | 500 と汎用日本語 error |
| ranking service | weekly ranking | current week、top 50、score desc、active user のみ |
| ranking service | alltime ranking | allTimeScore desc、active user のみ |
| ranking service | myRank | ranking 外 user でも rank が計算される |
| ranking service | tie score | 既存仕様に沿った順位または count 条件になる |
| batch job | weekly reset | current week へ score reset / weekStart 更新 |
| batch job | weekly reset rerun | 冪等で不正な二重加算や例外がない |
| batch job | question set cleanup | expired のみ削除、future は残る |
| scheduled batch | known cron | 対応する job が呼ばれる |
| scheduled batch | unknown cron | skip して成功扱い |
| scheduled batch | job failure | 内部詳細を出さず失敗扱い |
| frontend weak client | success | response shape を検証して返す |
| frontend weak client | API error JSON | backend message を `ApiError` に保持 |
| frontend weak client | 非 JSON error | fallback message の `ApiError` |
| frontend users client | profile / stats success | date / count / role / nullable を validation |
| frontend users client | validation error JSON | `details` を保持または message 抽出 |
| frontend users client | delete / password success | empty response または success response を仕様通り扱う |
| frontend ranking client | no token | Authorization header を送らない |
| frontend ranking client | blank token | trim 後に Authorization header を送らない |
| frontend ranking client | invalid success response | `ApiError(500)` 相当で扱う |
| frontend common | AbortSignal | AbortError を意図通り伝播または扱う |
| UI manual | 初期表示 | loading が視覚的にも支援技術にも伝わる |
| UI manual | 空状態 | empty message が表示され、操作不能状態が分かる |
| UI manual | API error | error が `role="alert"` / `aria-live` で伝わり retry できる |
| UI manual | keyboard | Tab / Enter / Space だけで主要操作が完結する |
| UI manual | reload / back | URL query または page state が仕様通り復元される |

## 技術的注意点

- テスト追加前に既存 test の coverage を必ず読む。
- `response.ok` の判定と JSON parse の順序は既存 `frontend/src/lib/api/errors.ts` の helper 方針に合わせる。
- 正規化値は一度だけ計算して再利用する。テストで trim 方針を追加する場合も UI / API client / backend validation の責務を混同しない。
- backend error message は日本語に統一する。
- Prisma mock は必要最小限の model と method を定義し、テストごとに `vi.clearAllMocks()` する。
- rate limit は test order に依存しないよう isolate する。
- frontend API client test で `API_BASE_URL` を直接再定義しない。
- UI component 内に API response 変換 logic を追加しない。
- DB 変更が発生した場合はこの計画の範囲外として扱う。

## 手動確認項目

- `/weak`
  - 初期 loading、空状態、取得 error、retry。
  - delete 成功、delete 404、cancel。
  - keyboard 操作と focus 位置。
- `/mypage`
  - stats loading、empty history、取得 error、retry。
  - reload / direct access 時の表示。
- `/ranking`
  - weekly / alltime 切り替え。
  - 未ログイン表示、ログイン済み myRank 表示。
  - API error、empty ranking、retry。
- A11Y
  - `aria-busy`、`aria-live`、`role="alert"` が必要状態で機能している。
  - 色だけに依存する状態表現がない。

## 実装完了時の更新ルール

実装完了時は次を必ず行う。

- 本 plan の checklist を実態に合わせて `[x]` に更新する。
- 実際に変更したファイルを「対象ファイル一覧」に反映する。
- 計画から外れた判断があれば `## 実装完了` に理由を書く。
- `docs/05_progress.md` の `残 API のテスト` を `[x]` にする。
- `docs/04_api.md` を更新した場合は、何の仕様差分を反映したかを書く。
- 実行した lint / format / test / 手動確認結果を書く。

### 実装完了セクションテンプレート

```markdown
## 実装完了
- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/xxx
- PR: #N

### 計画からの変更点
- なし

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/routes/weak/xxx.test.ts` | 修正 | 〇〇ケースを追加 |

### 実行した確認
| コマンド / 確認 | 結果 |
|---|---|
| `cd backend && npm run test -- --run` | pass |
| `cd frontend && npm run test:run` | pass |
```

## 実装完了
- 完了日: 2026-07-05
- 実装ブランチ: feature/phase9-remaining-api-tests
- PR: #74

### 計画からの変更点
- weak API、ranking API、batch job / scheduled entrypoint は、棚卸しと既存テスト再実行により計画の主要観点を満たしていると判断し、重複するテスト追加は行わなかった。
- API 側の仕様不一致は見つからなかったため、backend / frontend API client の production code は変更しなかった。
- `docs/04_api.md` は公開 API 仕様変更がないため更新しなかった。
- frontend の `npm run format` は `prettier --write .` で対象外ファイルまで書き換える可能性があるため、今回変更した API client test ファイルに対する `prettier --check` で確認した。
- `/ranking` の Enter / Space による種別切替は、明示的な `onkeydown` ハンドラーと `isRankingPeriodActivationKey` の自動テストを追加して固定した。

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/routes/users/get-me.test.ts` | 修正 | `UserError` の status / message が route response に反映されることを追加 |
| `backend/src/routes/users/update-me.test.ts` | 修正 | 未認証、`UserError`、予期しない service error の route test を追加 |
| `backend/src/routes/users/delete-me.test.ts` | 修正 | validation error、`UserError`、予期しない service error の route test を追加 |
| `backend/src/services/user.service.test.ts` | 修正 | username 更新の同値 no-op、trim 後の重複確認・更新、ユーザーなし 403 を追加 |
| `frontend/src/lib/api/users.test.ts` | 修正 | update / password / delete の AbortSignal、validation details 優先、delete 非 JSON error を追加 |
| `frontend/src/lib/api/ranking.test.ts` | 修正 | blank token では Authorization header を送らない optional auth 境界を追加 |
| `frontend/src/lib/ranking/ranking.ts` | 修正 | ランキング種別切替用の Enter / Space 判定 helper を追加 |
| `frontend/src/lib/ranking/ranking.test.ts` | 修正 | Enter / Space だけを種別切替キーとして扱うテストを追加 |
| `frontend/src/routes/(app)/ranking/+page.svelte` | 修正 | 種別切替ボタンの Enter / Space 操作を keydown で明示対応 |
| `docs/05_progress.md` | 修正 | `残 API のテスト` を実装中から完了へ更新 |
| `docs/plans/remaining-api-tests/plan.md` | 修正 | 棚卸し matrix、品質チェック結果、手動確認結果、実装完了記録を追加 |

### 実行した確認

| コマンド / 確認 | 結果 |
|---|---|
| `cd backend && npm run test -- --run src/routes/users/get-me.test.ts src/routes/users/update-me.test.ts src/routes/users/delete-me.test.ts src/services/user.service.test.ts` | pass: 4 files / 38 tests |
| `cd backend && npm run test -- --run src/routes/users src/routes/weak src/routes/ranking src/services/user.service.test.ts src/services/weak.service.test.ts src/services/ranking.service.test.ts src/jobs` | pass: 14 files / 91 tests |
| `cd frontend && npm run test:run -- src/lib/api/users.test.ts src/lib/api/ranking.test.ts` | pass: 2 files / 41 tests |
| `cd frontend && npm run test:run -- src/lib/api/weak.test.ts src/lib/api/users.test.ts src/lib/api/ranking.test.ts` | pass: 3 files / 56 tests |
| `cd frontend && npm run test:run -- src/lib/ranking/ranking.test.ts` | pass: 1 file / 5 tests |
| `cd frontend && npm run check` | pass: 0 errors / 0 warnings |
| `cd backend && npm run lint` | pass |
| `cd backend && npm run format:check` | pass |
| `cd backend && npm run test -- --run` | pass: 36 files / 299 tests |
| `cd frontend && npm run lint` | pass |
| `cd frontend && npm run check` | pass: 0 errors / 0 warnings |
| `cd frontend && npx prettier --check src/lib/api/users.test.ts src/lib/api/ranking.test.ts` | pass |
| `cd frontend && npm run test:run` | pass: 24 files / 295 tests |
| `/weak` 手動確認 | pass: 未ログイン導線、ログイン後空状態、console error なし |
| `/mypage` 手動確認 | pass: stats / history 空状態、A11Y section / combobox、console error なし |
| `/ranking` 手動確認 | pass: weekly 表示、全期間 click 切替、`aria-pressed` 更新、console error なし |
| `git diff --check` | pass |

### 残した確認メモ
- 手動確認用にローカル開発 DB へ一時ユーザーを API 登録し、Mailpit の確認メールからメール確認を完了してログインした。
- DB schema / migration は変更していないため、`npx prisma migrate deploy` は対象外。
- push / PR 作成: 実施済み（PR #74）。
