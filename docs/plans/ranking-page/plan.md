# ランキングページ `/ranking`（週間・全期間・自分の順位）実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、API 契約設計、状態管理、A11Y レビュー）

## 概要

`docs/05_progress.md` フェーズ8の `ランキングページ /ranking（週間・全期間・自分の順位）` を実装する。週間ランキングと全期間ランキングを URL query で切り替えて表示し、ログイン済みユーザーには自分の順位を表示する。

現状は `/ranking` が仮ページ、`backend/src/routes/ranking/index.ts` が TODO、`backend/src/index.ts` に ranking router mount もない。そのため本計画には、ranking API 契約の確定、backend API 実装、frontend API client、`/ranking` 画面実装、DB index、ドキュメント更新を含める。

## レビュー結果と改善方針

| 観点 | レビュー結果 | 改善方針 |
|---|---|---|
| 既存コード整合性 | `/ranking` は仮ページ。トップページのランキングプレビューは API 未実装のため空状態固定。`HomeRankingPreviewEntry` は `weeklyScore` を前提にしている | `/ranking` は live API を取得する詳細ページとして実装する。トップページ preview の live 化は別タスクに分離し、API は既存 `weeklyScore` 表記を維持する |
| 仕様整合性 | `docs/01_features.md` はログイン不要、週間、全期間、順位、ユーザー名、スコア、正答率を要求している | 未ログイン閲覧を必須にし、ログイン済みのみ `myRank` を表示する。表示項目に `accuracyRate` を追加する |
| API 整合性 | `docs/04_api.md` は weekly の例のみあり、alltime 詳細、error、`myRank` の null 条件が不足。末尾に重複した `## ランキング` 見出しがある | weekly / alltime を同じ構造で確定し、period 別に `weeklyScore` / `allTimeScore` を返す。実装時に `docs/04_api.md` の重複見出しを整理する |
| 認証 | ランキングは公開情報だが、自分の順位だけ認証が必要。必須認証にすると仕様と衝突する | backend は `optionalAuthMiddleware` を使う。frontend は `authStore.isInitializing` 完了後に、token がある場合だけ Authorization を付ける |
| DB 整合性 | `UserStats.weeklyScore` / `allTimeScore` は存在するが、ランキング用 index は `docs/03_data_model.md` の案に留まり schema 未反映 | `UserStats` に ranking 用 index を追加し migration を作る。DB 変更のため migration deploy と Playwright 確認を必須にする |
| DB 負荷 | Top50 と `myRank` count は score 順・score 条件で走る。index なしだとユーザー増加時に重くなる | score 降順 index を追加し、select は表示に必要な列だけに限定する。集計は既存 `UserStats` を使い、`GameSession` / `GameAnswer` の全件集計はしない |
| 未プレイユーザー | `UserStats` がない、または `totalGames = 0` のユーザーを含めると、未プレイで順位が出る | ランキング対象は `totalGames > 0` のアクティブ・未削除ユーザーに限定する。`myRank` も同条件を満たさない場合は `null` |
| 同点順位 | 既存 docs では同点時の扱いが未定義 | `rank = 自分より高スコアの対象ユーザー数 + 1` とし、同点は同順位にする |
| A11Y | ランキングは表形式が自然だが、仮ページには構造がない | `table` / `caption` / `th scope` を使い、period 切替は `aria-current` または `aria-selected` が分かるコントロールにする。loading は `aria-busy`、error は `role="alert"` |
| テスト | ranking route / service / frontend API client / helper のテストが存在しない | backend service / route、frontend API client / helper、Playwright を含む手動確認に分けて補強する |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- フェーズ8: `ランキングページ /ranking（週間・全期間・自分の順位）` は未実装。
- フェーズ9: `GET /ranking/weekly + /alltime（myRank フィールド・Top50）` は未実装。
- フェーズ9: `週間スコアリセットバッチ処理` は後続タスク。

