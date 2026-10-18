// BIG PICTURE
// Integration tests for the matter data layer, against the real dev Postgres.
// Each test builds the data it needs through small helpers, so tests do not depend on
// each other or on run order. Everything created is tracked and removed in afterAll.
// Two connections: fixtures and verification use the owner role (bypasses RLS); the
// functions under test use firm_app via "@/db", exactly as the running app does.
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { client } from "@/db";
import { clients, matterMembers, matters, users } from "@/db/schema";
import { createMatter, getMatterForUser, listMattersForUser } from "./matters";
import { ownerDb as db, ownerSql } from "./test-owner";

const tag = randomUUID().slice(0, 8); // unique per run, keeps unique columns collision-free

let seq = 0; // unique per call, so two users with the same label cannot collide
const userIds: string[] = [];
const clientIds: string[] = [];

async function makeUser(label: string) {
  const unique = `${label}-${tag}-${seq++}`;
  const [user] = await db
    .insert(users)
    .values({
      fullName: `Test ${label}`,
      username: unique,
      passwordHash: "x",
      email: `${unique}@test.local`,
      role: "attorney",
    })
    .returning({ id: users.id });
  userIds.push(user.id);
  return user.id;
}

async function makeClient() {
  const [row] = await db
    .insert(clients)
    .values({ fullName: `Test Client ${tag}` })
    .returning({ id: clients.id });
  clientIds.push(row.id);
  return row.id;
}

// Seeds a matter directly (not through createMatter), so tests of the read functions
// do not depend on the write function being correct.
async function seedMatter(
  clientId: string,
  memberIds: string[],
  title: string,
  status: "open" | "pending" | "closed" = "open",
) {
  const [matter] = await db
    .insert(matters)
    .values({
      clientId,
      title,
      type: "will",
      status,
      createdBy: memberIds[0],
    })
    .returning({ id: matters.id });
  await db
    .insert(matterMembers)
    .values(memberIds.map((userId) => ({ matterId: matter.id, userId })));
  return matter.id;
}

afterAll(async () => {
  // matters first: matters.client_id has no cascade. This also cascades to members.
  await db.delete(matters).where(inArray(matters.clientId, clientIds));
  await db.delete(clients).where(inArray(clients.id, clientIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await ownerSql.end();
  await client.end();
});

describe("createMatter", () => {
  it("creates an open matter and makes the creator a member", async () => {
    const userId = await makeUser("creator");
    const clientId = await makeClient();

    const matter = await createMatter(
      { clientId, title: `new-${tag}`, type: "medicaid" },
      userId,
    );

    expect(matter).toMatchObject({ title: `new-${tag}`, status: "open" });
    const visible = await listMattersForUser(userId);
    expect(visible.map((m) => m.id)).toEqual([matter.id]);
  });

  it("leaves no matter behind when the creator does not exist", async () => {
    const clientId = await makeClient();
    const title = `rollback-${tag}`;

    // random uuid = no such user, so the matter_members foreign key rejects it
    await expect(
      createMatter({ clientId, title, type: "will" }, randomUUID()),
    ).rejects.toThrow();

    const leftovers = await db
      .select({ id: matters.id })
      .from(matters)
      .where(eq(matters.title, title));
    expect(leftovers).toEqual([]);
  });
});

describe("getMatterForUser", () => {
  it("returns the matter to a member", async () => {
    const userId = await makeUser("member");
    const matterId = await seedMatter(
      await makeClient(),
      [userId],
      `get-${tag}`,
    );

    const matter = await getMatterForUser(matterId, userId);

    expect(matter).toMatchObject({ id: matterId, title: `get-${tag}` });
  });

  it("returns null to a user who is not a member", async () => {
    const member = await makeUser("member");
    const outsider = await makeUser("outsider");
    const matterId = await seedMatter(
      await makeClient(),
      [member],
      `private-${tag}`,
    );

    expect(await getMatterForUser(matterId, outsider)).toBeNull();
  });

  it("returns null for an id that does not exist", async () => {
    const userId = await makeUser("member");

    expect(await getMatterForUser(randomUUID(), userId)).toBeNull();
  });
});

describe("listMattersForUser", () => {
  it("returns only the user's own matters, newest first", async () => {
    const me = await makeUser("me");
    const other = await makeUser("other");
    const clientId = await makeClient();
    const first = await seedMatter(clientId, [me], `first-${tag}`);
    const second = await seedMatter(clientId, [me], `second-${tag}`);
    await seedMatter(clientId, [other], `not-mine-${tag}`);

    const list = await listMattersForUser(me);

    expect(list.map((m) => m.id)).toEqual([second, first]);
  });

  it("returns an empty list for a user with no memberships", async () => {
    const userId = await makeUser("lonely");

    expect(await listMattersForUser(userId)).toEqual([]);
  });

  it("returns the user's matters filtered by status", async () => {
    const userId = await makeUser("creator");
    const clientId = await makeClient();
    const open = await seedMatter(clientId, [userId], `first-${tag}`);
    await seedMatter(clientId, [userId], `first-${tag}`, "closed");

    const list = await listMattersForUser(userId, "open");

    expect(list.map((m) => m.id)).toEqual([open]);
  });
});
