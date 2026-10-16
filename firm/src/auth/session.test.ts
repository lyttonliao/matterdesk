// BIG PICTURE
// Session lifecycle tests. Fixtures and direct row checks go through the owner
// connection; the code under test runs as firm_app through "@/db"
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { client } from "@/db";
import { sessions, users } from "@/db/schema";
import { ownerDb, ownerSql } from "@/db/test-owner";
import {
  createSession,
  deleteSession,
  deleteUserSessions,
  validateSession,
} from "./session";

const tag = randomUUID().slice(0, 8);
const userIds: string[] = [];
const DAY_MS = 24 * 60 * 60 * 1000;

afterAll(async () => {
  // sessions cascade-delete with their user
  await ownerDb.delete(users).where(inArray(users.id, userIds));
  await ownerSql.end();
  await client.end();
});

async function makeUser() {
  const n = userIds.length;
  const [user] = await ownerDb
    .insert(users)
    .values({
      fullName: "Session test user",
      username: `session-${tag}-${n}`,
      passwordHash: "x",
      email: `session-${tag}-${n}@test.local`,
      role: "attorney",
    })
    .returning({ id: users.id });
  userIds.push(user.id);
  return user.id;
}

async function rowsFor(userId: string) {
  return ownerDb.select().from(sessions).where(eq(sessions.userId, userId));
}

describe("sessions", () => {
  it("validates a fresh token and stores only its hash", async () => {
    const userId = await makeUser();
    const { token } = await createSession(userId);

    expect(await validateSession(token)).toEqual({ userId });
    const [row] = await rowsFor(userId);
    expect(row.id).not.toBe(token);
    expect(row.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects an unknown token", async () => {
    expect(await validateSession("not-a-real-token")).toBeNull();
  });

  it("rejects and deletes an expired session", async () => {
    const userId = await makeUser();
    const { token } = await createSession(userId);
    await ownerDb
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, userId));

    expect(await validateSession(token)).toBeNull();
    expect(await rowsFor(userId)).toHaveLength(0);
  });

  it("extends a session with under half of its lifetime left", async () => {
    const userId = await makeUser();
    const { token } = await createSession(userId);
    await ownerDb
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + 10 * DAY_MS) })
      .where(eq(sessions.userId, userId));

    await validateSession(token);

    const [row] = await rowsFor(userId);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * DAY_MS);
  });

  it("does not rewrite a session with more than half its lifetime left", async () => {
    const userId = await makeUser();
    const { token } = await createSession(userId);
    const [before] = await rowsFor(userId);

    await validateSession(token);

    const [after] = await rowsFor(userId);
    expect(before.expiresAt).toEqual(after.expiresAt);
  });

  it("deleteSession logs out one token, deleteUserSessions logs out of all", async () => {
    const userId = await makeUser();
    const a = await createSession(userId);
    const b = await createSession(userId);
    const c = await createSession(userId);

    await deleteSession(a.token);
    expect(await validateSession(a.token)).toBeNull();
    expect(await validateSession(b.token)).not.toBeNull();

    await deleteUserSessions(userId);
    expect(await validateSession(b.token)).toBeNull();
    expect(await validateSession(c.token)).toBeNull();
  });
});
