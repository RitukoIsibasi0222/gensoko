import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

if (process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV !== "false") {
  throw new Error("Workers testではdotenvの読み込みを無効にしてください");
}

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./.wrangler/test-build/wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["src/cloudflare/**/*.test.ts"],
  },
});
