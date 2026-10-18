// BIG PICTURE
// Server Action behind the create-matter form. A Server Action is a public POST
// endpoint, so it re-checks everything itself: session, role, input shape.
// The creator id comes from the session and the zod schema drops unknown keys, so
// a forged `createdBy` field in the form is ignored (mass assignment).
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/auth/current-user";
import { canCreateMatter, canAddNote, canCloseMatter } from "@/auth/roles";
import { createMatter, closeMatter } from "@/db/matters";
import { addNote } from "@/db/notes";

const CreateMatterSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters"),
  clientId: z.uuid("Pick a client."),
  type: z.enum(["medicaid", "will", "trust", "guardianship"]),
});

export type CreateMatterState = { error?: string } | null;

export async function createMatterAction(
  _prev: CreateMatterState,
  formData: FormData,
): Promise<CreateMatterState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session expired. Sign in again." };
  if (!canCreateMatter(user.role)) {
    return { error: "You are not allowed to create matters." };
  }

  const parsed = CreateMatterSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await createMatter(parsed.data, user.id);
  } catch (err) {
    if ((err as { cause?: { code?: string } }).cause?.code === "23503") {
      return { error: "That client no longer exists." };
    }
    throw err;
  }
  revalidatePath("/");
  return null;
}

const AddNoteSchema = z.object({
  matterId: z.uuid(),
  body: z.string().trim().min(1, "Write something first.").max(5000),
});

export type ActionState = { error?: string } | null;

export async function addNoteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session expired. Sign in again." };
  if (!canAddNote(user.role)) {
    return { error: "You are not allowed to add notes." };
  }

  const parsed = AddNoteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await addNote(parsed.data.matterId, user.id, parsed.data.body);
  } catch (err) {
    // 42501: RLS refused the insert, i.e. not a member of that matter
    if ((err as { cause?: { code?: string } }).cause?.code === "42501") {
      return { error: "Matter not found." };
    }
    throw err;
  }
  revalidatePath(`/matters/${parsed.data.matterId}`);
  return null;
}

export async function closeMatterAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session expired. Sign in again." };
  if (!canCloseMatter(user.role)) {
    return { error: "You are not allowed to close matters." };
  }

  const parsed = z
    .object({ matterId: z.uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Matter not found." };

  if (!(await closeMatter(parsed.data.matterId, user.id))) {
    return { error: "Matter not found." };
  }
  revalidatePath(`/matters/${parsed.data.matterId}`);
  revalidatePath("/");
  return null;
}
