# トースト通知コンポーネント 実装計画

> 設計者ロール: シニアフロントエンドエンジニア

## 概要

全画面で利用できる共通トースト通知システムを実装する。Svelte 5 Runes ベースの singleton store `toastStore` と表示用コンポーネント `Toaster.svelte`（コンテナ）・`Toast.svelte`（個別表示）を `src/lib/components/toast/` に配置し、ルート `+layout.svelte` に `Toaster` を 1 つだけ組み込む。`success` / `error` / `info` / `warning` の 4 種類をサポートし、`ApiError` を受け取って自動的にエラートーストを表示するヘルパーも提供する。

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`src/lib/api/errors.ts`**

- `class ApiError extends Error` — API レスポンスエラーを表す共通例外
  - `readonly status: number` — 400-599 または 0（ネットワークエラー）
  - `readonly body: unknown | null` — レスポンス JSON body（パース失敗時 null）
  - `message: string` — エラーメッセージ（バックエンドの `error` フィールド由来）

**`src/lib/stores/auth.svelte.ts`**

- Svelte 5 Runes（`$state` + class）ベースの singleton store
- 同じパターンで `toastStore` を実装する（参考実装として参照のみ）

**`src/routes/+layout.svelte`**

- ルートレイアウト。本タスクで `Toaster` コンポーネントを追加する（既存コードには触らず、`{@render children()}` の隣に追加するのみ）

### 重要な制約

- `auth.svelte.ts` は変更しない
- `toastStore` から `auth.svelte.ts` への import は不要（循環依存防止）
- `(app)/+layout.svelte` は変更しない（トーストはルートレイアウトに置くため）
- Svelte 5 Runes 構文のみ使用（`store.subscribe()` / `writable()` 禁止）
- Tailwind CSS v4 のクラス直書き（`@apply` 不使用）
- SSR 対応: `setTimeout` などは `browser` ガード内でのみ実行
- アクセシビリティ: `error` / `warning` は `role="alert"` + `aria-live="assertive"`、`success` / `info` は `role="status"` + `aria-live="polite"`

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `src/lib/stores/toast.svelte.ts` | 新規 | トースト store 本体（singleton class） |
| `src/lib/stores/toast.svelte.test.ts` | 新規 | store のユニットテスト（Vitest） |
| `src/lib/components/toast/Toaster.svelte` | 新規 | トーストスタックのコンテナコンポーネント |
| `src/lib/components/toast/Toast.svelte` | 新規 | 個別トースト表示コンポーネント |
| `src/routes/+layout.svelte` | 変更 | `Toaster` を 1 箇所追加 |

## 設計上の決定事項

1. **トースト ID の発番方法**
   - 選択: `crypto.randomUUID()` を使う
   - 根拠:
     - インクリメントだとモジュールスコープの可変変数が必要になりテスト間で状態が漏れる
     - `Date.now()` は同一 ms で衝突する（連続呼び出しで重複 ID 発生）
     - `crypto.randomUUID()` はブラウザ標準で SSR でも `node:crypto` 経由で動作する。衝突確率は実質ゼロ

2. **タイマーの責務分離**
   - 選択: タイマーは store 内で管理する。`setTimeout` の戻り値（タイマーハンドル）を `Toast` オブジェクトに保持し、`dismiss(id)` 時に `clearTimeout` する
   - 根拠:
     - コンポーネント内に置くと、コンポーネント再マウント時にタイマーがリセットされる・複数残るリスクがある
     - store に集約することで、`dismiss(id)` を呼ぶだけで確実にタイマーも破棄できる
     - SSR 時は `browser` ガード内でのみ `setTimeout` を呼ぶ（サーバー側でタイマーが残留しない）

