# 苦手・ユーザー・ランキング・統計 API インターフェース確定 実装計画

> 設計者ロール: シニアフルスタックエンジニア

## 背景・目的

`docs/05_progress.md` フェーズ8の `苦手 / ユーザー / ランキング / 統計 各 API のインターフェースを確定` を完了させる。苦手リスト、ユーザー設定、マイページ統計、ランキングの API 契約を `docs/04_api.md`、backend route/service、frontend API client、UI 状態管理、テストの間で揃え、後続実装者が推測で API 仕様を補完しない状態にする。

## スコープ

- `docs/04_api.md` に `GET/PATCH/DELETE /users/me` の request / response / error を明記する。
- `docs/04_api.md` の `GET/DELETE /weak`、`GET /users/me/stats`、`GET /ranking/weekly`、`GET /ranking/alltime` が現行実装と一致しているか確認し、不一致があれば修正する。
- `frontend/src/lib/api/users.ts` に stats 以外の user API client を追加する。
- `/settings` の page 内 fetch を `frontend/src/lib/api/users.ts` へ寄せ、API URL / response validation / error handling の重複を減らす。
- backend / frontend の既存テストに不足があれば、契約テストを追加する。
- `docs/05_progress.md` と本計画書を実装完了時に更新する。

## 非スコープ

- DB schema / migration の追加。
- `GET /weak` の sort query 追加。
- `GET /ranking/*` のページネーション追加。
- 週間スコアリセットバッチ処理。
- 管理者 API。
- 共通 `frontend/src/lib/api/client.ts` の新規導入。
- トップページランキングプレビューの live API 化。

## レビュー結果

### この計画のまま実装すべきではない理由

この計画書は新規作成であり、作成前は docs/04_api.md が GET/PATCH/DELETE /users/me の詳細仕様を持たず、docs/05_progress.md は user API を未完了扱いにしている一方で backend route/service/test と /settings UI は実装済みだった。このズレを整理しないまま実装すると、実装担当が既存実装を二重実装したり、frontend/backend の error/status 契約を食い違わせるリスクが高い。

### DBの整合性と負荷

- 指摘内容: DB 変更を含める必要は現時点ではない。
- 根拠: 確認できた事実として、`WeakElement` は `@@unique([userId, elementId])` を持ち、`GameSession` は `@@index([userId, playedAt, id])` を持ち、`UserStats` は `@@index([weeklyScore(sort: Desc)])` と `@@index([allTimeScore(sort: Desc)])` を持つ。`getCurrentUserStats()` は `UserStats.findUnique` と `GameSession.findMany(take: 10)`、ranking は `UserStats.findMany(take: 50)` と `count()` を使っている。
- 影響・リスク: DB 変更を計画に含めると不要な migration / deploy リスクが増える。逆に ranking の `totalGames > 0` と user relation filter が将来ボトルネックになる可能性はある。
- 改善案: 本計画では DB 変更なしに固定する。性能問題が実測された場合のみ、別タスクで explain / index 見直しを行う。
- 優先度: Medium

### API・コードの整合性

- 指摘内容: `docs/04_api.md` の user API 詳細が不足している。
- 根拠: 確認できた事実として、`docs/04_api.md` は `GET/PATCH/DELETE /users/me` を一覧化しているが、詳細仕様は `GET /users/me/stats` だけである。backend は `GET /me`、`PATCH /me`、`DELETE /me` を実装済みで、`PATCH /me` は username 変更と password 変更を union schema で受ける。
- 影響・リスク: frontend client 実装時に request body、成功 response、429 の有無、password 変更後の refresh token 無効化が曖昧になる。
- 改善案: `docs/04_api.md` に user API の request / response / error / Cookie clear 方針を追加する。
- 優先度: High

