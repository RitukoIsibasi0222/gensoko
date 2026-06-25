# マイページ・統計画面 `/mypage` 実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、API 契約設計、状態管理、A11Y レビュー）

## 概要

`docs/05_progress.md` フェーズ8の `マイページ・統計画面 /mypage（正答率グラフ・サマリーカード）` を実装する。既存 `/mypage` のゲーム履歴セクションを維持しつつ、認証済みユーザーの累計統計サマリーと直近10ゲームの正答率推移グラフを追加する。

統計データは `GET /api/v1/users/me/stats` で取得し、画面は API response を source of truth とする。DB schema は既存 `UserStats` と `GameSession` で足りる想定のため、原則 migration は行わない。

## レビュー結果と改善方針

| 観点 | レビュー結果 | 改善方針 |
|---|---|---|
| 依頼内容整合性 | 主対象は `docs/05_progress.md` の `マイページ・統計画面 /mypage（正答率グラフ・サマリーカード）` と一致する | 計画書パスは `docs/plans/mypage-stats/plan.md` とする |
| 既存計画との整合性 | `docs/plans/mypage-stats/plan.md` は未作成。`docs/plans/game-session-history/plan.md` で `/mypage` のゲーム履歴セクションだけが実装済み | 既存履歴の mode filter、追加読み込み、URL query 復元を壊さず、統計セクションを追加する |
| 既存コードとの整合性 | `/mypage` は `authStore`、`toastStore`、`ApiError`、`AbortController` 付き API 取得を実装済み。users API は `GET/PATCH/DELETE /users/me` まで実装済みで、stats は未実装 | 統計取得も同じ認証・エラー・キャンセル処理パターンへ寄せる。settings 画面の users API inline fetch は本タスクで無理にリファクタしない |
| 仕様との整合性 | `docs/01_features.md` は総ゲーム数、総正解数、平均正答率、習得済み元素数、連続ログイン日数、直近10ゲーム正答率グラフを要求している | API response と UI 表示項目をこの6項目中心に固定し、スコア系は補助表示に留める |
| API 整合性 | `docs/04_api.md` は `GET /users/me/stats` の一覧だけあり、response / error 詳細が未定義 | 本計画で response、空状態、error、ステータスコードを確定し、実装時に `docs/04_api.md` を更新する |
| A11Y | グラフは canvas だけだとスクリーンリーダーで情報が失われる。カードだけでも数値変化の文脈が伝わりにくい | グラフに `figure` / `figcaption` / 代替テキストまたはデータリストを用意し、loading は `aria-busy`、error は `role="alert"` を使う |
| DB 整合性 | `UserStats` は `POST /game/sessions` で upsert 更新される集計キャッシュ。直近10ゲームは `GameSession` の summary だけで作れる | `UserStats.findUnique` と `GameSession.findMany(take: 10)` の軽量 query に限定し、`GameAnswer` は参照しない |
| DB 負荷 | 毎回全 `GameSession` や `GameAnswer` を集計すると履歴増加時に重い | 累計は `UserStats` から取得し、グラフは既存 index `@@index([userId, playedAt, id])` を活かして直近10件だけ select する |
| テスト | backend route だけでは stats null、正答率0除算、frontend 非 JSON エラー、グラフ空状態が漏れる | backend service / route、frontend API client / helper、UI 手動確認に分けてテスト観点を固定する |
| 依存追加 | `docs/06_libraries.md` は Chart.js 想定だが、現行 `frontend/package.json` には未導入 | Chart.js を採用する場合は dependency 更新を明記する。SSR 回避と A11Y 代替表示を必須にする |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- フェーズ8: `マイページ・統計画面 /mypage（正答率グラフ・サマリーカード）` は未実装。
- フェーズ9: `GET /users/me/stats` は未実装。
- フェーズ9: `GET /users/me + PATCH /users/me + DELETE /users/me` は進捗上は未完了表記だが、現行コードでは実装済み。今回の主対象は stats API と `/mypage` 統計 UI に限定する。

**`docs/01_features.md`**
- FEAT-004: マイページで表示する統計。
- 表示項目: 総ゲーム数、総正解数、平均正答率、習得済み元素数、連続ログイン日数、正答率グラフ。
- 正答率グラフは直近10ゲームの推移。

**`docs/04_api.md`**
- `GET /users/me/stats` はユーザー API 一覧に存在するが、詳細仕様は未定義。
- エラーレスポンス共通形式は `{ "error": "メッセージ文字列" }`。
- バリデーションエラー時は `{ "error": "バリデーションエラー", "details": [...] }`。

