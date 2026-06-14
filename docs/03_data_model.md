# データモデル設計書

> ORM: **Prisma** / DB: PostgreSQL
> 実装時は `npx prisma migrate dev` でマイグレーションを実行します
> 下記のスキーマを `backend/prisma/schema.prisma` にそのまま使用します

---

## テーブル一覧

| テーブル名 | 役割 |
|-----------|------|
| `Element` | 元素マスターデータ（固定データ） |
| `User` | ユーザーアカウント |
| `RefreshToken` | リフレッシュトークン管理 |
| `WeakElement` | 苦手リスト |
| `GameSession` | ゲーム1回分の記録 |
| `GameAnswer` | ゲーム内の各問の回答記録 |
| `UserStats` | ユーザー集計統計（キャッシュ用） |

---

## Prismaスキーマ

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─────────────────────────────────────────
// 元素マスター（固定データ・更新なし）
// ─────────────────────────────────────────
model Element {
  id          Int     @id                  // 原子番号（1〜118）
  symbol      String  @unique              // 元素記号（例: "H"）
  nameJa      String                       // 日本語名（例: "水素"）
  nameEn      String                       // 英語名（例: "Hydrogen"）
  category    String                       // 分類（例: "非金属"）
  period      Int                          // 周期（1〜7）
  group       Int?                         // 族（1〜18, null=ランタノイド等）
  atomicWeight Float?                      // 標準原子量
  etymology    String?                      // 名前・記号の由来（日本語）

  // リレーション
  weakElements  WeakElement[]
  gameAnswers   GameAnswer[]

  @@map("elements")
}

// ─────────────────────────────────────────
// ユーザー
// ─────────────────────────────────────────
model User {
  id              String    @id @default(cuid())
  username        String    @unique          // 表示名（3〜20文字、英数字_のみ）
  email           String    @unique
  passwordHash    String                     // bcryptハッシュ
  role            Role      @default(USER)
  emailVerified   Boolean   @default(false)
  isActive        Boolean   @default(true)  // 停止フラグ
  loginFailCount  Int       @default(0)     // ログイン失敗回数
  lockedUntil     DateTime?                 // ロック解除日時
  lastLoginAt     DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  // リレーション
  refreshTokens   RefreshToken[]
  weakElements    WeakElement[]
  gameSessions    GameSession[]
  stats           UserStats?

  @@map("users")
}

enum Role {
  USER
  ADMIN
}

// ─────────────────────────────────────────
// リフレッシュトークン
// ─────────────────────────────────────────
model RefreshToken {
  id        String   @id @default(cuid())
  tokenHash String   @unique              // トークンのSHA-256ハッシュ
  userId    String
  expiresAt DateTime
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("refresh_tokens")
}

// ─────────────────────────────────────────
// 苦手リスト
// ─────────────────────────────────────────
model WeakElement {
  id              String   @id @default(cuid())
  userId          String
  elementId       Int
  missCount       Int      @default(1)    // 間違えた回数
  consecutiveHit  Int      @default(0)    // 苦手ゲームでの連続正解数
  addedAt         DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  element Element @relation(fields: [elementId], references: [id])

  @@unique([userId, elementId])           // 同一ユーザーで同一元素は1行のみ
  @@map("weak_elements")
}

// ─────────────────────────────────────────
// ゲームセッション（1ゲーム = 1セッション）
// ─────────────────────────────────────────
model GameSession {
  id          String      @id @default(cuid())
  userId      String
  mode        GameMode
  totalScore  Int
  correctCount Int
  totalCount  Int         @default(10)
  maxStreak   Int         @default(0)    // 最大連続正解数
  durationSec Int                        // かかった秒数
  playedAt    DateTime    @default(now())

  user    User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  answers GameAnswer[]

  @@map("game_sessions")
}

enum GameMode {
  SYMBOL_TO_NAME_LV1
  SYMBOL_TO_NAME_LV2
  NAME_TO_SYMBOL_LV1
  NAME_TO_SYMBOL_LV2
  WEAK_SYMBOL_TO_NAME
  WEAK_NAME_TO_SYMBOL
}

// ─────────────────────────────────────────
// ゲーム内の各問の回答記録
// ─────────────────────────────────────────
model GameAnswer {
  id            String  @id @default(cuid())
  sessionId     String
  elementId     Int
  isCorrect     Boolean
  answerTimeSec Int                          // 回答にかかった秒数

  session GameSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  element Element     @relation(fields: [elementId], references: [id])

  @@map("game_answers")
}

// ─────────────────────────────────────────
// ユーザー統計（集計キャッシュ）
// ─────────────────────────────────────────
model UserStats {
  userId            String   @id
  totalGames        Int      @default(0)
  totalCorrect      Int      @default(0)
  totalAnswered     Int      @default(0)
  masteredCount     Int      @default(0)    // 習得済み元素数
  currentStreak     Int      @default(0)    // 連続ログイン日数
  lastActiveDate    DateTime?
  weeklyScore       Int      @default(0)    // 週間スコア（ランキング用）
  allTimeScore      Int      @default(0)    // 全期間スコア
  updatedAt         DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_stats")
}
```

---

## 元素分類の定義

| 日本語名 | 英語名 |
|---------|--------|
| 非金属 | Nonmetal |
| アルカリ金属 | Alkali Metal |
| アルカリ土類金属 | Alkaline Earth Metal |
| 遷移金属 | Transition Metal |
| 後遷移金属 | Post-transition Metal |
| 半金属 | Metalloid |
| ハロゲン | Halogen |
| 希ガス | Noble Gas |
| ランタノイド | Lanthanide |
| アクチノイド | Actinide |

---

## インデックス設計

> 実装時は SQL 直書きではなく、原則 `backend/prisma/schema.prisma` の `@@index` / `@@unique` に反映し、Prisma migration として管理する。
> 下記は本番前に schema と整合させる対象。新しい検索条件を追加した場合はこの表も更新する。

```sql
-- ゲーム履歴の検索高速化
CREATE INDEX idx_game_sessions_user_played ON "game_sessions"("userId", "playedAt" DESC);

-- ゲーム回答の集計高速化
CREATE INDEX idx_game_answers_session ON "game_answers"("sessionId");
CREATE INDEX idx_game_answers_element ON "game_answers"("elementId");

-- 苦手リストの検索
CREATE INDEX idx_weak_elements_user ON "weak_elements"("userId");

-- ランキング用
CREATE INDEX idx_user_stats_weekly ON "user_stats"("weeklyScore" DESC);
CREATE INDEX idx_user_stats_alltime ON "user_stats"("allTimeScore" DESC);

-- リフレッシュトークンの有効期限チェック
CREATE INDEX idx_refresh_tokens_expires ON "refresh_tokens"("expiresAt");

-- メール認証・パスワードリセット・一時問題セットの期限切れ cleanup
CREATE INDEX idx_email_verifications_expires ON "email_verifications"("expiresAt");
CREATE INDEX idx_password_reset_tokens_expires ON "password_reset_tokens"("expiresAt");
CREATE INDEX idx_game_question_sets_expires ON "game_question_sets"("expiresAt");
CREATE INDEX idx_game_question_sets_user_created ON "game_question_sets"("userId", "createdAt" DESC);
```
