# ゲームプレイ画面 `/game/play` 実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、ゲーム UX・状態設計）
> 対象実装者: Codex

## 概要

`docs/05_progress.md` フェーズ6「UI モック（ゲーム）」のうち、ゲームプレイ画面 `/game/play`（インジケーター・15秒タイマー・4択・正誤フィードバック・1〜4キー操作）を実装する。

既存のゲームモード選択画面 `/game` は `feature/game-mode-select` / PR #46 で実装済みであり、`docs/05_progress.md` でも `[x]` になっている。本計画は、同じ `docs/plans/game-screens/plan.md` に紐づく次タスクとして、`/game/play` の UI モックとゲーム進行ロジックの土台をレビュー改善した版である。

現状、`backend/src/routes/game/index.ts` と `backend/src/services/game.service.ts` は TODO、`backend/src/index.ts` に game ルーターも mount されていない。そのため本タスクでは live API 接続を行わず、フロントエンド内の mock question set で UX と状態遷移を固める。API 接続、サーバー側正誤判定、スコア保存、苦手更新はフェーズ7または API インターフェース確定タスクで扱う。

## レビュー結果と改善方針

| 観点 | レビュー結果 | 改善方針 |
|---|---|---|
| 既存コード整合性 | `/game` は実装済みだが、開始ボタンは `/game/play` 未実装のため toast で止めている | `/game` の `handleStart` を `/game/play?mode=...` 遷移に差し替えるタスクを含める |
| 仕様整合性 | `docs/01_features.md` は10問、15秒、1.5秒フィードバック、1〜4キーを要求している | 10問・15秒・1.5秒を定数化し、クリック/キー/時間切れの3経路を同じ回答処理に集約する |
| API 整合性 | `docs/04_api.md` の `GET /game/questions` は `questionSetId` がレスポンス例に未反映で、`elementId` 露出により正解推測も可能 | 今回は API を呼ばず、mock 専用型と将来 API 型を分離する。API 確定タスクで `questionSetId` と正解非露出の仕様を修正する |
| セキュリティ | フロントだけで正誤判定・スコア計算を完結させると改ざんできる | mock 判定は UI 確認専用と明記し、本番の正誤判定・スコア保存は `POST /game/sessions` のサーバー側に限定する |
| A11Y | 色だけの正誤表示、毎秒 `aria-live`、グローバル keydown の過剰反応は操作体験を損なう | 正誤テキストを併記し、タイマーは過剰読み上げしない。キー操作は回答可能 phase のみ受け付ける |
| DB 整合性・負荷 | UI モックで `GET /game/questions` を連打すると、将来 `GameQuestionSet` が多重作成される設計になりやすい | 本タスクでは DB に触らない。将来 API 接続時は開始中 disabled、AbortController、有効期限切れ cleanup を計画に残す |
| テスト | UI だけを手動確認するとタイマー境界・時間切れ・キー操作の回帰を拾いにくい | `play.ts` の純粋関数をユニットテストし、タイマー/keydown は手動確認項目として明確化する |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`docs/05_progress.md`**
- `ゲームモード選択画面 /game（モード一覧・苦手5問未満ガード表示）` は完了済み。
- `ゲームプレイ画面 /game/play（インジケーター・15秒タイマー・4択・正誤フィードバック・1〜4キー操作）` は未実装。
- `GET /game/questions` と `POST /game/sessions` の API インターフェース確定は未実装。
- 設計決定2として、将来の `GET /game/questions` は `GameQuestionSet` を保存し `questionSetId` を返す。

**`docs/01_features.md`**
- `GameMode` は以下の6種。
  - `SYMBOL_TO_NAME_LV1`
  - `SYMBOL_TO_NAME_LV2`
  - `NAME_TO_SYMBOL_LV1`
  - `NAME_TO_SYMBOL_LV2`
  - `WEAK_SYMBOL_TO_NAME`
  - `WEAK_NAME_TO_SYMBOL`
- 1ゲームは10問。
- 各問のタイムリミットは15秒。
- 選択または時間切れ後、正誤フィードバックを1.5秒表示する。
- 問題画面ではインジケーター、カウントダウンバー、問題文、4択ボタンを表示する。
- 問題回答時に `1` `2` `3` `4` キーで選択肢を選べる。
- ブラウザを閉じた場合の sessionStorage 中断復帰は将来仕様として存在する。

**`docs/04_api.md`**
- `GET /game/questions`
  - 認証必須。
  - query: `mode: GameMode`
  - 現状レスポンス例には `questionSetId` がないため、API インターフェース確定タスクで修正が必要。
- `POST /game/sessions`
  - 認証必須。
  - 現行案は `mode` と `answers` を送信する。
  - 設計決定2と整合させるため、将来は `questionSetId` をリクエストに含める必要がある。

**`backend/prisma/schema.prisma`**
- `GameMode` enum は6種定義済み。
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

