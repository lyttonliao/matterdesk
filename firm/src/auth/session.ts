// BIG PICTURE
// Server-side sessions, createSession() makes a random token for the cookie
// and stores only its SHA-256 hash; validateSession() turns a cookie token back
// into a user id or null. Logging out is deleting the row, so it takes effect
// immediately. Queries use `db` direction, not withUser(): at validation time
// we do not yet know who the user is, which is why `sessions` has no RLS
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
// Sliding expiry: extend only once less than half the lifetime remains, so an
// active user stays logged in but we do not write to the database on every request.
const RENEW_BELOW_MS = SESSION_LIFETIME_MS / 2;

// SHA-256 (fast) is fine here, unlike for passwords: the token is 256 bits, so
// there is nothing to brute-force even if the hash leaks
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  // The raw token is returned once, for the cookie. It is never stored
  return { token, expiresAt };
}

export async function validateSession(token: string) {
  const id = hashToken(token);
  const [session] = await db
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.id, id));
  if (!session) return null;

  const remaining = session.expiresAt.getTime() - Date.now();
  if (remaining <= 0) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  if (remaining < RENEW_BELOW_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS) })
      .where(eq(sessions.id, id));
  }
  return { userId: session.userId };
}

export async function deleteSession(token: string) {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function deleteUserSessions(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
