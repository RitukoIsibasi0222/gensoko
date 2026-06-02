# 元素詳細モーダルコンポーネント（カードクリックで開く）実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、UI アクセシビリティ・既存規約整合）
> 対象実装者: ジュニア開発者（Sonnet）

## 概要

`docs/05_progress.md` フェーズ4「元素詳細モーダルコンポーネント（カードクリックで開く）」を完了する。`/elements` ページの 118 カードをクリック／キーボード操作したときに、その元素の詳細情報をモーダルで表示する。GET `/elements/:id` 等の新規 API は本タスクでは呼ばず、既に `getElements()` で取得済みの `Element` をそのまま詳細に流用する。

スコープ外（別タスク）:

| 項目 | 帰属 |
|---|---|
| GET `/elements/:id` 実装 | フェーズ5 |
| 検索・フィルター UI | フェーズ4 別タスク |
| 習得状態バッジ | フェーズ4 別タスク |
| `isMastered` 連携 | フェーズ5 |
| 詳細モーダルへのディープリンク（`?id=xxx` 等） | 範囲外 |
| ダークモード対応 | フェーズ11 |

## 前提条件・依存関係

### 既存の実装（公開インターフェース・変更禁止）

**`frontend/src/routes/(app)/elements/+page.svelte`**
- `loadElements(showToast = false)` で初回ロード（onMount）+ 再読み込み
- `loading / error / empty / success` の 4 状態UIが排他制御済み
- カードは現在 `<article>` で非インタラクティブ

**`frontend/src/lib/elements/types.ts`**
- `Element` 型に詳細表示に必要な全フィールドが揃っている
  - `id, symbol, nameJa, nameEn, category, period, group, atomicWeight, etymology`

**`frontend/src/lib/elements/category-style.ts`**
- `getElementCategoryStyle(category): CategoryStyle` — 分類色を一元管理。モーダル内バッジでも再利用する

**`frontend/src/lib/api/elements.ts`**
- `getElements(): Promise<Element[]>`（本タスクでは呼び出しを増やさない）

**`frontend/src/lib/api/config.ts`**, **`frontend/src/lib/api/errors.ts`**, **`frontend/src/lib/stores/toast.svelte.ts`**
- 本タスクで新規参照はしない（既存 `loadElements` 内の利用を維持）

**`backend/src/routes/elements/index.ts`**
- GET `/elements` は既に id 昇順で全フィールドを返す
- 本タスクで変更しない

### 参照する既存実装パターン

- `frontend/src/lib/components/toast/Toast.svelte` — Svelte 5 Runes + `$props()` での再利用コンポーネント実装
- `frontend/src/routes/verify-email/+page.svelte` — タイマー/リスナーの `onMount` クリーンアップパターン

### 重要な制約

