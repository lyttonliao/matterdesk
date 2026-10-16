// BIG PICTURE
// Owner-role connection for test fixtures. The owner bypasses RLS, so
// tests can seed and clean up any rows and check what really happened in the database.
// The code under test runs as firm_app through "@/db", where RLS applies

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const ownerUrl = process.env.DATABASE_URL;
if (!ownerUrl)
  throw new Error("DATABASE_URL (owner role) is required for tests");

export const ownerSql = postgres(ownerUrl);
export const ownerDb = drizzle(ownerSql);
