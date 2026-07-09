# Codex ファイル編集ガイド（PowerShell + WSL）

このリポジトリは WSL Ubuntu 側の `/home/<user>/labs/Gensoko` に実体がある。Codex の外側 shell が PowerShell の場合、編集コマンドをそのまま渡すと PowerShell が先に `$lib`, `$state`, `$app`, `$derived` などを解釈して、Svelte / TypeScript ファイルが壊れることがある。

Codex は実装・修正・追加・リファクタリングでファイル編集を行う前に、このガイドを読み、ファイル種別に合った編集方法を選ぶこと。

---

## 基本方針

- 作業パスは原則 `/home/<user>/labs/Gensoko` を使う。
- PowerShell から UNC パスを直接編集しない。
- 手作業の差分編集は、リポジトリルートに移動して **WSL 内の `apply_patch`** を使う。
- `$lib`, `$state`, `$app`, `$derived` を含む内容を PowerShell inline 文字列で直接書かない。
- 長い `python3 -c ...` や長い heredoc を PowerShell 経由で直接渡さない。
- 編集後は必ず `git diff -- 対象ファイル` で意図した差分だけか確認する。
- 失敗した編集コマンドのあと、内容確認なしに続行しない。

---

## 失敗しやすい編集パターンと対処

Codex の `apply_patch` ツールを UNC パス `\\wsl.localhost\...` に対して使うと、`アクセスが拒否されました (os error 5)` で失敗することがある。この場合は `perl` や一時ファイル方式へすぐ逃げず、まず WSL 内でリポジトリルートへ移動して `apply_patch` を実行する。

```powershell
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
@'
*** Begin Patch
*** Update File: docs/example.md
@@
-old
+new
*** End Patch
'@ | wsl -d Ubuntu-24.04 -e bash -lc 'cd /home/rituko/labs/Gensoko && apply_patch'
```

また、PowerShell から WSL に長い script を渡すと、実行前に PowerShell 側で引用符や `$` を解釈して壊れることがある。特に `$lib`, `$state`, `$app`, `$derived`, `./user.service.js`, 日本語文字列, template literal, JSON 文字列を含む編集では注意する。

対処方針:

- まず WSL 内のリポジトリルートで `apply_patch` を使う。
- Codex の `apply_patch` ツールが UNC 権限で失敗しても、同じ変更を WSL 内 `apply_patch` で再実行する。
- 小さい置換でも、引用符・`$`・日本語・template literal を含むなら `perl` より WSL 内 `apply_patch` を優先する。
- `perl` / `python3 -c` 置換は、単純な1行置換や機械的な繰り返し変更に限定する。
- 複数行追加や大きい編集で `apply_patch` が読みづらくなる場合だけ **一時ファイル方式** にする。
- PowerShell 経由の長い `python3 -c ...`, heredoc, pipe 渡しは避ける。途中で引用符が落ちたり、WSL 側へ届く前に止まったりすることがある。ただし、UTF-8 を明示した PowerShell here-string を WSL 内 `apply_patch` に渡す用途は例外として使ってよい。
- `base64` 化などの回り道を増やすより、編集単位を小さくするか、一時ファイル方式に戻す。
- PowerShell の .NET ファイル API で UNC パスを直接編集しない。例外的な編集が必要な場合も、WSL 側一時ファイル方式へ戻す。
- 失敗した編集コマンドの後は、必ず `sed -n` などで対象ファイルを確認してから続行する。
- 編集後は必ず `git diff -- 対象ファイル` で、意図した差分だけになっているか確認する。

Markdown に TypeScript の型例やレスポンス例を書くときは、文字列リテラル型を必ずクオートする。特に union 型は `USER | ADMIN` のように書くと TypeScript 上は未定義識別子として扱われるため、コピー可能なサンプルとして不正になる。`"USER" | "ADMIN"` のように文字列リテラル union として書く。

```typescript
// 悪い例: USER / ADMIN が未定義識別子になる
type Role = USER | ADMIN;

// 良い例: 文字列リテラル union としてコピーできる
type Role = "USER" | "ADMIN";
```

安全な分割例:

1. import や mock などの小さい置換だけ先に行う。
2. 大きな `describe` や component 本文はファイル末尾への追記、または一時ファイル方式で反映する。
3. 差分確認後にテストを実行する。

---

## 推奨編集方法（ファイル種別別）

### 1. Svelte ファイル（`.svelte`）

推奨: **WSL 側一時ファイル → 内容確認 → `cp` で反映**

理由:

- `$state`, `$derived`, `$effect`, `$lib`, `$app` が PowerShell に解釈されやすい。
- HTML / TypeScript / Tailwind class が混在し、inline 置換では壊れやすい。
- 長文の画面実装は差分確認を挟んだほうが安全。

### 2. TypeScript / JavaScript（`.ts`, `.js`）

小規模変更:

- WSL 内 `apply_patch` を優先する。
- UNC パスに対する `apply_patch` が権限で失敗しても、`python3` / `perl` 置換へ移る前に WSL 内 `apply_patch` で再実行する。

大規模変更:

- まず WSL 内 `apply_patch` で差分を表現できるか検討する。
- 差分が大きすぎる、または全文置換のほうが安全な場合だけ一時ファイル方式を使う。
- 特に frontend の `$lib` import を含むファイルは、Svelte と同じく PowerShell inline 編集を避ける。

### 3. Markdown（`.md`）

小規模変更:

- WSL 内 `apply_patch` を優先する。
- 1行だけの完全一致置換なら、WSL 側の短い `python3` / `perl` でもよい。

大規模変更・コードブロックが多い場合:

- まず WSL 内 `apply_patch` で段落単位に分けて編集する。
- コードブロックや表が大きく崩れそうな場合だけ一時ファイル方式を使う。

注意:

- Markdown 内のバッククォートやコードブロックは、PowerShell 経由の inline 編集で崩れることがある。

### 4. JSON / package files（`.json`）

- 小規模なら WSL 内 `apply_patch`。
- 構造変更なら JSON parser を使って読み書きする。
- 編集後に format / test / package script で検証する。

### 5. Prisma schema（`schema.prisma`）

- WSL 内 `apply_patch` または一時ファイル方式。
- `datasource` に `url =` を書かない。
- DB 構造変更をした場合は、マイグレーション確認と Playwright 確認を実施し、作業報告に含める。

### 6. テストファイル（`.test.ts`）

- 小規模追加は WSL 内 `apply_patch` を優先する。
- 大きめの `describe` / fixture 追加は、一時ファイル方式、または小さい差分に分割する。
- 日本語テスト名、引用符、template literal が混ざるため、PowerShell inline 編集は避ける。

### 7. CSS / config files

- 小規模なら `apply_patch`。
- 大規模なら一時ファイル方式。

---

## 一時ファイル方式の標準手順

1. `/tmp` に一時ファイルを作る。
2. `sed -n` などで内容を確認する。
3. `cp` で対象ファイルへ反映する。
4. `git diff -- 対象ファイル` で差分確認する。
5. 対象テスト・format・lint を実行する。

---

## 編集後の確認コマンド

必要に応じて以下を実行する。

`git diff -- 対象ファイル`

`cd backend && npm run test -- path/to/file.test.ts --run`

`cd frontend && npm run test:run -- path/to/file.test.ts`

`cd frontend && npm run check`
