# ゲーム画面（/game・/game/play・/game/result）実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、ゲーム UX・API 連携設計）

## 概要

`docs/05_progress.md` フェーズ6「UI モック（ゲーム）」として、ゲームモード選択画面 `/game`、ゲームプレイ画面 `/game/play`、ゲーム結果画面 `/game/result` を作成する。

現状の `backend/src/routes/game/index.ts`、`backend/src/services/game.service.ts`、`backend/src/routes/weak/index.ts`、`backend/src/services/weak.service.ts` は TODO であり、game / weak ルーターも `backend/src/index.ts` に未 mount である。そのため本タスクでは **フロントエンドの UI モックと、将来 API 連携に向けた型・状態設計** を実装範囲にする。バックエンド実装・DB 書き込み・実データ取得はフェーズ7以降に分離する。

プレイ画面は 10 問、15 秒タイマー、4 択、回答後フィードバック、1〜4 キー操作を実装する。結果画面はスコア、最大連続正解数、間違え一覧、「もう一度」「ホームへ」を表示する。

## レビュー結果と改善方針

前回計画をシニアレビュー観点で見直し、以下を改善方針として反映する。

| 観点 | レビュー結果 | 改善方針 |
|---|---|---|
| 既存コード整合性 | `game` / `weak` API は未実装・未 mount。live fetch 前提では画面が壊れる | フェーズ6は frontend-only UI モックに限定し、API 連携は型とドキュメント整合までにする |
| 仕様整合性 | `docs/04_api.md` には `questionSetId` が未反映だが、`05_progress.md` と `schema.prisma` は `GameQuestionSet` 前提 | `docs/04_api.md` を `questionSetId` 前提へ更新する |
| セキュリティ | 正解情報を API レスポンスに含めない方針と即時正誤フィードバックが衝突する | UI モックのみ内部モック正解を使う。本番 API では Phase7 で回答チェック API またはフィードバック仕様を決める |
| A11Y | タイマー・正誤フィードバック・キーボード操作はスクリーンリーダーと競合しやすい | `aria-live`、`aria-current`、明示ラベル、focus 管理、reduced motion 配慮をタスクに含める |
| DB 整合性・負荷 | 問題セット生成や苦手件数取得を UI 実装に混ぜると DB 責務が曖昧になる | フェーズ6では DB に触らない。Phase7 の API は 1 ゲーム 1 questionSet 作成・終了時削除の方針を維持する |
| テスト | UI 操作が多く、純粋関数なしではテストが脆くなる | スコア・進行・ガード・時間計算を `lib/game` の純粋関数に切り出して Vitest で検証する |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- フェーズ6に以下の未実装タスクがある。
  - ゲームモード選択画面 `/game`
  - ゲームプレイ画面 `/game/play`
  - ゲーム結果画面 `/game/result`
  - `GET /game/questions` のレスポンス形式（問題・選択肢・questionSetId）決定
  - `POST /game/sessions` のリクエスト/レスポンス形式決定
- 設計決定2として、`GET /game/questions` は `GameQuestionSet` を保存し `questionSetId` を返す。

**`docs/04_api.md`**
- `GET /game/questions`
  - 認証必須
  - query: `mode: GameMode`
  - 現状レスポンス例に `questionSetId` がないため、本計画内で更新する。
- `POST /game/sessions`
  - 認証必須
  - 現状リクエスト例は `mode` を含むが、`docs/05_progress.md` と `docs/12_task_guide.md` は `questionSetId` 受信方式を前提としているため整合修正する。
- `GET /weak`
  - 認証必須
  - 苦手モードの 5 問未満ガード判定に将来利用する。