- Svelte 5 Runes（`$state` / `$derived` / `$effect` / `$props`）のみ使用。`export let` / `$:` 禁止
- `import.meta.env.VITE_API_BASE_URL` の直接参照を新規追加しない
- 分類色ロジックは `category-style.ts` を必ず再利用し、再定義しない
- エラーメッセージ・UI 文言は日本語で統一
- 詳細モーダル用に新規 API を呼ばない（一覧再利用）
- `document` / `window` 参照は SSR で実行されない位置（`onMount` / `$effect` のブラウザ実行コンテキスト）に限定
- Prettier `tabWidth: 2`
- DB変更なし（schema.prisma に触れない → Playwright 必須対象外）
- 既存テスト（`elements.test.ts` / `elements/category-style.test.ts` / `api/elements.test.ts` 等）は変更しない

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/elements/detail-fields.ts` | 新規 | 詳細項目の表示順・ラベル・null フォールバックを集約 |
| `frontend/src/lib/elements/detail-fields.test.ts` | 新規 | `buildElementDetailFields` のユニットテスト（Red 先行） |
| `frontend/src/lib/components/elements/ElementDetailModal.svelte` | 新規 | モーダル本体（表示・閉じる操作・a11y・スクロールロック） |
| `frontend/src/routes/(app)/elements/+page.svelte` | 修正 | カードを `<button>` 化、`selectedElement` 状態、モーダル呼び出し、フォーカス復帰 |
| `docs/05_progress.md` | 修正 | 該当タスクを `[ ]` → `[-]` → `[x]` に更新 |
| `docs/plans/elements-detail-modal/plan.md` | 新規 | 本計画書（実装完了時に「実装完了」セクション追記） |

## API 仕様（この機能で使う範囲のみ）

### エラーレスポンス共通形式

```json
{ "error": "メッセージ文字列" }
```

### 使用 API

| メソッド | パス | 用途 | 認証 | このタスクでの追加呼び出し |
|---|---|---|---|---|
| GET | `/api/v1/elements` | 一覧取得（既存ページの初回ロードのみ） | 不要 | なし（モーダルは取得済データ再利用） |

## 設計上の決定事項（判断理由つき）

1. **追加 API を呼ばず、既存一覧データでモーダルを構成する**
   - 選択: GET `/elements/:id` は使わない
   - 根拠: フェーズ4スコープを守り、ネットワーク往復・追加エラーハンドリングを増やさない。`Element` 型に詳細フィールドが揃っているため UI 要件を満たせる

2. **モーダル開閉は `selectedElement: Element | null` の単一状態で表現する**
   - 選択: `isOpen` boolean を別に持たない
   - 根拠: `isOpen=true なのに selected=null` の不整合を構造的に排除する

3. **カードを `<button type="button">` に変更する（`<article>` 廃止）**
   - 選択: `<li><button>...</button></li>` 構造に変更し、`onclick` と Enter/Space 操作をブラウザ標準に委ねる
   - 根拠: `<article>` への `onclick` + 独自 `onkeydown` 実装よりブラウザ標準のアクセシビリティが得られる。`aria-label` は `<button>` に移す。視覚スタイルは既存 `style.cardClass` を `<button>` に適用するだけで踏襲できる

4. **閉じる導線は 3 経路（閉じるボタン / 背景クリック / Escape キー）を統一サポート**
   - 選択: いずれも `onClose()` を呼ぶ単一経路に集約
   - 根拠: 離脱不能リスクを排除しつつ、状態更新ロジックを 1 箇所に閉じ込める

5. **背景クリック誤閉じ防止のため、ダイアログ本体クリックはバブルさせない**
   - 選択: backdrop に `onclick` を置き、ダイアログ要素は `onclick={(e) => e.stopPropagation()}` を付ける
   - 根拠: ドラッグ中に backdrop で `mouseup` する誤閉じも避けるため、`onclick` のみで判定する（`mousedown` で判定しない）

6. **Escape キーのリスナーはモーダル表示中のみ `window` に登録する**
   - 選択: `$effect` 内で `element != null` のときだけ `addEventListener('keydown', ...)`、cleanup で `removeEventListener`
   - 根拠: 常時リスナー登録によるリーク・他画面への副作用を避ける

7. **モーダル表示中は背景スクロールをロックする**
   - 選択: `$effect` 内で `document.body.style.overflow = 'hidden'`、cleanup で元の値に戻す
   - 根拠: スマホでの背面スクロール抜けを防ぐ。`browser` ガードは `$effect` がブラウザ実行のみで動作する性質に依存

8. **フォーカス復帰は「開いた時の `document.activeElement` を保存」して閉じた時に復帰する**
   - 選択: モーダル開閉ロジック側で `let returnFocusEl: HTMLElement | null` を保持
   - 根拠: カードへの `bind:this` を 118 個分集めるより堅牢で、別経路（キーボードフォーカス以外のクリック）でも復帰先が正しい

9. **モーダルマウント時、閉じるボタンに初期フォーカスを当てる**
   - 選択: モーダル内で `bind:this={closeButtonEl}` + `$effect` 内で `closeButtonEl?.focus()`
   - 根拠: キーボード操作の連続性を確保。フォーカストラップ（タブ循環）はスコープ外（モーダル要素が閉じるボタン1つしかフォーカス対象を持たないため必要性が低い）

10. **詳細項目の表示順・ラベル・null 表記を `detail-fields.ts` に集約する**
    - 選択: `buildElementDetailFields(element)` で `{ label, value }[]` を返す
    - 根拠: 文言の重複を排除し、テストで挙動を固定化できる

11. **null / 空文字の表記を統一する**
    - 選択: `group`/`atomicWeight` が null → `"未設定"`、`etymology` が null または空白のみ → `"情報なし"`
    - 根拠: 「数値項目（未設定）」と「テキスト情報（情報なし）」を区別したほうが意味が伝わる

12. **モーダル内で分類バッジを表示し、`category-style.ts` を再利用する**
    - 選択: ヘッダー部に既存のバッジを再描画
    - 根拠: 一覧と詳細の視覚一貫性を保ち、色マップを 1 箇所で管理する規約を破らない

13. **ローディング中・エラー中はカードを描画しない既存仕様を維持する**
    - 選択: 既存 4 状態 UI の `success` 分岐内でのみカード/モーダルを描画
    - 根拠: 「カードがそもそも存在しない状態でモーダルを開く」分岐を作らない

14. **本タスクでトーストは追加しない**
    - 選択: 開閉・選択操作でトースト通知を出さない
    - 根拠: 一覧失敗時のトーストは既存ロジックのまま。モーダル操作はユーザー意図的な遷移であり通知不要

## 公開インターフェース案

### `frontend/src/lib/elements/detail-fields.ts`

```ts
import type { Element } from '$lib/elements/types';

