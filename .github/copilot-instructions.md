# Gensoko 開発ワークフロー（Copilot 自動読み込み）

このファイルは GitHub Copilot が自動で読み込む指示書です。
ユーザーが「タスク名 の実装をします」「タスク名 の修正をします」など、
実装・修正・追加・リファクタリングに関する作業を宣言した場合、
以下のワークフローを **必ず** 実行してください。

---

## プロジェクト概要

- **名前**: Gensoko（元素庫）— 元素記号学習 Web アプリ
- **Backend**: Hono v4 + Prisma v7 + PostgreSQL（Docker port 3000）
- **Frontend**: SvelteKit v2 + Tailwind CSS v4（Docker port 5174）
- **テスト**: Vitest（`backend/src/**/*.test.ts`）
- **進捗管理**: `docs/05_progress.md`
- **テスト開発フロー**: `docs/07_testing_flow.md`
- **起動コマンド**: `docs/09_startup_commands.md`

---

## 重要な技術的制約

- **Prisma v7**: `new PrismaClient()` には必ず `PrismaPg` アダプタが必要
- **Prisma v7**: `schema.prisma` の `datasource` に `url =` を書いてはいけない（`prisma.config.ts` で管理）
- **hono/jwt**: `verify(token, secret, "HS256")` の第3引数 `"HS256"` は必須
- **ESM**: `import` のパスには `.js` 拡張子が必要（例: `../lib/prisma.js`）
- **インデント**: Prettier 準拠（tabWidth: 2）

### セキュリティ制約（必ず守ること）

- **パスワード**: 必ず `bcryptjs` でハッシュ化してから DB に保存する。平文保存・比較は絶対禁止
- **トークン生成**: メール確認・パスワードリセット用トークンは `crypto.randomBytes(32).toString("hex")` で生成する。`Math.random()` は禁止
- **DB アクセス**: 必ず Prisma ORM 経由でアクセスする。`$queryRaw` 等の生クエリは原則禁止（使う場合はパラメータバインディング必須）
- **秘密情報**: JWT_SECRET・DATABASE_URL 等を**コードにハードコードしない**。必ず環境変数から読む
- **入力検証**: ルートハンドラーの入口で必ず `zod` スキーマで検証する。未検証の値を DB や外部に渡さない
- **CORS**: 許可オリジンは環境変数 `FRONTEND_URL` のみ。ワイルドカード `*` は禁止
- **リフレッシュトークン**: HttpOnly Cookie で管理する。`localStorage` への保存は禁止
- **レート制限**: ログイン・登録・パスワードリセットエンドポイントには必ずレート制限を適用する
- **エラーレスポンス**: スタックトレース・DB エラー詳細・内部パスをクライアントに返さない

---

## 実装タスクのワークフロー

ユーザーが `タスク名 の実装をします` や `タスク名 の修正をします` など作業宣言をしたら、以下を順番に実行する。

### Step 0: ブランチ確認と準備

```bash
# 現在のブランチを確認
git branch --show-current

# develop を最新にする
git checkout develop && git pull origin develop

# 適切なブランチを作成（既になければ）
# 命名規則: feature/phase{N}-{機能名} または feature/{機能名}
git checkout -b feature/xxx
```

### Step 1: 関連ファイルの全確認

実装前に必ず以下を読む:
1. `docs/05_progress.md` — タスクの位置づけ・依存関係を確認
2. `backend/prisma/schema.prisma` — 関連するモデルの全フィールドを確認
3. 実装対象ファイル（routes・services・middleware）の現在の内容
4. **既に実装済みの類似ファイル**（コードのブレを防ぐため）
   - 例: `auth.ts` を実装するなら既存の `middleware/auth.ts` を読む
5. `backend/src/types/index.ts` — 型定義の確認

### Step 2: 05_progress.md に実装中マークをつける

```markdown
- [ ] タスク名  →  - [-] タスク名
```

### Step 3: タスクリスト作成（3回レビュー）

