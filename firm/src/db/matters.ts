// BIG PICTURE
// All matter reads and writes, every fn takes acting user's id and runs inside
// withUser, so RLS applies on top of the explicit membership filters below

import { and, desc, eq } from "drizzle-orm";
import { matterMembers, matters, type Matter } from "@/db/schema";
import { withUser } from "./with-user";

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

// The WHERE on matter_members is the application-level check. RLS enforces the same
// rule underneath, so a future function that forgets the filter still cannot leak rows.
export async function listMattersForUser(userId: string) {
  return withUser(userId, (tx) =>
    tx
      .select(matterColumns)
      .from(matters)
      .innerJoin(matterMembers, eq(matters.id, matterMembers.matterId))
      .where(eq(matterMembers.userId, userId))
      .orderBy(desc(matters.createdAt)),
  );
}

export async function createMatter(
  input: CreateMatterInput,
  creatorId: string,
) {
  return withUser(creatorId, async (tx) => {
    const [matter] = await tx
      .insert(matters)
      // creatorId is a separate, trusted argument (from the session) and is spread last,
      // so a caller can never choose the creator through `input` (mass assignment).
      .values({ ...input, createdBy: creatorId })
      .returning();
    await tx
      .insert(matterMembers)
      .values({ matterId: matter.id, userId: creatorId });

    return matter;
  });
}

// null for both "no such matter" and "not a member", so callers cannot probe which
// matter ids exist.
export async function getMatterForUser(matterId: string, userId: string) {
  const [matter] = await withUser(userId, (tx) =>
    tx
      .select(matterColumns)
      .from(matters)
      .innerJoin(matterMembers, eq(matterMembers.matterId, matters.id))
      .where(and(eq(matters.id, matterId), eq(matterMembers.userId, userId))),
  );

  return matter ?? null;
}
