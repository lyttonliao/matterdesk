// BIG PICTURE
// Login logic, independent of Next so it can be unit tested. Returns a new session
// token or a failure reason. Two protections against account probing:
// 1. unknown email and wrong password are indistinguishable and verifyPassword()
// spends one full Argon2 check either way, so timing matches
// 2. Failed attempts are counted per email, known or not, and lock that email for
// a window after MAX_FAILURES
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "./password";
import { createSession } from "./session";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

// shortcut: in-memory counters reset on restart and are per instance, so with
// several ECS tasks an attacker gets MAX_FAILURES per task.
// Upgrade to a shared store (Redis or a login_attempts table) before running more
// than one instance
const failures = new Map<string, { count: number; resetAt: number }>();

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; reason: "invalid" | "rate_limited" };

export async function login(
  rawEmail: string,
  password: string,
): Promise<LoginResult> {
  const email = rawEmail.trim().toLowerCase();

  const entry = failures.get(email);
  if (entry && entry.resetAt > Date.now() && entry.count >= MAX_FAILURES) {
    return { ok: false, reason: "rate_limited" };
  }

  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email));

  // null hash for an unknown email: verifyPassword burns the same time and returns false
  const ok = await verifyPassword(user?.passwordHash ?? null, password);
  if (!ok || !user) {
    const live = entry && entry.resetAt > Date.now() ? entry : null;
    failures.set(email, {
      count: (live?.count ?? 0) + 1,
      resetAt: live?.resetAt ?? Date.now() + WINDOW_MS,
    });
    return { ok: false, reason: "invalid" };
  }

  failures.delete(email);
  // A fresh token on every login, so a pre-login token can never become a session
  // (session fixation).
  return { ok: true, ...(await createSession(user.id)) };
}