3. **レイアウトへの組み込み箇所**
   - 選択: ルート `src/routes/+layout.svelte` に `Toaster` を 1 つだけ追加する
   - 根拠:
     - ログイン・登録・パスワードリセット画面（`(app)` グループ外）でも API エラーをトーストで表示したい
     - `(app)/+layout.svelte` に置くと認証前画面でトーストが出ない
     - 全画面共通の overlay は最上位レイアウトに置くのが定石

4. **アニメーション実装**
   - 選択: Svelte 組み込みの `transition:fly`（スライドイン）+ `out:fade`（フェードアウト）
   - 根拠:
     - 数行で完結し、`in:` / `out:` で入退場を別々に制御できる
     - Tailwind v4 の `animate-*` カスタムは `@theme` 等の設定が必要で煩雑
     - 手書き `@keyframes` は記述量が増えメンテコストが高い
   - 具体パラメータ案: `in:fly={{ x: 20, duration: 200 }} out:fade={{ duration: 150 }}`

5. **スタック上限と押し出しポリシー**
   - 選択: 最大 5 件。新しいトースト追加時に件数が 5 を超えたら最も古い 1 件（配列先頭）を即削除する
   - 根拠:
     - 上限なしだと画面が埋まりユーザビリティを損なう
     - 押し出し方式は実装が単純で予測しやすい挙動
     - 押し出し対象のトーストはタイマーも `clearTimeout` してリソースリークを防ぐ

6. **エラートーストの表示時間**
   - 選択: 種類別デフォルトを設ける。`success` / `info` / `warning` は 4000ms、`error` は 6000ms
   - 根拠:
     - エラーはユーザーが読み取って対処判断する時間が必要なため長め
     - `show()` の引数で個別上書きも可能にする

7. **`fromApiError` の挙動**
   - 選択: `error.message` を本文として `error` 種別のトーストを表示する。`status === 0`（ネットワークエラー）でも特別扱いせず同じ扱い
   - 根拠:
     - `client.ts` 側で `ApiError.message` にユーザー向け文字列が入る規約のため、UI 層では単純に表示すれば良い
     - ステータスごとの分岐は呼び出し側で `instanceof ApiError && status === 401` のように個別に行う

## 公開インターフェース案

実装コードは書かない。型シグネチャと役割説明のみ。

```ts
// src/lib/stores/toast.svelte.ts

/** トーストの種類 */
export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

/** スタック表示用の 1 件分のトーストデータ（読み取り専用） */
export type Toast = {
  readonly id: string;        // crypto.randomUUID()
  readonly variant: ToastVariant;
  readonly message: string;
  readonly duration: number;  // ms。0 の場合は自動消去なし
};

/** show() / 各ショートカットで指定できるオプション */
export type ToastOptions = {
  /** 表示時間（ms）。省略時は variant ごとのデフォルト。0 で自動消去なし */
  duration?: number;
};

/**
 * トースト通知の singleton store。
 * - $state でリアクティブな toasts 配列を保持する
 * - タイマー（setTimeout）は store 内で管理し、dismiss 時に clearTimeout する
 * - 最大 5 件まで保持し、超過時は最も古い 1 件を押し出す
 */
declare class ToastStore {
  /** 現在表示中のトースト一覧（古い順）。読み取り専用 */
  readonly toasts: readonly Toast[];

  /** トーストを追加する。返り値は追加されたトーストの id */
  show(variant: ToastVariant, message: string, options?: ToastOptions): string;

  /** success トーストを表示（duration デフォルト 4000ms） */
  success(message: string, options?: ToastOptions): string;
  /** info トーストを表示（duration デフォルト 4000ms） */
  info(message: string, options?: ToastOptions): string;
  /** warning トーストを表示（duration デフォルト 4000ms） */
  warning(message: string, options?: ToastOptions): string;
  /** error トーストを表示（duration デフォルト 6000ms） */
  error(message: string, options?: ToastOptions): string;

  /** ApiError から error トーストを表示する。message に error.message を使う */
  fromApiError(error: ApiError, options?: ToastOptions): string;

  /** 指定 ID のトーストを即時削除する（タイマーも clearTimeout する） */
  dismiss(id: string): void;

  /** すべてのトーストを削除する（タイマーも全 clearTimeout する） */
  clear(): void;
}

export const toastStore: ToastStore;
```