export type ElementDetailFieldKey = 'period' | 'group' | 'atomicWeight' | 'etymology';

export type ElementDetailField = {
  key: ElementDetailFieldKey;
  label: string;
  value: string;
};

export function buildElementDetailFields(element: Element): ElementDetailField[];
```

### `frontend/src/lib/components/elements/ElementDetailModal.svelte`

```ts
type Props = {
  element: import('$lib/elements/types').Element | null;
  onClose: () => void;
};
```

## タスクリスト（進捗管理）

| タスクID | 内容（何を） | ファイル（どこで） | 完了条件 | 依存 | 優先度 |
|---|---|---|---|---|---|
| T1 | 進捗を実装中に更新 | `docs/05_progress.md` | 該当タスクが `[ ]` → `[-]` になる | なし | 中 |
| T2 | 詳細表示ヘルパーの Red テスト先行作成 | `frontend/src/lib/elements/detail-fields.test.ts` | 実装前に `npm run test:run` で該当テストが失敗する | T1 | 高 |
| T3 | 詳細表示ヘルパー実装（表示順・ラベル・null整形） | `frontend/src/lib/elements/detail-fields.ts` | T2 が Green になる。`Element` 型の全表示項目を網羅 | T2 | 高 |
| T4 | モーダルコンポーネント骨組み（Props・表示部・分類バッジ・閉じるボタン） | `frontend/src/lib/components/elements/ElementDetailModal.svelte` | `element != null` のとき dialog が描画され、詳細項目が `buildElementDetailFields` 経由で表示される | T3 | 高 |
| T5 | モーダルの閉じる操作 3 経路を実装 | 同上 | ×ボタン / 背景クリック / Escape のいずれでも `onClose` が 1 度呼ばれる。ダイアログ本体クリックでは閉じない | T4 | 高 |
| T6 | a11y 属性・初期フォーカス・スクロールロック・リスナー解除 | 同上 | `role="dialog"` `aria-modal` `aria-labelledby` `aria-describedby` が付与され、開時に閉じるボタンへフォーカス、閉時にスクロールロック解除・リスナー解除される | T5 | 高 |
| T7 | `/elements` ページのカードを `<button>` 化（既存スタイル・aria-label を踏襲） | `frontend/src/routes/(app)/elements/+page.svelte` | 視覚崩れなし。Tab で各カードにフォーカス可能、Enter/Space で発火可能 | T1 | 高 |
| T8 | `selectedElement` 状態とモーダル呼び出し・フォーカス復帰の実装 | 同上 | カードクリックで該当 `Element` がモーダルに渡り、閉鎖時に元カードへフォーカスが戻る。`success` 状態のみで描画 | T7 | 高 |
| T9 | 品質チェック | `frontend/` | `npm run lint` / `npm run format` / `npm run check` / `npm run test:run` が全通過（既存テスト含む） | T8 | 高 |
| T10 | 手動確認（PC / モバイル / キーボード） | 手動 | テストケース一覧の全項目を確認しチェック | T9 | 高 |
| T11 | 進捗ドキュメント更新 | `docs/05_progress.md` | 該当タスクが `[-]` → `[x]` になる | T10 | 中 |
| T12 | 本計画書に「実装完了」セクション追記 | 本ファイル | テンプレートに沿って実装結果・実ファイル一覧・計画からの差分を記録 | T11 | 中 |

- [x] T1: 進捗を実装中に更新（`docs/05_progress.md`）
- [x] T2: 詳細表示ヘルパーの Red テスト先行作成（`frontend/src/lib/elements/detail-fields.test.ts`）
- [x] T3: 詳細表示ヘルパー実装（`frontend/src/lib/elements/detail-fields.ts`）
- [x] T4: モーダルコンポーネント骨組み（`frontend/src/lib/components/elements/ElementDetailModal.svelte`）
- [x] T5: 閉じる操作 3 経路実装（同上）
- [x] T6: a11y・初期フォーカス・スクロールロック・リスナー解除（同上）
- [x] T7: カードの `<button>` 化（`frontend/src/routes/(app)/elements/+page.svelte`）
- [x] T8: `selectedElement` とモーダル呼び出し・フォーカス復帰（同上）
- [x] T9: 品質チェック（`frontend/`）
- [x] T10: 手動確認（手動）
- [x] T11: 進捗ドキュメント更新（`docs/05_progress.md`）
- [x] T12: 計画書に実装完了セクション追記（本ファイル）

## 技術的注意点

### 実装パターン（疑似コード）

**`ElementDetailModal.svelte`（要点）**

```svelte
<script lang="ts">
  import type { Element } from '$lib/elements/types';
  import { buildElementDetailFields } from '$lib/elements/detail-fields';
  import { getElementCategoryStyle } from '$lib/elements/category-style';

  type Props = { element: Element | null; onClose: () => void };
  let { element, onClose }: Props = $props();

  let closeButtonEl = $state<HTMLButtonElement | null>(null);
  const titleId = 'element-detail-title';
  const descId = 'element-detail-desc';

  $effect(() => {
    if (element === null) return;

    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeydown);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    queueMicrotask(() => closeButtonEl?.focus());

    return () => {
      window.removeEventListener('keydown', handleKeydown);
      document.body.style.overflow = prevOverflow;
    };
  });