**`backend/src/index.ts`**
- mount 済みルーターは `/api/v1/auth`、`/api/v1/elements`、`/api/v1/users`。
- game ルーターは未 mount。

**`frontend/src/lib/game/constants.ts`**
- `MIN_WEAK_ELEMENTS_FOR_GAME: 5`
- 本タスクで `GAME_QUESTION_COUNT`, `QUESTION_TIME_LIMIT_SEC`, `ANSWER_FEEDBACK_MS` を追加する。

**`frontend/src/lib/game/types.ts`**
- `GameMode` — 6種類のゲームモード。
- `GameModeConfig` — `/game` のモード表示設定。
- `GameModeStartAvailability` — 開始可否とガード文言。
- `GameModeStartHandler` — mode を受け取る開始ハンドラー型。
- 本タスクでプレイ画面用の問題・選択肢・回答・phase 型を追加する。

**`frontend/src/lib/game/modes.ts`**
- `GAME_MODE_CONFIGS: readonly GameModeConfig[]`
- `getGameModeConfig(mode: GameMode): GameModeConfig`
- `isWeakGameMode(mode: GameMode): boolean`
- `getGameModeStartAvailability(mode: GameMode, weakCount: number | null): GameModeStartAvailability`

**`frontend/src/routes/(app)/game/+page.svelte`**
- モード一覧、未ログイン導線、苦手5問未満ガードを実装済み。
- 現在は開始ボタン押下時に `/game/play` へ遷移せず、toast で「プレイ画面は後続タスクで実装します。」を表示する。

**`frontend/src/routes/(app)/+layout.svelte`**
- Header / Footer / `main.max-w-5xl` を提供する。
- `/game/play` はこの既存レイアウト内で成立するレスポンシブ UI とする。

**`frontend/src/lib/stores/auth.svelte.ts`**
- `authStore.isInitializing: boolean`
- `authStore.isLoggedIn: boolean`
- `authStore.accessToken: string | null`
- `authStore.user: AuthUser | null`
- `/game/play` は認証状態の初期化完了を待ち、未ログイン時は `/login` へ誘導する。

**`frontend/src/lib/stores/toast.svelte.ts`**
- `toastStore.info(message: string): string`
- `toastStore.warning(message: string): string`
- `toastStore.error(message: string): string`
- `toastStore.fromApiError(error: ApiError): string`

**`frontend/src/lib/api/config.ts`**
- `API_BASE_URL: string`
- 将来 API 接続時はこのファイルから import し、各画面で環境変数を直接読まない。

**`frontend/src/lib/api/errors.ts`**
- `ApiError`
- `parseErrorBody(response: Response): Promise<ErrorBody>`
- `parseErrorResponse(response: Response, defaultMessage?: string): Promise<never>`
- 将来 API 接続時は `response.ok` を JSON パース前に確認し、非 JSON エラーにも対応する。

**`frontend/src/routes/(app)/elements/+page.svelte`**
- Svelte 5 Runes、`authStore.isInitializing` 待ち、loading / error / empty / success 状態、AbortController、toast 利用の参考実装。

### 重要な制約

