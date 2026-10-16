// BIG PICTURE
// Owner-connection test of the membership join itself (who is a member of what). It does
// not exercise RLS: see matters.rls.test.ts for that. Data is seeded once in beforeAll.
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clients, matterMembers, matters, users } from "@/db/schema";

// Seeding and cleanup use the owner role: once RLS is on, firm_app can only touch
// rows its user is allowed to see, so it cannot insert arbitrary fixtures.
const ownerUrl = process.env.DATABASE_URL;
if (!ownerUrl)
  throw new Error("DATABASE_URL (owner role) is required for tests");

const sql = postgres(ownerUrl);
const db = drizzle(sql);

const tag = randomUUID().slice(0, 8); // unique per run

// ids filled in by beforeAll, used by the tests and by cleanup
let memberId: string;
let outsiderId: string;
let clientId: string;
let matterId: string;

beforeAll(async () => {
  // insert two users (members + outsider), one client, one matter, one matter_members row
  const [member, outsider] = await db
    .insert(users)
    .values([
      {
        fullName: "Attorney Dudu", // member
        username: `attorney_dudu_${tag}`,
        passwordHash: "x",
        email: `dudu-${tag}@test.local`,
        role: "attorney",
      },
      {
        fullName: "Attorney Bubu", // outsider
        username: `attorney_bubu_${tag}`,
        passwordHash: "y",
        email: `bubu-${tag}@test.local`,
        role: "attorney",
      },
    ])
    .returning({ id: users.id });
  memberId = member.id;
  outsiderId = outsider.id;

  const [client] = await db
    .insert(clients)
    .values({ fullName: "Test Client-1" })
    .returning({ id: clients.id });
  clientId = client.id;

  const [matter] = await db
    .insert(matters)
    .values({ clientId, title: "Matter 1", type: "will", createdBy: memberId })
    .returning({ id: matters.id });
  matterId = matter.id;

  await db.insert(matterMembers).values({ matterId, userId: memberId });
});

afterAll(async () => {
  await db.delete(matters).where(eq(matters.id, matterId));
  await db.delete(clients).where(eq(clients.id, clientId));
  await db.delete(users).where(inArray(users.id, [memberId, outsiderId]));
  await sql.end();
});

async function mattersVisibleTo(userId: string) {
  return db
    .select({ id: matters.id, title: matters.title })
    .from(matters)
    .innerJoin(matterMembers, eq(matterMembers.matterId, matters.id))
    .where(eq(matterMembers.userId, userId));
}

describe("matter visibility", () => {
  it("shows a matter to a member", async () => {
    const rows = await mattersVisibleTo(memberId);
    expect(rows).toEqual([{ id: matterId, title: "Matter 1" }]);
  });

  it("hides it from a user with no membership", async () => {
    const rows = await mattersVisibleTo(outsiderId);
    expect(rows).toEqual([]);
  });

  it("hides it again after the membership row is removed", async () => {
    await db
      .delete(matterMembers)
      .where(
        and(
          eq(matterMembers.matterId, matterId),
          eq(matterMembers.userId, memberId),
        ),
      );
    expect(await mattersVisibleTo(memberId)).toEqual([]);
  });
});