**`docs/06_libraries.md`**
- `chart.js` は「マイページの正答率グラフに使う」と記載されている。
- ただし現行 `frontend/package.json` には `chart.js` が未導入。

**`backend/prisma/schema.prisma`**
- `UserStats`: `userId`, `totalGames`, `totalCorrect`, `totalAnswered`, `masteredCount`, `currentStreak`, `lastActiveDate`, `weeklyScore`, `allTimeScore`, `updatedAt`。
- `GameSession`: `id`, `userId`, `mode`, `totalScore`, `correctCount`, `totalCount`, `maxStreak`, `durationSec`, `playedAt`。
- `GameSession` には `@@index([userId, playedAt, id])` がある。
- `GameAnswer` は今回の統計 API では参照しない。

**`backend/src/routes/users/index.ts`**
- `usersRouter.get("/me", authMiddleware, ...)`。
- `usersRouter.patch("/me", authMiddleware, zValidator(...), ...)`。
- `usersRouter.delete("/me", authMiddleware, authRateLimit, zValidator(...), ...)`。
- `handleUserError(err, c)` は `UserError` を `{ error: err.message }`、想定外を `{ error: "サーバーエラーが発生しました" }` へ変換する。

**`backend/src/services/user.service.ts`**
- `UserError`。
- `CurrentUserProfile`。
- `getCurrentUserProfile(userId): Promise<CurrentUserProfile>`。
- `updateCurrentUsername(input)`。
- `changeCurrentPassword(input)`。
- `deleteCurrentUser(input)`。

**`backend/src/types/index.ts`**
- `AppVariables`。
- `AuthUser`。
- `JwtPayload`。

**`backend/src/lib/prisma.ts`**
- Prisma v7 の `PrismaPg` adapter 付き singleton。

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL: string`。
- API base URL はここから import し、各ファイルで再定義しない。

**`frontend/src/lib/api/errors.ts`**
- `ApiError`。
- `parseErrorBody(response)`。
- `parseErrorResponse(response, defaultMessage?)`。
- 非 JSON エラーレスポンスでは body を `null` にする。

**`frontend/src/lib/api/game.ts`**
- `getGameSessions(options): Promise<GameSessionsResponse>`。
- `API_BASE_URL`, `ApiError`, `parseErrorResponse` を使う API client pattern。
- response shape は runtime validation する。

**`frontend/src/lib/game/session-history.ts`**
- `normalizeGameSessionHistoryQuery(query)`。
- `getGameSessionAccuracy({ correctCount, totalCount })`。
- `formatGameSessionPlayedAt(playedAt)`。

**`frontend/src/lib/stores/auth.svelte.ts`**
- `authStore.user`。
- `authStore.accessToken`。
- `authStore.isLoggedIn`。
- `authStore.isInitializing`。

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.error(message)`。
- `toastStore.fromApiError(error)`。
- `toastStore.success(message)`。

**`frontend/src/routes/(app)/mypage/+page.ts`**
- `ssr = true`。
- `prerender = false`。

**`frontend/src/routes/(app)/mypage/+page.svelte`**
- 既存ゲーム履歴一覧。
- 未ログイン、認証初期化中、loading、empty、error、retry、追加読み込み状態。
- `mode`, `limit`, `cursor` の URL query 復元。

### 重要な制約

- `/mypage` 既存履歴セクションの URL query 復元、mode filter、追加読み込み、詳細リンクを壊さない。
- 統計 API は認証必須。未ログイン時は API を呼ばずログイン導線を表示する。
- API base URL とエラー処理を page component に重複実装しない。
- backend エラー文言は日本語に統一する。
- `response.ok` を JSON parse より先に確認する。
- 統計値は frontend で独自に全履歴再集計しない。累計は API response、表示整形は frontend helper に限定する。
- `averageAccuracyRate` は 0〜100 の整数パーセントとして返す。`totalAnswered <= 0` の場合は 0。
- DB schema 変更は予定しない。`schema.prisma` または migration を変更した場合は migration deploy と Playwright 確認を追加する。
- `Chart.js` は browser 環境でのみ初期化する。SSR 中に `window` / `canvas` に触れない。
- UI はグラフだけに意味を閉じ込めず、同じ情報をテキストでも確認できるようにする。

### 確認事項