- 指摘内容: frontend の users API client が stats に偏っている。
- 根拠: 確認できた事実として、`frontend/src/lib/api/users.ts` は `getMyStats()` のみを export している。一方、`frontend/src/routes/(app)/settings/+page.svelte` は `API_BASE_URL`、`parseErrorResponse()`、fetch options、response 型を page 内に持っている。
- 影響・リスク: 同じ API の response validation と error handling が page に分散し、非 JSON エラーや response shape 不正の扱いが stats / weak / ranking とずれる。
- 改善案: `getCurrentUserProfile()`、`updateCurrentUsername()`、`changeCurrentPassword()`、`deleteCurrentUser()` を `frontend/src/lib/api/users.ts` に追加し、`/settings` はそれを呼ぶ。
- 優先度: High

- 指摘内容: `docs/05_progress.md` と実装状態にズレがある。
- 根拠: 確認できた事実として、`docs/05_progress.md` は `GET /users/me + PATCH /users/me + DELETE /users/me` を `[ ]` としているが、backend route/service/test と `/settings` 画面は存在する。
- 影響・リスク: 後続担当が「未実装」と判断して重複実装する可能性がある。
- 改善案: 本タスク完了時に `docs/05_progress.md` へ実態差分を記録し、必要なら当該 API を完了扱いへ更新する。
- 優先度: High

### アクセシビリティ（A11Y）

- 指摘内容: API 契約タスクでも、UI への接続方針として A11Y 状態を明文化する必要がある。
- 根拠: 確認できた事実として、`/weak`、`/mypage`、`/ranking` は `aria-busy`、`role="alert"`、再試行ボタン、空状態を持つ。`/settings` は form label と `aria-describedby` を持つ。
- 影響・リスク: users API client 化の際に UI 状態を触ると、エラー関連付けや focus / disabled 状態が崩れる可能性がある。
- 改善案: `/settings` refactor は既存 UI 構造を維持し、loading / error / disabled / `aria-describedby` を退行させない。手動確認にキーボード操作と screen reader 向け文脈確認を含める。
- 優先度: Medium

### テストの妥当性

- 指摘内容: backend 側は user / weak / ranking / stats の route/service テストが広く存在するが、frontend users API client は stats しかテストされていない。
- 根拠: 確認できた事実として、`backend/src/routes/users/update-me.test.ts` は username / password / mixed payload / 400 / 409 を持ち、`backend/src/routes/users/delete-me.test.ts` は delete 成功と異常系を持つ。`frontend/src/lib/api/users.test.ts` は `getMyStats()` の URL / Authorization / HTTP error / response validation を対象としている。
- 影響・リスク: `GET/PATCH/DELETE /users/me` の frontend client を追加しても、Authorization、非 JSON error、response validation、AbortSignal の回帰が検出されない。
- 改善案: `frontend/src/lib/api/users.test.ts` に profile / username / password / delete の正常系・異常系・非 JSON error・不正 response を追加する。
- 優先度: High

## 現状調査結果

### 確認できた事実

- `docs/plans/api-interface-contracts/plan.md` は存在しない。
- `docs/05_progress.md` フェーズ8に `苦手 / ユーザー / ランキング / 統計 各 API のインターフェースを確定` が未完了で存在する。
- `docs/04_api.md` は `GET/DELETE /weak`、`GET /users/me/stats`、`GET /ranking/weekly`、`GET /ranking/alltime` の詳細を持つ。
- `docs/04_api.md` は `GET/PATCH/DELETE /users/me` の一覧を持つが、詳細仕様はまだない。
- `backend/src/routes/users/index.ts` は `/me/stats`、`/me`、`PATCH /me`、`DELETE /me` の順で route を定義しており、`/me/stats` と `/me` の衝突は避けられている。
- `PATCH /users/me` は `username` 変更または `currentPassword/newPassword` による password 変更を `z.union()` で検証している。
- password 変更と account delete は refresh token 関連 Cookie を削除し、DB の refresh token も削除する。
- `frontend/src/lib/api/users.ts` は `getMyStats()` のみを持つ。
- `/settings` は page 内で `GET/PATCH/DELETE /users/me` を直接 fetch している。
- `WeakElement` は user / element の composite unique を持つ。
- `UserStats` は weekly / allTime score の降順 index を持つ。

### 推測・要確認

