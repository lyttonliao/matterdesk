// BIG PICTURE
// Tests of the database's own access control, independent of the app's query code
// The queries here have no user filter on purpose: if rows are hidden or a write
// is refused, RLS and column privileges did it
// Fixtures are seeded as the owner (bypasses RLS); the queries under test run as firm_app

import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, db } from "@/db";
import { clients, documents, matterMembers, matters, users } from "@/db/schema";
import { ownerDb, ownerSql } from "./test-owner";
import { withUser } from "./with-user";

const tag = randomUUID().slice(0, 8);

// Postgres error code 42501 = insufficient_privilege. Covers both RLS policy rejecting
// a row and a missing column grant
const denied = { cause: { code: "42501" } };

let alice: string;
let bob: string;
let clientId: string;
let aliceMatter: string;
let bobMatter: string;

beforeAll(async () => {
  const [a, b] = await ownerDb
    .insert(users)
    .values(
      ["alice", "bob"].map((name) => ({
        fullName: name,
        username: `${name}-${tag}`,
        passwordHash: "x",
        email: `${name}-${tag}@test.local`,
        role: "attorney",
      })),
    )
    .returning({ id: users.id });
  alice = a.id;
  bob = b.id;

  const [c] = await ownerDb
    .insert(clients)
    .values({ fullName: `Test Client ${tag}` })
    .returning({ id: clients.id });
  clientId = c.id;

  const [am, bm] = await ownerDb
    .insert(matters)
    .values([
      { clientId, title: `alice-${tag}`, type: "will", createdBy: alice },
      { clientId, title: `bob-${tag}`, type: "will", createdBy: bob },
    ])
    .returning({ id: matters.id });
  aliceMatter = am.id;
  bobMatter = bm.id;

  await ownerDb.insert(matterMembers).values([
    { matterId: aliceMatter, userId: alice },
    { matterId: bobMatter, userId: bob },
  ]);
  await ownerDb.insert(documents).values([
    { matterId: aliceMatter, filename: "alice.pdf" },
    { matterId: bobMatter, filename: "bob.pdf" },
  ]);
});

afterAll(async () => {
  await ownerDb.delete(matters).where(eq(matters.clientId, clientId));
  await ownerDb.delete(clients).where(eq(clients.id, clientId));
  await ownerDb.delete(users).where(inArray(users.id, [alice, bob]));
  await ownerSql.end();
  await client.end();
});

describe("reads", () => {
  it("returns nothing when no user is set", async () => {
    const rows = await db
      .select({ id: matters.id })
      .from(matters)
      .where(inArray(matters.id, [aliceMatter, bobMatter]));

    expect(rows).toEqual([]);
  });

  it("shows a user only their own matters, with no user filter in the query", async () => {
    const rows = await withUser(alice, (tx) =>
      tx
        .select({ id: matters.id })
        .from(matters)
        .where(inArray(matters.id, [aliceMatter, bobMatter])),
    );

    expect(rows).toEqual([{ id: aliceMatter }]);
  });

  it("shows a user only the documents of their own matter", async () => {
    const rows = await withUser(alice, (tx) =>
      tx
        .select({ filename: documents.filename })
        .from(documents)
        .where(inArray(documents.matterId, [aliceMatter, bobMatter])),
    );

    expect(rows).toEqual([{ filename: "alice.pdf" }]);
  });
});

describe("writes", () => {
  it("rejects creating a matter in someone else's name", async () => {
    await expect(
      withUser(alice, (tx) =>
        tx.insert(matters).values({
          clientId,
          title: `forged-${tag}`,
          type: "will",
          createdBy: bob,
        }),
      ),
    ).rejects.toMatchObject(denied);
  });

  it("rejects adding yourself to someone else's matter", async () => {
    await expect(
      withUser(alice, (tx) =>
        tx.insert(matterMembers).values({ matterId: bobMatter, userId: alice }),
      ),
    ).rejects.toMatchObject(denied);
  });

  it("rejects rewriting created by, which would hand out read access", async () => {
    await expect(
      withUser(alice, (tx) =>
        tx
          .update(matters)
          .set({ createdBy: bob })
          .where(eq(matters.id, aliceMatter)),
      ),
    ).rejects.toMatchObject(denied);
  });

  it("lets a member update an allowed column", async () => {
    const rows = await withUser(alice, (tx) =>
      tx
        .update(matters)
        .set({ status: "pending" })
        .where(eq(matters.id, aliceMatter))
        .returning({ status: matters.status }),
    );

    expect(rows).toEqual([{ status: "pending" }]);
  });

  it("updates nothing on someone else's matter", async () => {
    const rows = await withUser(alice, (tx) =>
      tx
        .update(matters)
        .set({ status: "closed" })
        .where(eq(matters.id, bobMatter))
        .returning({ id: matters.id }),
    );

    expect(rows).toEqual([]);
  });

  it("deletes nothing, because no delete policy exists", async () => {
    const rows = await withUser(alice, (tx) =>
      tx
        .delete(matters)
        .where(eq(matters.id, aliceMatter))
        .returning({ id: matters.id }),
    );

    expect(rows).toEqual([]);
    const still = await ownerDb
      .select({ id: matters.id })
      .from(matters)
      .where(eq(matters.id, aliceMatter));
    expect(still).toHaveLength(1);
  });
});
