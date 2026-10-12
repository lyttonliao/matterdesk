// BIG PICTURE
// Config for drizzle-kit, the CLI behind `pnpm db:generate` (schema.ts -> SQL
// migration files in ./drizzle) and `pnpm db:migrate` (apply those files to the
// database in DATABASE_URL). The running app does not use this file.
import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit does not read .env itself (only Next.js does). The file is optional
// so CI can supply DATABASE_URL directly.
if (existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