**`docs/01_features.md`**
- `GameMode`
  - `SYMBOL_TO_NAME_LV1`: 記号→名前 / 初級 / 1〜20番
  - `SYMBOL_TO_NAME_LV2`: 記号→名前 / 上級 / 21〜118番
  - `NAME_TO_SYMBOL_LV1`: 名前→記号 / 初級 / 1〜20番
  - `NAME_TO_SYMBOL_LV2`: 名前→記号 / 上級 / 21〜118番
  - `WEAK_SYMBOL_TO_NAME`: 記号→名前 / 苦手 / 苦手リストのみ
  - `WEAK_NAME_TO_SYMBOL`: 名前→記号 / 苦手 / 苦手リストのみ
- 1ゲームは 10 問、15 秒タイムリミット、回答または時間切れ後に 1.5 秒フィードバック。

**`backend/prisma/schema.prisma`**
- `GameMode` enum は上記 6 種を定義済み。
- `GameQuestionSet` は `id`, `userId`, `mode`, `questions`, `expiresAt`, `createdAt` を持つ。
- `GameSession` は `totalScore`, `correctCount`, `totalCount`, `maxStreak`, `durationSec` を持つ。
- `GameAnswer` は `elementId`, `isCorrect`, `answerTimeSec` を持つ。

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
- game / weak ルーターは未 mount のため、フェーズ6では live fetch をしない。

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL: string` — API ベース URL を一元管理する。
- ページ側で `import.meta.env.VITE_API_BASE_URL` を直接読まない。

**`frontend/src/lib/api/errors.ts`**
- `class ApiError extends Error`
- `parseErrorBody(response: Response): Promise<ErrorBody>`
- `parseErrorResponse(response: Response, defaultMessage?: string): Promise<never>`
- エラー時は `response.ok` を JSON パース前に確認し、非 JSON レスポンスにも対応する。

**`frontend/src/lib/stores/auth.svelte.ts`**
- `authStore.isInitializing: boolean`
- `authStore.isLoggedIn: boolean`
- `authStore.accessToken: string | null`
- `authStore.logout(): Promise<void>`
- ゲーム API は認証必須のため、未ログイン時は `/login` へ誘導する。

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.error(message: string): string`
- `toastStore.warning(message: string): string`
- `toastStore.success(message: string): string`
- `toastStore.fromApiError(error: ApiError): string`
- API エラー・ゲーム開始失敗・結果保存失敗時の通知に使う。

**`frontend/src/routes/(app)/+layout.svelte`**
- Header / Footer / main コンテナを提供する。
- ゲーム画面はこの最大幅内で成立するレスポンシブ UI とする。

**`frontend/src/routes/(app)/game/+page.svelte`**
- 現状スタブ。全文書き換え対象。

### 重要な制約

