# ヘッダー導線・モバイルメニュー 実装計画

> 設計者ロール: シニアフロントエンドエンジニア（SvelteKit v2 / Svelte 5 Runes、ナビゲーション設計、A11Y レビュー）

## 概要

ログイン後に `/mypage` と `/weak` へ到達できる導線をヘッダーへ追加する。`/weak` はフェーズ8の苦手リスト画面が未実装のため、`/ranking` と同様の仮ページを先に置き、リンク先が 404 にならない状態にする。

スマホ幅では Gensoko のテキストロゴだけを常時表示し、その他のナビゲーションと認証操作はハンバーガーメニュー内にまとめる。

## 前提条件・依存関係

### 既存の実装

**`frontend/src/lib/components/Header.svelte`**
- 共通ヘッダー。デスクトップ向けの横並びナビと認証エリアを持つ。
- ログイン状態は `authStore.isLoggedIn`, `authStore.isInitializing`, `authStore.user` を参照する。

**`frontend/src/routes/(app)/mypage/+page.svelte`**
- ゲーム履歴一覧として実装済み。
- ヘッダーからの導線がない。

**`frontend/src/routes/(app)/ranking/+page.svelte`**
- フェーズ8・9予定を示す仮ページ。

### 重要な制約

- API 仕様は変更しない。
- `/weak` はリンク追加前に仮ページを作成し、404 を避ける。
- モバイルメニューのボタンは `aria-expanded` と `aria-controls` を持つ。
- モバイルメニューはログイン状態に応じて表示項目を切り替える。
- デスクトップの既存導線（元素一覧・ゲーム・ランキング・設定・ログアウト）は維持する。

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/lib/components/Header.svelte` | 修正 | ログイン後リンク追加、モバイルハンバーガーメニュー化 |
| `frontend/src/routes/(app)/weak/+page.svelte` | 新規 | 苦手リスト仮ページ |
| `docs/05_progress.md` | 修正 | フェーズ8の導線整備タスクを追加・進捗更新 |
| `docs/plans/header-navigation/plan.md` | 新規 | 本計画と実装記録 |

## 設計上の決定事項

1. **`/weak` の扱い**
   - 選択: `/ranking` と同様の仮ページを作成する。
   - 根拠: ヘッダーにリンクを出した時点で 404 になる状態を避けるため。

2. **ログイン後リンクの配置**
   - 選択: デスクトップでは既存のメインナビに `苦手` と `マイページ` を追加し、ログイン時のみ表示する。
   - 根拠: 学習導線として `元素一覧` / `ゲーム` / `ランキング` と同じ粒度で扱えるため。

3. **モバイル表示**
   - 選択: ロゴとメニューボタンのみ常時表示し、ナビ項目・認証項目は開閉メニュー内に置く。
   - 根拠: 横幅不足でテキストが詰まることを避け、後からロゴ画像へ差し替えやすくするため。

## タスクリスト

| タスクID | 内容 | ファイル | 優先度 | 備考 |
|---|---|---|---|---|
| T1 | 既存ヘッダー・進捗・関連ページを確認 | `Header.svelte`, `docs/05_progress.md` | 高 | 完了済み |
| T2 | 計画書と進捗タスクを追加 | `docs/plans/header-navigation/plan.md`, `docs/05_progress.md` | 高 | |
| T3 | `/weak` 仮ページを追加 | `frontend/src/routes/(app)/weak/+page.svelte` | 高 | 404 回避 |
| T4 | ヘッダーにログイン後リンクを追加 | `frontend/src/lib/components/Header.svelte` | 高 | `/weak`, `/mypage` |
| T5 | モバイルハンバーガーメニューを実装 | `frontend/src/lib/components/Header.svelte` | 高 | aria 属性を付与 |
| T6 | format / lint / frontend 確認 | `frontend/` | 高 | |
| T7 | 計画書の実装完了記録を更新 | `docs/plans/header-navigation/plan.md` | 中 | |

- [x] T1: 既存ヘッダー・進捗・関連ページを確認
- [x] T2: 計画書と進捗タスクを追加
- [x] T3: `/weak` 仮ページを追加
- [x] T4: ヘッダーにログイン後リンクを追加
- [x] T5: モバイルハンバーガーメニューを実装
- [x] T6: format / lint / frontend 確認
- [x] T7: 計画書の実装完了記録を更新

## 技術的注意点

- Svelte コンポーネント内で API 呼び出しは追加しない。
- `authStore.isInitializing` 中は既存どおり認証操作を非表示にし、モバイルメニュー内でも同じ扱いにする。
- メニュー開閉 state は `Header.svelte` 内の local state に留める。

## テストケース一覧

| ケース | 期待結果 |
|---|---|
| 未ログインのデスクトップ表示 | `元素一覧` / `ゲーム` / `ランキング` / `ログイン` / `新規登録` が見える |
| ログイン済みのデスクトップ表示 | `苦手` / `マイページ` / `設定` / `ログアウト` に到達できる |
| モバイル表示 | ロゴとハンバーガーボタンのみが上段に表示される |
| モバイルメニュー開閉 | `aria-expanded` が状態に応じて切り替わり、メニュー項目が表示・非表示になる |
| `/weak` 直接アクセス | 404 ではなく仮ページが表示される |


## 実装完了
- 完了日: 2026-06-23
- 実装ブランチ: feature/header-navigation
- PR: 未作成

### 計画からの変更点
- API 追加は行わず、ヘッダー導線と /weak 仮ページ追加に限定した。
- docs/05_progress.md の計画書パスはプレーンテキストで記載した。

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|
| frontend/src/lib/components/Header.svelte | 修正 | ログイン後の /weak・/mypage 導線追加、モバイルハンバーガーメニュー化 |
| frontend/src/routes/(app)/weak/+page.svelte | 新規 | 苦手リスト仮ページを追加 |
| docs/05_progress.md | 修正 | 共通ナビ導線・モバイルメニュー整備タスクを完了更新 |
| docs/plans/header-navigation/plan.md | 新規 | 実装計画と完了記録を追加 |

### 確認結果
| 確認 | 結果 |
|---|---|
| frontend format | OK: docker exec gensoko-sveltekit-1 npm run format |
| frontend lint | OK: docker exec gensoko-sveltekit-1 npm run lint |
| svelte-check | OK: docker exec gensoko-sveltekit-1 npm run check |
| frontend test | OK: docker exec gensoko-sveltekit-1 npm run test:run（19 files / 221 tests） |
| ブラウザ確認 | OK: /weak が 404 ではなく仮ページ表示。スマホ幅でロゴ + メニューボタンのみ、開閉時 aria-expanded=true を確認 |
