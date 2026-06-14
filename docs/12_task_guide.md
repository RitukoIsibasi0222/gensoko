# タスク実装ガイド（ジュニアエンジニア向け）

> このドキュメントは `05_progress.md` の各タスクを **なぜ作るのか・何を作るのか・どう実装するか** の観点で解説します。
> 実装順序は `05_progress.md` のフェーズ順に従ってください。

---

## 読み方

各タスクは以下の構成で書かれています。

| 項目 | 内容 |
|---|---|
| **目的** | そのタスクが必要な理由 |
| **作成・変更ファイル** | 触るファイルの一覧 |
| **実装の流れ** | 順番に沿ったステップ |
| **なぜそう作るのか** | 設計の意図・セキュリティ上の理由 |
| **よくあるミス** | 引っかかりやすいポイント |

---

## フェーズ1: セットアップ（完了済み）

すべて `[x]` 完了です。参考として概要のみ記載します。

| タスク | 概要 |
|---|---|
| GitHubリポジトリ作成 | プロジェクトをバージョン管理下に置く |
| Docker Compose起動 | DB・メールサーバーをローカルで動かす |
| Prismaスキーマ定義 | DB のテーブル構造を定義し `migrate dev` で実際のテーブルを生成 |
| 元素シードデータ | 118元素の初期データを `prisma/seed.ts` で投入 |
| src/ ファイル構造作成 | routes/services/middleware/lib/types のディレクトリを作成 |

---

## フェーズ2: バックエンド認証（完了済み）

すべて `[x]` 完了です。実装済みコードの理解に役立ててください。

### 概念マップ

```
クライアント
    │
    ├── POST /auth/register ─→ [routes/auth/index.ts]
    │       │ Zod で入力検証
    │       └─→ [services/auth.service.ts: register()]
    │               │ bcrypt でパスワードハッシュ
    │               │ DB にユーザー作成
    │               └─→ メール送信（lib/mail.ts）
    │
    ├── POST /auth/login ───→ [routes/auth/index.ts]
    │       └─→ [services/auth.service.ts: login()]
    │               │ パスワード照合
    │               │ JWT アクセストークン発行（15分）
    │               └─→ リフレッシュトークン発行（Cookie・7日）
    │
    └── 🔒 保護ルート ────→ [middleware/auth/index.ts]
                                │ Authorization: Bearer <token> を検証
                                └─→ c.set("user", { id, role })
```

### 認証の2トークン構成

```
アクセストークン（短命・15分）
  → Authorization: Bearer ヘッダーで毎回送信
  → DBを参照しない（JWTの署名だけで検証）→ 高速

リフレッシュトークン（長命・7日）
  → HttpOnly Cookie に保存（JSから読めない → XSS対策）
  → POST /auth/refresh で新しいアクセストークンを発行
  → DBに保存されているので、ログアウト時に削除できる
```

---

## フェーズ3: 元素・ゲーム・苦手 API

### 3-1. GET /elements

**目的**
元素一覧を返す。ログインユーザーには「この元素を習得済みか」も付与する（設計決定1）。

**作成・変更ファイル**

```
backend/src/routes/elements/index.ts   ← 実装（既存ファイルを編集）
backend/src/routes/elements/elements.test.ts  ← テスト（新規作成）
```

**実装の流れ**

1. `GET /elements` ルートハンドラを書く
2. クエリパラメータ（`q`, `category`, `period`）を Zod でバリデーション
3. Prisma で `Element` を検索（`where` 句に検索条件を付ける）
4. 認証済みユーザーの場合：`GameAnswer` を集計して `isMastered` を計算して付与
5. レスポンスを返す

**なぜそう作るのか**

- `isMastered` の計算は DB の集計クエリで行う。フロントに全 GameAnswer を渡してフロント側で計算すると、データ量が増えてパフォーマンスが悪化する
- `isMastered` は「直近2ゲームで連続正解したか」を判定する（設計決定1）

**習得判定のロジック（設計決定1）**

```
直近2回のゲームで、その元素に「正解した記録」があるか？
  → GameAnswer テーブルを userId + elementId + isCorrect で検索
  → 直近2回ともtrue → isMastered: true
  → それ以外 → isMastered: false
```

