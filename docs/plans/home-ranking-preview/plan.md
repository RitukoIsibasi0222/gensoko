# トップ画面ランキングプレビュー対応 実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、既存 API client 活用、トップページ UX 改善）

## 概要

GitHub Issue #72「トップ画面、ランキングプレビュー対応」に対応する。ランキング API と `/ranking` ページは実装済みだが、トップページの「ランキングプレビュー」は `HOME_RANKING_PREVIEW_INITIAL = []` により空状態固定のため、既存 `GET /ranking/weekly` を使って週間ランキング上位3件を表示する。

## レビュー結果と改善方針

| 観点 | レビュー結果 | 改善方針 |
|---|---|---|
| API 整合性 | `GET /ranking/weekly` は任意認証で未ログイン閲覧可能。`getRanking()` は `accessToken` 未指定なら Authorization を送らず、`credentials: 'include'` は維持する | トップページでは `accessToken` を渡さず公開ランキングとして取得する。`myRank` は使わない |
| DB 整合性 | 週間ランキングは単なる `weeklyScore` 順ではなく、当週の `weeklyScoreWeekStart` に一致する `UserStats` のみが対象 | empty 文言とテスト観点で「今週の対象ゲーム結果がない」状態を扱う。DB / API 変更は不要 |
| 既存 UI 整合性 | `/ranking?period=weekly` は既存ランキングページの `normalizeRankingPeriod()` で解釈される。トップ preview は `HomeRankingPreviewEntry.weeklyScore` を前提にしている | 導線は `/ranking?period=weekly` に揃える。preview component の公開 props は拡張に留め、既存 success 表示を壊さない |
| 共通化 | `frontend/src/lib/ranking/ranking.ts` に `formatRankingScore()` があり、preview component の独自 `Intl.NumberFormat` は重複になり得る | score 表示は既存 `formatRankingScore()` を import して使う。新しい formatter を component 内に増やさない |
| 認証初期化 | preview は公開情報なので `authStore.isInitializing` を待つ必要がない。待つとトップページの補助情報表示が遅れる | CTA の auth 分岐とは独立して、ranking preview は client side で即取得する |
| A11Y | 現行 plan は `aria-live` / `role=alert` の記載があるが、section 全体の busy 状態、再試行ボタン、空状態導線の検証が不足 | section に `aria-busy`、loading に `aria-live="polite"`、error に `role="alert"`、retry は通常の `<button type="button">` で実装する。自動フォーカス移動はしない |
| テスト | helper テスト中心で、component の状態表示や fetch 失敗時の回復確認が弱い | unit は変換 helper、manual は loading / success / empty / error / retry / keyboard focus を確認する。必要に応じて component test 追加を検討する |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`frontend/src/lib/api/ranking.ts`**
- `getRanking(options: GetRankingOptions): Promise<RankingResponse>` — 週間・全期間ランキングを取得し、UI 用に `score` へ正規化する。
- `RankingPeriod = 'weekly' | 'alltime'` — ランキング種別。
- `RankingEntry` — `rank`, `username`, `score`, `totalGames`, `accuracyRate` を持つ表示用ランキング項目。
- `GetRankingOptions.accessToken?: string | null` — 指定された場合のみ Authorization header を付与する。
- `GetRankingOptions.signal?: AbortSignal` — 呼び出し側のキャンセル制御を fetch に伝搬する。

**`frontend/src/lib/home/content.ts`**
- `HomeRankingPreviewEntry` — トップページ用ランキング項目。現状は `weeklyScore` を持つ。
- `HOME_RANKING_PREVIEW_INITIAL` — 現状は空配列。
- `selectRankingPreviewEntries(entries, limit?)` — 先頭から preview 件数分を返す。

**`frontend/src/lib/ranking/ranking.ts`**
- `formatRankingScore(value: number): string` — ランキングスコアを `ja-JP` の数値表記 + `pt` へ整形する。