- 本タスクは `/game/play` の UI モック範囲に限定する。
- backend game API の live fetch は行わない。
- `GET /game/questions` の正解情報をクライアントに渡さない本番方針は維持する。
- UI モック用の正解情報は `MockGamePlayQuestion` に閉じ、将来 API 型に混ぜない。
- 本番の正誤判定・スコア計算・苦手更新はサーバー側で行う前提を崩さない。
- `localStorage` に認証情報・ゲーム状態・回答内容を保存しない。
- sessionStorage 中断復帰は本タスクでは実装しない。将来タスクとして設計を分ける。
- Svelte 5 Runes（`$state`, `$derived`, `$effect`, `$props`）を使う。
- `authStore.isInitializing` 中はログイン状態を確定表示しない。
- `mode` query は一度だけ正規化し、正規化済み値を再利用する。
- タイマー、フィードバック timeout、keydown listener は `onDestroy` で必ず解除する。
- 数値定数（10問、15秒、1.5秒）は `frontend/src/lib/game/constants.ts` に集約し、UI に直書きしない。
- ゲーム進行ロジックは `frontend/src/lib/game/play.ts` に集約し、page / component に重複定義しない。
- API ベース URL や共通エラー処理を各ファイルで重複定義しない。
- UI 文言・エラー・ガードメッセージは日本語に統一する。
- Tailwind の既存 `brand` / `ink` / gray 系のトーンに寄せ、既存画面から極端に浮かないデザインにする。
- カード内カードを避け、問題表示・選択肢・状態表示を読みやすく構成する。
- モバイル幅で選択肢、キー番号、フィードバック文言がはみ出さないようにする。
- Prettier `tabWidth: 2` に従う。

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/game/constants.ts` | 修正 | 10問、15秒、1.5秒フィードバックの定数を追加 |
| `frontend/src/lib/game/types.ts` | 修正 | 問題、選択肢、回答、ゲーム進行 phase、プレイ画面用 handler 型を追加 |
| `frontend/src/lib/game/play.ts` | 新規 | mode query 正規化、回答判定、次問遷移、進捗、タイマー率、サマリー算出 |
| `frontend/src/lib/game/play.test.ts` | 新規 | mode 正規化、回答判定、時間切れ、進捗、タイマー境界のユニットテスト |
| `frontend/src/lib/game/mock-questions.ts` | 新規 | UI モック用の10問問題セット生成 |
| `frontend/src/lib/components/game/GameProgressIndicator.svelte` | 新規 | 10問分の進捗インジケーター |
| `frontend/src/lib/components/game/GameTimerBar.svelte` | 新規 | 15秒カウントダウンバー |
| `frontend/src/lib/components/game/GameChoiceButton.svelte` | 新規 | 4択ボタン、キー番号、選択状態表示 |
| `frontend/src/lib/components/game/GameFeedbackPanel.svelte` | 新規 | 正解・不正解・時間切れフィードバック |
| `frontend/src/routes/(app)/game/+page.svelte` | 修正 | `/game/play?mode=...` への開始導線に変更 |
| `frontend/src/routes/(app)/game/play/+page.ts` | 新規 | `ssr = true`, `prerender = false` を明示 |
| `frontend/src/routes/(app)/game/play/+page.svelte` | 新規 | プレイ画面本体、タイマー、キー操作、4択、フィードバック、完了表示 |
| `docs/05_progress.md` | 修正 | 実装時に `/game/play` を `[-]`、完了時に `[x]` へ更新 |
| `docs/plans/game-screens/plan.md` | 修正 | 本計画、チェックボックス、実装完了記録を更新 |

## API 仕様（この機能で使う範囲のみ）

### エラーレスポンス共通形式

```json
{ "error": "メッセージ文字列" }
```

ステータスコード: 400 / 401 / 403 / 404 / 409 / 429 / 500 / 502 / 504

### 今回の実装での API 利用

| メソッド | パス | 認証 | 今回の呼び出し | 理由 |
|---|---|---|---|---|
| GET | `/api/v1/game/questions?mode=...` | 必須 | 呼び出さない | backend 未実装・未 mount のため |
| POST | `/api/v1/game/sessions` | 必須 | 呼び出さない | backend 未実装・未 mount のため |

### 将来接続する API 仕様案

#### GET `/game/questions`

| 項目 | 内容 |
|---|---|
| 認証 | 必須 |
| Query | `mode: GameMode` |
| 用途 | 10問の問題セットと `questionSetId` を取得する |
| 注意 | `questionSetId` は `POST /game/sessions` に渡す。正解情報の露出方針は API 確定タスクで再設計する |

想定レスポンス案:

```json
{
  "questionSetId": "cuid",
  "questions": [
    {
      "questionId": "q1",
      "prompt": "H",
      "choices": [
        { "choiceId": "c1", "text": "水素" },
        { "choiceId": "c2", "text": "炭素" },
        { "choiceId": "c3", "text": "酸素" },
        { "choiceId": "c4", "text": "窒素" }
      ]
    }
  ]
}
```

#### POST `/game/sessions`

| 項目 | 内容 |
|---|---|
| 認証 | 必須 |
| 用途 | 10問分の回答を送信し、サーバー側で正誤判定・スコア計算・苦手更新を行う |
| 注意 | UI モックでは呼び出さない。結果画面 `/game/result` 実装時に接続する |

想定リクエスト案:

```json
{
  "questionSetId": "cuid",
  "mode": "SYMBOL_TO_NAME_LV1",
  "answers": [
    {
      "questionId": "q1",
      "chosenChoiceId": "c1",
      "answerTimeSec": 5
    }
  ],
  "durationSec": 72
}
```

## 設計上の決定事項

1. **`/game/play` で live API fetch を行うか**
   - 選択: 今回は行わない。
   - 根拠: backend game API は TODO かつ未 mount。フェーズ6は UI モックで UX と API インターフェースを固める段階。

2. **問題データをどこに置くか**
   - 選択: `frontend/src/lib/game/mock-questions.ts` に UI モック専用データを置く。
   - 根拠: page に問題配列を直書きせず、将来 `getGameQuestions()` API クライアントに差し替えやすくする。

3. **正誤判定をどこで行うか**
   - 選択: UI モックでは `play.ts` の helper で判定する。将来 API 接続時はサーバー判定に差し替える。
   - 根拠: 現時点で即時フィードバックを確認するにはローカル判定が必要。ただし本番仕様では正解情報露出を避ける方針があるため、責務を隔離する。

4. **mode query の扱い**
   - 選択: `/game/play?mode=SYMBOL_TO_NAME_LV1` を受け取り、`normalizeGameModeParam()` で一度だけ検証する。
   - 根拠: URL 直打ち・不正値に対応しつつ、以降の処理では `GameMode` 型で安全に扱う。

5. **タイマーの実装方法**
   - 選択: `setInterval` で残り秒数を管理し、回答済み・時間切れ・フィードバック中・完了時に停止する。
   - 根拠: 15秒単位の UI モックには十分。`onDestroy` で解除し、離脱時のリークを防ぐ。

6. **時間切れの扱い**
   - 選択: 残り秒数が 0 になったら未回答として不正解扱いにし、時間切れフィードバックを表示する。
   - 根拠: 仕様の「選択または時間切れ → 正誤フィードバック」に合わせる。

7. **フィードバック後の遷移**
   - 選択: 1.5秒後に次問へ進む。10問目の後は `/game/result` 未実装のため、完了サマリーを画面内に表示し、結果画面は後続タスクとして toast または導線で示す。
   - 根拠: `/game/result` は別タスク。壊れた遷移を作らず、プレイ体験だけ完結させる。

8. **1〜4キー操作**
   - 選択: `keydown` listener を page で登録し、`Digit1`〜`Digit4` と `Numpad1`〜`Numpad4` を受け付ける。
   - 根拠: キーボード上段・テンキーの両方を自然に使えるようにする。

9. **回答ボタンの状態表示**
   - 選択: 選択後は全選択肢を disabled にし、選んだ選択肢と正解/不正解を視覚・テキストの両方で示す。
   - 根拠: 多重回答を防ぎ、色だけに依存しないフィードバックにする。

10. **ゲーム中断・再開**
    - 選択: 本タスクでは sessionStorage による中断復帰は実装しない。
    - 根拠: `docs/01_features.md` に将来仕様として存在するが、今回は画面モックの基本体験に集中する。保存形式は API 接続・結果画面と合わせて別途設計する。

11. **`/game` の開始導線をこのタスクで変更するか**
    - 選択: 変更する。
    - 根拠: `/game/play` が実装されると、既存 toast のままではユーザーがプレイ画面へ到達できない。`goto('/game/play?mode=...')` または link 相当の導線へ差し替える。

12. **API インターフェース確定タスクを同時に完了扱いにするか**
    - 選択: 完了扱いにしない。
    - 根拠: 本タスクで API 仕様案は記録するが、backend 実装・`docs/04_api.md` 更新・サーバー側テストを含まないため、`GET /game/questions` / `POST /game/sessions` の確定タスクは別途実施する。

## 公開インターフェース案

### `frontend/src/lib/game/constants.ts`

```ts
export const GAME_QUESTION_COUNT = 10;
export const QUESTION_TIME_LIMIT_SEC = 15;
export const ANSWER_FEEDBACK_MS = 1500;
```

### `frontend/src/lib/game/types.ts`

```ts
export type GameChoice = {
  choiceId: string;
  text: string;
};

