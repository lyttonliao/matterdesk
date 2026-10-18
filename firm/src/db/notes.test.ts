// BIG PICTURE
// Notes access control and closeMatter, against the real database.
// Fitures are seeded as the owner (bypasses RLS); everything under test runs as
// firm_app through withUser.
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client } from "@/db";
import { clients, matterMembers, matters, notes, users } from "@/db/schema";
import { closeMatter } from "./matters";
import { addNote, listNotes } from "./notes";
import { ownerDb, ownerSql } from "./test-owner";
import { withUser } from "./with-user";

const tag = randomUUID().slice(0, 8);
const denied = { cause: { code: "42501" } }; // RLS refused
const checkViolation = { cause: { code: "23514" } }; // check constraint

let alice: string; // attorney, member
let bob: string; // attorney, NOT a member
let carol: string; // client, member
let clientId: string;
let matterId: string;

beforeAll(async () => {
  const rows = await ownerDb
    .insert(users)
    .values(
      [
        ["alice", "attorney"],
        ["bob", "attorney"],
        ["carol", "client"],
      ].map(([name, role]) => ({
        fullName: name,
        username: `${name}-${tag}`,
        passwordHash: "x",
        email: `${name}-${tag}@test.local`,
        role,
      })),
    )
    .returning({ id: users.id });
  [alice, bob, carol] = rows.map((r) => r.id);

  const [c] = await ownerDb
    .insert(clients)
    .values({ fullName: `Test Client ${tag}` })
    .returning({ id: clients.id });
  clientId = c.id;

  const [m] = await ownerDb
    .insert(matters)
    .values({ clientId, title: `notes-${tag}`, type: "will", createdBy: alice })
    .returning({ id: matters.id });
  matterId = m.id;

  await ownerDb.insert(matterMembers).values([
    { matterId, userId: alice },
    { matterId, userId: carol },
  ]);
});

afterAll(async () => {
  await ownerDb.delete(matters).where(eq(matters.clientId, clientId));
  await ownerDb.delete(clients).where(eq(clients.id, clientId));
  await ownerDb.delete(users).where(inArray(users.id, [alice, bob, carol]));
  await ownerSql.end();
  await client.end();
});

describe("notes", () => {
  it("lets a staff member add a note and read it back with the author's name", async () => {
    await addNote(matterId, alice, `hello-${tag}`);

    const list = await listNotes(matterId, alice);

    expect(list.map((n) => [n.body, n.authorName])).toEqual([
      [`hello-${tag}`, "alice"],
    ]);
  });

  it("hides the notes from a non-member", async () => {
    expect(await listNotes(matterId, bob)).toEqual([]);
  });

  it("rejects a note from a non-member", async () => {
    await expect(addNote(matterId, bob, "x")).rejects.toMatchObject(denied);
  });

  it("rejects a note written in someone else's name", async () => {
    await expect(
      withUser(alice, (tx) =>
        tx.insert(notes).values({ matterId, authorId: bob, body: "forged" }),
      ),
    ).rejects.toMatchObject(denied);
  });

  it("keeps notes internal: a client-role member can neither read nor write", async () => {
    expect(await listNotes(matterId, carol)).toEqual([]);
    await expect(addNote(matterId, carol, "x")).rejects.toMatchObject(denied);
  });

  it("rejects a blank at the database", async () => {
    await expect(addNote(matterId, alice, "")).rejects.toMatchObject(
      checkViolation,
    );
  });
});

describe("closeMatter", () => {
  it("refuses a non-member, then closes for a member", async () => {
    expect(await closeMatter(matterId, bob)).toBe(false);
    expect(await closeMatter(matterId, alice)).toBe(true);
  });
});