**`frontend/src/lib/components/home/RankingPreviewSection.svelte`**
- `entries: readonly HomeRankingPreviewEntry[]` — 表示対象。
- `moreHref?: string` — 詳細ランキングへの導線。デフォルトは `/ranking`。
- `emptyMessage?: string` — 空状態メッセージ。デフォルトは「ランキングは準備中です。」

**`frontend/src/routes/(app)/+page.svelte`**
- `RankingPreviewSection` に `selectRankingPreviewEntries(HOME_RANKING_PREVIEW_INITIAL, 3)` を渡している。
- `authStore` は CTA 出し分けのために利用済み。

**`docs/04_api.md`**
- `GET /api/v1/ranking/weekly` は任意認証で週間ランキング上位50件と `myRank` を返す。
- ランキング対象は `totalGames > 0`, `User.isActive = true`, `User.deletedAt = null`。
- Authorization ヘッダー形式不正・token 無効時のみ 401 を返す。

**`backend/src/services/ranking.service.ts`**
- `getWeeklyRanking(userId?)` — `weeklyScoreWeekStart` が当週に一致する `UserStats` から上位50件を取得する。
- `getAllTimeRanking(userId?)` — 累計スコア上位50件を取得する。
- 同点順位は競技順位方式（1位、1位、3位）で計算する。

### 重要な制約

