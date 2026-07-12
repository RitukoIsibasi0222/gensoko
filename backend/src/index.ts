import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const app = createApp({ isProduction: process.env.NODE_ENV === "production" });

// サーバー起動
const port = Number(process.env.PORT ?? 3000);
console.log(`Server is running on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