**よくあるミス**

- 未ログインユーザーにも `isMastered` フィールドを返してしまう（`null` か省略すべき）
- `middleware/auth/index.ts` には `authMiddleware`（必須）と `optionalAuthMiddleware`（任意）の2種類がある。このエンドポイントは **任意認証**なので `optionalAuthMiddleware` を使う

---

### 3-2. GET /elements/:id

**目的**
特定の元素の詳細情報（由来情報 `etymology` を含む）を返す。

**作成・変更ファイル**

```
backend/src/routes/elements/index.ts   ← 追記
backend/src/routes/elements/elements.test.ts  ← テスト追加
```

**実装の流れ**

1. `:id` パスパラメータを取り出す（`c.req.param("id")`）
2. `parseInt` で数値に変換し、NaN チェックを行う（Zod でも可）
3. Prisma で `Element.findUnique({ where: { id } })` を呼ぶ
4. `null` なら 404 を返す

**よくあるミス**

- `:id` は文字列で来る。`parseInt` を忘れると Prisma がエラーを出す
- 存在しない元素番号（例: 999）を渡されたとき 404 を返さずにクラッシュする

---

### 3-3. GET /game/questions（設計決定2）

**目的**  
ランダムに10問の問題を生成し、クライアントに返す。  
正解情報はサーバー側だけに保存する（不正防止）。

**作成・変更ファイル**

```
backend/src/routes/game/index.ts          ← 実装（既存ファイルを編集）
backend/src/services/game.service.ts      ← 実装（既存ファイルを編集）
backend/src/routes/game/questions.test.ts ← テスト（新規作成）
```

**設計決定2: GameQuestionSet テーブルの役割**

```
GET /game/questions
  │
  ├─ Prismaで118元素からランダム10問を選ぶ
  ├─ 各問に対して「正解のelementId」を確定する
  ├─ GameQuestionSet テーブルに {questionSetId, 正解情報, 有効期限(30分)} を保存
  └─ クライアントに {questionSetId, 問題と選択肢（正解はどれか伏せる）} を返す
```

**実装の流れ**

1. `authMiddleware` で認証必須にする
2. クエリパラメータ `mode`（例: `"SYMBOL_TO_NAME_LV1"`）を Zod で検証
3. `game.service.ts` の `generateQuestions(userId, mode)` を呼ぶ
4. サービス内で：
   - `Element.findMany()` で全元素を取得
   - 苦手モードの場合 `WeakElement` も考慮（苦手5問＋ランダム5問など）
   - ランダムに10問選ぶ
   - 各問の4択を生成（正解1問＋ランダム3問）
   - `GameQuestionSet` にシリアライズして保存
5. `questionSetId` と問題リストを返す（選択肢に正解の印はつけない）

**なぜそう作るのか**

- 正解情報をクライアントに渡すと、開発者ツールで簡単に答えが分かってしまう
- `GameQuestionSet` に有効期限(30分)を設けることで、古いセットでの不正回答を防止する
- `expiresAt` に index を張り、期限切れ cleanup がテーブル全走査にならないようにする

**よくあるミス**

- 4択の選択肢を毎回同じ順番で並べると「正解が常に1番目」のようなパターンが生まれる → **シャッフル必須**
- 苦手モードで苦手が5問未満のときのガード処理を忘れる

---

### 3-4. POST /game/sessions（設計決定1・2）

**目的**  
クライアントから回答を受け取り、正誤判定・スコア計算・DB保存を行う。  
苦手リストの自動更新と、習得カウントの更新もここで行う（設計決定1）。

**作成・変更ファイル**

```
backend/src/routes/game/index.ts          ← 実装追記
backend/src/services/game.service.ts      ← 実装追記
backend/src/routes/game/sessions.test.ts  ← テスト（新規作成）
```

**実装の流れ**

