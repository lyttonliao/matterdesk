// BIG PICTURE
// Server Action behind the create-matter form. A Server Action is a public POST
// endpoint, so it re-checks everything itself: session, role, input shape.
// The creator id comes from the session and the zod schema drops unknown keys, so
// a forged `createdBy` field in the form is ignored (mass assignment).
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/auth/current-user";
import { canCreateMatter } from "@/auth/roles";
import { createMatter } from "@/db/matters";

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
