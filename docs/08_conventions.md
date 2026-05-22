# コード規約・命名ルール

> チームで同じルールで書くことで、コードが読みやすくなります
> ツール（Prettier / ESLint）で自動チェックできるものは自動化します

---

## Git・GitHub のルール

### ブランチ戦略

```
main           ← 本番環境。直接コミット禁止
  └── develop  ← 開発の基点。機能ができたらここにマージ
        └── feature/xxx  ← 機能ごとに作るブランチ
        └── fix/xxx      ← バグ修正
```

**ブランチ名の例**
```bash
feature/element-list     # 元素一覧ページ
feature/game-quiz        # 4択ゲーム
fix/login-error          # ログインのバグ修正
```

### コミットメッセージのルール（Conventional Commits）

```
種類: 内容の要約（日本語OK）

例:
feat: 元素一覧ページを実装
fix: ログイン失敗時のエラーメッセージを修正
style: カードコンポーネントのレイアウト調整
refactor: ゲームスコア計算ロジックを整理
docs: API仕様書にランキングエンドポイントを追加
chore: Prettierの設定を追加
```

| 種類 | 使うタイミング |
|------|--------------|
| `feat` | 新しい機能を追加したとき |
| `fix` | バグを直したとき |
| `style` | 見た目・CSSの変更（ロジック変更なし） |
| `refactor` | 動作は同じだがコードを整理したとき |
| `docs` | ドキュメントの変更 |
| `chore` | 設定ファイルの変更など |

> ✅ 1コミット = 1つの目的。複数の変更をまとめないこと

---

## TypeScript（Hono）バックエンドのルール

### 命名規則まとめ（Hono / バックエンド）

| 対象 | ルール | 例 |
|------|--------|-----|
| 関数・変数 | camelCase | `calculateScore()`, `correctCount` |
| 型・インターフェース | PascalCase | `GameSession`, `User`, `Element` |
| ファイル名（ルート） | kebab-case | `game-sessions.ts`, `weak-elements.ts` |
| データベースカラム | snake_case | `user_id`, `created_at`（Prismaが自動変換） |
| URL | kebab-case | `/game/questions`, `/weak-elements` |
| 定数 | UPPER_SNAKE_CASE | `MAX_QUESTIONS = 10` |

### Honoルーターの書き方

```typescript
// ✅ 良い例: ルーターを機能ごとにファイルを分ける
// backend/src/routes/game.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { calculateScore } from '../services/game-service';

const game = new Hono();

game.post('/sessions', zValidator('json', sessionSchema), async (c) => {
  const body = c.req.valid('json');
  const result = await calculateScore(body);
  return c.json(result, 201);
});

export default game;

// ❌ 悪い例: 1ファイルに全ルートを書く（100行超えたら分割を検討）
```

### ファイル構成（Hono バックエンド）

```
backend/
  src/
    index.ts          ← Honoアプリの起点（ルートの登録）
    routes/           ← ルーター（URLとハンドラの紐付け）
      auth.ts
      elements.ts
      game.ts
      weak.ts
      ranking.ts
      admin.ts
    services/         ← ビジネスロジック（スコア計算・選択肢生成など）
      game-service.ts
      auth-service.ts
    middleware/       ← 認証チェック・権限チェック
      auth.ts
      admin.ts
    lib/              ← 共通ユーティリティ
      prisma.ts       ← Prismaクライアントのシングルトン
      mail.ts         ← メール送信関数
    types/            ← 型定義（フロントと共有したい型）
      index.ts
  prisma/
    schema.prisma     ← DBスキーマ
    seed.ts           ← 元素データの初期投入スクリプト
```

> ✅ `services/` にビジネスロジックを集中させ、ルーターは薄く書く
> ❌ ルーターファイルに100行以上のロジックを書かない

---

## TypeScript（SvelteKit）フロントエンドのルール

### 命名規則まとめ（TypeScript）