1. リクエスト `{ questionSetId, answers: [{ elementId, chosenElementId, answerTimeSec }] }` を Zod で検証
2. `GameQuestionSet` をDBから取得（存在・有効期限・自分のものか を確認）
3. 正誤判定：`answer.chosenElementId === correctElementId`
4. スコア計算：`answerTimeSec` が短いほど高スコア（例: `100 + max(0, 100 - answerTimeSec * 5)`）
5. `GameSession` と `GameAnswer` を DB に保存
6. `GameQuestionSet` を削除（使い捨て）
7. 苦手リスト更新：
   - 不正解なら `WeakElement.missCount++`、なければ作成
   - 正解なら `WeakElement.consecutiveHit++`（一定回数で苦手解除）
8. 習得カウント更新（設計決定1）：直近2ゲームの正解を集計して `UserStats.masteredCount` を更新
9. 結果をレスポンスで返す

**なぜそう作るのか**

- スコア計算・正誤判定をクライアントで行うと不正が容易になる。**全てサーバーサイドで計算**する
- `GameQuestionSet` の有効期限チェックは必須（古いセットで後からまとめて回答する不正を防ぐ）

**よくあるミス**

- `questionSetId` が他のユーザーのものである場合に弾かない → 必ず `userId` が一致するか確認する
- `GameQuestionSet` の削除を忘れると、同じセットで何度も回答できてしまう

---

### 3-5. 期限切れ GameQuestionSet クリーンアップ

**目的**
回答されずに期限切れになった `GameQuestionSet` を削除し、テーブル肥大化と古い一時データの残留を防ぐ。

**作成・変更ファイル**

```
backend/src/jobs/cleanupGameQuestionSets.ts  ← 新規作成（手動実行・Cron共用）
backend/src/jobs/cleanupGameQuestionSets.test.ts  ← テスト（新規作成）
```

**実装の流れ**

1. `expiresAt < now` の `GameQuestionSet` を `deleteMany` で削除する
2. 削除件数を構造化ログに出す（個人情報は含めない）
3. 開発環境では手動実行、本番では Cloudflare Workers Cron Trigger で定期実行する
4. `expiresAt` index が Prisma schema / migration に反映されていることを確認する

---

### 3-6. GET /game/sessions

**目的**  
ログインユーザーのゲーム履歴一覧を返す。

**作成・変更ファイル**

```
backend/src/routes/game/index.ts            ← 実装追記
backend/src/routes/game/game-sessions.test.ts ← テスト（新規作成）
```

**実装の流れ**

1. `authMiddleware` で認証必須にする
2. `GameSession.findMany({ where: { userId }, orderBy: { playedAt: "desc" } })` で取得
3. 件数が多い場合はページネーション（`take`, `skip`）も検討

---

### 3-7. GET /weak + DELETE /weak/:elementId

**目的**  
- `GET /weak`：ユーザーの苦手リストを返す
- `DELETE /weak/:elementId`：苦手リストから手動削除する

**作成・変更ファイル**

```
backend/src/routes/weak/index.ts          ← 実装（既存ファイルを編集）
backend/src/services/weak.service.ts      ← 実装（既存ファイルを編集）
backend/src/routes/weak/weak.test.ts      ← テスト（新規作成）
```

**実装の流れ（GET）**

1. `authMiddleware` で認証必須
2. `WeakElement.findMany({ where: { userId }, include: { element: true }, orderBy: { missCount: "desc" } })`
3. `element` の `symbol`, `nameJa` も一緒に返す

**実装の流れ（DELETE）**

1. `:elementId` を取得・`parseInt` でパース
2. `WeakElement.deleteMany({ where: { userId, elementId } })` で削除
3. `deleteMany` を使うと「存在しない場合」も 200 で返せる（404 にしたい場合は先に存在チェック）

**よくあるミス**

- 他のユーザーの苦手を削除できてしまう（`where` に `userId` を含め忘れる）

---

## フェーズ4: ユーザー・ランキング・管理者 API

### 4-1. GET /users/me + PATCH /users/me + DELETE /users/me

**目的**  
自分のプロフィールの取得・更新・削除。

**作成・変更ファイル**

```
backend/src/routes/users/index.ts       ← 実装（既存ファイルを編集）
backend/src/routes/users/users.test.ts  ← テスト（新規作成）
```

**PATCH のポイント**