**`docs/01_features.md`**
- ランキングはログイン不要で閲覧可能。
- 週間ランキング、全期間ランキングを提供する。
- 表示項目は順位、ユーザー名、スコア、正答率。

**`docs/03_data_model.md`**
- `UserStats.weeklyScore` は週間スコア。
- `UserStats.allTimeScore` は全期間スコア。
- ranking 用 index 案として `weeklyScore DESC` / `allTimeScore DESC` が記載されている。

**`docs/04_api.md`**
- `GET /ranking/weekly` と `GET /ranking/alltime` の一覧は存在する。
- `GET /ranking/weekly` の response 例は `rank`, `username`, `weeklyScore`, `totalGames`, `myRank`。
- `GET /ranking/alltime` の具体 response / error 仕様は不足している。

**`docs/12_task_guide.md`**
- ranking API は上位50ユーザーを返す。
- ログインユーザーには自分の順位も含める。
- `myRank` は「自分より高スコアのユーザー数 + 1」で算出する方針。

**`backend/prisma/schema.prisma`**
- `UserStats`: `userId`, `totalGames`, `totalCorrect`, `totalAnswered`, `weeklyScore`, `allTimeScore`, `updatedAt`。
- `UserStats.user` から `User.username`, `User.isActive`, `User.deletedAt` を参照できる。
- ranking 用 index は未実装。

**`backend/src/routes/ranking/index.ts`**
- 現状 `// TODO: implement`。

**`backend/src/index.ts`**
- `/api/v1/ranking` router は未 mount。

**`backend/src/middleware/auth/index.ts`**
- `optionalAuthMiddleware` — Authorization がなければ通過し、有効なログインユーザーだけ `c.set("user", ...)` する。
- Authorization ヘッダー形式不正・token 無効は 401。
- 停止中、メール未確認、ロック中など有効でないユーザーは `user` 未セットのまま通過する。

**`frontend/src/routes/(app)/ranking/+page.svelte`**
- 現状は仮ページ。

**`frontend/src/lib/components/Header.svelte`**
- `/ranking` へのグローバルナビ導線が存在する。

**`frontend/src/lib/components/home/RankingPreviewSection.svelte`**
- `HomeRankingPreviewEntry` の `weeklyScore` を表示する。
- 現状はトップページから空配列を受け取り、「ランキングは準備中です。」を表示する。

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL: string` — API base URL はここから import する。

**`frontend/src/lib/api/errors.ts`**
- `ApiError`
- `parseErrorResponse(response, defaultMessage?)`
- 非 JSON エラー時は body を `null` として扱う。

**`frontend/src/lib/stores/auth.svelte.ts`**
- `authStore.isInitializing`
- `authStore.isLoggedIn`
- `authStore.accessToken`

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.error(message)`

### 重要な制約

- ランキング閲覧は未ログインでも可能にする。
- `myRank` はログイン済みかつ ranking 対象条件を満たす場合のみ表示する。
- 未ログイン時は Authorization header を送らない。
- `authStore.isInitializing` 中は API 取得を開始しない。
- 不正 token がある場合は backend の 401 を frontend 固定文言で上書きしない。
- API URL とエラー処理を page component に重複実装しない。
- `response.ok` を JSON parse より先に確認する。
- frontend は rank / accuracyRate を再計算しない。API response を source of truth にする。
- DB アクセスは Prisma ORM 経由。生 SQL は使わない。
- backend のエラーレスポンスは日本語に統一する。
- DB schema / migration を変更するため、migration 適用確認と Playwright 確認を実施する。
- 週間スコアリセットバッチは本計画の対象外。`weeklyScore` の現値を表示する。
- トップページのランキングプレビュー live 化は本計画の対象外。

### 確認事項

