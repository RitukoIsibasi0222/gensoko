# ゲームモード選択画面 `/game` 実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、ゲーム UX・状態設計）
> 対象実装者: Codex

## 概要

`docs/05_progress.md` フェーズ6「UI モック（ゲーム）」のうち、ゲームモード選択画面 `/game`（モード一覧・苦手5問未満ガード表示）を実装する。

現状、`backend/src/routes/game/index.ts`、`backend/src/services/game.service.ts`、`backend/src/routes/weak/index.ts`、`backend/src/services/weak.service.ts` は TODO であり、`backend/src/index.ts` に game / weak ルーターも mount されていない。そのため本タスクでは **フロントエンドのモード選択 UI と、将来 API 連携に接続しやすい型・ガード判定設計** を実装範囲にする。`/game/play`、`/game/result`、backend game / weak API 本実装は別タスクとして扱う。

本計画は既存 `docs/plans/game-screens/plan.md` のレビュー改善版であり、既存コード整合性、仕様整合性、A11Y、DB 整合性・負荷、テスト妥当性を実装前に確定する。

## レビュー結果と改善方針

| 観点 | レビュー結果 | 改善方針 |
|---|---|---|
| 既存コード整合性 | game / weak backend は TODO かつ未 mount。live fetch 前提の `/game` は壊れる | 本タスクでは live fetch しない。UI と純粋関数を先に実装し、将来 API 接続点だけ明記する |
| 仕様整合性 | `docs/05_progress.md` は `/game`、`/game/play`、`/game/result` を同じ plan に紐づけているが、実装粒度は分ける必要がある | 本計画は `/game` に絞り、後続画面は依存・スコープ外として明記する |
| API 整合性 | `docs/04_api.md` の game API は `questionSetId` 反映が不十分 | `/game` 実装では API を呼ばない。API 仕様更新は別タスクまたは後続タスクで必須として記録する |
| セキュリティ | 苦手 5 問未満ガードをフロントだけで完結させると迂回可能 | フロントの disabled は UX 補助に限定し、Phase7 API でも必ず再判定する |
| A11Y | カード全体クリックや色だけの disabled 表現は操作・理解が難しい | 操作対象は button / link に限定し、disabled 理由をテキストで常時表示する |
| DB 整合性・負荷 | `/game` 初期表示で `GET /weak` を毎回呼ぶ設計は、未実装 API への依存と将来の不要負荷になる | 今回は DB に触らない。将来接続時は認証後に必要最小限の weak count 取得へ限定する |
| テスト | UI 表示だけのテストに偏ると、ガード条件の回帰を拾いにくい | `modes.ts` に純粋関数を切り出し、通常/苦手/件数境界をユニットテストする |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- フェーズ6に `ゲームモード選択画面 /game（モード一覧・苦手5問未満ガード表示）` が未実装として存在する。
- 同じ計画書に `/game/play`、`/game/result`、game API インターフェース確定タスクも紐づいている。
- 設計決定2として、将来の `GET /game/questions` は `GameQuestionSet` を保存し `questionSetId` を返す。

**`docs/01_features.md`**
- `GameMode` は以下の 6 種。
  - `SYMBOL_TO_NAME_LV1`: 記号→名前 / 初級 / 1〜20番
  - `SYMBOL_TO_NAME_LV2`: 記号→名前 / 上級 / 21〜118番
  - `NAME_TO_SYMBOL_LV1`: 名前→記号 / 初級 / 1〜20番
  - `NAME_TO_SYMBOL_LV2`: 名前→記号 / 上級 / 21〜118番
  - `WEAK_SYMBOL_TO_NAME`: 記号→名前 / 苦手 / 苦手リストのみ
  - `WEAK_NAME_TO_SYMBOL`: 名前→記号 / 苦手 / 苦手リストのみ
- 苦手リストが 5 問未満の場合は苦手ゲーム開始不可。

**`docs/04_api.md`**
- `GET /game/questions`
  - 認証必須。
  - query: `mode: GameMode`
  - 現状レスポンス例には `questionSetId` がないため、後続の API 仕様確定タスクで整合修正が必要。
- `GET /weak`
  - 認証必須。
  - 将来、苦手モード開始可否の判定に利用する。

