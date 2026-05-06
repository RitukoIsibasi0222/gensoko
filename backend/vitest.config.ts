import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // テストファイルのパターン
    include: ["src/**/*.test.ts"],
    // グローバルに使えるようにする（describe/it/expect を import 不要にも可）
    globals: false,
  },
});