- 計画書パスは `docs/plans/mypage-stats/plan.md` とする。
- 画面ルートは既存 `/mypage` を使う。別ルートは作らない。
- `平均正答率` は本計画では `totalCorrect / totalAnswered` の累計正答率として扱う。全セッションの単純平均が必要な場合は仕様変更として記録する。
- 直近10ゲームの正答率グラフは、履歴一覧の mode filter とは独立した「全モード直近10件」とする。
- `GET /users/me/stats` の response に `weeklyScore` / `allTimeScore` を含めるが、FEAT-004 の必須表示項目ではないため UI では補助的な表示に留める。
- `UserStats` が存在しないが `GameSession` が存在する状態は通常起きない想定。既存データ移行などで起きる場合の fallback 方針は実装時に確認し、必要なら軽量 aggregate を追加する。
- `docs/05_progress.md` の `GET /users/me + PATCH /users/me + DELETE /users/me` は現行実装と進捗表にズレがあるが、本計画では stats 以外の進捗整理は行わない。

## 対象ファイル一覧（変更種別つき）

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/services/user.service.ts` | 修正 | `getCurrentUserStats()` と統計 response 型を追加 |
| `backend/src/services/user.service.test.ts` | 修正 | stats service の正常系、空状態、0除算、ユーザーなしテストを追加 |
| `backend/src/routes/users/index.ts` | 修正 | `GET /me/stats` route を追加 |
| `backend/src/routes/users/get-me-stats.test.ts` | 新規 | stats route の認証、200、500、service error mapping テスト |
| `frontend/package.json` | 修正 | `chart.js` を追加する場合に依存を追加 |
| `frontend/package-lock.json` | 修正 | `chart.js` を追加する場合に lock を更新 |
| `frontend/src/lib/api/users.ts` | 新規 | `getMyStats()` API client、型、runtime validation を追加 |
| `frontend/src/lib/api/users.test.ts` | 新規 | stats API client の URL、Authorization、非 JSON、response validation テスト |
| `frontend/src/lib/mypage/stats.ts` | 新規 | 正答率、日付、サマリー表示、グラフ用データ helper |
| `frontend/src/lib/mypage/stats.test.ts` | 新規 | helper の空値、0除算、日付、グラフ label テスト |
| `frontend/src/lib/components/mypage/StatsSummaryCards.svelte` | 新規 | サマリーカード表示 component |
| `frontend/src/lib/components/mypage/AccuracyTrendChart.svelte` | 新規 | 直近10ゲーム正答率グラフ component |
| `frontend/src/routes/(app)/mypage/+page.svelte` | 修正 | 統計セクション、取得状態、再試行導線を追加 |
| `docs/04_api.md` | 修正 | `GET /users/me/stats` の request / response / error 仕様を追加 |
| `docs/05_progress.md` | 修正 | `/mypage` 統計画面と `GET /users/me/stats` に計画書リンクを追加し、実装完了時に更新 |
| `docs/plans/mypage-stats/plan.md` | 新規/修正 | 本計画。実装完了時に実態へ更新 |

## API 仕様（この機能で使う範囲のみ）

### エラーレスポンス共通形式

```json
{ "error": "メッセージ文字列" }
```

バリデーションエラー時:

```json
{
  "error": "バリデーションエラー",
  "details": [{ "message": "入力値が正しくありません" }]
}
```

### GET `/api/v1/users/me/stats`

| 項目 | 内容 |
|---|---|
| 認証 | 必須。`Authorization: Bearer <accessToken>` |
| 成功 | 200 |
| 用途 | マイページの統計サマリーと正答率グラフを表示する |
| request body | なし |
| query params | なし |
| 副作用 | なし |

#### Response 200

```json
{
  "stats": {
    "totalGames": 12,
    "totalCorrect": 91,
    "totalAnswered": 120,
    "averageAccuracyRate": 76,
    "masteredCount": 18,
    "currentStreak": 5,
    "weeklyScore": 2400,
    "allTimeScore": 9200,
    "lastActiveDate": "2026-06-20T00:00:00.000Z",
    "updatedAt": "2026-06-20T12:35:00.000Z"
  },
  "recentAccuracyTrend": [
    {
      "sessionId": "clx_session_id",
      "playedAt": "2026-06-20T12:35:00.000Z",
      "correctCount": 8,
      "totalCount": 10,
      "accuracyRate": 80
    }
  ]
}
```

#### 空状態 Response 200

```json
{
  "stats": {
    "totalGames": 0,
    "totalCorrect": 0,
    "totalAnswered": 0,
    "averageAccuracyRate": 0,
    "masteredCount": 0,
    "currentStreak": 0,
    "weeklyScore": 0,
    "allTimeScore": 0,
    "lastActiveDate": null,
    "updatedAt": null
  },
  "recentAccuracyTrend": []
}
```

#### Response field

| フィールド | 型 | 説明 |
|---|---|---|
| `stats.totalGames` | number | 累計ゲーム回数 |
| `stats.totalCorrect` | number | 累計正解数 |
| `stats.totalAnswered` | number | 累計回答数 |
| `stats.averageAccuracyRate` | number | `totalCorrect / totalAnswered` を整数パーセント化した値。0〜100 |
| `stats.masteredCount` | number | 習得済み元素数 |
| `stats.currentStreak` | number | 現在の連続ログイン日数 |
| `stats.weeklyScore` | number | 週間スコア。ランキング画面でも利用予定 |
| `stats.allTimeScore` | number | 全期間スコア |
| `stats.lastActiveDate` | string \| null | 最終アクティブ日 |
| `stats.updatedAt` | string \| null | 統計キャッシュ更新日時 |
| `recentAccuracyTrend` | array | 直近10ゲームの正答率推移。表示用は古い順に返す |

#### Error

| ステータス | 条件 | body |
|---|---|---|
| 401 | 未ログイン、token 不正、ユーザーが見つからない | auth middleware の日本語エラー |
| 403 | アカウント停止、メール未確認、ロック中 | auth middleware の日本語エラー |
| 429 | rate limit を適用した場合 | rateLimit middleware の日本語エラー |
| 500 | 想定外エラー | `{ "error": "サーバーエラーが発生しました" }` |

## 設計上の決定事項（判断理由つき）

1. **統計表示の source of truth**
   - 選択: `GET /users/me/stats` の response を source of truth にする。
   - 根拠: `UserStats` は backend で更新される集計キャッシュであり、frontend が全履歴から再集計するとズレや負荷の原因になる。

2. **直近10ゲームグラフの source of truth**
   - 選択: `recentAccuracyTrend` を API response に含める。
   - 根拠: frontend が `GET /game/sessions` の現在の page / filter に依存してグラフを作ると、全体統計と履歴 filter が混ざるため。

3. **初期表示時の復元**
   - 選択: `authStore.isInitializing` 完了後、ログイン済みなら統計 API を取得する。
   - 根拠: 認証初期化中に未ログイン扱いすると UI がちらつき、不要な error 表示が出る。

4. **URL query の扱い**
   - 選択: 統計セクションには URL query を使わない。既存履歴の `mode`, `limit`, `cursor` query は維持する。
   - 根拠: 統計はユーザー全体のサマリーであり、履歴一覧 filter と連動させると意味が不安定になる。

5. **ユーザー入力の反映タイミング**
   - 選択: 統計セクションには検索入力を置かず、再取得は「再試行」ボタンのみ。
   - 根拠: サマリーと直近10件に操作パラメータがなく、debounce や Enter 反映は不要。

6. **API パラメータの組み立て層**
   - 選択: `frontend/src/lib/api/users.ts` の `getMyStats()` に閉じ込める。
   - 根拠: page component に URL 組み立て、Authorization、runtime validation を埋め込まない。

7. **正規化済み値の保持**
   - 選択: stats API は query/body がないため入力正規化は不要。表示用の数値・日付整形は `frontend/src/lib/mypage/stats.ts` で一度だけ行う。
   - 根拠: 表示 component 内で同じ計算を重複させない。

8. **エラー表示**
   - 選択: 初回統計取得失敗は統計セクション内に表示し、再試行ボタンを置く。手動再試行の失敗時だけ toast を補助的に使う。
   - 根拠: 履歴セクションとは独立して復旧できるため、一時 toast だけに依存しない。

9. **既存コンポーネント再利用**
   - 選択: 既存履歴 markup は維持し、統計用に `StatsSummaryCards` と `AccuracyTrendChart` を新規作成する。
   - 根拠: サマリーカードとグラフは再利用可能な UI 単位だが、履歴 item とは責務が異なる。

10. **グラフライブラリ**
    - 選択: `docs/06_libraries.md` に合わせて Chart.js 採用を第一候補にする。依存追加を避ける判断に変える場合は計画からの変更点に記録する。
    - 根拠: 既存 docs に明示された用途と一致する。一方で SSR / bundle / A11Y の注意が必要なため component に閉じ込める。

11. **API response の日付順**
    - 選択: `recentAccuracyTrend` は表示しやすいよう古い順に返す。
    - 根拠: 折れ線グラフは左から右へ時系列が進むほうが自然。DB query は desc 取得後に service で反転する。

12. **reload / 戻る / 直接アクセス**
    - 選択: reload / 直接アクセスでは統計を再取得する。store には統計を永続化しない。
    - 根拠: 統計 API は軽量で、store 永続化より DB 実態との整合性を優先する。

13. **DB query 方針**
    - 選択: `UserStats.findUnique({ where: { userId } })` と `GameSession.findMany({ where: { userId }, orderBy, take: 10, select })` に限定する。
    - 根拠: 累計値はキャッシュ、グラフは summary だけで足りるため、`GameAnswer` include や全件集計を避けられる。

14. **stats 未作成時の扱い**
    - 選択: `UserStats` が `null` の場合はゼロ値を返す。
    - 根拠: 未プレイユーザーで 404/500 にせず、画面の空状態を自然に表示するため。

## 公開インターフェース案

```ts
// backend/src/services/user.service.ts
export type CurrentUserStatsSummary = {
  totalGames: number;
  totalCorrect: number;
  totalAnswered: number;
  averageAccuracyRate: number;
  masteredCount: number;
  currentStreak: number;
  weeklyScore: number;
  allTimeScore: number;
  lastActiveDate: Date | null;
  updatedAt: Date | null;
};