</script>

{#if element}
  {@const style = getElementCategoryStyle(element.category)}
  {@const fields = buildElementDetailFields(element)}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    onclick={onClose}
    role="presentation"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      class="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
      onclick={(e) => e.stopPropagation()}
    >
    </div>
  </div>
{/if}
```

**`+page.svelte`（要点・カード部分のみ）**

```svelte
<script lang="ts">
  let selectedElement = $state<Element | null>(null);
  let returnFocusEl: HTMLElement | null = null;

  function openModal(element: Element, event: MouseEvent | KeyboardEvent) {
    returnFocusEl = event.currentTarget as HTMLElement;
    selectedElement = element;
  }

  function closeModal() {
    selectedElement = null;
    queueMicrotask(() => returnFocusEl?.focus());
  }
</script>

<li>
  <button
    type="button"
    onclick={(e) => openModal(element, e)}
    aria-label={`${element.id}番 ${element.symbol} ${element.nameJa} の詳細を開く`}
    class={`w-full rounded-lg border p-3 text-left transition-shadow hover:shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none ${style.cardClass}`}
  >
  </button>
</li>

<ElementDetailModal element={selectedElement} onClose={closeModal} />
```

### 注意

- `loading / error / empty` 状態のときはカードが存在しないため、モーダルも開けない（仕様として明示）
- 同時に複数モーダルが開く設計にはしない（`selectedElement` 単一管理で構造的に防止）
- 同じカードを再クリックした場合は同じ `Element` が再代入されるだけで再オープン挙動になる（問題なし）
- `bind:this={closeButtonEl}` でフォーカスを当てる際、Svelte 5 の bind 値が `$effect` 初回実行時に既に取れている保証はないため `queueMicrotask` 経由で当てる
- `document.body.style.overflow` の元値を保存して復元する（既存のスクロールロック実装と競合しても安全に戻す）

## テストケース一覧

### ユニットテスト（`buildElementDetailFields`）

| ケース | 期待結果 |
|---|---|
| 全フィールドが値ありの元素 | 順序が周期 → 族 → 原子量 → 由来。各 value が文字列化される |
| `group` が null | 該当 value が `"未設定"` |
| `atomicWeight` が null | 該当 value が `"未設定"` |
| `etymology` が null | 該当 value が `"情報なし"` |
| `etymology` が空白のみ | 該当 value が `"情報なし"` |
| ラベル文言 | `周期 / 族 / 原子量 / 由来` であること |

### 手動確認（/elements 画面）

| ケース | 期待結果 |
|---|---|
| 任意のカードをマウスクリック | 該当元素のモーダルが開き、詳細が `buildElementDetailFields` の順で表示される |
| Tab で任意のカードへフォーカス → Enter | モーダルが開く |
| Tab で任意のカードへフォーカス → Space | モーダルが開く |
| モーダル open 直後 | 閉じるボタンへフォーカスが当たっている |
| ×ボタンクリック | モーダルが閉じる |
| 背景クリック | モーダルが閉じる |
| ダイアログ本体クリック | モーダルが閉じない |
| Escape キー | モーダルが閉じる |
| モーダル閉鎖後 | 元のカードへフォーカスが戻る |
| モーダル表示中の背景 | 縦スクロールが効かない |
| モーダル閉鎖後の背景 | スクロールが元通り効く |
| 一覧 loading 中 | カードが描画されない（モーダルも開けない） |
| 一覧 error 中 | カードが描画されない（モーダルも開けない） |
| モバイル幅（375px） | モーダルが画面内に収まり、必要なら縦スクロールで全項目読める |
| `group` / `atomicWeight` / `etymology` が null の元素（例: 由来未設定の元素） | それぞれ `"未設定"` / `"情報なし"` と表示される |

## 実装リスクと回避策

| リスク | 内容 | 回避策 |
|---|---|---|
| スコープ膨張 | GET `/elements/:id` 実装やディープリンクに着手 | 「設計上の決定事項 1」「スコープ外」表でフェーズ5/範囲外と明示 |
| 状態不整合 | 開いているのに対象データなし | `selectedElement` 単一状態で構造的に排除 |
| アクセシビリティ不足 | キーボード操作不可、フォーカスが迷子 | `<button>` 化、Escape 対応、初期フォーカス、フォーカス復帰を完了条件に含める |
| 文言重複 | null 表記が複数箇所でズレる | `detail-fields.ts` に集約しユニットテストで固定 |
| 背景クリック誤閉じ | ダイアログ内ドラッグ・本体クリックで閉じる | ダイアログ要素で `e.stopPropagation()`、判定は `onclick` のみで `mouseup` 単独判定はしない |
| リスナーリーク | keydown / body スタイルが残留 | `$effect` cleanup で必ず解除・復元 |
| 既存挙動の退行 | 一覧取得・分類色・既存テストが壊れる | `+page.svelte` の通信部分は触らず、`category-style.ts` を再利用、`npm run test:run` で全テスト緑を完了条件化 |
| SSR エラー | `document` / `window` 参照で hydration エラー | `$effect` 内に限定し、SSR 経路で実行されない構造にする |
| デザイン崩れ | 小画面でモーダル超過 | `max-w-md` + `max-h-[90vh] overflow-y-auto` + モバイル手動確認を必須化 |

## 実装完了
- 完了日: 2026-06-02
- 実装ブランチ: feature/phase4-elements-detail-modal
- PR: 未作成

### 計画からの変更点
- 背景クリックは `div` の click ではなく全画面 `button` で実装し、a11y エラーを回避した
- マウス操作でモーダルを開いた場合はフォーカス復帰しない挙動に調整し、フォーカスリング残留を解消した
- モーダル開閉時のスクロールバー消失によるレイアウトシフト対策として、`body` の `padding-right` をスクロールバー幅分補正した
- 画面レビューで追加要望があったため、角丸 4px 統一と `Noto Sans JP` 適用を本タスク内で実施した

### レビュー反映（改善）
- 背景の `<button>` がタブ順に混入していた a11y バグを修正（`tabindex="-1"` + `aria-hidden="true"`）。SR 用ラベルは Escape で代替できるため削除
- フォーカスリング残留対策を `event.detail === 0` 分岐ではなく `focus-visible:` バリアントへ統一し、`shouldRestoreFocus` ロジックを撤去。マウス操作時もフォーカスは常に復帰しつつリングは出ない挙動になった
- カード／閉じるボタンの `focus:ring-*` を `focus-visible:ring-*` に統一し、マウスクリックでリングが残る問題を解消
- `formatEtymology` を返り値も `trim()` した値にし、前後空白付きデータを綺麗に表示。対応するテストケースを追加（合計 6 件）

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/elements/detail-fields.ts` | 新規 | 詳細項目の表示順・ラベル・null フォールバック整形を実装 |
| `frontend/src/lib/elements/detail-fields.test.ts` | 新規 | `buildElementDetailFields` のユニットテストを追加 |
| `frontend/src/lib/components/elements/ElementDetailModal.svelte` | 新規 | モーダル本体、閉じる導線、a11y、スクロールロック、レイアウトシフト補正を実装 |
| `frontend/src/routes/(app)/elements/+page.svelte` | 修正 | カードの `button` 化、モーダル連携、フォーカス復帰、UI微調整を実装 |
| `frontend/src/lib/components/home/HeroSection.svelte` | 修正 | CTA ボタン角丸を 4px に統一 |
| `frontend/src/app.css` | 修正 | `Noto Sans JP` の読み込みとデフォルトフォント適用 |
| `docs/05_progress.md` | 修正 | 該当タスクを `[ ]` → `[-]` → `[x]` へ更新 |
| `docs/plans/elements-detail-modal/plan.md` | 修正 | タスクリスト完了反映と実装完了記録を追記 |