- 計画書パスは `docs/plans/ranking-page/plan.md` とする。
- 画面ルートは既存 `/ranking` を使う。別ルートは作らない。
- `docs/04_api.md` の `GET /ranking/alltime` 詳細は未確定。本計画では weekly と同じ方針で仕様を補完する。
- API response は既存 weekly 仕様に合わせ、weekly は `weeklyScore`、alltime は `allTimeScore` を返す。
- frontend API client は UI 表示用に period 別 score を `score` へ正規化してよい。ただし元 response の runtime validation は period ごとに行う。
- `myRank` は未ログイン、ログインユーザーに `UserStats` がない、または `totalGames = 0` の場合 `null` とする。
- ランキング対象は `User.isActive = true`、`User.deletedAt = null`、`UserStats.totalGames > 0` のユーザーに限定する。
- 同点時は同順位とし、次順位はスキップする競技順位方式にする。例: 1位、1位、3位。
- Top50 の同点境界を50件超えて拡張するかは未定義。本計画では API 負荷と表示安定性を優先して最大50件に固定する。

## 対象ファイル一覧（変更種別つき）

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/prisma/schema.prisma` | 修正 | `UserStats.weeklyScore` / `allTimeScore` 用 index を追加 |
| `backend/prisma/migrations/20260625090000_add_user_stats_ranking_indexes/migration.sql` | 新規 | ranking index 追加 migration |
| `backend/src/lib/stats.ts` | 新規 | 統計値の正規化・正答率計算 helper |
| `backend/src/services/ranking.service.ts` | 新規 | ranking 取得、順位算出、response 整形 |
| `backend/src/services/ranking.service.test.ts` | 新規 | Top50、myRank、同点、空状態、対象ユーザー除外のテスト |
| `backend/src/services/user.service.ts` | 修正 | 統計 helper を共通化して重複計算を削除 |
| `backend/src/routes/ranking/index.ts` | 修正 | weekly / alltime route、optional auth、エラー処理 |
| `backend/src/routes/ranking/ranking.test.ts` | 新規 | route の未ログイン、ログイン、401、500 テスト |
| `backend/src/index.ts` | 修正 | `/api/v1/ranking` router を mount |
| `frontend/src/lib/api/ranking.ts` | 新規 | ranking API client、型、runtime validation |
| `frontend/src/lib/api/ranking.test.ts` | 新規 | URL、Authorization 有無、非 JSON、response validation テスト |
| `frontend/src/lib/ranking/ranking.ts` | 新規 | period query 正規化、表示 formatter、rank helper |
| `frontend/src/lib/ranking/ranking.test.ts` | 新規 | query 正規化、表示 formatter、空値テスト |
| `frontend/src/lib/components/ranking/RankingTable.svelte` | 新規 | ランキング一覧表示 |
| `frontend/src/lib/components/ranking/MyRankPanel.svelte` | 新規 | 自分の順位表示 |
| `frontend/src/routes/(app)/ranking/+page.svelte` | 修正 | page state、query 連動、API 取得、状態表示 |
| `frontend/src/routes/(app)/ranking/+page.ts` | 新規 | `ssr = true`, `prerender = false` を明示 |
| `docs/04_api.md` | 修正 | ranking API 仕様を確定し、重複見出しを整理 |
| `docs/05_progress.md` | 修正 | 対象タスクと ranking API タスクに計画書リンク・完了状態を反映 |
| `docs/plans/ranking-page/plan.md` | 修正 | タスク完了・実装記録を追記 |

## API 仕様（この機能で使う範囲のみ）

### エラーレスポンス共通形式

```json
{ "error": "メッセージ文字列" }
```

### GET `/api/v1/ranking/weekly`

| 項目 | 内容 |
|---|---|
| 認証 | 任意。Authorization があれば `myRank` を返す |
| 成功 | 200 |
| 用途 | 週間スコア上位50件と自分の週間順位を取得する |
| request body | なし |
| query params | なし |

Response 200:

```json
{
  "ranking": [
    {
      "rank": 1,
      "username": "taro123",
      "weeklyScore": 15000,
      "totalGames": 30,
      "accuracyRate": 86
    }
  ],
  "myRank": 42
}
```

### GET `/api/v1/ranking/alltime`

| 項目 | 内容 |
|---|---|
| 認証 | 任意。Authorization があれば `myRank` を返す |
| 成功 | 200 |
| 用途 | 全期間スコア上位50件と自分の全期間順位を取得する |
| request body | なし |
| query params | なし |

Response 200:

```json
{
  "ranking": [
    {
      "rank": 1,
      "username": "hanako",
      "allTimeScore": 92000,
      "totalGames": 180,
      "accuracyRate": 91
    }
  ],
  "myRank": null
}
```

### Response field

| フィールド | 型 | 説明 |
|---|---|---|
| `ranking` | array | 最大50件 |
| `ranking[].rank` | number | score 降順の順位。同点は同順位 |
| `ranking[].username` | string | 表示名 |
| `ranking[].weeklyScore` | number | 週間ランキングのスコア |
| `ranking[].allTimeScore` | number | 全期間ランキングのスコア |
| `ranking[].totalGames` | number | 累計ゲーム数 |
| `ranking[].accuracyRate` | number | `totalCorrect / totalAnswered` の整数パーセント。0〜100 |
| `myRank` | number \| null | ログイン済みユーザーの順位。未ログイン、統計なし、未プレイなら null |

### Error

| ステータス | 条件 | body |
|---|---|---|
| 401 | Authorization ヘッダー形式不正・token 無効 | auth middleware の日本語エラー |
| 500 | 想定外エラー | `{ "error": "サーバーエラーが発生しました" }` |

## 設計上の決定事項

1. **状態の source of truth**
   - 選択: ランキング種別は URL query `period=weekly|alltime`、表示データは API response。
   - 根拠: reload / 戻る / 直接アクセスで選択状態を復元でき、API response と UI のズレを避けられる。

2. **初期表示**
   - 選択: query がない場合は weekly を初期値にする。
   - 根拠: トップページ preview も週間ランキング前提であり、学習継続の短期モチベーションとして自然。

3. **ユーザー入力の反映タイミング**
   - 選択: segmented control / tab のクリック時に即 `goto()` で query 更新し、更新後に取得する。
   - 根拠: 入力フォームではなく2択の表示切替なので debounce は不要。

4. **API パラメータの組み立て**
   - 選択: `frontend/src/lib/api/ranking.ts` が `period` を endpoint に変換する。
   - 根拠: page component に `/ranking/weekly` / `/ranking/alltime` の文字列分岐を散らさない。

5. **正規化済みの値**
   - 選択: `frontend/src/lib/ranking/ranking.ts` の `normalizeRankingPeriod()` で一度だけ正規化する。
   - 根拠: URL query、API client、UI 表示で同じ値を再計算しないため。

6. **認証状態と `myRank`**
   - 選択: `authStore.isInitializing` 中は取得を待つ。未ログイン確定後は Authorization なしで取得する。ログイン済みなら Bearer token 付きで取得する。
   - 根拠: 未ログインでも閲覧可能にしつつ、ログイン済みでは `myRank` を取得するため。

7. **エラー表示**
   - 選択: 初期取得失敗は画面内 error + 再読み込みボタンを主にする。再取得失敗時は必要に応じて toast を補助にする。
   - 根拠: ランキングは画面全体の情報なので、toast だけだと再試行導線が残らない。

8. **ローディング・多重取得防止**
   - 選択: `AbortController` と request key で古いリクエストを破棄する。
   - 根拠: weekly / alltime を素早く切り替えたときに古い response が後勝ちで画面を上書きしないようにする。

9. **コンポーネント分割**
   - 選択: 表は `RankingTable.svelte`、自分の順位は `MyRankPanel.svelte` に分ける。
   - 根拠: page は取得・状態管理、component は表示に専念できる。

10. **rank / accuracyRate の計算責務**
    - 選択: backend で計算し、frontend は受け取った値を表示するだけにする。
    - 根拠: 同点順位、対象ユーザー除外、0除算処理を frontend に重複実装しない。

11. **ランキング対象条件**
    - 選択: `totalGames > 0`、`User.isActive = true`、`User.deletedAt = null` のユーザーだけを対象にする。
    - 根拠: 未プレイ・停止・削除済みユーザーを公開ランキングに出さないため。

12. **DB index**
    - 選択: `UserStats.weeklyScore` / `allTimeScore` に score 降順 index を追加する。
    - 根拠: Top50 と `myRank` count は score 順・score 条件で頻繁に検索するため。

13. **週間リセット**
    - 選択: 本計画では実装しない。
    - 根拠: `docs/05_progress.md` で別タスクとして管理されているため。

14. **トップページ preview の扱い**
    - 選択: 本計画では live 化しない。
    - 根拠: トップページ計画では API 未実装期間の空状態固定が意図的に選択されている。ランキング詳細ページの完成後に別タスクで安全に差し替える。

## 公開インターフェース案

### Backend

```ts
export type RankingPeriod = 'weekly' | 'alltime';