export type CurrentUserAccuracyTrendItem = {
  sessionId: string;
  playedAt: Date;
  correctCount: number;
  totalCount: number;
  accuracyRate: number;
};

export type CurrentUserStats = {
  stats: CurrentUserStatsSummary;
  recentAccuracyTrend: CurrentUserAccuracyTrendItem[];
};

export function getCurrentUserStats(userId: string): Promise<CurrentUserStats>;
```

```ts
// frontend/src/lib/api/users.ts
export type MyStatsSummary = {
  totalGames: number;
  totalCorrect: number;
  totalAnswered: number;
  averageAccuracyRate: number;
  masteredCount: number;
  currentStreak: number;
  weeklyScore: number;
  allTimeScore: number;
  lastActiveDate: string | null;
  updatedAt: string | null;
};

export type MyAccuracyTrendItem = {
  sessionId: string;
  playedAt: string;
  correctCount: number;
  totalCount: number;
  accuracyRate: number;
};

export type MyStatsResponse = {
  stats: MyStatsSummary;
  recentAccuracyTrend: readonly MyAccuracyTrendItem[];
};

export type GetMyStatsOptions = {
  accessToken: string;
  signal?: AbortSignal;
};

export function getMyStats(options: GetMyStatsOptions): Promise<MyStatsResponse>;
```

```ts
// frontend/src/lib/mypage/stats.ts
export function formatStatNumber(value: number): string;
export function formatAccuracyRate(value: number): string;
export function formatStatsDate(value: string | null): string;
export function toAccuracyChartLabels(items: readonly MyAccuracyTrendItem[]): string[];
export function toAccuracyChartValues(items: readonly MyAccuracyTrendItem[]): number[];
```

## タスクリスト（進捗管理）

| タスクID | 内容 | ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存仕様・既存実装の最終確認 | `docs/01_features.md`, `docs/04_api.md`, `docs/05_progress.md`, `/mypage`, users 関連ファイル | 既存履歴との責務境界、API 未定義点、Chart.js 未導入、進捗表のズレが plan に反映済み | 高 |
| T2 | backend stats service の Red テストを追加 | `backend/src/services/user.service.test.ts` | stats あり、stats なし、0回答、直近10件、ユーザーなしのテストが先に失敗する | 高 |
| T3 | backend stats service を実装 | `backend/src/services/user.service.ts` | `UserStats` と直近10 `GameSession` から response を返し、`GameAnswer` を参照しない | 高 |
| T4 | backend route の Red テストを追加 | `backend/src/routes/users/get-me-stats.test.ts` | 未認証、200、service error、想定外 error のテストが先に失敗する | 高 |
| T5 | backend route を実装 | `backend/src/routes/users/index.ts` | `GET /me/stats` が auth 必須で動作し、エラーが日本語で返る | 高 |
| T6 | frontend stats API client の Red テストを追加 | `frontend/src/lib/api/users.test.ts` | Authorization、credentials、AbortSignal、非 JSON、response validation のテストが先に失敗する | 高 |
| T7 | frontend stats API client を実装 | `frontend/src/lib/api/users.ts` | `API_BASE_URL` と `parseErrorResponse()` を使い、runtime validation を行う | 高 |
| T8 | stats helper と Red テストを追加 | `frontend/src/lib/mypage/stats.ts`, `frontend/src/lib/mypage/stats.test.ts` | 数値、正答率、日付、空 trend、chart label/value のテストが通る | 高 |
| T9 | Chart.js 依存追加要否を最終判断して反映 | `frontend/package.json`, `frontend/package-lock.json` | Chart.js 採用なら依存が追加済み。不採用なら理由を plan 実装完了欄に記録 | 中 |
| T10 | サマリーカード component を作成 | `frontend/src/lib/components/mypage/StatsSummaryCards.svelte` | FEAT-004 の必須統計項目がレスポンシブに表示される | 高 |
| T11 | 正答率グラフ component を作成 | `frontend/src/lib/components/mypage/AccuracyTrendChart.svelte` | 直近10件、空状態、SSR 回避、destroy、代替テキストが実装済み | 高 |
| T12 | `/mypage` に統計取得・表示を接続 | `frontend/src/routes/(app)/mypage/+page.svelte` | 既存履歴を壊さず、ログイン後に統計セクションが表示される | 高 |
| T13 | loading / empty / error / retry を実装 | `frontend/src/routes/(app)/mypage/+page.svelte` | 統計単独の loading、空状態、エラー、再試行、二重取得防止が動作 | 高 |
| T14 | reload / 戻る / 直接アクセスの挙動を確認 | `frontend/src/routes/(app)/mypage/+page.svelte` | 統計は再取得され、履歴 query は既存どおり復元される | 中 |
| T15 | `docs/04_api.md` を更新 | `docs/04_api.md` | `GET /users/me/stats` の詳細仕様が実装と一致する | 高 |
| T16 | 品質チェックを実行 | backend / frontend | backend lint / format:check / test、frontend lint / check / test が通過 | 高 |
| T17 | 手動確認を実施 | ブラウザ / dev server | ログイン、未ログイン、空状態、履歴あり、API エラー、mobile、keyboard を確認 | 高 |
| T18 | 実装完了更新 | `docs/05_progress.md`, `docs/plans/mypage-stats/plan.md` | チェックボックス、対象ファイル一覧、実装完了セクションが実態と一致する | 高 |

- [ ] T1: 既存仕様・既存実装の最終確認（`docs/01_features.md`, `docs/04_api.md`, `docs/05_progress.md`, `/mypage`, users 関連ファイル）
- [ ] T2: backend stats service の Red テストを追加（`backend/src/services/user.service.test.ts`）
- [ ] T3: backend stats service を実装（`backend/src/services/user.service.ts`）
- [ ] T4: backend route の Red テストを追加（`backend/src/routes/users/get-me-stats.test.ts`）
- [ ] T5: backend route を実装（`backend/src/routes/users/index.ts`）
- [ ] T6: frontend stats API client の Red テストを追加（`frontend/src/lib/api/users.test.ts`）
- [ ] T7: frontend stats API client を実装（`frontend/src/lib/api/users.ts`）
- [ ] T8: stats helper と Red テストを追加（`frontend/src/lib/mypage/stats.ts`, `frontend/src/lib/mypage/stats.test.ts`）
- [ ] T9: Chart.js 依存追加要否を最終判断して反映（`frontend/package.json`, `frontend/package-lock.json`）
- [ ] T10: サマリーカード component を作成（`frontend/src/lib/components/mypage/StatsSummaryCards.svelte`）
- [ ] T11: 正答率グラフ component を作成（`frontend/src/lib/components/mypage/AccuracyTrendChart.svelte`）
- [ ] T12: `/mypage` に統計取得・表示を接続（`frontend/src/routes/(app)/mypage/+page.svelte`）
- [ ] T13: loading / empty / error / retry を実装（`frontend/src/routes/(app)/mypage/+page.svelte`）
- [ ] T14: reload / 戻る / 直接アクセスの挙動を確認（`frontend/src/routes/(app)/mypage/+page.svelte`）
- [ ] T15: `docs/04_api.md` を更新
- [ ] T16: backend / frontend 品質チェック
- [ ] T17: 手動確認
- [ ] T18: `docs/05_progress.md` と plan.md の実装完了更新

## 技術的注意点

- `GET /me/stats` は users router の `GET /me` と同じ router 内に置く。Hono では `/me` が `/me/stats` を横取りしないが、可読性のため `GET /me` の近くに配置する。
- `GET /users/me/stats` に request body / query はない。入力 validation は不要だが、route 入口で `authMiddleware` を必ず通す。
- stats が未作成のユーザーでも 404 にせず、ゼロ値を返す。
- `averageAccuracyRate` は `totalAnswered <= 0` なら 0、通常は `Math.round((totalCorrect / totalAnswered) * 100)`。
- `recentAccuracyTrend` は DB から `playedAt desc, id desc` で最大10件取得し、response では古い順に並べる。
- `GameSession.findMany` は `select` で `id`, `playedAt`, `correctCount`, `totalCount` のみ取得する。
- `GameAnswer` の include や全履歴 aggregate は使わない。
- `UserStats` と `recentAccuracyTrend` の取得は副作用がなく、厳密な同一トランザクション整合は不要。必要なら `Promise.all` で並列取得してもよい。
- frontend API client は `response.ok` を JSON parse 前に確認し、`parseErrorResponse(response, "統計情報の取得に失敗しました")` を使う。
- 非 JSON エラー時は fallback `統計情報の取得に失敗しました` を使う。
- response runtime validation では `lastActiveDate` / `updatedAt` の `string | null` を明示的に許可する。
- Chart.js を採用する場合は component 内で `onMount` 後に import / 初期化し、`onDestroy` で chart instance を破棄する。
- canvas グラフには `figcaption` と同等データのテキスト表示を用意する。
- UI カードは繰り返し item として使う。ページ section 全体を nested card にしない。
- DB schema 変更は予定しない。変更した場合は `npx prisma migrate deploy` と Playwright 確認を実施し、実装完了欄に記録する。

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| backend service: stats あり | `UserStats` の累計値と `averageAccuracyRate`、直近10件 trend を返す |
| backend service: stats なし | ゼロ値 summary と空 trend を返す |
| backend service: totalAnswered 0 | `averageAccuracyRate` は 0 |
| backend service: 直近10件超 | 最新10件だけを response では古い順に返す |
| backend service: 直近履歴なし | `recentAccuracyTrend: []` |
| backend service: ユーザーなし | `UserError(403, "ユーザーが見つかりません")` |
| backend service: DB エラー | 呼び出し元 route で 500 に変換される |
| backend route: 未認証 | 401 `{ "error": "認証が必要です" }` |
| backend route: 正常系 | 200。Date は ISO string に変換される |
| backend route: service UserError | `handleUserError` で status と日本語 message を返す |
| backend route: 想定外エラー | 500 `{ "error": "サーバーエラーが発生しました" }` |
| frontend API: 正常系 | Authorization と credentials を付けて `MyStatsResponse` を返す |
| frontend API: AbortSignal | signal を fetch に渡す |
| frontend API: backend error JSON | backend の日本語 `error` を `ApiError.message` に保持する |
| frontend API: 非 JSON エラー | fallback `統計情報の取得に失敗しました` を使う |
| frontend API: response 不正 | `ApiError(500, "統計情報のレスポンス形式が不正です")` を throw |
| helper: 数値表示 | 大きな数値を日本語 locale で読みやすく整形する |
| helper: 正答率表示 | 0〜100 の整数を `%` 表示にする |
| helper: null 日付 | `-` などの安全な fallback を返す |
| helper: 空 trend | 空 label/value 配列を返す |
| UI: 認証初期化中 | stats API を呼ばず、確認中表示になる |
| UI: 未ログイン | stats API を呼ばず、ログイン導線を表示する |
| UI: 統計あり | サマリーカードと正答率グラフが表示される |
| UI: 空状態 | ゼロ値、空グラフ説明、ゲーム開始導線が表示される |
| UI: API エラー | 統計セクション内にエラーと再試行ボタンを表示する |
| UI: 再試行 | loading 中は二重取得せず、失敗時は画面内 error と toast を表示する |
| UI: reload / 直接アクセス | `/mypage` へ直接アクセスして統計を再取得する |
| UI: 履歴 query 併用 | `/mypage?mode=SYMBOL_TO_NAME_LV1&limit=10` で履歴 query は維持され、統計は全体サマリーを表示する |
| UI: 非 JSON エラー | 502/504 相当でも画面が壊れず fallback message を表示する |
| A11Y: loading | 統計セクションに `aria-busy` または状態テキストがある |
| A11Y: error | error container が `role="alert"` を持つ |
| A11Y: graph | グラフの意味が `figcaption` / 代替テキスト / データリストで読める |
| A11Y: keyboard | 再試行、履歴 filter、詳細リンクへ keyboard で到達できる |

## 実装リスクと回避策

| リスク | 回避策 |
|---|---|
| 統計と履歴の責務が混ざる | 統計 API は全体サマリー、履歴 API は一覧・filter 表示に限定する |
| 平均正答率の定義が曖昧 | `totalCorrect / totalAnswered` の累計正答率と plan / docs / API に明記する |
| DB 負荷が高くなる | `UserStats` キャッシュと直近10 `GameSession` summary select のみにする |
| stats 未作成ユーザーで 500 | `UserStats` null をゼロ値へ変換する |
| 既存 `/mypage` 履歴が壊れる | T12/T14 と手動確認で mode filter、追加読み込み、詳細遷移を回帰確認する |
| Chart.js が SSR で壊れる | `onMount` 後に初期化し、SSR 中は canvas に触れない |
| canvas だけで A11Y 情報が失われる | 同じ trend 情報をテキストでも表示する |
| 依存追加で bundle が増える | Chart.js 採用理由を明記し、必要なら軽量 SVG 実装への変更を実装完了欄に記録する |
| API docs と実装がズレる | T15 で `docs/04_api.md` を必ず更新し、実装完了時に再確認する |
| `docs/05_progress.md` の users API 進捗ズレが混ざる | stats と `/mypage` 統計画面だけを更新し、既存 users API の進捗整理は別タスクに分ける |

## 手動確認項目

| 項目 | 手順 | 期待結果 |
|---|---|---|
| ログイン後表示 | ログインして `/mypage` を開く | サマリー、正答率グラフ、既存履歴が表示される |
| 未プレイユーザー | 履歴のないユーザーで `/mypage` を開く | ゼロ値、空グラフ説明、ゲーム開始導線が表示される |
| 未ログイン | logout 後に `/mypage` へ直接アクセス | stats API を呼ばずログイン導線が表示される |
| API エラー | backend 停止または 502 相当で表示 | 統計エラーと再試行導線が表示される |
| 再試行 | エラー後に再試行ボタンを押す | 二重取得せず再取得する |
| 履歴 filter | `/mypage` の履歴 mode filter を変更 | 履歴だけが変わり、統計は全体サマリーのまま |
| reload | `/mypage?mode=SYMBOL_TO_NAME_LV1` を再読み込み | 履歴 query 復元、統計再取得 |
| 詳細遷移 | 履歴 item の詳細リンクを開く | `/game/result?sessionId=...` が既存どおり表示される |
| mobile | スマホ幅で確認 | カード・グラフ・履歴がはみ出さない |
| keyboard | Tab / Enter で操作 | 再試行、履歴 filter、詳細リンクが操作可能 |
| screen reader 概略 | グラフ周辺のテキストを確認 | 数値推移が canvas 以外でも理解できる |

## 実装完了時の更新ルール

実装完了時は以下を必ず確認して plan.md を更新する。

- [ ] 対象ファイル一覧が実際の変更ファイルと一致している
- [ ] 変更種別（新規 / 修正 / 削除）が実態と一致している
- [ ] 完了したタスクに `- [x]` が付いている
- [ ] 設計から変更した判断が `## 実装完了` に記録されている
- [ ] `docs/04_api.md` の `GET /users/me/stats` 仕様が実装と一致している
- [ ] `docs/05_progress.md` の `/mypage` 統計画面と `GET /users/me/stats` の状態が実装結果と一致している
- [ ] lint / format / test / check / 手動確認結果が実装報告に含まれている
- [ ] DB schema / migration を変更した場合は migration deploy と Playwright 確認結果が記録されている

実装完了セクションのテンプレート:

```markdown
## 実装完了
- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/mypage-stats
- PR: #N

### 計画からの変更点
- 例: Chart.js ではなく軽量 SVG component に変更した、など

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/services/user.service.ts` | 修正 | 統計取得 service を追加 |

### 検証結果
| コマンド / 確認 | 結果 |
|---|---|
| `cd backend && npm run lint` | |
| `cd backend && npm run format:check` | |
| `cd backend && npm run test -- --run` | |
| `cd frontend && npm run lint` | |
| `cd frontend && npm run check` | |
| `cd frontend && npm run test:run` | |
| 手動確認 | |
```
