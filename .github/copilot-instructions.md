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
- **実装計画書**: `docs/plans/{機能名}/plan.md` （機能ごとのディレクトリ・設計書・タスクリスト）
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

### コード品質制約（必ず守ること）

- **冗長な実装をしない**: 同じロジック・同じ正規表現・同じ計算が複数箇所に現れた場合は、必ずヘルパー関数に切り出して一箇所で管理する
  - 例: `c.req.path.replace(/\/[^/]+$/, "")` が複数ルートで重複 → `getAuthBasePath(path)` として切り出す
  - 修正漏れやズレを防ぐためにも、同じコードの複製は作らない

---

## 実装計画のワークフロー

ユーザーが「〇〇の実装計画を作成して」「〇〇の設計をして」「〇〇の計画を立てて」など
**計画・設計の作成** を依頼した場合、以下を実行する。

### Step 0: docs ブランチを作成

```bash
git checkout develop && git pull origin develop
# 命名規則: docs/plan-{機能名}
git checkout -b docs/plan-{機能名}
```

### Step 1: 計画書を docs/plans/ に作成

ディレクトリ: `docs/plans/{機能名}/`
メインファイル: `docs/plans/{機能名}/plan.md`
（例: `docs/plans/frontend-api-client/plan.md`、`docs/plans/game-feature/plan.md`）

追加の参考資料（API 仕様・シーケンス図・スキーマ案など）は同ディレクトリ内に自由に追加してよい。

#### 計画書のテンプレート（plan.md）

> セクションは適宜追加・削除してよい。不要なセクションはコメントごと消す。

```markdown
# {機能名} 実装計画

<!-- 設計者の視点・役割（例: シニアフロントエンドエンジニア / バックエンドエンジニア） -->
> 設計者ロール: {ロール名}

## 概要
<!-- 何を、なぜ実装するかを 1〜3 文で -->

## 前提条件・依存関係

### 既存の実装（公開インターフェース）
<!-- 依存する既存ファイルの公開 getter・メソッド・型定義を列挙する -->
<!-- 実装コードは書かない。シグネチャと役割のみ -->

**{既存ファイルパス}**
- `{メソッド/getter名}: {型}` — {役割}

### 重要な制約
<!-- 既存実装を変更してはいけない箇所・循環依存禁止ルール等 -->
- 例: `auth.svelte.ts` の fetch 呼び出しは変更しない

## 対象ファイル一覧
| ファイル | 変更種別 | 内容 |
|---|---|---|
| `src/lib/xxx/client.ts` | 新規 | 〇〇 |

## API 仕様（関連エンドポイント）
<!-- バックエンド API のうち、このタスクで使うものだけ記載 -->

### エラーレスポンス共通形式
```json
{ "error": "メッセージ文字列" }
```
ステータスコード: 400 / 401 / 403 / 404 / 409 / 429 / 500

### エンドポイント一覧
| メソッド | パス | 認証 | リクエスト | レスポンス |
|---|---|---|---|---|
| POST | `/api/v1/xxx` | 不要 | `{ field: string }` | `{ result: string }` |

## 設計上の決定事項
<!-- 実装前に答えを固めておくべき設計の問い。迷いをなくすために記録する -->

1. **{問い}**
   - 選択: {選んだ方針}
   - 根拠: {なぜそうするか}

2. **{問い}**
   - 選択:
   - 根拠:

## 公開インターフェース案
<!-- 実装コードは書かない。型シグネチャと役割説明のみ -->

```ts
// {説明}
export function {関数名}<T>({引数}: {型}): Promise<T>

// {説明}
export class {クラス名} extends Error {
  constructor(public status: number, public message: string)
}
```

## タスクリスト（進捗管理）
<!-- タブ区切りで記載すると実装指示として Copilot に渡しやすい -->

| タスクID | 内容 | ファイル | 優先度 | 備考 |
|---|---|---|---|---|
| T1 | 〇〇の型定義 | `src/types/index.ts` | 高 | |
| T2 | 〇〇の実装 | `src/lib/xxx/client.ts` | 高 | |
| T3 | テスト作成 | `src/lib/xxx/client.test.ts` | 高 | |

- [ ] T1: 〇〇の型定義（`src/types/index.ts`）
- [ ] T2: 〇〇の実装（`src/lib/xxx/client.ts`）
- [ ] T3: テスト作成（`src/lib/xxx/client.test.ts`）

## 技術的注意点
<!-- 実装時に迷わないよう、制約・パターンを明記 -->

## テストケース一覧
| ケース | 期待結果 |
|---|---|
| 正常系: 〇〇 | 200 OK |
| 異常系: 〇〇 | 400 Bad Request |
```

