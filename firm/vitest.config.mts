// BIG PICTURE
// Config for Vitest, the test runner (`pnpm test`). Tests live next to the code as
// *.test.ts. They run in plain Node (no browser), and "@/..." imports resolve to
// src/ exactly as they do in the app.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests talk to the Compose Postgres, so they need APP_DATABASE_URL.
// Vitest workers inherit process.env, so loading it here is enough.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