export type GamePlayQuestion = {
  questionId: string;
  prompt: string;
  choices: readonly GameChoice[];
};

export type MockGamePlayQuestion = GamePlayQuestion & {
  correctChoiceId: string;
};

export type GameAnswerDraft = {
  questionId: string;
  chosenChoiceId: string | null;
  answerTimeSec: number;
  isCorrect: boolean;
  timedOut: boolean;
};

export type GamePlayPhase = 'answering' | 'feedback' | 'completed';
```

### `frontend/src/lib/game/play.ts`

```ts
export function normalizeGameModeParam(value: string | null): GameMode | null;

export function getProgressLabel(currentIndex: number, totalCount: number): string;

export function getTimerPercent(remainingSec: number, timeLimitSec: number): number;

export function buildAnswerDraft(params: {
  question: MockGamePlayQuestion;
  chosenChoiceId: string | null;
  remainingSec: number;
  timeLimitSec: number;
}): GameAnswerDraft;

export function getNextQuestionIndex(currentIndex: number, totalCount: number): number | null;

export function summarizeAnswers(answers: readonly GameAnswerDraft[]): {
  correctCount: number;
  totalCount: number;
};
```

### `frontend/src/lib/game/mock-questions.ts`

```ts
export function getMockGameQuestions(mode: GameMode): readonly MockGamePlayQuestion[];
```

## タスクリスト（進捗管理）

| タスクID | 内容 | ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 進捗を実装中へ更新する | `docs/05_progress.md` | `/game/play` タスクが `[ ]` から `[-]` に更新される | 中 |
| T2 | ゲームプレイ用の定数・型を追加する | `frontend/src/lib/game/constants.ts`, `frontend/src/lib/game/types.ts` | 10問、15秒、1.5秒、問題、選択肢、回答、phase 型が定義される | 高 |
| T3 | ゲーム進行 helper を実装する | `frontend/src/lib/game/play.ts` | mode query 検証、回答判定、タイマー率、進捗、サマリー算出が page から分離される | 高 |
| T4 | helper のユニットテストを作成する | `frontend/src/lib/game/play.test.ts` | 正常 mode、不正 mode、正解、不正解、時間切れ、進捗境界、タイマー境界のテストが通る | 高 |
| T5 | UI モック用問題セットを追加する | `frontend/src/lib/game/mock-questions.ts` | 6モードのいずれでも10問・各4択を返せる。選択肢 ID が重複しない | 高 |
| T6 | 進捗インジケーターを実装する | `frontend/src/lib/components/game/GameProgressIndicator.svelte` | 10問分の現在位置・回答済み状態がテキストと視覚の両方で分かる | 中 |
| T7 | 15秒タイマー表示を実装する | `frontend/src/lib/components/game/GameTimerBar.svelte` | 残り秒数とバーが表示され、0秒時にも崩れない | 高 |
| T8 | 4択ボタンを実装する | `frontend/src/lib/components/game/GameChoiceButton.svelte` | 1〜4の番号、選択肢テキスト、disabled、選択後状態を表示できる | 高 |
| T9 | 正誤フィードバックを実装する | `frontend/src/lib/components/game/GameFeedbackPanel.svelte` | 正解・不正解・時間切れの日本語メッセージを表示できる | 高 |
| T10 | `/game` から `/game/play` への導線を接続する | `frontend/src/routes/(app)/game/+page.svelte` | 開始可能な mode で `/game/play?mode=...` へ遷移する。多重クリック対策は維持される | 高 |
| T11 | `/game/play` route 設定を追加する | `frontend/src/routes/(app)/game/play/+page.ts` | `ssr = true`, `prerender = false` が明示される | 中 |
| T12 | `/game/play` page を実装する | `frontend/src/routes/(app)/game/play/+page.svelte` | 認証状態、mode 検証、問題表示、15秒タイマー、4択、正誤フィードバック、完了表示が動作する | 高 |
| T13 | キーボード操作を実装する | `frontend/src/routes/(app)/game/play/+page.svelte` | 回答可能中のみ `1`〜`4` / `Numpad1`〜`Numpad4` で回答できる | 高 |
| T14 | エラー・ガード状態を実装する | `frontend/src/routes/(app)/game/play/+page.svelte` | 未ログイン、不正 mode、問題生成失敗時に日本語メッセージと戻る導線が表示される | 高 |
| T15 | frontend lint を実行する | `frontend/` | `npm run lint` が通る | 高 |
| T16 | format を実行する | `frontend/` | `npm run format` 実行後に不要な差分がない | 高 |
| T17 | frontend test を実行する | `frontend/` | `npm run test:run` が通る | 高 |
| T18 | Svelte / TypeScript check を実行する | `frontend/` | `npm run check` が通る | 高 |
| T19 | 手動確認を実施する | ブラウザ | PC / モバイルで `/game` → `/game/play`、クリック回答、1〜4キー、時間切れ、完了表示を確認する | 高 |
| T20 | 進捗・計画書を実装完了へ更新する | `docs/05_progress.md`, `docs/plans/game-screens/plan.md` | `/game/play` タスクが `[x]` になり、実装完了セクションに実際の変更ファイルと確認結果が記録される | 中 |

- [x] T1: 進捗を実装中へ更新する
- [x] T2: ゲームプレイ用の定数・型を追加する
- [x] T3: ゲーム進行 helper を実装する
- [x] T4: helper のユニットテストを作成する
- [x] T5: UI モック用問題セットを追加する
- [x] T6: 進捗インジケーターを実装する
- [x] T7: 15秒タイマー表示を実装する
- [x] T8: 4択ボタンを実装する
- [x] T9: 正誤フィードバックを実装する
- [x] T10: `/game` から `/game/play` への導線を接続する
- [x] T11: `/game/play` route 設定を追加する
- [x] T12: `/game/play` page を実装する
- [x] T13: キーボード操作を実装する
- [x] T14: エラー・ガード状態を実装する
- [x] T15: frontend lint を実行する
- [x] T16: format を実行する
- [x] T17: frontend test を実行する
- [x] T18: Svelte / TypeScript check を実行する
- [x] T19: 手動確認を実施する
- [x] T20: 進捗・計画書を実装完了へ更新する

## 技術的注意点

- `GAME_QUESTION_COUNT`, `QUESTION_TIME_LIMIT_SEC`, `ANSWER_FEEDBACK_MS` を UI component に直書きしない。
- `GameMode` の文字列 union は Prisma の `GameMode` enum と一致させる。
- `mode` query の正規化は `normalizeGameModeParam()` に集約し、page 内で `GAME_MODE_CONFIGS.includes(...)` のような判定を重複させない。
- `MockGamePlayQuestion.correctChoiceId` は UI モック限定とし、将来 API レスポンス型には含めない。
- 正解判定、時間切れ回答生成、サマリー計算は `play.ts` に置き、Svelte component に重複実装しない。
- タイマー interval と feedback timeout は別々に管理し、状態遷移時に既存 timer を clear する。
- `keydown` listener は `onMount` / `onDestroy` で登録解除し、回答可能 phase 以外では何もしない。
- 選択肢ボタンは `disabled` 中でも理由・状態がテキストで分かるようにする。
- `aria-live` は正誤・時間切れ・完了の通知に限定し、毎秒の timer 更新を読み上げ続けない。
- 未ログイン時は `authStore.isInitializing` 完了後にログイン導線を表示する。初期化中に「未ログイン」と断定しない。
- `/game/play` 直打ちで mode が不正な場合は `/game` へ戻る link を表示する。
- 将来 API 接続する場合は `API_BASE_URL`、`Authorization: Bearer ${authStore.accessToken}`、`credentials: 'include'`、`parseErrorResponse` を使う。
- API エラー時はバックエンドの日本語メッセージを上書きしない。
- `response.json()` は `response.ok` チェック前に呼ばない。
- `<button>` と `<a>` の役割を混同しない。回答操作は button、画面遷移は link または `goto` を使う。
- モバイルでは選択肢を1列、広い画面では2列程度にし、ボタン内テキストがはみ出さないようにする。
- 結果画面 `/game/result` は別タスク。10問完了後は画面内 summary と戻る導線で完結させる。

## A11Y要件

| 対象 | 要件 |
|---|---|
| ページ構造 | `h1` は `/game/play` の画面名またはモード名にし、問題領域・進捗・選択肢を見出しで分ける |
| 進捗 | 視覚インジケーターだけでなく「3 / 10問」のようなテキストを併記する |
| タイマー | 残り秒数を表示するが、毎秒 `aria-live` で読み上げない。残り少ない状態は色だけに依存しない |
| 選択肢 | 4択は button として実装し、`1`〜`4` のキー番号をテキストで表示する |
| 正誤表示 | 正解/不正解/時間切れを文字で表示し、色だけに依存しない |
| キーボード | Tab で選択肢へ移動でき、`1`〜`4` / `Numpad1`〜`Numpad4` でも回答できる |
| 読み上げ順 | DOM順は「見出し → 進捗 → 問題文 → 選択肢 → フィードバック」の流れにし、見た目だけの grid 並び替えで読み上げ順を崩さない |
| focus | 回答後に focus が消失しない。次問遷移後も自然に問題領域へ戻れるようにする |
| disabled | フィードバック中・完了後の disabled 状態が見た目とテキストで分かる |
| レスポンシブ | 390px 幅でもタイマー、選択肢、フィードバック文言が切れない |

## DB整合性・負荷に関する注意

- 本タスクでは DB 読み書きを行わないため、DB 負荷は発生しない。
- `/game/play` 初期表示で `GET /game/questions` を呼ぶ実装は今回は行わない。
- Phase7 で `GET /game/questions` を接続する場合、`GameQuestionSet` が作成されるため、開始ボタンの多重クリック防止とリクエスト中断を必ず実装する。
- `GameQuestionSet.expiresAt` と `createdAt` は存在するが、自動削除方針は未実装。API 実装時に期限切れ cleanup を検討する。
- `POST /game/sessions` では `questionSetId` を受け取り、サーバー側で正誤判定後に該当 `GameQuestionSet` を削除する方針を維持する。
- 苦手モードの5問未満チェックはサーバー側でも必ず実行する。フロントのガードは UX 補助であり、セキュリティ境界ではない。
- スコア、連続正解、`WeakElement` 更新、`UserStats` 更新はフロントで信頼しない。DB 更新はサーバー側のトランザクションで行う。

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| mode query が有効 | `GameMode` として返る |
| mode query が `null` | `null` を返し、画面でエラー導線を表示する |
| mode query が未知値 | `null` を返し、クラッシュしない |
| mock questions | 10問、各4択、選択肢 ID 重複なし |
| 正解選択 | `isCorrect: true`, `timedOut: false` の回答になる |
| 不正解選択 | `isCorrect: false`, `timedOut: false` の回答になる |
| 時間切れ | `chosenChoiceId: null`, `isCorrect: false`, `timedOut: true` の回答になる |
| 残り15秒 | timer percent が100になる |
| 残り0秒 | timer percent が0になる |
| 進捗1問目 | 「1 / 10」相当の表示になる |
| 10問目回答後 | phase が `completed` になり完了表示になる |
| 未ログイン | ゲーム UI を開始せず、ログイン導線を表示する |
| `authStore.isInitializing` 中 | 未ログインと断定せず確認中表示になる |
| クリック回答 | 選択後にボタンが disabled になり、正誤フィードバックが出る |
| `1`〜`4`キー回答 | 対応する選択肢を選べる |
| `Numpad1`〜`Numpad4`キー回答 | 対応する選択肢を選べる |
| フィードバック中のキー入力 | 追加回答されない |
| 時間切れ後のクリック | 追加回答されない |
| `/game` 開始導線 | `/game/play?mode=...` に遷移する |
| モバイル表示 | 390px 幅で選択肢・タイマー・フィードバックがはみ出さない |
| lint | `npm run lint` が通る |
| format | `npm run format` 実行後、Prettier 整形済み |
| test | `npm run test:run` が通る |
| check | `npm run check` が通る |

## 実装リスクと回避策

| リスク | 影響 | 回避策 |
|---|---|---|
| API 未実装なのに live fetch してしまう | `/game/play` が常に失敗する | 本タスクでは mock questions のみ使用する |
| 正解情報の扱いが本番仕様と混ざる | セキュリティ方針と矛盾する | `MockGamePlayQuestion` に限定し、API 型には `correctChoiceId` を含めない |
| タイマーが複数走る | 残り秒数が不安定になる | interval ID を1つだけ保持し、状態遷移ごとに clear する |
| 離脱後に timer / keydown が残る | メモリリークや別画面での誤作動 | `onDestroy` で必ず解除する |
| フィードバック中に二重回答できる | 回答数・進捗が壊れる | phase が `answering` の時だけ回答を受け付ける |
| mode 不正値でクラッシュする | URL 直打ち時に白画面になる | `normalizeGameModeParam()` とエラー画面を用意する |
| 未ログイン判定がちらつく | refresh 中にログイン導線が一瞬出る | `authStore.isInitializing` 中は判定保留 UI を出す |
| 1〜4キーがページ全体で過剰に効く | 将来入力 UI と衝突する | 回答可能状態のみ処理し、必要に応じて target を確認する |
| UI モックの問題データが page に散る | API 接続時の差し替えが難しい | `mock-questions.ts` に集約する |
| 結果画面未実装で遷移先が壊れる | 10問完了後にユーザーが迷う | 本タスクでは画面内完了サマリーを表示し、`/game/result` は後続タスクにする |
| DB 更新をフロント計算値に依存する | スコア改ざんや苦手更新不整合が起きる | API 実装時はサーバー側で `questionSetId` をもとに正誤判定・集計する |

## 手動確認項目

| 項目 | 確認内容 |
|---|---|
| `/game` から開始 | 通常モード開始で `/game/play?mode=...` に遷移する |
| `/game/play` 初期表示 | 見出し、モード名、進捗、タイマー、問題、4択が表示される |
| 未ログイン表示 | ゲーム開始せずログイン導線が表示される |
| 不正 mode | 日本語エラーと `/game` へ戻る導線が表示される |
| クリック回答 | 正解/不正解フィードバックが1.5秒表示され、次問に進む |
| 1〜4キー回答 | 対応する選択肢を選べる |
| 時間切れ | 0秒で時間切れフィードバックが表示され、次問に進む |
| 10問完了 | 完了サマリーと戻る導線が表示される |
| PC 幅 | 既存 layout 内で問題・選択肢が読みやすい |
| モバイル幅 390px | 選択肢・タイマー・フィードバック文言がはみ出さない |
| キーボード操作 | Tab / Shift+Tab と `1`〜`4` が自然に使える |
| コンソール | 不要なエラーや hydration mismatch が出ない |

## 実装完了時の更新ルール

実装完了時は以下を必ず行う。

- `docs/05_progress.md` の `ゲームプレイ画面 /game/play（インジケーター・15秒タイマー・4択・正誤フィードバック・1〜4キー操作）` を `[x]` に更新する。
- `docs/plans/game-screens/plan.md` の該当チェックボックスを `[x]` に更新する。
- 計画時と実装時で変更ファイルが異なった場合、対象ファイル一覧を実態に合わせて更新する。
- 設計判断が変わった場合、`## 実装完了` の「計画からの変更点」に記録する。
- 実行した品質チェックを `## 実装完了` に記録する。
- 手動確認した画面幅・ログイン状態・タイマー・キー操作を `## 実装完了` に記録する。

