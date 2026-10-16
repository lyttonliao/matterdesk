// BIG PICTURE
// Turns the request's session cookie into the logged-in user, or null
// Server code calls getCurrentUser() and passes user.id to withUser(), so the
// database identity always comes from the session and never from client input.
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { db } from "@/db";
import { users } from "@/db/schema";
import { SESSION_COOKIE } from "./cookie";
import { validateSession } from "./session";

// cache() deduplicates within one request: a layout and a page that both calls this
// share one cookie read and one pair of queries
export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await validateSession(token);
  if (!session) return null;

  const [user] = await db
    .select({ id: users.id, role: users.role, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, session.userId));
  return user ?? null;
});
