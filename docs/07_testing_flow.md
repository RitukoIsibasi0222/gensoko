# テスト開発フロー（TDD）

> 対象: バックエンド（Hono + Vitest）
> ステータス: 全テストは `npm run test` で実行

---

## TDD の基本サイクル

```
Red（赤）  → テストを先に書く → 実装がないので失敗する
  ↓
Green（緑）→ テストが通る最小限の実装を書く
  ↓
Refactor  → コードを整理・重複削除（テストが通り続けることを確認）
  ↓
（次のテストへ）
```

---

## テストファイルの配置ルール

```
src/
  middleware/
    auth.ts          ← 実装
    auth.test.ts     ← テスト（同じディレクトリに置く）
  routes/
    auth.ts
    auth.test.ts
  services/
    auth.service.ts
    auth.service.test.ts
```

**ルール**: `*.test.ts` をソースファイルと同じディレクトリに置く。

---

## テストの種類

### ユニットテスト（Unit Test）
- 対象: ミドルウェア・サービス関数など「部品」単体
- DB や外部サービスは **モック（偽物）** に差し替える
- 速くて安定している

```ts
// 例: prisma をモックして DB 接続なしでテスト
vi.mock("../lib/prisma.js", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
```

### インテグレーションテスト（Integration Test）
- 対象: ルート全体（ミドルウェア + ルートハンドラ + DB）
- 実際の DB を使う（テスト用 DB を別途用意）
- 今後実装予定

---

## Hono のテスト方法

Hono には `app.request()` という便利なメソッドがあります。
**サーバーを起動しなくても** HTTP リクエストをシミュレートできます。

```ts
// テスト用アプリを作成
const app = new Hono();
app.get("/test", authMiddleware, (c) => c.json({ ok: true }));

// リクエストをシミュレート
const res = await app.request("/test", {
  headers: { Authorization: "Bearer xxxxx" },
});

expect(res.status).toBe(200);
```

---

## テストの書き方（基本構造）

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// describe: テスト対象をグループ化
describe("authMiddleware", () => {

  // beforeEach: 各テスト前に実行（モックのリセットなど）
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // it / test: 1 つのテストケース
  it("有効なトークンで 200 を返す", async () => {
    // Arrange（準備）
    const token = await createToken();

    // Act（実行）
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Assert（検証）
    expect(res.status).toBe(200);
  });
});
```

---

## よく使う Vitest の関数

| 関数 | 用途 |
|---|---|
| `vi.mock("パス")` | モジュールをモック化 |
| `vi.fn()` | モック関数を作成 |
| `vi.mocked(fn).mockResolvedValue(x)` | 非同期モック関数の戻り値を設定 |
| `vi.clearAllMocks()` | 全モックをリセット |
| `vi.stubEnv("KEY", "value")` | 環境変数を一時的に設定 |
| `expect(x).toBe(y)` | 厳密に等しいか検証 |
| `expect(x).toEqual(y)` | 深い比較で等しいか検証 |
| `expect(fn).rejects.toThrow()` | エラーが投げられるか検証 |

---

## テスト実行コマンド

```bash
# 全テストを実行
npm run test

# ウォッチモード（ファイル変更で自動再実行）
npm run test -- --watch

# 特定ファイルのみ
npm run test -- src/middleware/auth.test.ts

# カバレッジ付き（今後設定予定）
npm run test -- --coverage
```

---

## DB構造変更時の追加確認（必須）

`schema.prisma` や `prisma/migrations/` を変更したときは、ユニットテストだけで完了にしない。
**必ず Playwright でフロント動作確認**を実施する。

### 最低限の確認手順

1. マイグレーション適用（開発環境）
2. バックエンドテスト実行（回帰確認）
3. フロントエンドの主要導線を Playwright で確認
  - 例: 認証（register/login/verify-email）
  - 例: DB変更の影響がある画面（settings、一覧、詳細など）
4. 「画面表示は成功したが裏で 500 が出ていないか」を確認

### 記録ルール

- 変更タスクの `plan.md` に、実行した Playwright シナリオと結果を記録する
- 必要に応じて `docs/05_progress.md` に検証完了を反映する

---

## 各フェーズのテスト方針

| フェーズ | テスト対象 | 種類 |
|---|---|---|
| フェーズ2 | middleware・auth routes | ユニットテスト |
| フェーズ3 | elements・game routes | ユニットテスト |
| フェーズ4 | users・ranking routes | ユニットテスト |
| 将来 | API 全体 | インテグレーションテスト |