export type WeeklyRankingEntry = {
  rank: number;
  username: string;
  weeklyScore: number;
  totalGames: number;
  accuracyRate: number;
};

export type AllTimeRankingEntry = {
  rank: number;
  username: string;
  allTimeScore: number;
  totalGames: number;
  accuracyRate: number;
};

export type WeeklyRankingResponse = {
  ranking: WeeklyRankingEntry[];
  myRank: number | null;
};

export type AllTimeRankingResponse = {
  ranking: AllTimeRankingEntry[];
  myRank: number | null;
};

export function getWeeklyRanking(userId?: string): Promise<WeeklyRankingResponse>;
export function getAllTimeRanking(userId?: string): Promise<AllTimeRankingResponse>;
```

### Frontend

```ts
export type RankingPeriod = 'weekly' | 'alltime';

export type RankingEntry = {
  rank: number;
  username: string;
  score: number;
  totalGames: number;
  accuracyRate: number;
};

export type RankingResponse = {
  period: RankingPeriod;
  ranking: RankingEntry[];
  myRank: number | null;
};

export function getRanking(options: {
  period: RankingPeriod;
  accessToken?: string | null;
  signal?: AbortSignal;
}): Promise<RankingResponse>;
```

```ts
export function normalizeRankingPeriod(value: string | null): RankingPeriod;
export function toRankingSearchParams(period: RankingPeriod): URLSearchParams;
export function formatRankingScore(value: number): string;
export function formatRankingAccuracy(value: number): string;
```

## タスクリスト（進捗管理）

| タスクID | 内容 | ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存仕様・既存実装を最終確認する | `docs/04_api.md`, `docs/05_progress.md`, `backend/src/routes/ranking/index.ts`, `frontend/src/routes/(app)/ranking/+page.svelte` | API 未実装、router 未 mount、仮ページ状態を確認し、実装対象が確定する | 高 |
| T2 | ranking 用 DB index と migration を追加する | `backend/prisma/schema.prisma`, `backend/prisma/migrations/*` | `weeklyScore` / `allTimeScore` の検索用 index が migration として追加される | 高 |
| T3 | ranking service を TDD で実装する | `backend/src/services/ranking.service.ts`, `backend/src/services/ranking.service.test.ts` | Top50、myRank、同点、空状態、対象ユーザー除外のテストが通る | 高 |
| T4 | ranking route を TDD で実装して mount する | `backend/src/routes/ranking/index.ts`, `backend/src/routes/ranking/ranking.test.ts`, `backend/src/index.ts` | `/api/v1/ranking/weekly` と `/alltime` が動作し、任意認証と日本語エラーが確認できる | 高 |
| T5 | frontend ranking API client を実装する | `frontend/src/lib/api/ranking.ts`, `frontend/src/lib/api/ranking.test.ts` | Authorization 有無、非 JSON、period 別 response validation のテストが通る | 高 |
| T6 | ranking helper を実装する | `frontend/src/lib/ranking/ranking.ts`, `frontend/src/lib/ranking/ranking.test.ts` | query 正規化、formatter、境界値テストが通る | 高 |
| T7 | ranking 表示コンポーネントを作成する | `frontend/src/lib/components/ranking/RankingTable.svelte`, `frontend/src/lib/components/ranking/MyRankPanel.svelte` | 順位、ユーザー名、スコア、正答率、自分の順位を A11Y に配慮して表示できる | 高 |
| T8 | `/ranking` page を実装する | `frontend/src/routes/(app)/ranking/+page.svelte`, `frontend/src/routes/(app)/ranking/+page.ts` | 初期表示、weekly/alltime 切替、reload/back 復元、loading/error/empty/retry が動作する | 高 |
| T9 | ドキュメントを更新する | `docs/04_api.md`, `docs/05_progress.md`, `docs/plans/ranking-page/plan.md` | API 仕様、進捗、計画チェックボックスが実態と一致する | 高 |
| T10 | 品質チェックを実行する | backend / frontend | lint、format、test、migration deploy 確認が完了する | 高 |
| T11 | 手動確認を実施する | `/ranking`, `/`, API | 未ログイン・ログイン済み・切替・空状態・エラー・A11Y を確認する | 高 |

- [x] T1: 既存仕様・既存実装を最終確認する
- [x] T2: ranking 用 DB index と migration を追加する
- [x] T3: ranking service を TDD で実装する
- [x] T4: ranking route を TDD で実装して mount する
- [x] T5: frontend ranking API client を実装する
- [x] T6: ranking helper を実装する
- [x] T7: ranking 表示コンポーネントを作成する
- [x] T8: `/ranking` page を実装する
- [x] T9: ドキュメントを更新する
- [x] T10: 品質チェックを実行する
- [x] T11: 手動確認を実施する

## 技術的注意点

- `ranking.service.ts` では停止中・論理削除済み・未プレイユーザーを除外する。
- `accuracyRate` は `totalAnswered <= 0` の場合 0 とし、0〜100 の整数に正規化する。
- `myRank` 算出は period ごとに対象 score を切り替える。
- `myRank` 算出時も Top50 と同じ対象条件を使う。
- optional auth のため、frontend は `authStore.isInitializing` が終わってから取得を始める。
- 不正 query は 400 にせず frontend 側で weekly に正規化する。
- `AbortController` は `onDestroy` で abort する。
- `RankingTable.svelte` は `<table>` を使い、`caption` か見出し関連付けで表の意味を伝える。
- score 表示は `Intl.NumberFormat('ja-JP')` を使う。
- period 切替のボタンは選択中状態が視覚だけでなく支援技術にも伝わるようにする。
- DB schema を変更するため、`npx prisma migrate deploy` と Playwright 確認結果を報告に含める。

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| 初期表示: query なし | weekly として API を取得し、週間ランキングが表示される |
| 初期表示: `?period=alltime` | 全期間ランキングが表示される |
| 初期表示: 不正 query | weekly に正規化される |
| 正常系: 未ログイン | Authorization なしで取得し、`myRank: null` を表示する |
| 正常系: ログイン済み | Bearer token 付きで取得し、自分の順位を表示する |
| 正常系: Top50 | 最大50件が順位付きで表示される |
| 正常系: 同点 | 同じ score のユーザーは同じ rank になる |
| 正常系: 未プレイユーザー | `totalGames = 0` のユーザーは ranking と `myRank` の対象外 |
| 正常系: 停止中・削除済みユーザー | ranking と `myRank` の対象外 |
| 正常系: 正答率 | `totalCorrect / totalAnswered` が 0〜100 の整数で返る |
| 空状態 | ランキングがまだない旨とゲーム導線が表示される |
| API エラー JSON | backend の日本語 error が画面内に表示される |
| API エラー 非 JSON | default message が `ApiError` として表示される |
| 認証エラー | 不正 token 時は 401 の日本語エラーを上書きしない |
| ローディング中の二重取得 | 古い request は abort され、最新 period の結果だけ表示される |
| reload 復元 | `?period=alltime` で再読み込みしても全期間が維持される |
| 戻る操作 | weekly / alltime の履歴移動で表示が追従する |
| response validation | period 別 score field、`rank`, `accuracyRate`, `myRank` の型不一致で ApiError(500) |
| A11Y | period 切替、再読み込みボタン、表の見出し、`aria-busy` / `role="alert"` が機能する |

## 実装リスクと回避策

| リスク | 影響 | 回避策 |
|---|---|---|
| ranking API 未 mount のまま frontend が呼ぶ | 404 になる | T4 で `backend/src/index.ts` の mount を必須にする |
| `myRank` と Top50 の順位計算がズレる | ユーザーに誤った順位を表示する | service helper で順位計算条件を一元化し、同点テストを追加する |
| 停止中・削除済みユーザーが表示される | 不適切な公開情報になる | service query で `isActive` / `deletedAt` 条件を必須にする |
| 未プレイユーザーが1位表示される | 信頼性が下がる | `totalGames > 0` を ranking 対象条件にする |
| DB index なしでランキングが重い | データ増加時に遅くなる | migration で ranking index を追加する |
| frontend が weekly / alltime score を混同する | 誤ったスコアを表示する | API client で period 別 response を検証し、UI 用 `score` に正規化する |
| 認証初期化前に未ログイン取得する | `myRank` が一瞬消える | `authStore.isInitializing` 中は fetch しない |
| docs と実装が不一致になる | 後続実装者が迷う | `docs/04_api.md` と plan の完了更新を T9 に含める |

## 手動確認項目

- `/ranking` を未ログインで開き、週間ランキングまたは空状態が表示されること。
- `/ranking?period=alltime` を直接開き、全期間タブが選択されること。
- weekly / alltime を切り替え、URL query と表示が一致すること。
- ブラウザ戻る / 進むで選択状態が復元されること。
- ログイン済みで開き、自分の順位が表示されること。
- 未プレイのログインユーザーでは自分の順位が未参加状態として表示されること。
- ranking が空の場合、空状態とゲーム導線が表示されること。
- API 500 / 非 JSON 相当の失敗時、画面内エラーと再読み込み導線が表示されること。
- キーボードだけで period 切替、再読み込み、主要リンクへ到達できること。
- DB migration 後、ログイン、ゲーム結果保存、`/ranking` 表示の主要導線が壊れていないこと。
- トップページのランキングプレビューが従来どおり空状態で壊れていないこと。

## 実装完了時の更新ルール

実装完了時は以下を必ず行う。

- `docs/plans/ranking-page/plan.md` のチェックボックスを完了状態に更新する。
- 実際に変更したファイルに合わせて「対象ファイル一覧」を修正する。
- API 仕様が計画から変わった場合は `docs/04_api.md` と「計画からの変更点」に記録する。
- `docs/05_progress.md` の `ランキングページ /ranking（週間・全期間・自分の順位）` を `[x]` に更新する。
- backend API まで完了した場合は `GET /ranking/weekly + /alltime（myRank フィールド・Top50）` も実態に合わせて更新する。
- DB schema / migration を変更した場合は migration 適用確認と Playwright 確認結果を記録する。

```markdown
## 実装完了
- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/ranking-page
- PR: #N

### 計画からの変更点
- なし

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/services/ranking.service.ts` | 新規 | ランキング取得処理 |
| `frontend/src/routes/(app)/ranking/+page.svelte` | 修正 | ランキングページ実装 |

### 確認結果
- backend lint:
- backend format:check:
- backend test:
- frontend lint:
- frontend format:
- frontend test:
- prisma migrate deploy:
- Playwright:
```


## 実装完了
- 完了日: 2026-06-25
- 実装ブランチ: feature/ranking-page
- PR: #64

### 計画からの変更点
- `backend/src/lib/stats.ts` を追加し、ランキング service と既存 user service で統計値の正規化・正答率計算を共有した。計画時は ranking service 内で完結する想定だったが、同じ計算が重複するため共通 helper に切り出した。
- Playwright の手動確認は、既存データが入っている開発 DB で未ログイン表示、週間/全期間切替、API 200、console error なしを確認した。ログイン済み `myRank`・空状態・エラー系は自動テストで確認した。
- レビュー改善として、ログイン時の ranking 一覧取得と `myRank` 取得を並列化し、`aria-busy` と ranking 種別ボタンの `aria-pressed` を実際の UI 状態に合わせた。

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/prisma/schema.prisma` | 修正 | `UserStats.weeklyScore` / `allTimeScore` の降順 index を追加 |
| `backend/prisma/migrations/20260625090000_add_user_stats_ranking_indexes/migration.sql` | 新規 | ranking index 追加 migration |
| `backend/src/lib/stats.ts` | 新規 | 統計値の正規化・正答率計算 helper |
| `backend/src/services/ranking.service.ts` | 新規 | Top50、同点順位、myRank、対象ユーザー除外を実装 |
| `backend/src/services/ranking.service.test.ts` | 新規 | ranking service の TDD テスト |
| `backend/src/services/user.service.ts` | 修正 | 統計 helper の共通化 |
| `backend/src/routes/ranking/index.ts` | 修正 | `GET /ranking/weekly` / `GET /ranking/alltime` を実装 |
| `backend/src/routes/ranking/ranking.test.ts` | 新規 | ranking route の TDD テスト |
| `backend/src/index.ts` | 修正 | `/api/v1/ranking` router を mount |
| `frontend/src/lib/api/ranking.ts` | 新規 | ranking API client、型、runtime validation |
| `frontend/src/lib/api/ranking.test.ts` | 新規 | ranking API client の TDD テスト |
| `frontend/src/lib/ranking/ranking.ts` | 新規 | period 正規化と表示 formatter |
| `frontend/src/lib/ranking/ranking.test.ts` | 新規 | ranking helper の TDD テスト |
| `frontend/src/lib/components/ranking/RankingTable.svelte` | 新規 | ランキング表コンポーネント |
| `frontend/src/lib/components/ranking/MyRankPanel.svelte` | 新規 | 自分の順位表示コンポーネント |
| `frontend/src/routes/(app)/ranking/+page.svelte` | 修正 | ranking page の取得・切替・状態表示 |
| `frontend/src/routes/(app)/ranking/+page.ts` | 新規 | prerender 無効化を明示 |
| `docs/04_api.md` | 修正 | ranking API 仕様を実装内容に合わせて更新 |
| `docs/05_progress.md` | 修正 | ranking page / ranking API を完了に更新 |
| `docs/plans/ranking-page/plan.md` | 修正 | タスク完了・実装記録を追記 |

### 確認結果
- backend lint: `npm run lint` 成功
- backend format:check: `npm run format:check` 成功
- backend test: `npm run test -- --run` 成功（30 files / 259 tests）
- frontend check: `npm run check` 成功
- frontend lint: `npm run lint` 成功
- frontend test: `npm run test:run` 成功（24 files / 267 tests）
- frontend format: `npm run format` 実行済み
- prisma validate / format: 成功
- prisma migrate deploy: host では Docker hostname 解決の都合で失敗、`docker exec gensoko-hono-1 npx prisma migrate deploy` で成功
- Playwright: `http://localhost:5174/ranking` で週間ランキング表示、全期間切替、`?period=alltime` 反映、console error なしを確認
- API 実動作: `GET http://localhost:3000/api/v1/ranking/weekly` / `alltime` が 200 OK を返すことを確認
