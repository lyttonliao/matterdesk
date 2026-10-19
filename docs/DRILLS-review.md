# Module 06 code-review drills

Three snippets, each with seeded bugs. Read each cold, then write your findings in
`docs/DRILLS-review-answers.md`: for every bug give the line, what goes wrong with a concrete
input, severity (security / data loss / correctness / maintainability), and the fix in one
sentence. Do not run the snippets. They are written in the style of our own code
(`withApiUser`, `withUser`, Drizzle, zod) but are not files in `firm/`.

Approach for a timed review: first pass for security and data boundaries (who can call this,
what input crosses in, what leaves), second pass for correctness, third for style.

## Snippet A: document download route

```ts
// app/api/documents/[id]/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { ownerDb } from "@/db/test-owner";
import { getCurrentUser } from "@/auth/session";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await ownerDb.execute(
    sql.raw(`SELECT filename, storage_path FROM documents WHERE id = '${params.id}'`),
  );
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  const doc = rows[0];
  console.log("download", user.id, doc.filename, doc.storage_path);
  return new Response(await readFile(doc.storage_path), {
    headers: { "Content-Disposition": `attachment; filename=${doc.filename}` },
  });
}
```

Hints on where to look (not a full list): the database role, how the id reaches the query,
what authorization means here, what is logged, and what the response headers include.

## Snippet B: RAG answer endpoint

RAG = retrieval-augmented generation: fetch relevant text chunks, put them in the prompt, ask
the model to answer from them.

```ts
// app/api/ask/route.ts
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { question, matterId } = await req.json();

  const queryVec = await embed(question);
  const chunks = await ownerDb.execute(sql`
    SELECT c.text, c.document_id
    FROM chunks c
    ORDER BY c.embedding <=> ${JSON.stringify(queryVec)}::vector
    LIMIT 8`);

  const context = chunks.map((c) => c.text).join("\n---\n");
  const prompt = `You are a legal assistant. Answer using the context below.
Context:
${context}

Question: ${question}`;

  const answer = await completion(prompt);
  return NextResponse.json({ answer });
}
```

Hints: what `<=>` ranks by and what it does not check, where `matterId` ends up, what the
body is assumed to be, what text inside a chunk could do to the prompt, and what the caller
can verify about the answer.

## Snippet C: client component

```tsx
"use client";
import { useEffect, useState } from "react";

export function NoteList({ matter, user }: { matter: Matter; user: User }) {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    fetch(`/api/matters/${matter.id}/notes`)
      .then((r) => r.json())
      .then(setNotes);
  });

  async function add() {
    setNotes([...notes, { id: Math.random(), body: draft, authorName: user.fullName }]);
    await fetch(`/api/matters/${matter.id}/notes`, {
      method: "POST",
      body: JSON.stringify({ body: draft, authorId: user.id }),
    });
    setDraft("");
  }

  return (
    <div>
      {notes.map((n) => (
        <p key={n.id} dangerouslySetInnerHTML={{ __html: n.body }} />
      ))}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button onClick={add}>Add</button>
      {user.role === "attorney" && <button>Close matter</button>}
    </div>
  );
}
```

Hints: what the effect's missing dependency array does, what `Matter` and `User` carry across
the server/client boundary (props of a `"use client"` component are serialized into the HTML),
what the POST body trusts, rendering untrusted text, error handling on the optimistic update,
and where the real permission check for "Close matter" has to live.

## Done when

Each snippet has a written findings list. Then I compare it with mine, we merge the two, and
the combined list becomes the review checklist for module 07.