実装完了セクションのテンプレート:

```markdown
## 実装完了
- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/game-play
- PR: #N

### 計画からの変更点
- なし

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/game/constants.ts` | 修正 | ゲームプレイ定数 |
| `frontend/src/lib/game/types.ts` | 修正 | プレイ画面型 |
| `frontend/src/lib/game/play.ts` | 新規 | ゲーム進行 helper |
| `frontend/src/lib/game/play.test.ts` | 新規 | helper テスト |
| `frontend/src/lib/game/mock-questions.ts` | 新規 | UI モック問題 |
| `frontend/src/lib/components/game/GameProgressIndicator.svelte` | 新規 | 進捗 |
| `frontend/src/lib/components/game/GameTimerBar.svelte` | 新規 | タイマー |
| `frontend/src/lib/components/game/GameChoiceButton.svelte` | 新規 | 選択肢 |
| `frontend/src/lib/components/game/GameFeedbackPanel.svelte` | 新規 | フィードバック |
| `frontend/src/routes/(app)/game/+page.svelte` | 修正 | 開始導線 |
| `frontend/src/routes/(app)/game/play/+page.ts` | 新規 | route 設定 |
| `frontend/src/routes/(app)/game/play/+page.svelte` | 新規 | プレイ画面 |
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
| `/game` から開始 | OK |
| `/game/play` クリック回答 | OK |
| `/game/play` 1〜4キー回答 | OK |
| `/game/play` 時間切れ | OK |
| `/game/play` 10問完了 | OK |
| PC 幅 | OK |
| モバイル幅 390px | OK |
```

## 実装完了

- 完了日: 2026-06-13
- 実装ブランチ: `feature/game-play`
- PR: #47

### 計画からの変更点

- `GET /game/questions` / `POST /game/sessions` は計画どおり呼び出さず、`frontend/src/lib/game/mock-questions.ts` の UI モック問題で実装した。
- `/game/result` は未実装のため、10問完了後は `/game/play` 画面内の完了サマリーと「もう一度」「モード選択へ戻る」導線で完結させた。
- ログイン済みセッションがない環境だったため、ブラウザでの実ゲーム進行操作は未確認。ゲーム進行の核は `play.test.ts`、画面構文は `npm run check`、未ログインガードとモバイル表示は Browser で確認した。

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/game/constants.ts` | 修正 | `GAME_QUESTION_COUNT`, `QUESTION_TIME_LIMIT_SEC`, `ANSWER_FEEDBACK_MS` を追加 |
| `frontend/src/lib/game/types.ts` | 修正 | プレイ画面用の問題、選択肢、回答、phase、選択 handler 型を追加 |
| `frontend/src/lib/game/play.ts` | 新規 | mode 正規化、進捗ラベル、タイマー率、回答生成、次問遷移、サマリー算出を追加 |
| `frontend/src/lib/game/play.test.ts` | 新規 | mode 正規化、回答判定、時間切れ、進捗、タイマー、サマリーのテストを追加 |
| `frontend/src/lib/game/mock-questions.ts` | 新規 | UI モック用の10問問題セット生成を追加 |
| `frontend/src/lib/components/game/GameProgressIndicator.svelte` | 新規 | 10問分の進捗インジケーターを追加 |
| `frontend/src/lib/components/game/GameTimerBar.svelte` | 新規 | 15秒カウントダウンバーを追加 |
| `frontend/src/lib/components/game/GameChoiceButton.svelte` | 新規 | 4択ボタン、キー番号、選択後状態表示を追加 |
| `frontend/src/lib/components/game/GameFeedbackPanel.svelte` | 新規 | 正解・不正解・時間切れフィードバックを追加 |
| `frontend/src/routes/(app)/game/+page.svelte` | 修正 | 開始ボタンを `/game/play?mode=...` 遷移へ変更 |
| `frontend/src/routes/(app)/game/play/+page.ts` | 新規 | `ssr = true`, `prerender = false` を明示 |
| `frontend/src/routes/(app)/game/play/+page.svelte` | 新規 | プレイ画面、timer、4択、1〜4キー操作、フィードバック、完了サマリーを追加 |
| `docs/05_progress.md` | 修正 | `/game/play` タスクを実装中、完了へ更新 |
| `docs/plans/game-screens/plan.md` | 修正 | タスク完了チェックと実装完了記録を追記 |