**`backend/prisma/schema.prisma`**
- `GameMode` enum は 6 種定義済み。
- `GameQuestionSet` は `id`, `userId`, `mode`, `questions`, `expiresAt`, `createdAt` を持つ。
- `GameSession` は `mode`, `totalScore`, `correctCount`, `totalCount`, `maxStreak`, `durationSec` を持つ。
- `GameAnswer` は `elementId`, `isCorrect`, `answerTimeSec` を持つ。
- `WeakElement` は `userId`, `elementId`, `missCount`, `consecutiveHit` を持つ。

**`backend/src/routes/game/index.ts`**
- 現状 `// TODO: implement`。
- 本タスクでは変更しない。

**`backend/src/services/game.service.ts`**
- 現状 `// TODO: implement`。
- 本タスクでは変更しない。

**`backend/src/routes/weak/index.ts`**
- 現状 `// TODO: implement`。
- 本タスクでは変更しない。

**`backend/src/services/weak.service.ts`**
- 現状 `// TODO: implement`。
- 本タスクでは変更しない。

**`backend/src/index.ts`**
- mount 済みルーターは `/api/v1/auth`、`/api/v1/elements`、`/api/v1/users`。
- game / weak ルーターは未 mount。

**`frontend/src/routes/(app)/game/+page.svelte`**
- 現状は見出しと「フェーズ6・7で実装予定」のスタブのみ。
- 本タスクで全文書き換え対象。

**`frontend/src/routes/(app)/+layout.svelte`**
- Header / Footer / `main.max-w-5xl` を提供する。
- `/game` はこの既存レイアウト内で成立するレスポンシブ UI とする。

**`frontend/src/lib/stores/auth.svelte.ts`**
- `authStore.isInitializing: boolean`
- `authStore.isLoggedIn: boolean`
- `authStore.accessToken: string | null`
- `authStore.user: AuthUser | null`
- 未ログイン時はゲーム開始ではなく `/login` への誘導を表示する。

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.warning(message: string): string`
- `toastStore.error(message: string): string`
- `toastStore.fromApiError(error: ApiError): string`
- 未ログイン開始、苦手ガード、将来 API エラー通知で利用可能。

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL: string`
- API ベース URL はこのファイルから import する。page / component 内で環境変数を直接読まない。

**`frontend/src/lib/api/errors.ts`**
- `ApiError`
- `parseErrorBody(response: Response): Promise<ErrorBody>`
- `parseErrorResponse(response: Response, defaultMessage?: string): Promise<never>`
- 将来 API 接続時は `response.ok` を JSON パース前に確認し、非 JSON エラーにも対応する。

**`frontend/src/routes/(app)/elements/+page.svelte`**
- Svelte 5 Runes、`authStore.isInitializing` 待ち、loading / error / empty / success 状態、`toastStore` 利用の参考実装。

**`frontend/src/lib/components/elements/ElementSearchFilters.svelte`**
- UI 状態を component に分離し、正規化や URL query 責務を helper に寄せる参考実装。
- 本タスクでは検索・フィルター UI は変更しない。

### 重要な制約