- 新しい backend endpoint は追加しない。既存 `GET /ranking/weekly` を再利用する。
- API URL や fetch エラー処理をトップページに重複実装しない。`getRanking()` を使う。
- トップページ preview は週間ランキング固定とし、全期間切替は `/ranking` ページに任せる。
- preview 表示件数は3件に制限する。API は Top50 を返すため、frontend 側で表示用に切り出す。
- preview には `myRank` を表示しないため、Authorization header は原則送らない。
- `authStore.isInitializing` の完了を preview 取得の前提にしない。CTA 出し分けと ranking preview 取得は独立させる。
- API 取得失敗時にページ全体を壊さない。ランキング枠内でエラーまたは再試行導線を表示する。
- 空状態は「準備中」ではなく、実データ取得後にランキング対象がないことが分かる文言にする。
- `response.ok` 先行確認、非 JSON エラー耐性、日本語エラー表示は既存 `getRanking()` / `ApiError` の責務を再利用する。
- score 表示は `formatRankingScore()` を使い、ランキング系の数値フォーマットを重複実装しない。
- 取得処理は client side に限定する。`+page.ts` の SSR / prerender 設定は既存のまま変更しない。
- Svelte / TypeScript の import はファイル先頭に置き、既存スタイルに合わせる。

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/home/content.ts` | 修正 | `RankingEntry` から `HomeRankingPreviewEntry` へ変換する helper を追加 |
| `frontend/src/lib/home/content.test.ts` | 修正 | preview 変換 helper と上位3件切り出しのテストを追加 |
| `frontend/src/lib/components/home/RankingPreviewSection.svelte` | 修正 | loading / error / empty / retry の表示状態を追加し、詳細リンク aria-label をprops化し、score 表示は `formatRankingScore()` に寄せる |
| `frontend/src/lib/components/home/RankingPreviewSection.svelte.test.ts` | 新規 | preview section の success / loading / error / empty 表示と A11Y 属性テストを追加 |
| `frontend/src/lib/test/svelte-client.ts` | 新規 | Svelte component DOM test 用の client runtime import を集約 |
| `frontend/src/routes/(app)/+page.svelte` | 修正 | `getRanking({ period: 'weekly' })` で preview を取得し、状態と週次詳細リンク label を section へ渡す |
| `frontend/src/routes/home-page-ranking-preview.test.ts` | 新規 | preview 取得失敗時に自動再リクエストせず、Retry でのみ再取得することを検証 |
| `docs/05_progress.md` | 修正 | Issue #72 対応タスクの進捗を更新 |
| `docs/plans/home-ranking-preview/plan.md` | 修正 | 実装完了記録と確認結果を追記 |

## API 仕様（関連エンドポイント）

### エラーレスポンス共通形式

```json
{ "error": "メッセージ文字列" }
```

### エンドポイント一覧

| メソッド | パス | 認証 | リクエスト | レスポンス |
|---|---|---|---|---|
| GET | `/api/v1/ranking/weekly` | 任意 | なし | `{ ranking: WeeklyRankingEntry[], myRank: number \| null }` |

トップページでは `ranking` の先頭3件のみを表示し、`myRank` は使用しない。

補足:
- `ranking[].weeklyScore` は当週の週間スコア。`getRanking()` では `RankingEntry.score` に正規化される。
- weekly ranking の対象は `weeklyScoreWeekStart` が当週に一致する `UserStats` のみ。
- Authorization を送らない場合でも `myRank: null` は返るが、トップページでは破棄する。

## 設計上の決定事項

1. **データ取得方法**
   - 選択: 既存 `getRanking({ period: 'weekly' })` を client side で呼び出す。
   - 根拠: ranking API client に URL 組み立て、認証 header、非 JSON エラー対応、runtime validation が集約済みのため。

2. **表示対象**
   - 選択: 週間ランキングの上位3件を表示する。
   - 根拠: 既存 `RankingPreviewSection` は週間 `weeklyScore` 前提で、トップページでは短期モチベーションを示す用途が自然なため。

3. **認証 header**
   - 選択: preview 取得では Authorization を送らない。
   - 根拠: preview は公開ランキングのみで十分で、`myRank` 表示も行わないため。認証初期化待ちによる表示遅延も避けられる。

4. **型変換**
   - 選択: `RankingEntry.score` を `HomeRankingPreviewEntry.weeklyScore` に変換する helper を `content.ts` に置く。
   - 根拠: 既存 preview component の公開 props を大きく変えず、週間 preview であることを型名に残せるため。

5. **状態表示**
   - 選択: `RankingPreviewSection` が loading / error / empty / success を表示する。
   - 根拠: page component は取得状態管理、section component は表示に責務を分けるため。

6. **エラー時の UX**
   - 選択: 枠内に日本語エラーと再試行ボタンを表示する。toast は使わない。
   - 根拠: トップページの補助情報なので、ページ全体のエラー扱いにせず、ユーザーがその場で回復できるようにするため。

7. **数値フォーマット**
   - 選択: score は `formatRankingScore()` を使い、preview component 内の独自 `Intl.NumberFormat` は削除する。
   - 根拠: ランキングページとトップ preview の表記ズレを防ぎ、フォーマット責務を `frontend/src/lib/ranking/ranking.ts` に集約するため。

8. **A11Y の状態通知**
   - 選択: section 全体に `aria-busy`、loading に `aria-live="polite"`、error に `role="alert"` を付ける。再試行は通常の button とし、独自 keydown handler は追加しない。
   - 根拠: 支援技術へ非同期状態を伝えつつ、標準 button の keyboard 操作に任せて過剰実装を避けるため。

## 公開インターフェース案

```ts
import type { RankingEntry } from '$lib/api/ranking';

export function toHomeRankingPreviewEntries(
  entries: readonly RankingEntry[]
): HomeRankingPreviewEntry[];
```

```ts
type Props = {
  entries: readonly HomeRankingPreviewEntry[];
  moreHref?: string;
  emptyMessage?: string;
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
};
```

```svelte
<RankingPreviewSection
  entries={rankingPreviewEntries}
  isLoading={isRankingPreviewLoading}
  errorMessage={rankingPreviewErrorMessage}
  onRetry={retryRankingPreview}
  emptyMessage=まだランキング対象のゲーム結果がありません。
  moreHref=/ranking?period=weekly
