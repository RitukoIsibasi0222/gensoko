# トップページ（/）実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、情報設計・導線設計）
> 対象実装者: ジュニア開発者（Sonnet）

## 概要

フェーズ4「UI モック（トップ・元素一覧）」のトップページ `/` を実装する。対象は「アプリ概要」「ゲーム開始 CTA」「ランキングプレビュー」の 3 セクションで、既存の Header / Footer / authStore と整合する構成で組む。

現状は `frontend/src/routes/(app)/+page.svelte` がスタブ、`backend/src/routes/ranking/index.ts` も TODO、さらに `backend/src/index.ts` に ranking ルーターの mount もない。そのため本タスクではランキングプレビューを **空状態（「ランキングは準備中です」）固定で先行実装** し、ランキング API 本実装はフェーズ9タスクに委ねる。将来の差し替えコストを下げるため、プレビューが受け取るデータ形・表示項目は `GET /ranking/weekly` 仕様に揃える（fake username を含むダミーデータをユーザーに表示することは行わない）。

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**frontend/src/routes/(app)/+layout.svelte**
- `(app)` 配下に Header / Footer / main コンテナを提供する。
- トップページはこのレイアウト内に収まる前提で余白・最大幅を決める。

**frontend/src/routes/+layout.svelte**
- ブラウザ環境で `authStore.initialize()` を呼び、Toaster を描画する。
- `/` 側で認証初期化を重複実装しない。

**frontend/src/lib/stores/auth.svelte.ts**
- `authStore.user: AuthUser | null`
- `authStore.isLoggedIn: boolean`
- `authStore.isInitializing: boolean`
- `authStore.logout(): Promise<void>`
- 型 `AuthStatus = 'initializing' | 'authenticated' | 'anonymous'` を export 済み。トップページの audience 型はこれを別名で再利用する（独自 union を新設しない）。
- トップページでは `isLoggedIn` と `isInitializing` を用いて CTA の文言と遷移先を切り替える。
- `login` `refresh` `updateUser` など既存の公開メソッドは変更しない。
- SSR 時の初期 status は `'initializing'` 固定（`+layout.svelte` の `if (browser) authStore.initialize()`）。トップページは SSR と hydration 初回描画が同じ表示になるよう、`initializing` 用プレースホルダーを必ず実装する。

**frontend/src/lib/api/config.ts**
- `API_BASE_URL: string`
- 今回の UI モックでは直接利用しないが、将来ランキング API 連携へ切り替える際は必ずここから参照する。

**frontend/src/lib/api/errors.ts**
- `class ApiError extends Error`
- `parseErrorBody(response: Response): Promise<ErrorBody>`
- `parseErrorResponse(response: Response, defaultMessage?: string): Promise<never>`
- 今回の UI モックでは直接利用しない。将来ランキング API 連携時のエラーハンドリングはこの既存パターンに揃える。

**frontend/src/lib/stores/toast.svelte.ts**
- `toastStore.success(message: string): string`
- `toastStore.error(message: string): string`
- `toastStore.info(message: string): string`
- `toastStore.fromApiError(error: ApiError): string`
- トップページの CTA は遷移のみなので、今回のスコープではトースト通知を増やさない。

**frontend/src/lib/components/Header.svelte**
- グローバルナビとして `/elements` `/game` `/ranking` への導線を持つ。
- トップページ側で同じ導線を重複させる場合は役割を分け、Hero の CTA は「開始行動」に限定する。

**frontend/src/lib/components/Footer.svelte**
- フッターは `(app)` レイアウトで自動表示される。
- トップページ内で重複したサービス情報を足し過ぎない。

**frontend/src/routes/(app)/game/+page.svelte**
- 現状スタブ。
- ログイン済みユーザー向け CTA の遷移先候補として扱う。

**frontend/src/routes/(app)/ranking/+page.svelte**
- 現状スタブ。
- ランキングプレビューの「もっと見る」導線はこのページへ向ける。

**backend/src/routes/ranking/index.ts**
- 現状 `// TODO: implement` のスタブ。
- 今回のトップページ実装では依存しない。

**backend/src/index.ts**
- mount 済みルーターは `/api/v1/auth` と `/api/v1/users` のみ。
- ranking ルーターは未登録のため、トップページから live fetch を始める前提は置けない。

