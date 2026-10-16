// BIG PICTURE
// The app's database connection. It uses APP_DATABASE_URL, i.e. the restricted firm_app
// role, never the owner: a superuser or table owner bypasses Row-Level Security (RLS),
// so connecting as one would make every policy decorative. Migrations and test fixtures
// use the owner URL separately. Run queries through withUser() so RLS knows who is asking.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/env";
import * as schema from "./schema";

export const client = postgres(env.APP_DATABASE_URL);
export const db = drizzle(client, { schema });