- `GET/PATCH/DELETE /users/me` を `docs/05_progress.md` 上で完了扱いにしてよいかは、ユーザー確認または実装時のレビュー判断が必要。
- ranking の `totalGames > 0` と relation filter は現在の規模では問題になりにくいが、大規模化時は複合 index の検討余地がある。
- frontend API client の共通 `apiFetch` 基盤は進捗上 `[-]` だが、このタスク内では導入しない方が差分を小さく保てる。

## 実装方針

1. `docs/04_api.md` の user API 詳細を backend 実装に合わせて補完する。
2. `frontend/src/lib/api/users.ts` に stats 以外の users API client を追加し、runtime validation を一箇所に集める。
3. `/settings` は既存 UI / validation / authStore 更新 / logout 遷移を維持しつつ、新 API client を呼ぶ形に置き換える。
4. `weak`、`stats`、`ranking` は原則実装変更せず、契約とテストの不足確認に限定する。
5. `docs/05_progress.md` は API interface 確定タスクを完了にし、user API 実装済みの実態差分を必要に応じて反映する。

## DB変更方針

- DB schema / migration は変更しない。
- `backend/prisma/schema.prisma` を変更した場合は計画逸脱として `## 実装完了` に理由を記録し、`npx prisma migrate deploy` と Playwright 確認を追加する。
- ranking の追加 index はこのタスクでは扱わない。必要性が出た場合は別計画で explain 結果を添えて判断する。

## API変更方針

### `GET /api/v1/users/me`

- 認証: 必須。
- 成功: `200 { user: { id, username, email, role, createdAt } }`。
- Error: 401 / 403 / 500。

### `PATCH /api/v1/users/me`

- 認証: 必須。
- username 変更 request: `{ username: string }`。
- username 変更 response: `200 { message: "ユーザー名を変更しました", user: { id, username, role } }`。
- password 変更 request: `{ currentPassword: string, newPassword: string }`。
- password 変更 response: `200 { message: "パスワードを変更しました" }`。
- Error: 400 / 401 / 403 / 409 / 429 / 500。
- username と password payload の混在は 400。

### `DELETE /api/v1/users/me`

- 認証: 必須。
- request: `{ currentPassword: string }`。
- response: `200 { message: "アカウントを削除しました" }`。
- Error: 400 / 401 / 403 / 429 / 500。
- 成功時は論理削除し、refresh / password reset / email verification token を無効化する。

### 既存契約の維持

- `GET /weak` と `DELETE /weak/:elementId` の response shape は変更しない。
- `GET /users/me/stats` の response shape は変更しない。
- `GET /ranking/weekly` と `GET /ranking/alltime` の raw response は `weeklyScore` / `allTimeScore` を維持し、frontend client 内で `score` に正規化する。

## UI / A11Y方針

- `/settings` の layout、label、`aria-invalid`、`aria-describedby`、`role="alert"` を維持する。
- 初期 loading、load error、form error、submit disabled、削除確認 checkbox の既存挙動を退行させない。
- password 変更・account delete 成功後の toast と redirect は page 側の責務として維持する。
- API client は UI 文言を過剰に持たず、backend error message を `ApiError.message` として渡す。
- 手動確認でキーボードのみの username / password / delete 操作を確認する。

## テスト方針

### Backend

- 既存 route/service テストを確認し、`docs/04_api.md` と status / body がずれていれば修正する。
- `PATCH /users/me` の mixed payload、password rate limit、Cookie clear header、409 conflict を確認する。
- `DELETE /users/me` の論理削除、token 無効化、認証エラーを確認する。

### Frontend

- `frontend/src/lib/api/users.test.ts` に以下を追加する。
  - `getCurrentUserProfile()` 正常系、Authorization、AbortSignal、不正 response。
  - `updateCurrentUsername()` 正常系、409 error、非 JSON error、不正 response。
  - `changeCurrentPassword()` 正常系、400 error、非 JSON error、不正 response。
  - `deleteCurrentUser()` 正常系、400 error、非 JSON error、不正 response。
- `/settings` の UI は既存の page test 基盤が限定的なため、helper / API client テストと手動確認で補強する。

## リリース・移行方針

- docs と frontend API client の変更のみを想定する。
- DB migration は発生しないため、データ移行は不要。
- `/settings` の API 呼び出し層を差し替えるため、リリース前にログイン済みユーザーで settings の主要導線を手動確認する。