| 対象 | ルール | 例 |
|------|--------|-----|
| 変数・関数 | camelCase | `correctCount`, `fetchElements()` |
| 型・インターフェース | PascalCase | `Element`, `GameMode`, `User` |
| Svelteコンポーネント | PascalCase | `ElementCard.svelte`, `GameTimer.svelte` |
| ページファイル | `+page.svelte` | SvelteKitのルール固定 |
| 定数 | UPPER_SNAKE_CASE | `MAX_QUESTIONS = 10` |
| CSSクラス（Tailwind） | Tailwindのクラス名そのまま | `flex`, `rounded-xl` |

### 型の定義ルール

```typescript
// ✅ 良い例: 型を明示する
interface Element {
  id: number;
  symbol: string;
  nameJa: string;
  nameEn: string;
  category: string;
  period: number;
  group: number | null;
}

// ❌ 悪い例: any を使う（型の恩恵がなくなる）
const element: any = await fetchElement(id);
```

### ファイル構成（SvelteKit）

```
src/
  lib/
    components/     ← 再利用するUIコンポーネント
      ElementCard.svelte
      GameTimer.svelte
    stores/         ← 画面をまたいで使うデータ（Svelteのstore）
      auth.ts       ← ログイン状態
      game.ts       ← ゲーム進行状態
    types/          ← 型定義（バックエンドのtypes/と合わせる）
      index.ts
    api/            ← APIを呼ぶ関数
      elements.ts
      game.ts
  routes/           ← ページ（SvelteKitのルーティング）
    +page.svelte    ← トップページ
    elements/
      +page.svelte  ← 元素一覧
    game/
      +page.svelte  ← ゲームモード選択
      play/
        +page.svelte ← ゲームプレイ
```

---

## Prettierの設定（コード自動整形）