```svelte
<!-- src/lib/components/toast/Toaster.svelte -->
<!--
  画面右下にトーストをスタック表示するコンテナ。
  toastStore.toasts を $derived で読み、各要素を Toast コンポーネントで描画する。
  ルート +layout.svelte に 1 つだけ配置する。
  Props なし。
-->
```

```svelte
<!-- src/lib/components/toast/Toast.svelte -->
<!--
  単一トーストの表示。Toaster から { toast: Toast } を受け取る。
  - role / aria-live は variant に応じて切り替える
  - ×ボタンクリックで toastStore.dismiss(toast.id) を呼ぶ
  - 入退場は transition:fly + out:fade
  Props: { toast: Toast }
-->
```

## タスクリスト（進捗管理）

| タスクID | 内容 | ファイル | 優先度 | 備考 |
|---|---|---|---|---|
| T1 | 型定義（`ToastVariant`, `Toast`, `ToastOptions`） | `src/lib/stores/toast.svelte.ts` | 高 | export する |
| T2 | `ToastStore` クラス骨組み（`$state` 配列・getter） | `src/lib/stores/toast.svelte.ts` | 高 | singleton export |
| T3 | `show()` 実装（ID 発番・スタック追加・タイマー設定・押し出し） | `src/lib/stores/toast.svelte.ts` | 高 | `browser` ガード必須 |
| T4 | `success` / `info` / `warning` / `error` ショートカット | `src/lib/stores/toast.svelte.ts` | 高 | variant ごとのデフォルト duration |
| T5 | `fromApiError(error)` 実装 | `src/lib/stores/toast.svelte.ts` | 高 | `ApiError` を import |
| T6 | `dismiss(id)` / `clear()` 実装（タイマー破棄含む） | `src/lib/stores/toast.svelte.ts` | 高 | clearTimeout 漏れ防止 |
| T7 | store ユニットテスト（テストケース一覧の全件） | `src/lib/stores/toast.svelte.test.ts` | 高 | `vi.useFakeTimers()` 使用 |
| T8 | `Toast.svelte` 実装（表示・×ボタン・aria 属性・transition） | `src/lib/components/toast/Toast.svelte` | 高 | Props: `{ toast }` |
| T9 | `Toaster.svelte` 実装（`toastStore.toasts` を each で描画） | `src/lib/components/toast/Toaster.svelte` | 高 | `fixed bottom-4 right-4` |
| T10 | variant 別の Tailwind スタイル（色・アイコン） | `Toast.svelte` | 中 | success=緑 / error=赤 / info=青 / warning=黄 |
| T11 | ルート `+layout.svelte` に `Toaster` 追加 | `src/routes/+layout.svelte` | 高 | `{@render children()}` の隣 |
| T12 | アクセシビリティ確認（`role` / `aria-live` / フォーカス順序） | `Toast.svelte` | 中 | error/warning=alert、他=status |

- [x] T1: 型定義（`src/lib/stores/toast.svelte.ts`）
- [x] T2: `ToastStore` クラス骨組み（`src/lib/stores/toast.svelte.ts`）
- [x] T3: `show()` 実装（`src/lib/stores/toast.svelte.ts`）
- [x] T4: 4 種ショートカット（`src/lib/stores/toast.svelte.ts`）
- [x] T5: `fromApiError()` 実装（`src/lib/stores/toast.svelte.ts`）
- [x] T6: `dismiss()` / `clear()` 実装（`src/lib/stores/toast.svelte.ts`）
- [x] T7: store ユニットテスト（`src/lib/stores/toast.svelte.test.ts`）
- [x] T8: `Toast.svelte` 実装
- [x] T9: `Toaster.svelte` 実装
- [x] T10: variant 別 Tailwind スタイル
- [x] T11: ルートレイアウトに `Toaster` 追加（`src/routes/+layout.svelte`）
- [x] T12: アクセシビリティ確認