## ロールバック方針

- docs 変更は該当コミットを revert すれば戻せる。
- frontend API client / `/settings` 接続変更で問題が出た場合は、`/settings` の呼び出しを直前の inline fetch へ戻す。
- DB 変更を含めないため、DB ロールバックは不要。

## リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| user API の進捗表と実装済み状態のズレ | 重複実装・レビュー混乱 | `docs/05_progress.md` と本計画に実態差分を明記 |
| `/settings` refactor で UI 挙動が変わる | ユーザー設定導線の退行 | API 呼び出し層だけを差し替え、UI state は維持 |
| frontend validation と backend validation の不一致 | 送信前に通るが API で 400 になる | 正規化済み値を一度だけ計算し、送信 body に同じ値を使う |
| backend error を frontend が上書きする | 具体的な日本語エラーが消える | `parseErrorResponse()` と `ApiError.message` を使う |
| 非 JSON error で例外終了 | 502/504 時に画面が壊れる | API client テストに非 JSON error を含める |
| ranking 負荷が将来増える | 大規模データで遅くなる | 今回は既存 index を維持し、必要時に別タスクで explain |

## 作業手順

1. `docs/04_api.md` の user API 詳細を追記する。
2. `frontend/src/lib/api/users.ts` に users API client 型・関数・runtime validation を追加する。
3. `frontend/src/lib/api/users.test.ts` に契約テストを追加する。
4. `/settings/+page.svelte` を users API client に接続する。
5. backend tests と docs の status / body が一致しているか確認する。
6. `docs/05_progress.md` を更新する。
7. 本計画書のチェックボックスを更新し、実装完了セクションを追記する。
8. format / lint / test / 手動確認を実行する。

## タスクリスト

| タスクID | 内容 | 対象ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存実装と docs の差分を最終確認 | `docs/04_api.md`, `docs/05_progress.md`, 関連 route/service/client | user API の不足仕様と進捗ズレが整理されている | High |
| T2 | user API 詳細仕様を追記 | `docs/04_api.md` | `GET/PATCH/DELETE /users/me` の request / response / error が明記されている | High |
| T3 | users API client の型・validation を追加 | `frontend/src/lib/api/users.ts` | profile/update/password/delete 関数が追加されている | High |
| T4 | users API client の契約テストを追加 | `frontend/src/lib/api/users.test.ts` | 正常系・HTTP error・非 JSON error・不正 response を検証している | High |
| T5 | `/settings` を API client に接続 | `frontend/src/routes/(app)/settings/+page.svelte` | page 内 fetch の重複が減り、既存 UI 挙動が維持されている | High |
| T6 | weak/stats/ranking 契約の回帰確認 | `docs/04_api.md`, `frontend/src/lib/api/*.ts`, backend route/service | 既存契約に不要な変更がない | Medium |
| T7 | backend 既存テストと docs の整合確認 | `backend/src/routes/**/*.test.ts`, `backend/src/services/**/*.test.ts` | status / body / error message が docs と一致している | Medium |
| T8 | 品質チェック | backend / frontend | lint / format / test が通る、または失敗理由を記録 | High |
| T9 | 手動確認 | `/settings`, `/weak`, `/mypage`, `/ranking` | 主要導線と A11Y 状態を確認済み | High |
| T10 | 進捗・計画書更新 | `docs/05_progress.md`, 本計画書 | チェックボックスと実装完了セクションが更新されている | High |