プロジェクトルートに `.prettierrc` を作成：

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "plugins": ["prettier-plugin-svelte"],
  "overrides": [
    {
      "files": "*.svelte",
      "options": { "parser": "svelte" }
    }
  ]
}
```

> ✅ VS Codeの設定で「保存時に自動整形」をONにすると手動で直す必要がなくなる

---

## ESLintの設定（コード品質チェック）

プロジェクトルートに `eslint.config.js` を作成：

```javascript
import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    rules: {
      'no-console': 'warn',           // console.logを本番に残さない
      '@typescript-eslint/no-explicit-any': 'error', // any禁止
    },
  },
];
```

---

## 共通ルール

- **コメントは「なぜ」を書く**（「何をしているか」はコードを読めばわかる）
  ```php
  // ✅ 良い: なぜこうしているかを説明
  // 苦手ゲームは最低5問ないと成立しないため弾く
  if ($weakCount < 5) {
      return response()->json(['error' => 'INSUFFICIENT_WEAK'], 422);
  }

  // ❌ 悪い: コードを日本語にしただけ
  // weakCountが5未満かチェックする
  if ($weakCount < 5) { ... }
  ```

- **マジックナンバーを使わない**（数字に名前をつける）
  ```typescript
  // ✅ 良い
  const MAX_QUESTIONS = 10;
  const TIME_LIMIT_SEC = 15;

  // ❌ 悪い
  if (answers.length >= 10) { ... }
  ```

- **共通設定は 1 箇所で管理する**（重複コードを避ける）
  ```typescript
  // ✅ 良い: 共通設定ファイルで一元管理
  // frontend/src/lib/api/config.ts
  export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
  
  // frontend/src/lib/stores/auth.svelte.ts
  import { API_BASE_URL } from '$lib/api/config';
  
  // frontend/src/routes/login/+page.svelte
  import { API_BASE_URL } from '$lib/api/config';

  // ❌ 悪い: 各ファイルで同じ定義を繰り返す
  // auth.svelte.ts
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
  
  // login/+page.svelte
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
  
  // register/+page.svelte
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
  // ↑ 3箇所に同じコード → メッセージやフォールバック方針がズレやすい
  ```
  
  **なぜ重要か**:
  - 1箇所で管理すれば、変更が必要なときも1箇所を修正するだけで済む
  - フォールバック方針や警告メッセージが複数箇所でズレるリスクを防ぐ
  - コードレビューで「これは共通化すべき」という指摘を減らせる
  
  **共通化すべきもの**:
  - API ベース URL
  - 環境変数の読み込みとフォールバック
  - エラーハンドリングのパターン
  - バリデーション関数
  - 定数（タイムアウト値、リトライ回数など）

- **関数は1つのことだけ行う**（長くなったら分割を検討する）

---

## 実装前の基本チェックリスト（必須）

> **「パスの確認は当然のこと」** — 実装前に以下の基本項目を必ずチェックしてください。
> これらを怠ると、レビューで指摘される前に自分で気づける問題が多発します。

### 1. 環境変数の確認
- [ ] 環境変数名が正しいか（例: `VITE_API_BASE_URL`）
- [ ] `.env` ファイルが存在し、値が設定されているか
- [ ] フォールバック値（`|| ''`）が設定されているか
- [ ] DEV モードで未設定時の警告が表示されるか

### 2. import パスの確認
- [ ] import するファイルが実際に存在するか
- [ ] パスのスペルミスがないか（大文字小文字含む）
- [ ] SvelteKit のエイリアス（`$lib`, `$app`）を正しく使っているか
- [ ] import 文がファイルの先頭に配置されているか

### 3. 型定義の確認
- [ ] 使用する型が正しく import されているか
- [ ] 型定義が実際の使用方法と一致しているか
- [ ] JSDoc コメントと型定義が一致しているか
- [ ] `any` を使っていないか（使う場合は理由をコメント）

### 4. API エンドポイントの確認
- [ ] バックエンドのエンドポイントパスが正しいか
- [ ] メソッド（GET/POST/PUT/DELETE）が正しいか
- [ ] リクエスト/レスポンスの型が API 仕様と一致しているか
- [ ] バックエンドが実際に返すステータスコードのみハンドリングしているか

### 5. バリデーションと送信の一貫性
- [ ] バリデーションで `trim()` した値を使っているなら、送信時も `trim()` しているか
- [ ] 正規化値（`trim()` 等）を一度だけ計算して変数に入れ、validate と fetch の両方で同じ変数を使っているか（その場で再計算しない）
- [ ] 同じ値に対するチェック（空欄・形式）が一貫しているか
- [ ] バリデーション通過後に送信する値が変わっていないか

### 6. エラーハンドリングの確認
- [ ] `response.ok` を JSON パース前にチェックしているか
- [ ] JSON パースを try-catch で囲んでいるか（502/504 対策）
- [ ] バックエンドのエラーメッセージを上書きしていないか
- [ ] 存在しないステータスコードをハンドリングしていないか

### 7. 多重実行の防止
- [ ] フォーム送信時に多重送信防止のガードがあるか（`if (isSubmitting) return;`）
- [ ] ボタンが送信中に無効化されているか（`disabled={isSubmitting}`）
- [ ] API 呼び出しが完了するまで再実行されないようになっているか

### 8. フォーマット・Lint
- [ ] Prettier でフォーマットを適用したか（`npm run format`）
- [ ] ESLint でエラーがないか（`npm run lint`）
- [ ] インデントが 2 スペースになっているか（tabWidth=2）

### 9. 既存コードとの整合性
- [ ] 既存の類似実装（authStore 等）のパターンに従っているか
- [ ] 命名規則が統一されているか（camelCase/PascalCase）
- [ ] 同じ責務のコードを重複して書いていないか
- [ ] バックエンドのエラーレスポンス（サービス層・ミドルウェア含む）が日本語になっているか（`"Unauthorized"` 等の英語は不可）

### 10. コメントと実装の精度確認
- [ ] コメントで「○○と一致」と書いたとき、**本当に完全一致しているか**確認したか
  - ルールは同じでも**エラーメッセージが違う**場合は「準拠」と書く
  - 例: バックエンドは `min(3)` エラーで「3文字以上」だが、フロントは空欄で「入力してください」→「準拠」
- [ ] 外部スキーマ（`registerSchema` 等）を参照するコメントに**例外・相違点**を明記したか
  - 例: `* ユーザー名・パスワードは registerSchema に準拠。※ 空欄時のメッセージはフロント独自文言`
- [ ] 「簡易チェック」「フロント独自」など、**意図的に完全一致させていない箇所**に理由を書いたか
- [ ] 実装を変更したとき、**そのファイル内の関連コメントをすべて更新**したか（見落とし防止）

---

## フロントエンド（SvelteKit）のベストプラクティス

> レビューで指摘が多い項目をまとめています。実装前に必ず確認してください。

### Fetch API のエラーハンドリング（必須パターン）

**必ず守るべき順序**:

```typescript
// ✅ 正しいパターン
async function callApi() {
  const response = await fetch(`${API_BASE_URL}/endpoint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password: password.trim() }) // password はバックエンドの normalizePassword と同様に trim して送信する
  });

  // 1. 最初に response.ok をチェック（JSON パース前）
  if (!response.ok) {
    // 2. JSON パースを try-catch で囲む（非 JSON レスポンス対策）
    let errorBody: { error?: string; details?: { message: string }[] } | null = null;
    try {
      errorBody = await response.json();
    } catch {
      // JSON パース失敗時は null（空オブジェクト {} は使わない）
    }
    
    // 3. details[0].message を優先（バリデーションエラー時の具体的な Zod メッセージを使用）
    //    バックエンドが { error: "バリデーションエラー", details: ZodIssue[] } を返す場合に有効
    const message =
      errorBody?.details?.[0]?.message ?? errorBody?.error ?? 'エラーが発生しました';
    throw new ApiError(response.status, message);
  }

  // 正常系: response.ok が true なら通常 JSON が返る
  return await response.json();
}

// ❌ 間違ったパターン（よくあるミス）
async function badExample() {
  const response = await fetch(url);
  
  // NG: JSON パースを先にすると、502/504 等の非 JSON で例外が発生
  const data = await response.json();
  
  // NG: response.ok チェックが遅すぎる
  if (!response.ok) {
    throw new Error(data.error);
  }
}
```

**なぜこの順序が重要か**:
- サーバーダウン時（502/504 等）は非 JSON（HTML、プレーンテキスト等）が返る可能性がある → JSON パースで例外
- `response.ok` を先にチェックすれば、エラー時も安全に JSON パースできる
- JSON パースに失敗しても catch で拾えるので、ユーザーに適切なエラーメッセージを表示できる

---

### バリデーションと送信の一貫性

```typescript
// ✅ 正しいパターン: 正規化した値を一貫使用
function validate(normalizedEmail: string, normalizedPassword: string): string | null {
  // 正規化済みの値を受け取る（この関数内で trim しない）
  if (!normalizedEmail) return 'メールアドレスを入力してください';
  if (!normalizedPassword) return 'パスワードを入力してください';

  // 形式チェック（正規化済みの値を使う）
  // isValidEmailFormat は $lib/validation/email.ts の共通関数
  if (!isValidEmailFormat(normalizedEmail)) {
    return 'メールアドレスの形式が正しくありません';
  }

  return null;
}

async function handleSubmit() {
  // ① 正規化値を一度だけ計算（バリデーションと送信の両方で共用）
  const normalizedEmail = email.trim();
  const normalizedPassword = password.trim(); // login 等: バックエンドと同じく trim 正規化（登録系でスペース禁止を検知したい場合は trim しない）

  // ② 正規化済みの値でバリデーション
  const error = validate(normalizedEmail, normalizedPassword);
  if (error) return;

  // ③ 送信時も同じ正規化変数を使う（ここで email.trim() を再計算しない）
  const response = await fetch(url, {
    body: JSON.stringify({
      email: normalizedEmail,
      password: normalizedPassword
    })
  });
}

// ❌ 間違ったパターン
function badValidate() {
  // NG: 空欄チェックは trim するのに...
  if (!email.trim()) return 'メールアドレスを入力してください';

  // NG: 形式チェックは trim しない → 前後に空白があると形式エラーになる
  if (!isValidEmailFormat(email)) return '形式が正しくありません'; // isValidEmailFormat は $lib/validation/email.ts の共通関数
}

async function badSubmit() {
  // NG: email を trim しないと前後の空白がサーバーに送られ認証失敗する
  // （password は trim しないのが正しいが、email は trim が必要）
  body: JSON.stringify({ email, password }) // email は email.trim() にすること
}
```

**なぜ重要か**:
- バリデーションで OK でも、送信時の値が異なるとサーバー側でエラーになる
- 空白混入時の挙動が一貫しないとユーザーが混乱する
- 「入力できたのにログインできない」といったバグの原因になる

---

### 環境変数の管理パターン

```typescript
// ✅ 正しいパターン: 共通ファイルで一元管理
// frontend/src/lib/api/config.ts
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

if (import.meta.env.DEV && !import.meta.env.VITE_API_BASE_URL) {
  console.warn(
    '[警告] VITE_API_BASE_URL が設定されていません。\n' +
    'frontend/.env に以下を追加してください:\n' +
    'VITE_API_BASE_URL=http://localhost:3000/api/v1'
  );
}

// 他のファイルから import して使う
// frontend/src/lib/stores/auth.svelte.ts
import { API_BASE_URL } from '$lib/api/config';

// frontend/src/routes/login/+page.svelte
import { API_BASE_URL } from '$lib/api/config';

// ❌ 間違ったパターン: 各ファイルで重複定義
// auth.svelte.ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// login/+page.svelte
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// register/+page.svelte
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
// ↑ 3箇所に同じコード → 警告メッセージやフォールバック方針がズレやすい
```

**なぜ重要か**:
- 環境変数の読み込み方針を1箇所で管理できる
- 警告メッセージや開発時のヘルプを統一できる
- 変更時に1箇所を修正するだけで全体に反映される
- コードレビューで「重複」の指摘を受けなくなる

---

### ステータスコードとバックエンドの整合性

```typescript
// ✅ 正しいパターン: バックエンドが実際に返すコードのみハンドリング
function toJpMessage(status: number, fallback: string): string {
  switch (status) {
    case 400:
      return '入力内容を確認してください';
    case 401:
      return fallback; // バックエンドの具体的なメッセージを優先
    case 403:
      return fallback; // 「メール未確認」等の具体的な理由はバックエンドから
    case 404:
      return 'リソースが見つかりません';
    case 429:
      return 'しばらく待ってから再試行してください';
    case 500:
      return 'サーバーエラーが発生しました';
    default:
      return fallback || 'エラーが発生しました';
  }
}

// ❌ 間違ったパターン
function badExample(status: number) {
  switch (status) {
    case 423: // NG: バックエンドは 423 を返さない（実際は 401）
      return 'アカウントがロックされています';
    case 401:
      return '認証に失敗しました'; // NG: バックエンドの具体的なメッセージを上書き
  }
}
```

**確認方法**:
1. `backend/src/services/auth.service.ts` の `AuthError` クラスを確認
2. 実際に返されるステータスコードのみハンドリングする
3. バックエンドの具体的なエラーメッセージ（`fallback`）を優先する

---

### import 文の配置ルール

```typescript
// ✅ 正しいパターン: ファイルの先頭に配置
import { goto } from '$app/navigation';
import { API_BASE_URL } from '$lib/api/config';
import { authStore } from '$lib/stores/auth.svelte';
import { toastStore } from '$lib/stores/toast.svelte';

// 型定義
let email = $state('');
let password = $state('');

// ❌ 間違ったパターン: 型定義の後に import
let email = $state('');
let password = $state('');

import { API_BASE_URL } from '$lib/api/config'; // NG: 遅すぎる
```

**なぜ重要か**:
- TypeScript / JavaScript の慣例に従う
- ファイルの依存関係が一目でわかる
- ESLint で警告が出る場合がある
