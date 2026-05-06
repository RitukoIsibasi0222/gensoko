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

```sql
-- ゲーム履歴の検索高速化
CREATE INDEX idx_game_sessions_user_played ON game_sessions(user_id, played_at DESC);

-- 苦手リストの検索
CREATE INDEX idx_weak_elements_user ON weak_elements(user_id);

-- ランキング用
CREATE INDEX idx_user_stats_weekly ON user_stats(weekly_score DESC);
CREATE INDEX idx_user_stats_alltime ON user_stats(all_time_score DESC);

-- リフレッシュトークンの有効期限チェック
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);
```