- 変更できる項目: `username`（重複チェック必須）、`password`（現在パスワードの確認必須）
- パスワード変更時は現在のパスワードを `bcrypt.compare` で確認してから新しいハッシュを保存する
- 変更後は全リフレッシュトークンを無効化する（セキュリティのため）

**DELETE のポイント**

- 即時削除ではなく「パスワード確認後に削除」する
- Prisma スキーマに `onDelete: Cascade` が設定されているため、User を削除すれば関連データも自動削除される

---

### 4-2. GET /users/me/stats

**目的**  
ゲームの累計統計（プレイ回数・最高スコア・習得数など）を返す。

**作成・変更ファイル**

```
backend/src/routes/users/index.ts       ← 追記
backend/src/routes/users/users.test.ts  ← テスト追加
```

**UserStats テーブル**  
毎回集計クエリを投げると重くなるため、`UserStats` テーブルにキャッシュしている。  
ゲーム終了時（POST /game/sessions）に `upsert` で更新する設計。

---

### 4-3. GET /ranking/weekly + /alltime

**目的**  
上位50ユーザーのスコアランキングを返す。ログインユーザーには自分の順位も含める。

**作成・変更ファイル**

```
backend/src/routes/ranking/index.ts       ← 実装（既存ファイルを編集）
backend/src/routes/ranking/ranking.test.ts ← テスト（新規作成）
```

**myRank の取得方法**

```
// 自分より高スコアのユーザー数 + 1 = 自分の順位
const myRank = await prisma.userStats.count({
  where: { weeklyScore: { gt: myWeeklyScore } }
}) + 1;
```

---

### 4-4. 週間スコアリセットバッチ処理

**目的**  
毎週月曜日0時に全ユーザーの `weeklyScore` を 0 にリセットする。

**作成・変更ファイル**

```
backend/src/jobs/weeklyReset.ts  ← 新規作成（cronジョブ）
```

**実装方法**

- Node.js の `node-cron` パッケージを使って定期実行する
- または、Cloudflare Workers の Cron Trigger（デプロイ後に設定）
- `GameQuestionSet` cleanup と同じ Cron 運用方針に寄せ、ジョブの実行ログ・失敗通知を共通化する

---

### 4-5. Admin APIs

**目的**  
管理者がユーザーを管理するためのAPI群。

**作成・変更ファイル**

```
backend/src/routes/admin/index.ts       ← 実装（既存ファイルを編集）
backend/src/routes/admin/admin.test.ts  ← テスト（新規作成）
```

**重要**: `middleware/admin/index.ts` の `adminMiddleware` を必ず適用する。  
`authMiddleware` → `adminMiddleware` の順で適用する。

---

### 4-6. 管理者作成CLIコマンド

**目的**  
セキュリティ上、管理者アカウントは UI からは作成できない。CLI から作成する。

**作成・変更ファイル**

```
backend/src/scripts/createAdmin.ts  ← 新規作成
```

**実装の流れ**

```bash
# 使用例
npx ts-node src/scripts/createAdmin.ts --email admin@example.com --password Secure1!
```

---

### 4-7. 監査ログ実装

**目的**  
「誰が・いつ・何をしたか」を記録する。セキュリティ事故の調査に使う。

**記録すべき操作**

- ログイン成功・失敗
- パスワード変更
- 管理者操作（ユーザー停止・ロール変更・強制退会）

**注意**: 個人情報（メールアドレス・パスワード等）はログに含めない。

---

## フェーズ5: セキュリティ基盤

### 5-1. セキュリティヘッダーミドルウェア

**目的**  
XSS・クリックジャッキング・MIME タイプスニッフィングなどの攻撃を防ぐ HTTP ヘッダーを付与する。

**作成・変更ファイル**

```
backend/src/middleware/security/index.ts  ← 実装（既存ファイルを編集）
```

**設定すべきヘッダー**

| ヘッダー | 役割 |
|---|---|
| `Content-Security-Policy` | XSS対策。許可するスクリプト・リソースの出所を制限 |
| `Strict-Transport-Security` | HTTPS 強制 |
| `X-Frame-Options: DENY` | クリックジャッキング対策 |
| `X-Content-Type-Options: nosniff` | MIME タイプの推測を禁止 |
| `Referrer-Policy` | リファラー情報の漏洩を制限 |

