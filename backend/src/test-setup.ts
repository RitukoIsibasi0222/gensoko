import { vi } from "vitest";

// レート制限ミドルウェアをテスト環境でスルーにする
vi.mock("./middleware/rateLimit/index.js", () => ({
  rateLimit: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));