**v1（初版）**: 実装に必要なサブタスクを洗い出す

**v2（1回目レビュー）**: 以下の観点で見直す
- 見落としているエラーケースはないか
- 型安全性は確保されているか
- セキュリティの抜けはないか（入力検証・認証・認可）

**v3（2回目レビュー）**: 以下の観点で見直す
- 既存の実装との整合性はあるか
- テストケースは十分か
- DB の制約（unique・nullable 等）と整合しているか

**v4（3回目レビュー・確定）**: 無理な変更は加えない。最終タスクリストを確定する。

#### タスクリストのタブ区切り出力

最終タスクリストをスプレッドシート貼り付け用にタブ区切りで出力する:

```
タスクID	タスク内容	ファイル	優先度
T1	〇〇の型定義	src/types/index.ts	高
T2	〇〇の実装	src/routes/auth.ts	高
T3	テスト: 正常系	src/routes/auth.test.ts	高
...
```

### Step 4: TDD 実装

**絶対に守るルール: テストを通すためだけの実装をしてはいけない。仕様に沿った正しい実装をすること。**

#### Red フェーズ（テスト先行）
1. `*.test.ts` を先に作成する
2. テストを実行して「全件失敗」を確認する
   ```bash
   cd backend && npm run test -- --run
   ```

#### Green フェーズ（実装）
1. 実装ファイルを作成・編集する
2. テストを実行して「全件通過」を確認する

#### Refactor フェーズ
1. コードの整理（重複削除・可読性向上）
2. テストが引き続き通ることを確認する

### Step 5: 品質チェック

```bash
cd backend
npm run lint          # ESLint
npm run format:check  # Prettier
npm run test -- --run # 全テスト
```

### Step 6: コミット・push

```bash
git add -A
git commit -m "feat: タスク名の実装（TDD・Nテスト全通過）"
git push origin feature/xxx
```

### Step 7: 05_progress.md に完了マークをつける

```markdown
- [-] タスク名  →  - [x] タスク名
```

完了マークをつけてコミットするまでが、そのブランチ内の作業範囲。

### Step 8: PR 作成

以下を含む詳細な PR を作成する:
- 実装内容の説明
- TDD 実施記録（Red → Green の流れ）
- テストケース一覧（表形式）
- チェックリスト（test/lint/format の通過確認）
- 関連タスク（05_progress.md との対応）

---

## ファイル構造リファレンス

```
backend/src/
  index.ts              # Honoサーバーエントリーポイント
  types/index.ts        # 共通型定義（JwtPayload, AppVariables等）
  lib/
    prisma.ts           # PrismaClient シングルトン
    mail.ts             # nodemailer トランスポート
  middleware/
    auth.ts             # JWT認証（authMiddleware, optionalAuthMiddleware）
    admin.ts            # 管理者ロールチェック
    security.ts         # セキュリティヘッダー
    rateLimit.ts        # レート制限
  routes/
    auth.ts             # POST /auth/*
    elements.ts         # GET /elements/*
    game.ts             # GET/POST /game/*
    weak.ts             # GET/DELETE /weak/*
    users.ts            # GET/PATCH/DELETE /users/*
    ranking.ts          # GET /ranking/*
    admin.ts            # 管理者 API
  services/
    auth.service.ts     # 認証ビジネスロジック
    game.service.ts     # ゲームビジネスロジック
    weak.service.ts     # 苦手リストビジネスロジック
```

---

## テストのモックパターン

```ts
// Prisma のモック（DB 接続不要でテスト）
vi.mock("../lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    // 必要なモデルを追加
  },
}));

// 環境変数のモック
vi.stubEnv("JWT_SECRET", "test-secret");

// モックのリセット（各テスト前に実行）
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
});
```

---

## PR 作成時のブランチ → base の対応

| 作業ブランチ | マージ先 |
|---|---|
| `feature/*` | `develop` |
| `release/*` | `main` → `develop` |
| `hotfix/*` | `main` → `develop` |
| `docs/*` | `develop` |