---

### 5-2. APIレート制限ミドルウェア

**目的**  
大量のリクエストを連続送信する攻撃（DDoS・ブルートフォース）を防ぐ。

**作成・変更ファイル**

```
backend/src/middleware/rateLimit/index.ts  ← 実装（既存ファイルを編集）
```

**制限値（`docs/02_security.md` より）**

| 対象 | 制限 |
|---|---|
| 認証系（login/register/forgot-password/reset-password） | 10分間に10リクエスト |
| ゲーム結果送信（POST /game/sessions） | 1分間に20リクエスト |
| 一般API | 1分間に60リクエスト |

**実装の選択肢**

- インメモリで管理（シンプル・Dockerを再起動するとリセットされる）
- Redis で管理（本番向け・複数インスタンスに対応）
- Cloudflare 側のエッジ制限で大量アクセスを先に遮断する（本番向け）
- 今フェーズはテストしやすいミドルウェア境界で実装し、本番では Cloudflare 側の制限と併用する
- Workers のインスタンス内メモリだけに依存せず、ユーザーID/IP単位で制限できる設計にしておく

---

### 5-3. CORS設定

**目的**  
フロントエンド（Vercel）以外のドメインからのリクエストを拒否する。

**作成・変更ファイル**

```
backend/src/index.ts  ← CORS ミドルウェアを追加
```

**重要な制約（`copilot-instructions.md` より）**

```ts
// NG: ワイルドカードは禁止
app.use(cors({ origin: "*" }));

// OK: 環境変数で許可オリジンを管理
app.use(cors({ origin: process.env.FRONTEND_URL }));
```

---

## フェーズ6: フロントエンド共通

> バックエンドとは異なり、フロントエンドは SvelteKit を使います。

### 6-1. SvelteKitルーティング・共通レイアウト

**作成・変更ファイル**

```
frontend/src/routes/+layout.svelte   ← ナビゲーションバーなど共通UI
frontend/src/app.html                ← HTMLテンプレート（既存）
frontend/src/app.css                 ← グローバルCSS（Tailwind）
```

**SvelteKit のルーティング基本**

```
frontend/src/routes/
  +layout.svelte    ← 全ページ共通のレイアウト
  +page.svelte      ← / (トップページ)
  login/
    +page.svelte    ← /login
  game/
    +page.svelte    ← /game
    play/
      +page.svelte  ← /game/play
```

---

### 6-2. 認証Store

**目的**  
ログイン状態（アクセストークン・ユーザー情報）をアプリ全体で共有するための Svelte ストア。

**作成・変更ファイル**

```
frontend/src/lib/stores/auth.ts  ← 新規作成
```

**設計のポイント**

```ts
// Svelteストア（メモリ上に保存）
export const authStore = writable<{ token: string; user: User } | null>(null);

// sessionStorage にも保存（ページリロード後に復元できるように）
// ※ localStorage は XSS リスクがあるため使わない
```

---

### 6-3. APIクライアント関数

**目的**  
各APIへのリクエストを関数化して再利用しやすくする。

**作成・変更ファイル**

```
frontend/src/lib/api/auth.ts      ← 認証系API
frontend/src/lib/api/elements.ts  ← 元素系API
frontend/src/lib/api/game.ts      ← ゲーム系API
frontend/src/lib/api/weak.ts      ← 苦手系API
frontend/src/lib/api/users.ts     ← ユーザー系API
frontend/src/lib/api/ranking.ts   ← ランキング系API
frontend/src/lib/api/client.ts    ← 共通フェッチ設定（ベースURL・エラーハンドリング）
```

**共通クライアントのイメージ**

```ts
// lib/api/client.ts
const BASE_URL = import.meta.env.VITE_API_BASE_URL;

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const token = get(authStore)?.token;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message ?? "APIエラー");
  }
  return res.json();
}
```

---

## フェーズ7〜10: フロントエンドページ

> 基本的に「フェーズ6で作ったAPIクライアント・認証Storeを使って UI を組む」作業です。

### 共通のページ実装パターン