/>
```

## タスクリスト（進捗管理）

| タスクID | 内容 | ファイル | 優先度 | 備考 |
|---|---|---|---|---|
| T1 | 既存のランキング API client とトップページ preview 実装を確認する | `frontend/src/lib/api/ranking.ts`, `frontend/src/lib/home/content.ts`, `frontend/src/routes/(app)/+page.svelte` | 高 | Issue #72 の差分範囲を確定 |
| T2 | ranking 表示項目からトップ preview 用項目へ変換する helper を追加する | `frontend/src/lib/home/content.ts` | 高 | `score` → `weeklyScore` |
| T3 | helper のユニットテストを追加する | `frontend/src/lib/home/content.test.ts` | 高 | 空配列、3件超過、元配列非破壊、score 変換 |
| T4 | preview section に loading / error / retry / empty 表示を追加する | `frontend/src/lib/components/home/RankingPreviewSection.svelte` | 高 | 既存 success 表示は維持 |
| T5 | トップページで週間ランキング preview を取得する | `frontend/src/routes/(app)/+page.svelte` | 高 | AbortController、request key、再試行を実装 |
| T6 | 品質チェックを実行する | `frontend` | 高 | `npm run check`, `npm run lint`, `npm run test:run` |
| T7 | 手動確認を実施する | `/` | 高 | loading, success, empty, error, retry, keyboard focus, `/ranking?period=weekly` 導線 |
| T8 | 実装完了時に計画書と進捗を更新する | `docs/05_progress.md`, `docs/plans/home-ranking-preview/plan.md` | 高 | 完了チェックと実変更ファイルを記録 |

- [x] T1: 既存のランキング API client とトップページ preview 実装を確認する
- [x] T2: ranking 表示項目からトップ preview 用項目へ変換する helper を追加する
- [x] T3: helper のユニットテストを追加する
- [x] T4: preview section に loading / error / retry / empty 表示を追加する
- [x] T5: トップページで週間ランキング preview を取得する
- [x] T6: 品質チェックを実行する
- [x] T7: 手動確認を実施する
- [x] T8: 実装完了時に計画書と進捗を更新する

### タブ区切りタスクリスト

```text
タスクID	タスク内容	ファイル	優先度
T1	既存のランキング API client とトップページ preview 実装を確認する	frontend/src/lib/api/ranking.ts, frontend/src/lib/home/content.ts, frontend/src/routes/(app)/+page.svelte	高
T2	ranking 表示項目からトップ preview 用項目へ変換する helper を追加する	frontend/src/lib/home/content.ts	高
T3	helper のユニットテストを追加する	frontend/src/lib/home/content.test.ts	高
T4	preview section に loading / error / retry / empty 表示を追加する	frontend/src/lib/components/home/RankingPreviewSection.svelte	高
T5	トップページで週間ランキング preview を取得する	frontend/src/routes/(app)/+page.svelte	高
T6	品質チェックを実行する	frontend	高
T7	手動確認を実施する	/	高
T8	実装完了時に計画書と進捗を更新する	docs/05_progress.md, docs/plans/home-ranking-preview/plan.md	高
```

## 技術的注意点

- `getRanking()` の `RankingResponse.ranking` は period 別 score を `score` に正規化済み。トップ preview では `period: 'weekly'` の結果だけを扱う。
- 週間ランキング API は当週の `weeklyScoreWeekStart` に一致する行だけを返す。空配列は「今週の対象ゲーム結果がない」状態として扱う。
- `selectRankingPreviewEntries()` で表示件数を3件に絞ってから section へ渡す。
- `AbortController` と request key を使い、コンポーネント破棄時や再試行時に古い request が後勝ちしないようにする。
- エラー文言は `ApiError.message` を優先し、それ以外は日本語のネットワークエラー文言を使う。
- `RankingPreviewSection` の `moreHref` は `/ranking?period=weekly` にして、preview と詳細ページの初期表示を合わせる。
- loading / error / empty / success の順で表示分岐する。error 時は古いランキングを残さず、再試行で success に戻す。
- retry button は `type="button"` にし、loading 中は disabled にする。
- DB 変更や API 仕様変更は不要。発生した場合は `docs/04_api.md` と本計画書へ追記する。

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| 正常系: API が3件以上返す | 上位3件だけが表示される |
| 正常系: API が1〜2件返す | 返却件数分だけ表示される |
| 正常系: API が空配列を返す | 「まだランキング対象のゲーム結果がありません。」が表示される |
| 正常系: `score` 変換 | `RankingEntry.score` が `HomeRankingPreviewEntry.weeklyScore` として表示される |
| 正常系: score 表示 | `formatRankingScore()` と同じ `ja-JP` 表記 + `pt` で表示される |
| 異常系: JSON エラー | backend の日本語 error または ApiError の message が表示される |
| 異常系: ネットワークエラー | 日本語の汎用エラーと再試行ボタンが表示される |
| 再試行 | ボタン押下で再取得され、成功時にランキングへ戻る |
| 導線 | 「もっと見る」が `/ranking?period=weekly` へ遷移する |
| A11Y: loading | section が `aria-busy` になり、loading 文言は `aria-live="polite"` で伝わる |
| A11Y: error / retry | error は `role="alert"`、retry は keyboard で操作できる |
| A11Y: focus | loading / error / retry 後に不要な自動フォーカス移動が発生しない |

## 実装完了時の更新ルール

実装完了時は以下を必ず行う。

- `docs/plans/home-ranking-preview/plan.md` のチェックボックスを完了状態に更新する。
- 実際に変更したファイルに合わせて「対象ファイル一覧」を修正する。
- `docs/05_progress.md` の「トップページ ランキングプレビュー実データ対応」を `[x]` に更新する。
- 確認結果（frontend check / lint / test、手動確認）を本計画書の `## 実装完了` に記録する。