**docs/04_api.md**
- `GET /ranking/weekly` と `GET /ranking/alltime` が定義されている。
- 具体的なレスポンス例は weekly のみ掲載されているため、トップページのプレビューは weekly 形式に揃える。

### 重要な制約

- この計画は `docs/05_progress.md` のフェーズ4「トップページ UI モック」に合わせ、バックエンド ranking API 本実装は含めない。
- ランキングプレビューのデータ形は `GET /ranking/weekly` の `rank` `username` `weeklyScore` `totalGames` に揃え、将来の API 差し替えを容易にする。
- **fake username を含むダミーランキングをユーザーに表示しない**。実データが取得できない期間は空状態 UI で固定する（誤認・規約面のリスク回避）。
- `authStore.isInitializing` を無視して CTA を分岐しない。初期化中のちらつきを避ける。
- SSR と hydration 初回描画の結果が一致するように、audience='initializing' のレンダリング結果を必ず実装する（Header と同じパターン）。
- route から他 route 配下の実装を import しない。共通化が必要なら `frontend/src/lib/home/` または `frontend/src/lib/components/home/` に置く。
- `import.meta.env.VITE_API_BASE_URL` をページ側で直接読まない。API 連携を後から足す場合も `config.ts` を使う。
- エラーメッセージ・ステータスコード整合性は future API integration 時に `parseErrorResponse` とバックエンドの日本語メッセージをそのまま使う前提にする。今回 dead code として fetch を先置きしない。
- Svelte 5 Runes（`$state` / `$derived`）のみ使用し、`$:` は使わない。
- 既存の `brand` / `ink` テーマ変数を優先し、トップページだけ別配色ルールを増やさない。
- Prettier 設定の `tabWidth: 2` を守る。

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/home/content.ts` | 新規 | トップページ用コピー定数、CTA 判定用の純粋関数、ランキングプレビュー用の型と件数制御ヘルパーを定義（ダミーデータは持たない） |
| `frontend/src/lib/home/content.test.ts` | 新規 | CTA 判定（initializing / authenticated / anonymous）とランキング件数制御（空配列 / 上限以下 / 上限超過）のユニットテスト |
| `frontend/src/lib/components/home/HeroSection.svelte` | 新規 | アプリ概要のリード文と auth 状態に応じた主 CTA / 副 CTA を表示 |
| `frontend/src/lib/components/home/AppOverviewSection.svelte` | 新規 | 学習価値を伝える 3 つ前後の概要カードを表示 |
| `frontend/src/lib/components/home/RankingPreviewSection.svelte` | 新規 | 週間ランキングの上位プレビューと `/ranking` 導線を表示 |
| `frontend/src/routes/(app)/+page.svelte` | 修正（全文書換） | authStore とコンテンツ定数を接続し、トップページ全体を組み立てる |
| `docs/05_progress.md` | 修正 | 実装完了時に該当タスクを `[ ]` から `[x]` に更新 |
| `docs/plans/top-page/plan.md` | 新規 | 本計画書。実装完了時に完了セクションを追記 |

## API 仕様（この機能で使う範囲のみ）

### 参照 API（今回の UI モックでは未呼び出し）

| メソッド | パス | 認証 | このタスクでの扱い |
|---|---|---|---|
| GET | `/ranking/weekly` | 不要 | レスポンス形だけ参照し、プレビュー UI 側の型 `HomeRankingPreviewEntry` を揃える（fetch はしない） |
| GET | `/ranking/alltime` | 不要 | エンドポイント定義のみ参照。トップページでは使用しない |

### GET `/ranking/weekly`

```json
{
  "ranking": [
    {
      "rank": 1,
      "username": "taro123",
      "weeklyScore": 15000,
      "totalGames": 30
    }
  ],
  "myRank": 42
}
```

補足:
- トップページでは `ranking` の先頭 3 件のみを teaser として表示する。
- `myRank` はランキング詳細ページ向けの情報であり、トップページでは表示しない。
- `backend/src/routes/ranking/index.ts` が未実装かつ `backend/src/index.ts` でも未 mount のため、このタスクではネットワークリクエストを実装しない。

### エラーハンドリング方針（将来の差し替え前提）

- ランキングプレビューを live data に差し替えるときは、`response.ok` 判定を先に行い、その後 `parseErrorResponse()` を用いる。
- バックエンドの `error` / `details[0].message` をフロント側の固定文言で上書きしない。
- 非 JSON レスポンスの可能性があるため、`response.json()` を先に呼ばない。

## 設計上の決定事項

### 1. トップページはフェーズ4の UI モックとして frontend-only で完結させる

- 選択: backend ranking API の実装・mount は今回含めず、ランキングプレビューは空状態固定で描画する。
- 根拠: `docs/05_progress.md` ではトップページがフェーズ4、ranking API 本実装がフェーズ9に分離されている。現状のコード上も ranking route は TODO かつ未 mount であり、ここで backend を巻き込むとスコープが崩れる。

### 2. ランキングプレビューは weekly 上位 3 件用の UI とし、初期値は空配列にする

- 選択: `GET /ranking/weekly` 互換のデータを最大 3 件描画できる UI を作るが、API 未実装の間は **空配列を渡し「ランキングは準備中です」とリンクのみ表示**する。fake username を含むサンプルは入れない。
- 根拠: 実体のないランキングを「準備中」と偽装して見せると、規約・ユーザー信頼の両面でリスクがある。空状態を含めた UI を先に固めておけば、後続の API 連携時は entries を差し替えるだけで完成する。alltime や `myRank` を詰め込むとランキングページと責務が競合するため範囲外。

### 3. 主 CTA は auth 状態で出し分ける

- 選択: `authenticated` は `/game`、`anonymous` は `/register`、`initializing` は遷移先を確定しないプレースホルダー表示にする。
- 根拠: 「ゲーム開始 CTA」を維持しつつ、未ログインユーザーを未完成のゲーム導線に直接送らないため。`authStore.isInitializing` 中に href が切り替わると UX が不安定になるので、プレースホルダーで吸収する。

### 4. 副 CTA は `/elements` に固定する

- 選択: Hero の副 CTA は `/elements` に向け、「まずは元素一覧を見る」導線にする。
- 根拠: Header には `/ranking` への常設リンクがある一方、未ログインユーザーがアプリ価値を理解するには学習コンテンツ閲覧導線の方が自然。ランキング導線はプレビューセクション側に集約する。

### 5. コピー・定数・CTA 判定は `frontend/src/lib/home/content.ts` に集約する

- 選択: `+page.svelte` に文字列配列や分岐ロジックを直書きせず、純粋関数と定数を `lib/home` に切り出す。
- 根拠: ページ本体を組み立て役に限定でき、将来 ranking API を live data に置き換える際も差分が明確になる。コピー修正も 1 箇所で済む。

### 6. セクションごとに presentational component を分割する

- 選択: Hero / Overview / RankingPreview を個別コンポーネントにし、`+page.svelte` では props を渡すだけにする。
- 根拠: トップページは 1 画面でも役割が明確に分かれている。1 ファイルに UI と分岐を詰め込むより、デザイン変更や将来の AB 的調整がしやすい。

### 7. トースト通知は使わない

- 選択: CTA 押下時のトーストや「ランキング準備中」トーストは出さない。
- 根拠: 今回のページ上アクションはすべて通常遷移であり、トーストを挟む意味が薄い。`toastStore` は非同期処理結果の通知に限定した方が一貫性が保てる。

### 8. ナビゲーションは `goto()` ではなくアンカーで表現する

- 選択: CTA はスタイル付き `<a>` を基本とし、通常のリンクとして遷移させる。
- 根拠: 初期ページ表示の Hero CTA に imperative navigation は不要で、SSR / アクセシビリティ / ブラウザ標準挙動との整合がよい。

### 9. audience 型は `AuthStatus` の別名にする（独自 union を新設しない）

- 選択: `export type TopPageAudience = AuthStatus` として `auth.svelte.ts` の既存型を再利用する。
- 根拠: 同じ意味の 3 値 union を 2 箇所で定義するとズレが発生する。`AuthStatus` が増減した際にトップページ側で検知できるよう一元化する。

### 10. CTA 判定関数は主・副の両方を関数化する

- 選択: `getPrimaryCta(audience)` と `getSecondaryCta(audience)` の 2 関数を公開する。副 CTA は audience に依らず `/elements` 固定だが、関数化して将来の変更点を 1 箇所に閉じる。
- 根拠: 主だけ関数で副だけ定数だと、後で副 CTA も状態依存にしたい場合に呼び出し側 (`+page.svelte`) を書き換える必要が出る。最初から対称な公開 IF にしておく。

### 11. トップページは prerender しない

- 選択: `frontend/src/routes/(app)/+page.ts` を作成し `export const prerender = false; export const ssr = true;` を明示する。
- 根拠: 認証状態は実行時にしか決まらないため prerender は不要。一方で SSR は維持して初期表示の TTFB を悪化させない。Hero / Overview / RankingPreview いずれも SSR 時は audience='initializing' + 空ランキングという確定状態を返すため、hydration mismatch は発生しない。

## 公開インターフェース案

```ts
// frontend/src/lib/home/content.ts
import type { AuthStatus } from '$lib/stores/auth.svelte';

