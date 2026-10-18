// BIG PICTURE
// Matter notes. Same shape as matters.ts: every function takes the acting user's id and
// runs inside withUser, so the explicit membership join below is backed by RLS
import { and, desc, eq } from "drizzle-orm";
import { matterMembers, notes, users } from "./schema";
import { withUser } from "./with-user";

export async function listNotes(matterId: string, userId: string) {
  return withUser(userId, (tx) =>
    tx
      .select({
        id: notes.id,
        body: notes.body,
        createdAt: notes.createdAt,
        authorName: users.fullName,
      })
      .from(notes)
      .innerJoin(users, eq(users.id, notes.authorId))
      .innerJoin(matterMembers, eq(matterMembers.matterId, notes.matterId))
      .where(
        and(eq(notes.matterId, matterId), eq(matterMembers.userId, userId)),
      )
      .orderBy(desc(notes.createdAt)),
  );
}

export async function addNote(
  matterId: string,
  authorId: string,
  body: string,
) {
  return withUser(authorId, (tx) =>
    tx.insert(notes).values({ matterId, authorId, body }),
  );
}