```svelte
<!-- +page.svelte の基本構造 -->
<script lang="ts">
  import { onMount } from "svelte";
  import { getElements } from "$lib/api/elements";
  import type { Element } from "$lib/types";

  let elements: Element[] = [];
  let loading = true;
  let error: string | null = null;

  onMount(async () => {
    try {
      elements = await getElements();
    } catch (e) {
      error = e instanceof Error ? e.message : "エラーが発生しました";
    } finally {
      loading = false;
    }
  });
</script>

{#if loading}
  <p>読み込み中...</p>
{:else if error}
  <p class="text-red-500">{error}</p>
{:else}
  <!-- コンテンツ -->
{/if}
```

### 各ページの目的早見表

| ページ | パス | 目的 |
|---|---|---|
| ログイン | `/login` | メール・パスワードを入力してログイン |
| ユーザー登録 | `/register` | アカウント作成フォーム |
| パスワードリセット | `/reset-password` | パスワード忘れた時の再設定 |
| プロフィール設定 | `/settings` | ユーザー名変更・アカウント削除 |
| 元素一覧 | `/elements` | 118元素をカードグリッドで表示 |
| ゲームモード選択 | `/game` | 通常/苦手モードの選択 |
| ゲームプレイ | `/game/play` | 問題表示・回答・タイマー |
| ゲーム結果 | `/game/result` | スコアと正誤一覧 |
| 苦手リスト | `/weak` | 苦手な元素の一覧・削除 |
| マイページ | `/mypage` | 統計グラフ・サマリー |
| ランキング | `/ranking` | 週間・全期間ランキング |
| 管理者ダッシュボード | `/admin` | ユーザー管理（管理者のみ） |

---

## フェーズ11: デプロイ

**デプロイ先の構成**

```
GitHub ─→ GitHub Actions
              │
              ├─→ Cloudflare Workers（バックエンド: Hono）
              └─→ Vercel（フロントエンド: SvelteKit）
                       │
                    Supabase（PostgreSQL）
```

**手順の大まかな流れ**

1. Supabase でプロジェクト作成 → `DATABASE_URL` を取得
2. 本番DBバックアップ取得状況を確認
3. GitHub Actions で `prisma migrate deploy` を実行
4. Cloudflare Workers に `wrangler deploy` でバックエンドをデプロイ
5. Vercel に SvelteKit をデプロイ
6. GitHub Actions で push 時に自動デプロイされるよう設定

**リリース前に必ず決めること**

- `prisma migrate deploy` は API デプロイ前に実行する
- DB変更は expand/contract 方式で後方互換を保つ
- 500系エラーを検知するエラートラッキングまたは構造化ログの通知先を設定する
- 認証系・一般API・`POST /game/sessions` のレート制限を本番設定に反映する

---

## 実装時の共通チェックリスト

各タスクを完了する前に以下を確認してください。

```
[ ] Zod でリクエストのバリデーションをしているか
[ ] 認証が必要なルートに authMiddleware を適用しているか
[ ] 他のユーザーのデータにアクセスできないか確認したか（userId の一致チェック）
[ ] エラーレスポンスにスタックトレースや DB エラー詳細が含まれていないか
[ ] テスト（*.test.ts）を先に書いて TDD で実装したか
[ ] npm run lint / npm run format:check / npm run test -- --run が全て通るか
[ ] 05_progress.md に完了マークをつけたか
```

---

## 技術スタック早見表

| 用途 | ライブラリ | 使う場所 |
|---|---|---|
| バリデーション | `zod` | ルートハンドラの入口 |
| パスワードハッシュ | `bcryptjs` | auth.service.ts |
| JWT発行・検証 | `hono/jwt` | routes/auth・middleware/auth |
| ORM | `prisma` | lib/prisma.ts 経由で使う |
| メール送信 | `nodemailer` | lib/mail.ts 経由で使う |
| テスト | `vitest` | *.test.ts |
| 乱数（セキュア） | `crypto.randomBytes` | トークン生成 |
| Svelte状態管理 | `svelte/store` | lib/stores/ |
| UIスタイル | `Tailwind CSS v4` | frontend/src/ |
