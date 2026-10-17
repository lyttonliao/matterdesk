// BIG PICTURE
// The create-matter form. Same useActionState wiring as the login form: the state
// is whatever the action last returned, `pending` disables the button while it runs
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { createMatterAction } from "./actions";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

type Props = { clients: { id: string; fullName: string }[] };

export function NewMatterForm({ clients }: Readonly<Props>) {
  const [state, formAction, pending] = useActionState(createMatterAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input
        name="title"
        placeholder="Matter title"
        required
        className={inputClass}
      />
      <select name="clientId" required className={inputClass}>
        <option value="">Select a client</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.fullName}
          </option>
        ))}
      </select>
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <select name="type" required className={inputClass}>
        <option value="medicaid">Medicaid</option>
        <option value="will">Will</option>
        <option value="trust">Trust</option>
        <option value="guardianship">Guardianship</option>
      </select>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Create matter"}
      </Button>
    </form>
  );
}
