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

- **関数は1つのことだけ行う**（長くなったら分割を検討する）
