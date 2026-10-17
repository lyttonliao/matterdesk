// BIG PICTURE
// Login behavior: success, the two failure modes look identical, and the per-email
// lockout. Each test uses its own email, so the in-memory failure counters
// never collide.
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { client } from "@/db";
import { sessions, users } from "@/db/schema";
import { ownerDb, ownerSql } from "@/db/test-owner";
import { login } from "./login";
import { hashPassword } from "./password";

const tag = randomUUID().slice(0, 8);
const userIds: string[] = [];

afterAll(async () => {
  await ownerDb.delete(users).where(inArray(users.id, userIds));
  await ownerSql.end();
  await client.end();
});

async function makeUser(name: string, password: string) {
  const email = `login-${name}-${tag}@test.local`;
  const [user] = await ownerDb
    .insert(users)
    .values({
      username: `login-${name}-${tag}`,
      fullName: "Login test user",
      passwordHash: await hashPassword(password),
      email,
      role: "attorney",
    })
    .returning({ id: users.id });
  userIds.push(user.id);
  return { id: user.id, email };
}

describe("login", () => {
  it("returns a session token for the right credentials", async () => {
    const { id, email } = await makeUser("ok", "correct horse");

    const result = await login(email.toUpperCase(), "correct horse");

    expect(result.ok).toBe(true);
    const rows = await ownerDb
      .select()
      .from(sessions)
      .where(eq(sessions.userId, id));
    expect(rows).toHaveLength(1);
  });

  it("fails identically for a wrong password and an unknown email", async () => {
    const { email } = await makeUser("bad", "correct horse");

    const wrong = await login(email, "wrong horse");
    const unknown = await login("wrong", "correct horse");

    expect(wrong).toEqual({ ok: false, reason: "invalid" });
    expect(unknown).toEqual(wrong);
  });

  it("locks an email after 5 failures, even with the right password", async () => {
    const { email } = await makeUser("lock", "correct horse");

    for (let i = 0; i < 5; i++) await login(email, "wrong horse");
    const result = await login(email, "correct horse");

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
  });
});
