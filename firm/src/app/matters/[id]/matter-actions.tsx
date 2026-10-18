// BIG PICTURE
// The two forms on the detail page. They are client components only because
// useActionState (the last action result and the pending flag) is a client hook;
// the work itself runs on the server in ../actions.ts
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { addNoteAction, closeMatterAction } from "../actions";

export function AddNoteForm({ matterId }: Readonly<{ matterId: string }>) {
  const [state, formAction, pending] = useActionState(addNoteAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="matterId" value={matterId} />
      <textarea
        name="body"
        required
        rows={3}
        maxLength={5000}
        placeholder="Add a note"
        className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
      />
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Add note"}
      </Button>
    </form>
  );
}

export function CloseMatterForm({ matterId }: Readonly<{ matterId: string }>) {
  const [state, formAction, pending] = useActionState(closeMatterAction, null);

  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="matterId" value={matterId} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Closing..." : "Close matter"}
      </Button>
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