- 本タスクはフェーズ6の UI モックであり、backend game / weak API 本実装は含めない。
- ただし API 仕様の不整合を残さないため、`docs/04_api.md` は `questionSetId` 前提に更新する。
- `GET /game/questions` で正解情報をクライアントに渡さない方針は維持する。
- 即時の正誤フィードバックは UI 要件と既存 API 仕様が衝突するため、UI モックでは内部モックデータで表現し、Phase7 では追加 API または正誤表示タイミングを確定する。
- `localStorage` に認証情報やゲーム結果を保存しない。画面間のゲーム状態は `gameStore` のメモリ状態を基本とし、リロード時は `/game` へ戻す。
- Svelte 5 Runes（`$state`, `$derived`, `$effect`）を使う。`$:` は使わない。
- タイマー・キーボードイベントは必ず cleanup する。
- 数値定数（10問、15秒、1.5秒、苦手5問）は `frontend/src/lib/game/constants.ts` に集約する。
- API エラーメッセージはバックエンドの日本語文言を上書きしない。
- Tailwind の既存 `brand` / `ink` テーマを優先し、ゲーム画面だけ極端に別配色にしない。
- 画面内テキスト・ボタンラベルはモバイル幅で折り返してもはみ出さないようにする。

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/game/constants.ts` | 新規 | 問題数、制限時間、フィードバック時間、苦手ガード件数などの定数 |
| `frontend/src/lib/game/types.ts` | 新規 | `GameMode`、question、answer、result、mode config の型 |
| `frontend/src/lib/game/modes.ts` | 新規 | 6 モードの表示名・説明・難易度・苦手モード判定 |
| `frontend/src/lib/game/play-state.ts` | 新規 | ゲーム進行、スコア、連続正解、回答時間、結果生成の純粋関数 |
| `frontend/src/lib/game/play-state.test.ts` | 新規 | 進行ロジック・ガード・結果集計のユニットテスト |
| `frontend/src/lib/game/mock-questions.ts` | 新規 | UI モック用の固定問題セット（正解情報はこのファイル内に閉じる） |
| `frontend/src/lib/stores/game.svelte.ts` | 新規 | `/game` → `/game/play` → `/game/result` 間のゲーム状態 store |
| `frontend/src/lib/components/game/GameModeCard.svelte` | 新規 | モードカード、苦手 5 問未満ガード表示、開始ボタン |
| `frontend/src/lib/components/game/GameProgressIndicator.svelte` | 新規 | 10 問の進捗インジケーター |
| `frontend/src/lib/components/game/GameTimerBar.svelte` | 新規 | 15 秒カウントダウン表示 |
| `frontend/src/lib/components/game/AnswerChoiceButton.svelte` | 新規 | 4 択ボタン、番号表示、選択状態、disabled 状態 |
| `frontend/src/lib/components/game/GameFeedbackPanel.svelte` | 新規 | 正解・不正解・時間切れフィードバック |
| `frontend/src/lib/components/game/GameResultSummary.svelte` | 新規 | スコア、正解数、正答率、最大連続正解数 |
| `frontend/src/lib/components/game/MissedAnswersList.svelte` | 新規 | 間違えた問題一覧 |
| `frontend/src/routes/(app)/game/+page.svelte` | 修正 | モード一覧、ログイン誘導、苦手 5 問未満ガード |
| `frontend/src/routes/(app)/game/+page.ts` | 新規 | `ssr = true`, `prerender = false` を明示 |
| `frontend/src/routes/(app)/game/play/+page.svelte` | 新規 | ゲームプレイ画面 |
| `frontend/src/routes/(app)/game/play/+page.ts` | 新規 | `ssr = false`, `prerender = false` を明示 |
| `frontend/src/routes/(app)/game/result/+page.svelte` | 新規 | 結果画面 |
| `frontend/src/routes/(app)/game/result/+page.ts` | 新規 | `ssr = false`, `prerender = false` を明示 |
| `docs/04_api.md` | 修正 | `questionSetId` 前提の game API 仕様へ整合修正 |
| `docs/05_progress.md` | 修正 | フェーズ6の該当タスクに本計画書リンクを追記し、実装完了時に完了へ更新 |
| `docs/plans/game-screens/plan.md` | 新規 | 本計画書 |

## API仕様（この機能で使う範囲のみ）

### エラーレスポンス共通形式

```json
{ "error": "メッセージ文字列" }
```

ステータスコード: 400 / 401 / 403 / 404 / 429 / 500 / 502 / 504

### GET `/game/questions`

| 項目 | 内容 |
|---|---|
| 認証 | 必須 |
| Query | `mode: GameMode` |
| 用途 | ゲーム開始時に 10 問と `questionSetId` を取得する |
| 今回の UI モック | 呼び出さない。型と画面設計だけ揃える |

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

重要:
- 正解フラグ・正解 elementId は返さない。
- `questionSetId` は必須。`POST /game/sessions` に渡す。
- 苦手モードで苦手元素が 5 件未満の場合は、Phase7 API で 400 または 403 の日本語エラーを返す方針を確定する。

### POST `/game/sessions`

| 項目 | 内容 |
|---|---|
| 認証 | 必須 |
| 用途 | 10 問終了後に回答を送信し、サーバー計算済み結果を取得する |
| 今回の UI モック | 呼び出さない。モック結果を store 内で生成する |

想定リクエスト:

```json
{
  "questionSetId": "cuid",
  "answers": [
    {
      "elementId": 1,
      "chosenElementId": 1,
      "answerTimeSec": 5
    }
  ]
}
```

時間切れの場合:

```json
{
  "elementId": 1,
  "chosenElementId": null,
  "answerTimeSec": 15
}
```

想定レスポンス:

```json
{
  "sessionId": "cuid",
  "correctCount": 8,
  "totalScore": 1250,
  "maxStreak": 5,
  "results": [
    {
      "elementId": 1,
      "isCorrect": true,
      "correctAnswer": "水素",
      "yourAnswer": "水素",
      "score": 125
    }
  ]
}
```

### GET `/weak`

| 項目 | 内容 |
|---|---|
| 認証 | 必須 |
| 用途 | 苦手モード開始可否（5 件以上）を判定する |
| 今回の UI モック | backend 未実装のため live fetch はしない。`gameStore` または定数の preview 値でガード表示を検証する |

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

1. **フェーズ6は frontend-only UI モックとして実装する**
   - 選択: game / weak API の live fetch は行わず、固定モック問題と `gameStore` で画面遷移を成立させる。
   - 根拠: backend game / weak は TODO かつ未 mount。フェーズ6の目的は UX 確認と API インターフェース確定であり、backend 実装はフェーズ7以降。

2. **API 仕様は `questionSetId` 前提へ更新する**
   - 選択: `GET /game/questions` レスポンスと `POST /game/sessions` リクエストに `questionSetId` を明記する。
   - 根拠: `docs/05_progress.md` の設計決定2、`docs/12_task_guide.md`、`schema.prisma` の `GameQuestionSet` と整合させるため。

3. **即時正誤フィードバックは UI モック限定で表現する**
   - 選択: `mock-questions.ts` の内部データにのみ正解情報を持たせ、UI モックでは回答直後に正誤を出す。
   - 根拠: 既存 API 方針では正解をクライアントに渡さないため、本番 API 連携では追加の回答チェック API またはフィードバック仕様の再確定が必要。計画書にリスクとして明記する。

4. **ゲーム状態は `gameStore` に集約する**
   - 選択: 選択中モード、問題セット、現在問、回答履歴、結果を `frontend/src/lib/stores/game.svelte.ts` に持たせる。
   - 根拠: `/game/play` と `/game/result` の route 間で状態を共有する必要がある。ページに状態を分散させると結果画面との整合が崩れやすい。

5. **結果画面の直アクセス・リロードは `/game` に戻す**
   - 選択: result が存在しない場合は `/game` へ遷移し、必要なら toast で「ゲームを開始してください」と表示する。
   - 根拠: 認証情報やゲーム結果を localStorage に保存しない制約を守るため。

6. **苦手 5 問未満ガードは純粋関数で判定する**
   - 選択: `canStartGameMode(mode, weakCount)` と `getGameModeGuardMessage(mode, weakCount)` を `modes.ts` に定義する。
   - 根拠: `/game` の表示、開始ボタン disabled、将来 API 連携後の判定を同じロジックで扱える。

7. **タイマーは play page で制御し、回答後は停止する**
   - 選択: 問題表示時に 15 秒カウントダウンを開始し、選択・時間切れ・画面離脱で停止する。
   - 根拠: 多重 timer による二重回答・次問スキップを防ぐため。

8. **1〜4キーは回答可能状態でのみ有効にする**
   - 選択: フィードバック表示中、結果遷移中、ボタン disabled 中はキー入力を無視する。
   - 根拠: キーボード連打で複数回答が記録される事故を防ぐため。

9. **回答時間は一度だけ計算して再利用する**
   - 選択: 回答確定時に `answerTimeSec` を計算し、回答履歴・結果計算・将来 API 送信に同じ値を渡す。
   - 根拠: 正規化値を一度だけ計算して再利用する規約に合わせる。

10. **A11Y の状態通知を UI コンポーネント単位で設計する**
    - 選択: 進捗・タイマー・フィードバック・結果に適切な `aria-live`、`aria-current`、説明文を付ける。
    - 根拠: ゲーム UI は視覚変化が多く、スクリーンリーダーとキーボード利用者に状態変化を伝える必要がある。

11. **DB 負荷は Phase7 API 側で制御し、UI から多重開始を防ぐ**
    - 選択: フェーズ6では DB に触らない。将来 API 連携時は開始ボタンを loading / disabled にし、二重 `GET /game/questions` を防ぐ。
    - 根拠: `GameQuestionSet` は 1 開始ごとに DB 行を作るため、多重クリック対策が必要。

12. **ゲーム UI はカードを過度にネストしない**
    - 選択: ページは full-width section と単体カードの組み合わせに留め、カード内カードを避ける。
    - 根拠: 既存デザインのシンプルさと frontend guidance に合わせる。

## 公開インターフェース案

```ts
// frontend/src/lib/game/constants.ts
export const GAME_QUESTION_COUNT = 10;
export const GAME_TIME_LIMIT_SEC = 15;
export const GAME_FEEDBACK_DELAY_MS = 1500;
export const MIN_WEAK_ELEMENTS_FOR_GAME = 5;
```

```ts
// frontend/src/lib/game/types.ts
export type GameMode =
  | 'SYMBOL_TO_NAME_LV1'
  | 'SYMBOL_TO_NAME_LV2'
  | 'NAME_TO_SYMBOL_LV1'
  | 'NAME_TO_SYMBOL_LV2'
  | 'WEAK_SYMBOL_TO_NAME'
  | 'WEAK_NAME_TO_SYMBOL';