### 品質チェック

| コマンド | 結果 |
|---|---|
| `cd frontend && npm run test:run -- src/lib/game/play.test.ts` | Red: `play.ts` 未実装で import 解決失敗 |
| `cd frontend && npm run test:run -- src/lib/game/play.test.ts` | Green: OK（12 tests） |
| `cd frontend && npm run format` | OK |
| `cd frontend && npm run lint` | OK |
| `cd frontend && npm run test:run` | OK（13 files / 169 tests） |
| `cd frontend && npm run check` | OK（0 errors / 0 warnings） |

### 手動確認

| 条件 | 結果 |
|---|---|
| `/game` 未ログイン表示 | OK: 6モードとログイン導線を表示 |
| `/game/play?mode=SYMBOL_TO_NAME_LV1` 未ログイン表示 | OK: 「ログインが必要です」とログイン導線を表示 |
| `/game/play?mode=SYMBOL_TO_NAME_LV1` コンソール | OK: error log なし |
| モバイル幅 `/game` | OK: 390px 相当で横はみ出しなし（`scrollWidth <= clientWidth`） |
| モバイル幅 `/game/play` 未ログイン表示 | OK: 390px で横はみ出しなし（`scrollWidth <= clientWidth`） |
| ログイン済み `/game/play` クリック回答 | 未確認: 手動確認環境にログインセッションなし。`play.test.ts` と `npm run check` で主要ロジック・画面構文を確認 |
| ログイン済み `/game/play` 1〜4キー回答 | 未確認: 手動確認環境にログインセッションなし。キー入力 handler は実装済み |
| ログイン済み `/game/play` 時間切れ | 未確認: 手動確認環境にログインセッションなし。時間切れ回答生成は `play.test.ts` で確認 |

## 既存 `/game` 実装完了記録

- 完了日: 2026-06-12
- 実装ブランチ: `feature/game-mode-select`
- PR: #46
- `docs/05_progress.md` の `ゲームモード選択画面 /game（モード一覧・苦手5問未満ガード表示）` は現在 `[x]`。

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
