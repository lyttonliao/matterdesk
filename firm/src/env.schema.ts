// BIG PICTURE
// The shape of the environment variables the app needs. Kept apart from env.ts so
// tests can import the schema without triggering the parse of the real process.env.
import { z } from "zod";

export const schema = z.object({
  DATABASE_URL: z.url(),
});
