// BIG PICTURE
// Tests of withUser itself: that the user id reaches the database as app_user_id(), and
// that a failing callback leaves nothing behind. Rollback is checked as the owner,
// because a firm_app query would show no rows whether or not the rollback worked.
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { client } from "@/db";
import { clients, matters, users } from "@/db/schema";
import { ownerDb, ownerSql } from "./test-owner";
import { withUser } from "./with-user";

const tag = randomUUID().slice(0, 8);
const userIds: string[] = [];
const clientIds: string[] = [];

afterAll(async () => {
  await ownerDb.delete(matters).where(inArray(matters.clientId, clientIds));
  await ownerDb.delete(clients).where(inArray(clients.id, clientIds));
  await ownerDb.delete(users).where(inArray(users.id, userIds));
  await ownerSql.end();
  await client.end();
});

async function makeUser() {
  const [user] = await ownerDb
    .insert(users)
    .values({
      fullName: "Test user",
      username: `withuser-${tag}`,
      passwordHash: "x",
      email: `withuser-${tag}@test.local`,
      role: "attorney",
    })
    .returning({ id: users.id });
  userIds.push(user.id);
  return user.id;
}

describe("withUser", () => {
  it("exposes the user id to the database as app_user_id()", async () => {
    const userId = randomUUID();

    const rows = await withUser(userId, (tx) =>
      tx.execute<{ id: string }>(sql`select app_user_id() as id`),
    );

    expect(rows[0].id).toBe(userId);
  });

  it("rolls everything back when the callback throws", async () => {
    const userId = await makeUser();
    const [row] = await ownerDb
      .insert(clients)
      .values({ fullName: `Test Client ${tag}` })
      .returning({ id: clients.id });
    clientIds.push(row.id);
    const title = `withuser-rollback-${tag}`;

    await expect(
      withUser(userId, async (tx) => {
        await tx
          .insert(matters)
          .values({ clientId: row.id, title, type: "will", createdBy: userId });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const leftovers = await ownerDb
      .select({ id: matters.id })
      .from(matters)
      .where(eq(matters.title, title));
    expect(leftovers).toEqual([]);
  });
});
