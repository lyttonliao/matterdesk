// BIG PICTURE
// The shape of the environment variables the app needs. Kept apart from env.ts so
// tests can import the schema without triggering the parse of the real process.env.
// The app only gets APP_DATABASE_URL (the RLS-bound firm_app role). The owner
// DATABASE_URL is for migrations and is read by drizzle.config.ts alone.
import { z } from "zod";

export const schema = z.object({
  APP_DATABASE_URL: z.url(),
});