- 本タスクは `/game` の UI モック範囲に限定する。
- backend game / weak API の live fetch は行わない。
- `GET /game/questions` の正解情報をクライアントに渡さない方針は維持する。
- 苦手 5 問未満ガードは UX 補助であり、将来 API 実装時もサーバー側で必ず再判定する。
- `localStorage` に認証情報・ゲーム状態・苦手件数を保存しない。
- Svelte 5 Runes（`$state`, `$derived`, `$effect`, `$props`）を使う。
- `authStore.isInitializing` 中はログイン状態を確定表示しない。
- 数値定数（苦手 5 問）は `frontend/src/lib/game/constants.ts` に集約し、UI へ直書きしない。
- モード定義・ガード判定は `frontend/src/lib/game/modes.ts` に集約し、component / page に重複定義しない。
- API ベース URL や共通エラー処理を各ファイルで重複定義しない。
- UI 文言・エラー・ガードメッセージは日本語に統一する。
- Tailwind の既存 `brand` / `ink` / gray 系のトーンに寄せ、既存画面から極端に浮かないデザインにする。
- カード内カードを避け、カードは各モードの反復 item に限定する。
- モバイル幅でボタン文言・説明文がはみ出さないようにする。
- Prettier `tabWidth: 2` に従う。

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/game/constants.ts` | 新規 | 苦手モード開始に必要な最低件数など、ゲーム画面で使う定数 |
| `frontend/src/lib/game/types.ts` | 新規 | `GameMode`、モード設定、開始可否結果の型 |
| `frontend/src/lib/game/modes.ts` | 新規 | 6 モードの表示情報、苦手モード判定、開始可否・ガード文言 |
| `frontend/src/lib/game/modes.test.ts` | 新規 | モード定義、苦手 5 問未満ガード、文言生成のユニットテスト |
| `frontend/src/lib/components/game/GameModeCard.svelte` | 新規 | モードカード、開始ボタン、disabled 理由、未ログイン表示 |
| `frontend/src/routes/(app)/game/+page.svelte` | 修正 | モード一覧、認証状態別 CTA、苦手 5 問未満ガード表示 |
| `frontend/src/routes/(app)/game/+page.ts` | 新規 | `ssr = true`, `prerender = false` を明示 |
| `docs/05_progress.md` | 修正 | 実装開始時に該当タスクを `[-]`、完了時に `[x]` へ更新 |
| `docs/plans/game-screens/plan.md` | 修正 | 本タスクのチェックボックス更新、実装完了セクション追記 |

## API 仕様（この機能で使う範囲のみ）

### エラーレスポンス共通形式

```json
{ "error": "メッセージ文字列" }
```

ステータスコード: 400 / 401 / 403 / 404 / 429 / 500 / 502 / 504

### 今回の実装での API 利用

| メソッド | パス | 認証 | 今回の呼び出し | 理由 |
|---|---|---|---|---|
| GET | `/api/v1/game/questions?mode=...` | 必須 | 呼び出さない | backend 未実装・未 mount のため |
| GET | `/api/v1/weak` | 必須 | 呼び出さない | backend 未実装・未 mount のため |

### 将来接続する API

#### GET `/game/questions`

| 項目 | 内容 |
|---|---|
| 認証 | 必須 |
| Query | `mode: GameMode` |
| 用途 | `/game` の開始ボタン押下後、10 問と `questionSetId` を取得して `/game/play` へ進む |
| 注意 | 苦手モードで苦手元素が 5 件未満の場合はサーバー側でも日本語エラーを返す |

想定レスポンス:

```json
{
  "questionSetId": "cuid",
  "questions": [
    {
      "elementId": 1,
      "question": "H",
      "choices": [
        { "elementId": 1, "text": "水素" },
        { "elementId": 6, "text": "炭素" },
        { "elementId": 8, "text": "酸素" },
        { "elementId": 7, "text": "窒素" }
      ]
    }
  ]
}
```

#### GET `/weak`

| 項目 | 内容 |
|---|---|
| 認証 | 必須 |
| 用途 | 苦手モード開始可否の `weakCount` を算出する |
| 注意 | 件数だけ必要な場合、将来は軽量 API または `GET /weak` のレスポンス利用を検討する |

想定レスポンス:

```json
{
  "weakElements": [
    {
      "elementId": 26,
      "symbol": "Fe",
      "nameJa": "鉄",
      "missCount": 3,
      "addedAt": "2026-05-01T00:00:00Z"
    }
  ]
}
```

## 設計上の決定事項

1. **`/game` では live fetch を行うか**
   - 選択: 今回は行わない。
   - 根拠: game / weak API は TODO かつ未 mount。フェーズ6の目的は UI モックと UX 確認であり、API 本実装はフェーズ7。

2. **検索条件を URL クエリに反映するか**
   - 選択: 本画面では検索条件が存在しないため、URL query は使わない。
   - 根拠: `/game` の状態はモード選択と認証状態・苦手件数ガードであり、検索・分類・周期の query は `/elements` の責務。不要な query を導入すると責務が混ざる。

3. **初期表示時に検索条件をどこから復元するか**
   - 選択: 本画面では検索条件を復元しない。初期表示は `authStore` とモード定義から構成する。
   - 根拠: `/game` には検索 UI がない。再読み込み時に保持すべき検索条件もない。

4. **キーワード入力の反映タイミングをどうするか**
   - 選択: 本画面ではキーワード入力を実装しない。
   - 根拠: キーワード検索は `/elements` の完了済みタスク。ゲームモード選択画面に入力欄を追加すると、ゲーム開始導線が曖昧になる。

5. **分類・周期の選択 UI をどう表現するか**
   - 選択: 本画面では分類・周期 select を実装しない。
   - 根拠: ゲームの出題範囲は `GameMode` によって決まる。分類・周期は元素一覧検索の責務であり、今回のモード一覧とは別概念。

6. **検索条件リセット時に API 再取得するか**
   - 選択: 本画面では検索条件リセットを実装しない。
   - 根拠: リセット対象となる検索状態がない。ゲーム状態の reset は `/game/play` / `/game/result` 実装時の `gameStore` 側で扱う。

7. **API パラメータの組み立てをどの層で行うか**
   - 選択: 将来 `GET /game/questions` を呼ぶ際は `lib/api/game.ts` または `gameStore` から `mode` を渡し、page / component では URL を組み立てない。
   - 根拠: `API_BASE_URL`、Authorization、`parseErrorResponse` を共通化し、UI component に API 仕様を埋め込まないため。

8. **正規化済みの検索条件をどこで保持するか**
   - 選択: 本画面では検索条件を保持しない。選択モードは `GameMode` 型で扱い、開始可否は `canStartGameMode(mode, weakCount)` の結果として都度導出する。
   - 根拠: 状態を最小化し、モード定義と UI 表示のズレを防ぐ。

9. **エラー表示に toast を使うか、画面内表示にするか**
   - 選択: 未ログイン・苦手 5 問未満のような予測可能なガードは画面内表示にする。将来 API 開始失敗など非同期エラーは `toastStore.fromApiError` または画面内エラーを併用する。
   - 根拠: ガード条件はユーザーが開始前に確認すべき常設情報。API エラーは一時的な通知として toast が適する。

10. **既存コンポーネントを再利用するか、新規作成するか**
    - 選択: Header / Footer / layout / authStore / toastStore は再利用し、モードカードは `GameModeCard.svelte` として新規作成する。
    - 根拠: モードカードは game 固有の表示・disabled 理由・開始 CTA を持つため、独立 component にすると `/game` page が肥大化しない。

11. **苦手件数はどこで管理するか**
    - 選択: 今回は `/game/+page.svelte` のローカル状態または定数の preview 値として扱い、判定ロジックは `modes.ts` に置く。
    - 根拠: backend 未実装のため永続化・実取得はしない。判定だけ先に純粋関数化して将来接続に備える。

12. **未ログイン時のモード表示をどうするか**
    - 選択: モード一覧は表示するが、開始ボタンは `/login` への誘導に切り替える。
    - 根拠: game API は認証必須。未ログインでもゲーム内容は理解できるようにしつつ、開始操作ではログインに誘導する。

13. **開始ボタン押下時の遷移先**
    - 選択: 今回は通常モード開始時に `/game/play` へ進む導線を設計するが、`/game/play` 未実装の場合は実装段階でスタブ遷移または toast にするかを確認する。
    - 根拠: `docs/05_progress.md` では `/game/play` が別未実装タスク。`/game` 単体実装時に壊れたリンクを作らないため。

14. **苦手 5 問未満ガード文言**
    - 選択: `getGameModeGuardMessage` で「苦手元素が5件以上必要です」系の日本語文言を返す。
    - 根拠: disabled 理由を UI とテストで共有し、文言の重複・ズレを防ぐ。

## 公開インターフェース案

### `frontend/src/lib/game/constants.ts`

```ts
export const MIN_WEAK_ELEMENTS_FOR_GAME = 5;
```

### `frontend/src/lib/game/types.ts`

```ts
export type GameMode =
  | 'SYMBOL_TO_NAME_LV1'
  | 'SYMBOL_TO_NAME_LV2'
  | 'NAME_TO_SYMBOL_LV1'
  | 'NAME_TO_SYMBOL_LV2'
  | 'WEAK_SYMBOL_TO_NAME'
  | 'WEAK_NAME_TO_SYMBOL';