## 実装完了

- **完了日**: 2026-05-15
- **実装ブランチ**: feature/toast-notification
- **テスト結果**: 20 テスト全通過
- **変更ファイル**:
  - `frontend/src/lib/stores/toast.svelte.ts` （新規）
  - `frontend/src/lib/stores/toast.svelte.test.ts` （新規）
  - `frontend/src/lib/components/toast/Toast.svelte` （新規）
  - `frontend/src/lib/components/toast/Toaster.svelte` （新規）
  - `frontend/src/routes/+layout.svelte` （変更）
  - `frontend/vitest.config.ts` （新規）
  - `frontend/package.json` （test スクリプト追加）

## 技術的注意点

- **SSR ガード**: `show()` / タイマー設定処理は `browser` 判定（`typeof window !== 'undefined'` または `$app/environment` の `browser`）で囲み、サーバー側では即時 dismiss しないだけにする（state には追加して問題ないが `setTimeout` は呼ばない）。テストでは `vi.useFakeTimers()` を使うため `browser` を `true` 扱いにできる前提
- **押し出し時のタイマー破棄**: 最古トーストを削除する際に `clearTimeout` を必ず呼ぶこと（メモリリーク防止）
- **`duration: 0` の扱い**: 自動消去なし（`setTimeout` を設定しない）。手動 dismiss 専用のトーストに使う
- **無限ループ防止**: `clear()` 内で `dismiss()` を for ループで呼ぶ場合、配列を変更しながら走査すると添字がずれるため `[...this.toasts]` でコピーしてからループする
- **重複表示の許容**: 同じ message の連続表示は許容する（呼び出し側責務）。重複防止は今回スコープ外
- **`crypto.randomUUID()` 環境差**: Vitest（jsdom）で動作することを確認済み。古い環境では polyfill 不要（プロジェクトターゲットがモダンブラウザ）
- **transition の SSR**: Svelte の `transition:` は SSR 時には実行されないため特別な対処不要
- **z-index**: `Toaster` のコンテナに `z-50` 程度を指定してモーダル等より前面に出す

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| `success('OK')` で 1 件追加される | `toasts.length === 1`、`variant === 'success'`、`message === 'OK'` |
| `error('NG')` の duration デフォルトが 6000ms | `toasts[0].duration === 6000` |
| `success` / `info` / `warning` のデフォルトが 4000ms | 各 `duration === 4000` |
| `show()` のオプションで duration 上書き | 指定値が `toasts[0].duration` に反映 |
| 自動消去（fake timer で duration 経過） | `toasts.length === 0` に戻る |
| `duration: 0` 指定時は自動消去されない | timer 進行後も `toasts.length === 1` |
| `dismiss(id)` で該当トースト削除 | 配列から該当 id が消える |
| `dismiss(id)` で対応する `setTimeout` も clear | timer 進行しても再 dismiss が走らない（spy で確認） |
| `clear()` で全件削除 + 全タイマー破棄 | `toasts.length === 0`、`clearTimeout` 呼び出し回数 = 元の件数 |
| 6 件目追加時に最古 1 件が押し出される | `toasts.length === 5`、押し出された id が消えている |
| 押し出された 1 件のタイマーも破棄される | `clearTimeout` が呼ばれる（spy で確認） |
| `fromApiError(error)` で error トースト表示 | `variant === 'error'`、`message === error.message` |
| `fromApiError` がネットワークエラー（status=0）でも動作 | エラートーストが表示される |
| 連続 `show()` で発番される ID が全件ユニーク | 100 件追加して `new Set(ids).size === 100` |
| `show()` 戻り値の id が追加されたトーストの id と一致 | `returned === toasts.at(-1)!.id` |