- [x] T1: 既存実装と docs の差分を最終確認
- [x] T2: user API 詳細仕様を追記
- [x] T3: users API client の型・validation を追加
- [x] T4: users API client の契約テストを追加
- [x] T5: `/settings` を API client に接続
- [x] T6: weak/stats/ranking 契約の回帰確認
- [x] T7: backend 既存テストと docs の整合確認
- [x] T8: 品質チェック
- [x] T9: 手動確認
- [x] T10: 進捗・計画書更新

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| `GET /users/me` 正常系 | profile response を runtime validation 後に返す |
| `GET /users/me` 非 JSON error | `ApiError` body `null`、default message |
| `GET /users/me` 不正 response | `ApiError(500, ...)` |
| username 変更 正常系 | trim 済み username を送信し、updated user を返す |
| username 変更 409 | backend の `このユーザー名は既に使用されています` を保持 |
| username 変更 mixed payload | backend route test で 400 |
| password 変更 正常系 | `{ message }` を返し、page 側が logout / login 遷移 |
| password 変更 現在PW誤り | 400 と backend message を保持 |
| password 変更 新旧同一 | 400 と backend message を保持 |
| password 変更 rate limit | 429 と rateLimit message を保持 |
| account delete 正常系 | `{ message }` を返し、page 側が logout / top 遷移 |
| account delete PW誤り | 400 と backend message を保持 |
| account delete rate limit | 429 と rateLimit message を保持 |
| stats 空状態 | 0 値 summary と空 trend を受け入れる |
| ranking 未ログイン | Authorization なしで 200、`myRank: null` |
| ranking 不正 token | 401 と backend message |
| weak delete 404 | `苦手元素が見つかりません` を保持 |
| `/settings` キーボード操作 | username / password / delete が keyboard のみで完結 |
| `/settings` error A11Y | form error が `role="alert"` と `aria-describedby` で伝わる |

## 実装完了時の更新ルール

実装完了時は以下を必ず行う。

- `docs/04_api.md` の user API 仕様が実装と一致しているか確認する。
- `docs/05_progress.md` の `苦手 / ユーザー / ランキング / 統計 各 API のインターフェースを確定` を `[x]` に更新する。
- user API 実装済みの進捗差分を `docs/05_progress.md` に反映するか、反映しない理由を記録する。
- 本計画書のチェックボックスを完了にする。
- 実際に変更したファイルを `## 実装完了` に記録する。

```markdown
## 実装完了
- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/api-interface-contracts
- PR: #N

### 計画からの変更点
- なし

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `docs/04_api.md` | 修正 | user API 詳細仕様を追記 |
| `frontend/src/lib/api/users.ts` | 修正 | users API client を追加 |
```


## 実装完了
- 完了日: 2026-06-28
- 実装ブランチ: feature/api-interface-contracts
- PR: #67

### 計画からの変更点
- 共通 `frontend/src/lib/api/client.ts` は計画どおり新規導入せず、既存の `ApiError` / `parseErrorResponse()` パターンへ寄せた。
- DB schema / migration は変更しなかった。
- weak / stats / ranking はコード変更せず、既存 route/service/client と docs の契約回帰確認に限定した。

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `docs/04_api.md` | 修正 | `GET/PATCH/DELETE /users/me` の詳細仕様を追記 |
| `docs/05_progress.md` | 修正 | API インターフェース確定タスクと user API 実装済み状態を更新 |
| `docs/plans/api-interface-contracts/plan.md` | 修正 | タスク完了状態と実装完了記録を更新 |
| `frontend/src/lib/api/users.ts` | 修正 | profile / username / password / delete の users API client と runtime validation を追加 |
| `frontend/src/lib/api/users.test.ts` | 修正 | users API client の契約テストを追加 |
| `frontend/src/routes/(app)/settings/+page.svelte` | 修正 | page 内 fetch を users API client 呼び出しへ置換 |

### 実行した確認
| 種別 | コマンド / 内容 | 結果 |
|---|---|---|
| Backend lint | `cd backend && npm run lint` | 成功 |
| Backend format | `cd backend && npm run format:check` | 成功 |
| Backend test | `cd backend && npm run test -- --run` | 30 files / 259 tests passed |
| Frontend lint | `cd frontend && npm run lint` | 成功 |
| Frontend check | `cd frontend && npm run check` | 0 errors / 0 warnings |
| Frontend test | `cd frontend && npm run test:run` | 24 files / 280 tests passed |
| Frontend format check | `prettier --check`（変更対象） | 成功 |
| 手動確認 | テストアカウント登録・メール認証・ログイン・`/settings` 表示・validation A11Y・パスワード変更・新パスワード再ログイン・アカウント削除・`/weak` / `/mypage` / `/ranking` 表示 | 成功 |