// 既存の AuthStatus を再利用（'initializing' | 'authenticated' | 'anonymous'）
export type TopPageAudience = AuthStatus;

export type HomeRankingPreviewEntry = {
  rank: number;
  username: string;
  weeklyScore: number;
  totalGames: number;
};

export type TopPageCta = {
  href: string;
  label: string;
  description: string;
  /** initializing 時は href を確定せず disabled=true でプレースホルダー描画する */
  disabled: boolean;
};

export function getTopPageAudience(
  isInitializing: boolean,
  isLoggedIn: boolean
): TopPageAudience;

export function getPrimaryCta(audience: TopPageAudience): TopPageCta;
export function getSecondaryCta(audience: TopPageAudience): TopPageCta;

/**
 * 上位件数（デフォルト 3）に丸めた配列を返す。
 * entries が limit 未満ならそのまま、超えれば先頭 limit 件を返す。
 * 元配列は破壊しない。
 */
export function selectRankingPreviewEntries(
  entries: readonly HomeRankingPreviewEntry[],
  limit?: number
): HomeRankingPreviewEntry[];

export const HOME_OVERVIEW_ITEMS: readonly {
  title: string;
  description: string;
}[];

// API 未実装期間の初期プレビューは空配列固定（fake username を表示しない）
export const HOME_RANKING_PREVIEW_INITIAL: readonly HomeRankingPreviewEntry[];
```

```ts
// frontend/src/lib/components/home/RankingPreviewSection.svelte