### Step 2: 05_progress.md を更新

新機能の場合、`docs/05_progress.md` に該当タスクを追記する。

### Step 3: コミット・push

```bash
git add docs/plans/{機能名}/ docs/05_progress.md
git commit -m "docs: {機能名} 実装計画を作成"
git push origin docs/plan-{機能名}
```

---

## 実装時の計画書活用ルール

実装タスクのワークフロー **Step 1（関連ファイルの全確認）** の最初に必ず行う:

1. `docs/plans/{機能名}/plan.md` が存在するか確認する
2. 存在する場合は **必ず読み込んでから** 実装を開始する（同ディレクトリの補足資料も参照する）
3. タスクが完了したら計画書の `- [ ]` を `- [x]` に更新する
4. 全タスク完了時に計画書に `## 実装完了` セクションを追記してコミットする

```markdown
## 実装完了
- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/xxx
- PR: #N
```

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
0. `docs/plans/{機能名}/plan.md` — 実装計画書が存在する場合は **最初に必ず読む**（同ディレクトリの補足資料も確認する）
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

変更の種類ごとに **コミットを分ける**。1コミットに全変更をまとめない。

| 変更の種類 | コミットメッセージ例 |
|---|---|
| スキーマ追加・マイグレーション | `feat: XxxToken モデル追加・マイグレーション実行` |
| サービス・ルート・テスト（機能実装） | `feat: POST /auth/xxx 実装（TDD・Nテスト全通過）` |
| ドキュメント・進捗更新 | `docs: xxx 完了マーク更新` |
| リファクタリング | `refactor: xxx をヘルパー関数に切り出し` |

```bash
# 例: DBの変更、機能実装、ドキュメントを3コミットに分ける
git add backend/prisma/
git commit -m "feat: XxxToken モデル追加・マイグレーション実行"

git add backend/src/
git commit -m "feat: POST /auth/xxx 実装（TDD・Nテスト全通過）"

git add docs/
git commit -m "docs: xxx 完了マーク更新"

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
    auth/
      index.ts          # JWT認証（authMiddleware, optionalAuthMiddleware）
      auth.test.ts      # テスト
    admin/
      index.ts          # 管理者ロールチェック
      admin.test.ts     # テスト
    rateLimit/
      index.ts          # レート制限
    security/
      index.ts          # セキュリティヘッダー
  routes/
    auth/
      index.ts          # POST /auth/*
      register.test.ts  # POST /auth/register のテスト
      verify-email.test.ts  # POST /auth/verify-email のテスト
      login.test.ts     # POST /auth/login のテスト
    elements/
      index.ts          # GET /elements/*
    game/
      index.ts          # GET/POST /game/*
    weak/
      index.ts          # GET/DELETE /weak/*
    users/
      index.ts          # GET/PATCH/DELETE /users/*
    ranking/
      index.ts          # GET /ranking/*
    admin/
      index.ts          # 管理者 API
  services/
    auth.service.ts     # 認証ビジネスロジック
    game.service.ts     # ゲームビジネスロジック
    weak.service.ts     # 苦手リストビジネスロジック
```

---

## テストのモックパターン

```ts
// Prisma のモック（DB 接続不要でテスト）
// ※ パスはファイルの深さに合わせる（routes/auth/ なら ../../lib/prisma.js）
vi.mock("../../lib/prisma.js", () => ({
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

## テストファイルの命名規則

テストファイルは **エンドポイント（機能）ごとに 1 ファイル** に分け、対応するソースファイルと **同じディレクトリ内** に配置する。

```
routes/
  auth/
    index.ts
    register.test.ts        # POST /auth/register
    verify-email.test.ts    # POST /auth/verify-email
    login.test.ts           # POST /auth/login（追加時に作成）
middleware/
  auth/
    index.ts
    auth.test.ts
```

**ルール**:
- 新しいエンドポイントを追加するたびに対応する `.test.ts` を必ず作成する
- 既存テストファイルに `describe` を追加して済ませない

---

## PR 作成時のブランチ → base の対応

| 作業ブランチ | マージ先 |
|---|---|
| `feature/*` | `develop` |
| `release/*` | `main` → `develop` |
| `hotfix/*` | `main` → `develop` |
| `docs/*` | `develop` |