export type GameModeConfig = {
  mode: GameMode;
  title: string;
  description: string;
  formatLabel: string;
  difficultyLabel: string;
  rangeLabel: string;
  requiresWeakElements: boolean;
};

export type GameModeStartAvailability = {
  canStart: boolean;
  guardMessage: string | null;
};
```

### `frontend/src/lib/game/modes.ts`

```ts
export const GAME_MODE_CONFIGS: readonly GameModeConfig[];

export function getGameModeConfig(mode: GameMode): GameModeConfig;

export function isWeakGameMode(mode: GameMode): boolean;

export function canStartGameMode(mode: GameMode, weakCount: number | null): boolean;

export function getGameModeGuardMessage(mode: GameMode, weakCount: number | null): string | null;

export function getGameModeStartAvailability(
  mode: GameMode,
  weakCount: number | null
): GameModeStartAvailability;
```

### `frontend/src/lib/components/game/GameModeCard.svelte`

```ts
type Props = {
  config: GameModeConfig;
  isLoggedIn: boolean;
  weakCount: number | null;
  isStarting?: boolean;
  onStart(mode: GameMode): void;
};
```

## タスクリスト（進捗管理）

| タスクID | 内容 | ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存仕様・既存実装を確認する | `AGENTS.md`, `docs/05_progress.md`, `docs/04_api.md`, `docs/08_conventions.md`, `docs/07_testing_flow.md`, `docs/plans/game-screens/plan.md`, backend / frontend 関連ファイル | `/game` が UI モック範囲であること、game / weak API が未実装・未 mount であること、既存 store / API 共通処理の使い方が確認される | 高 |
| T2 | 進捗を実装中へ更新する | `docs/05_progress.md` | `ゲームモード選択画面 /game` が `[ ]` から `[-]` に更新される | 中 |
| T3 | ゲーム定数・型定義を追加する | `frontend/src/lib/game/constants.ts`, `frontend/src/lib/game/types.ts` | `MIN_WEAK_ELEMENTS_FOR_GAME`、`GameMode`、`GameModeConfig`、開始可否型が定義され、UI に直書き定数が残らない | 高 |
| T4 | モード設定・苦手ガード判定を実装する | `frontend/src/lib/game/modes.ts` | 6 モードの表示情報、`isWeakGameMode`、`canStartGameMode`、`getGameModeGuardMessage` が一元化される | 高 |
| T5 | ガード判定のユニットテストを作成する | `frontend/src/lib/game/modes.test.ts` | 通常モード、苦手 4 件、苦手 5 件、`null` 件数、文言生成のテストが通る | 高 |
| T6 | モードカード component を実装する | `frontend/src/lib/components/game/GameModeCard.svelte` | タイトル、説明、形式、難易度、出題範囲、開始ボタン、未ログイン誘導、苦手ガード理由が表示される | 高 |
| T7 | `/game` page を実装する | `frontend/src/routes/(app)/game/+page.svelte`, `frontend/src/routes/(app)/game/+page.ts` | モード一覧、認証状態別 CTA、苦手 5 問未満ガード、ローディング相当表示が既存 layout 内で表示される | 高 |
| T8 | 開始操作の多重実行・未実装画面への扱いを整理する | `frontend/src/routes/(app)/game/+page.svelte` | 開始中はボタンが disabled になり、`/game/play` 未実装時の挙動が toast または明示導線として破綻しない | 高 |
| T9 | ローディング・空状態・エラー状態を確認する | `frontend/src/routes/(app)/game/+page.svelte`, `frontend/src/lib/components/game/GameModeCard.svelte` | `authStore.isInitializing` 中の表示、モード定義欠損時の空状態、将来 API エラー用の表示方針が実装またはコメントで明確になる | 中 |
| T10 | frontend lint を実行する | `frontend/` | `npm run lint` が通る | 高 |
| T11 | format を実行する | `frontend/` | `npm run format` 実行後に不要な差分がない | 高 |
| T12 | frontend test を実行する | `frontend/` | `npm run test:run` が通る | 高 |
| T13 | Svelte / TypeScript check を実行する | `frontend/` | `npm run check` が通る | 高 |
| T14 | 手動確認を実施する | ブラウザ | PC / モバイルで `/game` のログイン中・未ログイン・苦手 4 件・苦手 5 件相当表示を確認する | 高 |
| T15 | 進捗・計画書を実装完了へ更新する | `docs/05_progress.md`, `docs/plans/game-screens/plan.md` | `/game` タスクが `[x]` になり、plan.md に実装完了セクションと実際の変更ファイルが追記される | 中 |

- [x] T1: 既存仕様・既存実装を確認する
- [x] T2: 進捗を実装中へ更新する
- [x] T3: ゲーム定数・型定義を追加する
- [x] T4: モード設定・苦手ガード判定を実装する
- [x] T5: ガード判定のユニットテストを作成する
- [x] T6: モードカード component を実装する
- [x] T7: `/game` page を実装する
- [x] T8: 開始操作の多重実行・未実装画面への扱いを整理する
- [x] T9: ローディング・空状態・エラー状態を確認する
- [x] T10: frontend lint を実行する
- [x] T11: frontend format を実行する
- [x] T12: frontend test を実行する
- [x] T13: frontend check を実行する
- [x] T14: 手動確認を実施する
- [x] T15: 進捗・計画書を実装完了へ更新する

## 技術的注意点

- `MIN_WEAK_ELEMENTS_FOR_GAME` を UI component に直書きしない。
- `GameMode` の文字列 union は Prisma の `GameMode` enum と一致させる。
- モード表示名・説明・難易度・出題範囲は `GAME_MODE_CONFIGS` に集約し、page と component で重複定義しない。
- 苦手モード判定は `mode.startsWith('WEAK_')` のような ad hoc 判定を複数箇所に書かず、`isWeakGameMode` に集約する。
- 苦手件数が `null` の場合は「未取得」として扱い、通常モードは開始可能、苦手モードは開始不可または確認中表示にする。
- 未ログイン時は `authStore.isInitializing` 完了後に CTA を表示する。初期化中に「未ログイン」と断定しない。
- `toastStore` を使う場合はユーザー操作に対する補助通知に留め、常に必要なガード理由は画面内に表示する。
- 将来 API 接続する場合は `API_BASE_URL`、`Authorization: Bearer ${authStore.accessToken}`、`credentials: 'include'`、`parseErrorResponse` を使う。
- API エラー時はバックエンドの日本語メッセージを上書きしない。
- `response.json()` は `response.ok` チェック前に呼ばない。
- 開始ボタンは `isStarting` 中に disabled にし、多重クリックを防ぐ。
- disabled 理由は色だけでなくテキストで表示する。
- `<button>` と `<a>` の役割を混同しない。実行は button、ログイン遷移は link を使う。
- component 内に `/api/v1/game/questions` など API パスを埋め込まない。
- `/game/+page.ts` では `ssr = true`, `prerender = false` を明示し、認証 store 初期化中表示との hydration 不一致を避ける。
- モバイルでは 1 カラム、広い画面では 2〜3 カラム程度の mode grid とし、カード内テキストがはみ出さないようにする。
- UI 文言は日本語に統一する。

## A11Y要件

| 対象 | 要件 |
|---|---|
| ページ構造 | `h1` は `/game` の画面名にし、モード一覧は section + list 構造で読む順序を安定させる |
| モードカード | カード全体をクリック領域にしない。開始操作は button、ログイン遷移は link として明確に分ける |
| disabled 表示 | disabled の理由をボタン付近にテキストで表示し、色だけに依存しない |
| 未ログイン導線 | 「ログインすると開始できます」のような説明を CTA と近接させる |
| focus | Tab で各モードの開始操作へ移動でき、disabled 要素でフォーカスが迷子にならない |
| `aria-live` | `authStore.isInitializing` 後に表示が切り替わる補助文は必要最小限にし、過剰な読み上げを避ける |
| レスポンシブ | 390px 幅でもボタン文言・ガード文言が切れない |

## DB整合性・負荷に関する注意

- 本タスクでは DB 読み書きを行わないため、DB 負荷は発生しない。
- `/game` 初期表示で `GET /weak` を毎回呼ぶ実装は今回は行わない。
- Phase7 で `GET /weak` または weak count API を接続する場合、認証済みユーザーに限定し、必要最小限の取得にする。
- Phase7 の苦手 5 問未満判定はサーバー側でも必ず実行する。フロントの disabled は UX 補助であり、セキュリティ境界ではない。
- Phase7 の `GET /game/questions` は `GameQuestionSet` を作成するため、多重クリックで複数 question set が作られないよう開始ボタンを loading / disabled にする。
- 将来 `GameQuestionSet` を作成したまま離脱するケースに備え、API 側では有効期限切れデータの削除方針も検討する。

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| 初期表示でモード一覧が表示される | 6 種のゲームモードが表示される |
| `GAME_MODE_CONFIGS` | 6 種の `GameMode` が重複なく定義される |
| 通常モードの開始可否 | `weakCount` に関係なく開始可能 |
| 苦手モード・`weakCount = 4` | 開始不可、ガード文言が返る |
| 苦手モード・`weakCount = 5` | 開始可能、ガード文言は `null` |
| 苦手モード・`weakCount = null` | 未取得扱いで開始不可または確認中表示になる |
| `getGameModeGuardMessage` | 「苦手元素が5件以上必要です」系の日本語文言を返す |
| 未ログイン時 | モード内容は見えるが、開始操作はログイン誘導になる |
| `authStore.isInitializing` 中 | ログイン/未ログインを断定する CTA がちらつかない |
| 開始ボタン連打 | `isStarting` 中は二重開始しない |
| ローディング中 | UI が崩れず、操作不能な箇所は disabled になる |
| 空状態 | モード定義が空の場合にクラッシュせず日本語メッセージを表示する |
| API エラー時の将来方針 | `ApiError.message` を優先して toast または画面内表示できる設計になっている |
| モバイル表示 | 390px 幅でカード・ボタン・文言がはみ出さない |
| キーボード操作 | Tab で各開始ボタン・ログインリンクへ移動できる |
| lint | `npm run lint` が通る |
| format | `npm run format` 実行後、Prettier 整形済み |
| test | `npm run test:run` が通る |
| check | `npm run check` が通る |

注記:

- 依頼文に含まれていた「キーワード検索」「分類」「周期」「URL クエリ復元」「検索条件リセット」のテストは `/elements` の検索・フィルター UI に対する観点であり、本 `/game` 画面では対象外とする。該当テストは既存 `frontend/src/lib/elements/search-filter.test.ts` と `ElementSearchFilters.svelte` 周辺で扱う。

## 実装リスクと回避策

| リスク | 影響 | 回避策 |
|---|---|---|
| game / weak API が未実装なのに live fetch してしまう | `/game` 初期表示や開始操作が常に失敗する | 本タスクでは API を呼ばず、将来接続点だけ型と設計で明記する |
| 苦手件数ガードが page と component に分散する | disabled 表示と開始可否がズレる | `modes.ts` の純粋関数に集約し、テストする |
| 苦手 5 問の数値が直書きされる | 仕様変更時に修正漏れが起きる | `MIN_WEAK_ELEMENTS_FOR_GAME` に集約する |
| 未ログイン状態のちらつき | refresh 中にログイン誘導が一瞬出る | `authStore.isInitializing` 中は判定保留 UI を出す |
| `/game/play` 未実装でリンク切れになる | 開始ボタン押下後にユーザーが迷う | 実装時点で `/game/play` の有無を確認し、未実装なら toast または準備中表示にする |
| 将来 API 接続時にエラー処理が重複する | `API_BASE_URL` や parse 処理が複数箇所に散る | `lib/api/game.ts` 追加時に `parseErrorResponse` を使う方針を維持する |
| disabled が色だけで表現される | A11Y と UX が悪化する | disabled 理由をテキストで表示し、`aria-disabled` / `disabled` を適切に使う |
| 依頼文の検索・フィルター要件を混ぜる | `/game` の責務が曖昧になる | 本計画では検索系要件を対象外として明記し、既存 `elements-search-filter` 計画へ分離する |

## 手動確認項目

| 項目 | 確認内容 |
|---|---|
| `/game` 初期表示 | 見出し、説明、6 モードが表示される |
| 未ログイン表示 | 開始 CTA がログイン誘導になり、ゲーム開始できない |
| ログイン済み表示 | 通常モードの開始ボタンが表示される |
| 苦手 4 件相当 | 苦手モードが disabled になり、理由が表示される |
| 苦手 5 件相当 | 苦手モードが開始可能表示になる |
| 初期化中 | ログイン状態判定のちらつきがない |
| 多重クリック | 開始中にボタンが disabled になる |
| PC 幅 | 既存 layout 内でカード grid が読みやすい |
| モバイル幅 390px | ボタン・カード・説明文がはみ出さない |
| キーボード操作 | Tab / Shift+Tab で自然に操作できる |
| スクリーンリーダー向け | disabled 理由がテキストとして読める |
| コンソール | 不要なエラーや hydration mismatch が出ない |

## 実装完了時の更新ルール

実装完了時は以下を必ず行う。

- `docs/05_progress.md` の `ゲームモード選択画面 /game（モード一覧・苦手5問未満ガード表示）` を `[x]` に更新する。
- `docs/plans/game-screens/plan.md` の該当チェックボックスを `[x]` に更新する。
- 計画時と実装時で変更ファイルが異なった場合、対象ファイル一覧を実態に合わせて更新する。
- 設計判断が変わった場合、`## 実装完了` の「計画からの変更点」に記録する。
- 実行した品質チェックを `## 実装完了` に記録する。
- 手動確認した画面幅・ログイン状態・苦手件数条件を `## 実装完了` に記録する。