type Props = {
  entries: HomeRankingPreviewEntry[];
  moreHref?: string;
  emptyMessage?: string;
};
```

## タスクリスト（進捗管理）

| タスクID | 内容（何を） | ファイル（どこで） | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | トップページ用のコピー定数・CTA 判定・ランキングプレビュー用ヘルパーを定義する | `frontend/src/lib/home/content.ts` | `getTopPageAudience` `getPrimaryCta` `getSecondaryCta` `selectRankingPreviewEntries` と表示用定数（`HOME_OVERVIEW_ITEMS` / `HOME_RANKING_PREVIEW_INITIAL`）が揃い、`+page.svelte` に直書きしなくて済む。`AuthStatus` を再 export せず import で再利用する | 高 |
| T2 | T1 の純粋関数に対するユニットテストを追加する | `frontend/src/lib/home/content.test.ts` | 3 audience × 主/副 CTA、`selectRankingPreviewEntries` の空配列・上限以下・上限超過、`getTopPageAudience` の (initializing=true) / (false,true) / (false,false) を Vitest で検証 | 高 |
| T3 | Hero セクションをコンポーネント化する | `frontend/src/lib/components/home/HeroSection.svelte` | タイトル・説明・主 CTA・副 CTA を props で受け取り、初期化中の非活性表示にも対応する | 高 |
| T4 | アプリ概要セクションをコンポーネント化する | `frontend/src/lib/components/home/AppOverviewSection.svelte` | 概要カードが配列から描画され、見出し・説明・レスポンシブレイアウトが整う | 中 |
| T5 | ランキングプレビューセクションをコンポーネント化する | `frontend/src/lib/components/home/RankingPreviewSection.svelte` | 上位 3 件表示、空状態メッセージ、`/ranking` への導線が実装される | 高 |
| T6 | ルートページを組み立て、authStore と各セクションを接続する | `frontend/src/routes/(app)/+page.svelte` | スタブが置き換わり、`$derived` で audience を導出して CTA が正しく切り替わる。初期プレビューは `HOME_RANKING_PREVIEW_INITIAL`（空配列）を渡す | 高 |
| T6.5 | ページ設定を明示する | `frontend/src/routes/(app)/+page.ts` | `export const prerender = false; export const ssr = true;` を定義 | 中 |
| T7 | トップページ全体のレスポンシブ・アクセシビリティ調整を行う | `frontend/src/routes/(app)/+page.svelte`, `frontend/src/lib/components/home/*.svelte` | モバイルで崩れず、見出し構造（`h1` は 1 つ）・リンクフォーカス・リスト構造が妥当になる | 高 |
| T8 | 品質チェックを実行する | `frontend/` | `npm run lint` `npm run format` `npm run check` `npm run test:run` が通る | 高 |
| T9 | 手動確認を実施する | 手動 | テストケース一覧の匿名/ログイン済み/レスポンシブ確認が完了する | 高 |
| T10 | 進捗ドキュメントを更新する | `docs/05_progress.md` | 「トップページ `/`」が `[x]` に更新される | 中 |
| T11 | 計画書に実装完了記録を追記する | `docs/plans/top-page/plan.md` | 実装完了セクションに実際の変更ファイルと差分が記録される | 中 |

- [ ] T1: トップページ用のコピー定数・CTA 判定・ランキングプレビュー用ヘルパーを定義する（`frontend/src/lib/home/content.ts`）
- [ ] T2: T1 の純粋関数に対するユニットテストを追加する（`frontend/src/lib/home/content.test.ts`）
- [ ] T3: Hero セクションをコンポーネント化する（`frontend/src/lib/components/home/HeroSection.svelte`）
- [ ] T4: アプリ概要セクションをコンポーネント化する（`frontend/src/lib/components/home/AppOverviewSection.svelte`）
- [ ] T5: ランキングプレビューセクションをコンポーネント化する（`frontend/src/lib/components/home/RankingPreviewSection.svelte`）
- [ ] T6: ルートページを組み立て、authStore と各セクションを接続する（`frontend/src/routes/(app)/+page.svelte`）
- [ ] T6.5: ページ設定を明示する（`frontend/src/routes/(app)/+page.ts`）
- [ ] T7: トップページ全体のレスポンシブ・アクセシビリティ調整を行う（`frontend/src/routes/(app)/+page.svelte`, `frontend/src/lib/components/home/*.svelte`）
- [ ] T8: 品質チェックを実行する（`frontend/`）
- [ ] T9: 手動確認を実施する（手動）
- [ ] T10: 進捗ドキュメントを更新する（`docs/05_progress.md`）
- [ ] T11: 計画書に実装完了記録を追記する（`docs/plans/top-page/plan.md`）

## 技術的注意点

### CTA 状態遷移の整理

| audience | 主 CTA | 遷移先 | 備考 |
|---|---|---|---|
| `initializing` | プレースホルダー表示 | なし | 初期化完了前に href を確定させない |
| `authenticated` | ゲームを始める | `/game` | 既ログインユーザーの最短導線 |
| `anonymous` | 新規登録して始める | `/register` | ゲーム導線の前に認証完了を促す |

### コンポーネント責務

- `HeroSection.svelte`: 見出し、リード文、主副 CTA の表示に専念する。
- `AppOverviewSection.svelte`: アプリ価値の説明カードを配列描画する。
- `RankingPreviewSection.svelte`: ランキング preview 表示に専念し、データ取得責務は持たない。
- `+page.svelte`: authStore から audience を導出し、各コンポーネントへ props を渡す組み立て層に留める。

### 表示ルール

- ランキングプレビューのスコア表示は `Intl.NumberFormat('ja-JP')` で桁区切りする。
- 上位 3 件のみ表示し、4 位以下は `/ranking` で見せる。
- 空状態を受け取った場合でもセクション自体は消さず、「ランキングは準備中です」のような文言と詳細ページ導線を残す。
- 主 CTA / 副 CTA はボタン見た目でも要素自体はリンクにする。

### 将来の API 置き換えメモ

- ranking API が実装されたら `HOME_RANKING_PREVIEW_INITIAL`（空配列）を live fetch 結果に置き換える。
- その際は `API_BASE_URL` と `parseErrorResponse()` を使い、ページ内に独自 fetch パターンを増やさない。
- `GET /ranking/alltime` の具体レスポンス例が `docs/04_api.md` で不足しているため、ランキングページ実装前に API ドキュメントを補完すること。

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| ユニットテスト: `getTopPageAudience(true, false/true)` | 必ず `'initializing'` が返る（isLoggedIn の値に依らない） |
| ユニットテスト: `getTopPageAudience(false, true)` / `(false, false)` | それぞれ `'authenticated'` / `'anonymous'` を返す |
| ユニットテスト: `getPrimaryCta('initializing')` | `disabled: true` のプレースホルダー CTA が返る |
| ユニットテスト: `getPrimaryCta('authenticated')` | `/game` 向け CTA が返り `disabled: false` |
| ユニットテスト: `getPrimaryCta('anonymous')` | `/register` 向け CTA が返り `disabled: false` |
| ユニットテスト: `getSecondaryCta(*)` | すべての audience で `/elements` を指す CTA が返る |
| ユニットテスト: `selectRankingPreviewEntries([], 3)` | 空配列を返し、元配列を破壊しない |
| ユニットテスト: `selectRankingPreviewEntries(2件, 3)` | 2 件をそのまま順序維持で返す |
| ユニットテスト: `selectRankingPreviewEntries(5件, 3)` | 先頭 3 件だけを順序維持で返す |
| 匿名ユーザーで `/` にアクセス | Hero の主 CTA が新規登録導線になり、副 CTA で `/elements` に進める |
| ログイン済みユーザーで `/` にアクセス | Hero の主 CTA が `/game` を向く |
| 認証初期化中にページ表示 | 誤った CTA が一瞬表示されず、プレースホルダーまたは非活性状態で安定する |
| ランキングプレビュー表示（初期状態） | 空状態メッセージ「ランキングは準備中です」と `/ranking` へのリンクが表示される（fake username は出ない） |
| ランキングデータを 3 件渡したケース（手動: ストーリーブック代わりに props 差し替えで確認） | 上位 3 件が桁区切り表示され、`/ranking` へのリンクも維持される |
| SSR レスポンス（curl `/`） | `audience='initializing'` 用プレースホルダーがレンダリングされ、hydration mismatch ログがコンソールに出ない |
| モバイル幅（375px 前後） | Hero / Overview / RankingPreview が縦積みで表示され、横スクロールが発生しない |
| キーボード操作 | CTA と `/ranking` リンクに順番どおりフォーカスできる |
| 品質チェック | `npm run lint` `npm run format` `npm run check` `npm run test:run` が通る |

## 実装リスクと回避策

| リスク | 内容 | 回避策 |
|---|---|---|
| ranking API 未実装依存 | live fetch 前提で作ると backend の TODO に引きずられて着手できない | 今回は空状態の UI を先に固定し、差し替えポイントを `lib/home/content.ts` に閉じ込める |
| auth 初期化ちらつき | `isLoggedIn` だけで CTA を決めると hydration 直後に誤導線が見える | `isInitializing` を audience 判定に含め、CTA はプレースホルダー経由で出し分ける |
| トップページとランキングページの責務衝突 | preview に情報を載せすぎると `/ranking` の存在意義が薄れる | トップページは weekly 上位 3 件の teaser に限定し、詳細は `/ranking` へ送る |
| コピーや配列の直書き散在 | `+page.svelte` に文字列や配列を埋め込むと後続変更が煩雑になる | 定数・純粋関数を `frontend/src/lib/home/content.ts` に集約する |
| 将来の API 連携時に fetch パターンが乱れる | ページごとに独自のエラーハンドリングを書いてしまう | 差し替え時は `API_BASE_URL` と `parseErrorResponse()` を使う方針をこの計画で先に固定する |
| fake username 露出 | ダミーランキングを誤って本番にも出すと、実在しないユーザー名が表示され信頼を損なう | 初期実装で `HOME_RANKING_PREVIEW_INITIAL` を空配列に固定し、ダミーエントリを定数として持たない |
| SSR / hydration mismatch | SSR は `audience='initializing'` 固定だが、クライアント初期化直後に CTA が切り替わる | initializing 用プレースホルダーを必ず実装し、SSR とクライアント初回描画が同一マークアップになることを手動確認に含める |
| `AuthStatus` 型のドリフト | 認証 store 側の status 値が増減したのにトップページが追従し損ねる | `TopPageAudience` を `AuthStatus` の別名として import し、追加時は TypeScript エラーで気付ける状態にする |