## 実装完了
- 完了日: 2026-07-05
- 実装ブランチ: feature/home-ranking-preview
- PR: #76

### 計画からの変更点
- `RankingPreviewSection.svelte.test.ts` を追加し、section component の success / loading / error / empty 表示を DOM ベースで確認した。
- Vitest が `svelte` を server entry に解決するため、component test 用の client runtime 参照を `frontend/src/lib/test/svelte-client.ts` に隔離し、理由をコメントで明記した。
- 実DB状態を変更しないため、手動確認は success 表示と `/ranking?period=weekly` 導線を対象にした。empty / error / retry は component test で確認した。

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/home/content.ts` | 修正 | `RankingEntry.score` を `HomeRankingPreviewEntry.weeklyScore` へ変換する helper を追加 |
| `frontend/src/lib/home/content.test.ts` | 修正 | preview 変換 helper の unit test を追加 |
| `frontend/src/lib/components/home/RankingPreviewSection.svelte` | 修正 | loading / error / retry / empty 表示、A11Y 属性、詳細リンク aria-label のprops化、共通 score formatter 利用を追加 |
| `frontend/src/lib/components/home/RankingPreviewSection.svelte.test.ts` | 新規 | preview section の success / loading / error / empty 表示と A11Y 属性テストを追加 |
| `frontend/src/lib/test/svelte-client.ts` | 新規 | Svelte component DOM test 用の client runtime import を集約 |
| `frontend/src/routes/(app)/+page.svelte` | 修正 | 週間ランキング preview の実データ取得、上位3件変換、週次詳細リンク label、retry、AbortController を追加 |
| `frontend/src/routes/home-page-ranking-preview.test.ts` | 新規 | preview 取得失敗時に自動再リクエストせず、Retry でのみ再取得することを検証 |
| `docs/05_progress.md` | 修正 | 対象タスクを完了に更新 |
| `docs/plans/home-ranking-preview/plan.md` | 修正 | 実装完了記録と確認結果を追記 |

### 確認結果
- frontend check: `npm run check` 成功（0 errors / 0 warnings）
- frontend lint: `npm run lint` 成功
- frontend test: `npm run test:run` 成功（26 files / 305 tests passed）
- 手動確認: Docker 上の `http://localhost:5174/` でトップページを開き、週間ランキング preview に実データ2件が表示されることを確認
- 手動確認: 「もっと見る」から `http://localhost:5174/ranking?period=weekly` へ遷移し、週間ランキング表示になることを確認
- 手動確認: ブラウザ console error が 0 件であることを確認
- 補足確認: loading / empty / error / retry は `RankingPreviewSection.svelte.test.ts`、取得失敗時の自動再リクエスト抑止と Retry 再取得は `home-page-ranking-preview.test.ts` で確認