export type GameChoice = {
  elementId: number;
  text: string;
};

export type GameQuestion = {
  elementId: number;
  question: string;
  choices: GameChoice[];
};

export type GameQuestionSet = {
  questionSetId: string;
  mode: GameMode;
  questions: GameQuestion[];
};

export type GameAnswerInput = {
  elementId: number;
  chosenElementId: number | null;
  answerTimeSec: number;
};

export type GameResultItem = {
  elementId: number;
  isCorrect: boolean;
  correctAnswer: string;
  yourAnswer: string;
  score: number;
};

export type GameSessionResult = {
  sessionId: string;
  correctCount: number;
  totalScore: number;
  maxStreak: number;
  results: GameResultItem[];
};
```

```ts
// frontend/src/lib/game/modes.ts
export type GameModeConfig = {
  mode: GameMode;
  title: string;
  description: string;
  formatLabel: string;
  difficultyLabel: string;
  rangeLabel: string;
  requiresWeakElements: boolean;
};

export const GAME_MODE_CONFIGS: readonly GameModeConfig[];

export function getGameModeConfig(mode: GameMode): GameModeConfig;
export function isWeakGameMode(mode: GameMode): boolean;
export function canStartGameMode(mode: GameMode, weakCount: number | null): boolean;
export function getGameModeGuardMessage(mode: GameMode, weakCount: number | null): string | null;
```

```ts
// frontend/src/lib/game/play-state.ts
export function calculateAnswerTimeSec(startedAtMs: number, answeredAtMs: number): number;
export function calculateMaxStreak(results: readonly { isCorrect: boolean }[]): number;
export function calculateCorrectCount(results: readonly { isCorrect: boolean }[]): number;
export function calculateAccuracy(correctCount: number, totalCount: number): number;
```

```ts
// frontend/src/lib/stores/game.svelte.ts
export const gameStore: {
  readonly mode: GameMode | null;
  readonly questionSet: GameQuestionSet | null;
  readonly currentQuestionIndex: number;
  readonly answers: readonly GameAnswerInput[];
  readonly result: GameSessionResult | null;
  readonly hasActiveGame: boolean;
  readonly hasResult: boolean;

  startMockGame(mode: GameMode): void;
  answerCurrentQuestion(chosenElementId: number | null, answerTimeSec: number): void;
  moveToNextQuestion(): boolean;
  finishMockGame(): GameSessionResult;
  reset(): void;
};
```

## タスクリスト（進捗管理）

| タスクID | 内容 | ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | ゲーム API 仕様の整合修正 | `docs/04_api.md` | `GET /game/questions` に `questionSetId`、`POST /game/sessions` に `questionSetId` リクエストが明記される | 高 |
| T2 | ゲーム定数・型定義を作成 | `frontend/src/lib/game/constants.ts`, `frontend/src/lib/game/types.ts` | 6 種の `GameMode`、問題・回答・結果型が定義される | 高 |
| T3 | モード設定と苦手ガード判定を実装 | `frontend/src/lib/game/modes.ts` | 6 モード表示情報と苦手 5 問未満判定が一元化される | 高 |
| T4 | ゲーム進行の純粋関数とテストを作成 | `frontend/src/lib/game/play-state.ts`, `frontend/src/lib/game/play-state.test.ts` | 正解数、正答率、最大連続正解、回答時間のテストが通る | 高 |
| T5 | UI モック用問題セットを作成 | `frontend/src/lib/game/mock-questions.ts` | 10 問・4 択・6 モード対応の固定問題が生成できる | 高 |
| T6 | `gameStore` を実装 | `frontend/src/lib/stores/game.svelte.ts` | 開始、回答、次問、結果生成、reset が動作する | 高 |
| T7 | モード選択コンポーネントを実装 | `frontend/src/lib/components/game/GameModeCard.svelte` | 通常モード開始、苦手ガード、未ログイン誘導が表示できる | 高 |
| T8 | プレイ画面用コンポーネントを実装 | `GameProgressIndicator.svelte`, `GameTimerBar.svelte`, `AnswerChoiceButton.svelte`, `GameFeedbackPanel.svelte` | インジケーター、15 秒タイマー、4 択、フィードバックが表示できる | 高 |
| T9 | 結果画面用コンポーネントを実装 | `GameResultSummary.svelte`, `MissedAnswersList.svelte` | スコア、連続正解、間違え一覧、CTA が表示できる | 高 |
| T10 | `/game` を実装 | `frontend/src/routes/(app)/game/+page.svelte`, `frontend/src/routes/(app)/game/+page.ts` | モード一覧、苦手 5 問未満ガード、ログイン状態別 CTA が表示される | 高 |
| T11 | `/game/play` を実装 | `frontend/src/routes/(app)/game/play/+page.svelte`, `frontend/src/routes/(app)/game/play/+page.ts` | 10 問進行、15 秒タイマー、1〜4 キー操作、時間切れ処理が動作する | 高 |
| T12 | `/game/result` を実装 | `frontend/src/routes/(app)/game/result/+page.svelte`, `frontend/src/routes/(app)/game/result/+page.ts` | 結果表示、「もう一度」「ホームへ」、直アクセス時の戻しが動作する | 高 |
| T13 | frontend 品質チェック | `frontend/` | `npm run lint`, `npm run format`, `npm run check`, `npm run test:run` が通る | 高 |
| T14 | 手動確認 | ブラウザ | `/game` → `/game/play` → `/game/result`、PC/モバイル、1〜4 キー、時間切れ、苦手ガードを確認する | 高 |
| T15 | 進捗・計画書更新 | `docs/05_progress.md`, `docs/plans/game-screens/plan.md` | フェーズ6該当タスクを完了にし、実装完了セクションを追記する | 中 |

- [ ] T1: ゲーム API 仕様の整合修正
- [ ] T2: ゲーム定数・型定義を作成
- [ ] T3: モード設定と苦手ガード判定を実装
- [ ] T4: ゲーム進行の純粋関数とテストを作成
- [ ] T5: UI モック用問題セットを作成
- [ ] T6: `gameStore` を実装
- [ ] T7: モード選択コンポーネントを実装
- [ ] T8: プレイ画面用コンポーネントを実装
- [ ] T9: 結果画面用コンポーネントを実装
- [ ] T10: `/game` を実装
- [ ] T11: `/game/play` を実装
- [ ] T12: `/game/result` を実装
- [ ] T13: frontend 品質チェック
- [ ] T14: 手動確認
- [ ] T15: 進捗・計画書更新

## 技術的注意点

- `GAME_TIME_LIMIT_SEC`, `GAME_FEEDBACK_DELAY_MS`, `MIN_WEAK_ELEMENTS_FOR_GAME` は直書きしない。
- 回答確定時は `chosenElementId` と `answerTimeSec` を一度だけ作り、store に渡す。
- 時間切れは `chosenElementId: null` として扱い、結果では「未回答」と表示する。
- 1〜4 キーは `event.isComposing` を考慮し、日本語入力中は無視する。
- `<svelte:window onkeydown={handleKeydown} />` を使う場合も、回答可能状態でのみ処理する。
- `setTimeout` / `setInterval` を使う場合は `$effect` cleanup または `onDestroy` で必ず解除する。
- `/game/play` と `/game/result` は SSR で store 状態が取れないため `ssr = false` を明示する。
- API 連携に切り替える際は `API_BASE_URL` と `parseErrorResponse` を使い、`response.json()` を先に呼ばない。
- API エラー時は `ApiError.message` を優先し、バックエンドの具体的な日本語メッセージを固定文言で上書きしない。
- `authStore.isInitializing` 中はログイン判定を確定させず、ちらつきを避ける。
- 画面上のエラー・ガード文言は日本語で統一する。
- 苦手モードの disabled 理由はボタン付近に表示し、色だけに依存しない。
- 結果画面の間違え一覧は空の場合「全問正解です」と表示する。
- 「もう一度」は直前の mode で再開始する。mode が失われている場合は `/game` へ戻す。
- UI モックの正解情報は `mock-questions.ts` から外に公開しない。公開 `GameQuestion` 型に `correctElementId` を含めない。

## A11Y要件

| 対象 | 要件 |
|---|---|
| モードカード | カード全体ではなく開始ボタンを明確な操作対象にする。disabled の理由をボタン近くにテキストで表示する |
| 進捗インジケーター | 現在問に `aria-current="step"` 相当の意味付けを行い、「3問目 / 10問中」のテキストを併記する |
| タイマー | 残り秒数を視覚バーだけに依存しない。残り 5 秒以下など重要変化のみ `aria-live` で通知し、毎秒読み上げ続けない |
| 4択ボタン | `1. 水素` のように番号と選択肢をラベルに含める。キーボード操作とクリック操作の結果を同じ処理にする |
| フィードバック | 正解・不正解・時間切れを `aria-live="polite"` で通知する。色だけでなくテキストで状態を示す |
| focus 管理 | 問題が切り替わったら見出しまたは選択肢領域へ自然に戻る。結果画面遷移時はページ見出しが最初に読める構造にする |
| 動き | タイマーやフィードバックに過剰なアニメーションを使わない。必要な場合は `prefers-reduced-motion` に配慮する |

## DB整合性・負荷に関する注意

- フェーズ6では DB 読み書きを行わないため、DB 負荷は発生しない。
- Phase7 の `GET /game/questions` は 1 ゲーム開始につき 1 件の `GameQuestionSet` を作成する。フロント側は開始ボタンの多重クリックを防ぐ必要がある。
- Phase7 の `POST /game/sessions` は `questionSetId` の userId・有効期限・未使用状態を検証し、完了後に `GameQuestionSet` を削除する。
- 苦手モードの 5 問未満判定はサーバー側でも必ず行う。フロントの disabled は UX 補助であり、セキュリティ境界にしない。
- `GET /weak` で苦手件数だけが必要な場合、将来は件数用 API または軽量レスポンスを検討する。ただし現時点では API 未実装のため、本計画では追加 API を作らない。
- 問題セットをリロードごとに作成する実装にすると未使用 `GameQuestionSet` が増えるため、Phase7 では期限切れ削除方針も検討する。

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| `canStartGameMode` 通常モード | weakCount に関係なく true |
| `canStartGameMode` 苦手モード・weakCount 4 | false |
| `canStartGameMode` 苦手モード・weakCount 5 | true |
| `getGameModeGuardMessage` 苦手 4 件 | 「苦手元素が5件以上必要です」系の日本語文言 |
| 回答時間計算 | 0〜15 秒の範囲に丸められる |
| 最大連続正解数 | 正誤配列から最大 streak が返る |
| 正答率計算 | `correctCount / totalCount` が percentage で返る |
| `gameStore.startMockGame` | mode と 10 問の questionSet が設定される |
| `gameStore.answerCurrentQuestion` | 同じ問題に二重回答できない |
| `gameStore.finishMockGame` | correctCount, totalScore, maxStreak, results が生成される |
| `/game` 未ログイン | モード開始ではなくログイン誘導が表示される |
| `/game` 苦手 5 問未満 | 苦手モードカードの開始ボタンが disabled |
| `/game/play` 1〜4 キー | 対応する選択肢が回答される |
| `/game/play` 時間切れ | 未回答として記録され、フィードバック後に次問へ進む |
| `/game/play` 回答後の連打 | 2 回目以降の回答は記録されない |
| `/game/result` 結果なし直アクセス | `/game` へ戻る |
| `/game/result` 間違えなし | 間違え一覧の代わりに全問正解メッセージ |
| 品質チェック | lint / format / check / test:run が通る |
| 手動確認 | PC・モバイルで表示崩れ、テキストはみ出し、操作不能がない |
| A11Y 手動確認 | Tab 操作、1〜4 キー、スクリーンリーダー向け状態テキストが成立する |

## 実装リスクと回避策

| リスク | 影響 | 回避策 |
|---|---|---|
| 即時正誤フィードバックと「正解を返さない API 方針」が衝突する | Phase7 で UI と API が噛み合わない | 本計画で明記し、Phase7 で回答チェック API 追加またはフィードバック仕様変更を決める |
| backend game / weak が未実装 | live fetch 前提にすると画面が動かない | フェーズ6は UI モックとして固定問題と preview weak count で成立させる |
| タイマーが多重起動する | 二重回答・自動遷移バグ | タイマー ID を管理し、回答・時間切れ・画面離脱で cleanup する |
| キーボード連打で複数回答される | 回答履歴が壊れる | 回答可能状態を `canAnswer` で一元管理し、store 側でも二重回答を弾く |
| route 直アクセスで store が空 | result / play 画面がクラッシュする | `hasActiveGame` / `hasResult` を確認し、不足時は `/game` へ戻す |
| 苦手件数判定ロジックが複数箇所に分散する | 表示と開始可否がズレる | `modes.ts` の `canStartGameMode` と `getGameModeGuardMessage` に集約する |
| モック正解情報が本番 API クライアントに混入する | 不正対策方針に反する | `mock-questions.ts` に限定し、公開 `GameQuestion` 型には正解フィールドを含めない |
| API 仕様書と実装計画がズレる | Phase7 実装者が迷う | T1 で `docs/04_api.md` を `questionSetId` 前提に更新する |
| A11Y が後回しになる | キーボード・支援技術利用者がゲームを完走できない | A11Y 要件と手動確認を T14 とテストケースに含める |

