import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/auth/current-user";
import { getMatterForUser } from "@/db/matters";
import { z } from "zod";
import { canAddNote, canCloseMatter } from "@/auth/roles";
import { listNotes } from "@/db/notes";
import { AddNoteForm, CloseMatterForm } from "./matter-actions";

export default async function MatterPage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>; // async in Next 15
}>) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const matterId = z.uuid().safeParse(id);
  const matter = matterId.success
    ? await getMatterForUser(matterId.data, user.id)
    : null;
  if (!matter) notFound(); // returns `never`, so `matter` is non-null

  const notes = await listNotes(matter.id, user.id);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <Link href="/" className="text-sm underline">
        ← All matters
      </Link>
      <h1 className="text-2xl font-semibold">{matter.title}</h1>
      <dl>
        <dt className="font-medium">Status</dt>
        <dd>{matter.status}</dd>
        <dt className="font-medium">Type</dt>
        <dd>{matter.type}</dd>
        <dt className="font-medium">Created</dt>
        <dd>{matter.createdAt.toLocaleDateString()}</dd>
      </dl>
      {canCloseMatter(user.role) && matter.status !== "closed" && (
        <CloseMatterForm matterId={matter.id} />
      )}
      <section className="flex flex-col gap-3">
        <h2 className="flex flex-col gap-3">Notes</h2>
        {canAddNote(user.role) && <AddNoteForm matterId={matter.id} />}
        {notes.length === 0 ? (
          <p className="text-sm">No notes yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {notes.map((n) => (
              <li key={n.id} className="text-sm">
                <p className="whitespace-pre-wrap">{n.body}</p>
                <p className="text-muted-foreground text-xs">
                  {n.authorName}, {n.createdAt.toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
