// BIG PICTURE
// All matter reads and writes. Every function takes the acting user's id, so Day 3
// auth only changes who supplies it, not these signatures.
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { matterMembers, matters, type Matter } from "@/db/schema";

type CreateMatterInput = {
  clientId: string;
  title: string;
  type: Matter["type"];
};

const matterColumns = {
  id: matters.id,
  title: matters.title,
  status: matters.status,
  type: matters.type,
  createdAt: matters.createdAt,
};

export async function listMattersForUser(userId: string) {
  return db
    .select(matterColumns)
    .from(matters)
    .innerJoin(matterMembers, eq(matters.id, matterMembers.matterId))
    .where(eq(matterMembers.userId, userId))
    .orderBy(desc(matters.createdAt));
}

export async function createMatter(
  input: CreateMatterInput,
  creatorId: string,
) {
  return db.transaction(async (tx) => {
    const [matter] = await tx.insert(matters).values(input).returning();
    await tx
      .insert(matterMembers)
      .values({ matterId: matter.id, userId: creatorId });

    return matter;
  });
}

// null for both "no such matter" and "not a member", so callers cannot probe which
// matter ids exist.
export async function getMatterForUser(matterId: string, userId: string) {
  const [matter] = await db
    .select(matterColumns)
    .from(matters)
    .innerJoin(matterMembers, eq(matterMembers.matterId, matters.id))
    .where(and(eq(matters.id, matterId), eq(matterMembers.userId, userId)));

  return matter ?? null;
}