実装完了セクションのテンプレート:

```markdown
## 実装完了
- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/game-mode-select
- PR: #N

### 計画からの変更点
- なし

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/game/constants.ts` | 新規 | 苦手ガード定数 |
| `frontend/src/lib/game/types.ts` | 新規 | ゲームモード型 |
| `frontend/src/lib/game/modes.ts` | 新規 | モード定義・開始可否判定 |
| `frontend/src/lib/game/modes.test.ts` | 新規 | ガード判定テスト |
| `frontend/src/lib/components/game/GameModeCard.svelte` | 新規 | モードカード |
| `frontend/src/routes/(app)/game/+page.svelte` | 修正 | モード選択画面 |
| `frontend/src/routes/(app)/game/+page.ts` | 新規 | route 設定 |
| `docs/05_progress.md` | 修正 | 進捗更新 |
| `docs/plans/game-screens/plan.md` | 修正 | 実装完了記録 |

### 品質チェック
| コマンド | 結果 |
|---|---|
| `cd frontend && npm run lint` | OK |
| `cd frontend && npm run format` | OK |
| `cd frontend && npm run test:run` | OK |
| `cd frontend && npm run check` | OK |

### 手動確認
| 条件 | 結果 |
|---|---|
| 未ログイン `/game` | OK |
| ログイン済み `/game` | OK |
| 苦手 4 件相当 | OK |
| 苦手 5 件相当 | OK |
| PC 幅 | OK |
| モバイル幅 390px | OK |
```

## 実装完了

- 完了日: 2026-06-12
- 実装ブランチ: `feature/game-mode-select`
- PR: 未作成

### 計画からの変更点

- `GameModeCard.svelte` のルート要素は当初 `article` で実装したが、外側が `ul > li` のモード選択リストであり、カード自体は独立記事ではなくリスト項目内の表示コンテナであるため `div` に変更した。
- `/game/play` は未実装のため、開始ボタン押下時は遷移せず toast で「プレイ画面は後続タスクで実装します。」と表示する UI モックにした。
- `onStart` の関数型は Svelte ファイル内で `no-unused-vars` に検出されたため、`GameModeStartHandler` として `frontend/src/lib/game/types.ts` に切り出した。
- backend game / weak API は未実装・未 mount のため、計画どおり live fetch は行っていない。

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/game/constants.ts` | 新規 | 苦手ガード定数 `MIN_WEAK_ELEMENTS_FOR_GAME` を追加 |
| `frontend/src/lib/game/types.ts` | 新規 | `GameMode`、`GameModeConfig`、`GameModeStartAvailability`、`GameModeStartHandler` を追加 |
| `frontend/src/lib/game/modes.ts` | 新規 | 6 モード定義、苦手モード判定、開始可否判定、ガード文言生成を追加 |
| `frontend/src/lib/game/modes.test.ts` | 新規 | モード定義・苦手 5 件境界・ガード文言のユニットテストを追加 |
| `frontend/src/lib/components/game/GameModeCard.svelte` | 新規 | モードカード、ログイン導線、開始ボタン、disabled 理由表示を追加 |
| `frontend/src/routes/(app)/game/+page.svelte` | 修正 | `/game` スタブをモード選択画面へ置換 |
| `frontend/src/routes/(app)/game/+page.ts` | 新規 | `ssr = true`, `prerender = false` を明示 |
| `docs/05_progress.md` | 修正 | `/game` タスクを実装中、完了へ更新 |
| `docs/plans/game-screens/plan.md` | 修正 | タスク完了チェックと実装完了記録を追記 |

### 品質チェック

| コマンド | 結果 |
|---|---|
| `cd frontend && npm run lint` | OK |
| `cd frontend && npm run format` | OK |
| `cd frontend && npm run test:run` | OK（12 files / 157 tests） |
| `cd frontend && npm run check` | OK（0 errors / 0 warnings） |

### 手動確認

| 条件 | 結果 |
|---|---|
| 未ログイン `/game` | OK: 6 モード表示、ログイン導線 6 件 |
| PC 幅 `/game` | OK: 見出し、モード一覧、コンソールエラーなし |
| モバイル幅 390px | OK: 6 カード表示、横はみ出し検出なし |
| 苦手 4 件相当 | OK: `modes.test.ts` で開始不可・ガード文言を確認。UI は preview 値 4 件で苦手モード disabled 表示 |
| ログイン済み `/game` | 未確認: 手動確認時にログインセッションなし。`authStore.isLoggedIn` 分岐は実装済み |
| 苦手 5 件相当 | 未確認: backend weak API 未実装のため実データ確認なし。`modes.test.ts` で開始可能境界を確認 |
