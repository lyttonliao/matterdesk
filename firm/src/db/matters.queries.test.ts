import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clients, matterMembers, matters, users } from "@/db/schema";
import { listMattersForUser, createMatter, getMatterForUser } from "./matters";
import { env } from "@/env";

let sql = postgres(env.DATABASE_URL);
let db = drizzle(sql);

const tag = randomUUID().slice(0, 8);

let memberId1: string;
let memberId2: string;
let clientId1: string;
let clientId2: string;
let matterIds: string[];

beforeAll(async () => {
  const [member1, member2] = await db
    .insert(users)
    .values([
      {
        fullName: "Test Attorney1",
        username: `test-attorney-1-${tag}`,
        passwordHash: "x",
        email: `test-attorney-1-${tag}@test.local`,
        role: "attorney",
      },
      {
        fullName: "Test Attorney2",
        username: `test-attorney-2-${tag}`,
        passwordHash: "x",
        email: `test-attorney-2-${tag}@test.local`,
        role: "attorney",
      },
    ])
    .returning({ id: users.id });
    memberId1 = member1.id;
    memberId2 = member2.id;
  
  const [client1, client2] = await db
    .insert(clients)
    .values([
      { fullName: "Test Client1" },
      { fullName: "Test Client2" },
    ])
    .returning({ id: clients.id });
  clientId1 = client1.id;
  clientId2 = client2.id;

  const dbMatters = await db
    .insert(matters)
    .values([
      { id: randomUUID(), clientId: clientId1, title: `matter1-${tag}`, type: "will" },
      { id: randomUUID(), clientId: clientId1, title: `matter2-${tag}`, type: "will" },
      { id: randomUUID(), clientId: clientId1, title: `matter3-${tag}`, type: "will" },
      { id: randomUUID(), clientId: clientId2, title: `matter4-${tag}`, type: "will" },
      { id: randomUUID(), clientId: clientId2, title: `matter5-${tag}`, type: "will" },
    ])
    .returning({ id: matters.id });
  matterIds = dbMatters.map((matter) => matter.id);

  await db.insert(matterMembers).values([
    { matterId: matterIds[0], userId: memberId1 },
    { matterId: matterIds[1], userId: memberId1 },
    { matterId: matterIds[2], userId: memberId1 },
    { matterId: matterIds[3], userId: memberId2 },
    { matterId: matterIds[4], userId: memberId2 },
  ])
});


afterAll(async () => {
  await db.delete(matters).where(inArray(matters.id, matterIds));
  await db.delete(clients).where(inArray(clients.id, [clientId1, clientId2]));
  await db.delete(users).where(inArray(users.id, [memberId1, memberId2]));
  await sql.end();
});

describe("matters", () => {
  it("create a matter", async () => {
    const matter = await createMatter(
      {
        title: 'New Matter 1',
        type: "medicaid",
        clientId: clientId1
      }, 
      memberId1,
    );
    matterIds.push(matter.id);
    expect(matter.title).toEqual('New Matter 1');
  });

  it("successfully get a matter", async () => {
    const matterId = matterIds[0];
    const matter = await getMatterForUser(matterId, memberId1);
    expect(matter.id).toEqual(matterId);
  });

  it("get an invalid matter id", async () => {
    const matter = await getMatterForUser(randomUUID(), memberId1);
    expect(matter).toBeNull();
  });

  it("successfully gets a list of matters", async () => {
    const memberOneMatters = await listMattersForUser(memberId1);
    const memberTwoMatters = await listMattersForUser(memberId2);
    expect(memberOneMatters).toHaveLength(4);
    expect(memberTwoMatters).toHaveLength(2);
  });
});

