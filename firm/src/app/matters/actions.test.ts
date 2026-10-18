// BIG PICTURE
// Decision tests for createMatterAction. Session, db and cache are mocked, so these
// check the action's own rules: who may call it, what input it accepts, and that
// the creator id comes from the session rather than the form
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/db/matters", () => ({
  createMatter: vi.fn(),
  closeMatter: vi.fn(),
}));
vi.mock("@/db/notes", () => ({ addNote: vi.fn() }));

import { getCurrentUser } from "@/auth/current-user";
import { createMatter, closeMatter } from "@/db/matters";
import {
  createMatterAction,
  addNoteAction,
  closeMatterAction,
} from "./actions";
import { addNote } from "@/db/notes";

const clientId = randomUUID();

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const valid = { title: "Estate of Smith", clientId, type: "will" };

function signInAs(role: string) {
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: "user-1",
    role,
    fullName: "Test User",
  });
}

beforeEach(() => vi.resetAllMocks());

describe("createMatterAction", () => {
  it("rejects a signed-out caller", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const result = await createMatterAction(null, form(valid));
    expect(result?.error).toMatch(/sign in/i);
    expect(createMatter).not.toHaveBeenCalled();
  });

  it("rejects the client role even with the valid input", async () => {
    signInAs("client");
    const result = await createMatterAction(null, form(valid));
    expect(result?.error).toMatch(/not allowed/i);
    expect(createMatter).not.toHaveBeenCalled();
  });

  it("rejects a short title", async () => {
    signInAs("attorney");
    const result = await createMatterAction(
      null,
      form({ ...valid, title: "ab" }),
    );
    expect(result?.error).toMatch(/title/i);
    expect(createMatter).not.toHaveBeenCalled();
  });

  it("creates the matter as the session user and ignores a forged createdBy", async () => {
    signInAs("paralegal");
    const result = await createMatterAction(
      null,
      form({ ...valid, createdBy: "someone-else" }),
    );
    expect(result).toBeNull();
    expect(createMatter).toHaveBeenCalledWith(valid, "user-1");
  });

  it("turns a missing client (foreign key violation) into a friendly error", async () => {
    signInAs("attorney");
    vi.mocked(createMatter).mockRejectedValue({ cause: { code: "23503" } });
    const result = await createMatterAction(null, form(valid));
    expect(result?.error).toMatch(/no longer exists/i);
  });
});

describe("addNoteAction", () => {
  const note = { matterId: clientId, body: "Called the client" };

  it("rejects the client role", async () => {
    signInAs("client");
    const result = await addNoteAction(null, form(note));
    expect(result?.error).toMatch(/not allowed/i);
    expect(addNote).not.toHaveBeenCalled();
  });

  it("rejects a blank body", async () => {
    signInAs("paralegal");
    const result = await addNoteAction(null, form({ ...note, body: "" }));
    expect(result?.error).toMatch(/write something/i);
    expect(addNote).not.toHaveBeenCalled();
  });

  it("writes as the session user and ignores a forged authorId", async () => {
    signInAs("paralegal");
    const result = await addNoteAction(
      null,
      form({ ...note, authorId: "someone-else " }),
    );
    expect(result).toBeNull();
    expect(addNote).toHaveBeenCalledWith(clientId, "user-1", note.body);
  });

  it("turns an RLS refusal into a not found error", async () => {
    signInAs("attorney");
    vi.mocked(addNote).mockRejectedValue({ cause: { code: "42501" } });
    const result = await addNoteAction(null, form(note));
    expect(result?.error).toMatch(/not found/i);
  });
});

describe("closeMatterAction", () => {
  it("rejects a paralegal", async () => {
    signInAs("paralegal");
    const result = await closeMatterAction(null, form({ matterId: clientId }));
    expect(result?.error).toMatch(/not allowed/i);
    expect(closeMatter).not.toHaveBeenCalled();
  });

  it("closes as the session user for an attorney", async () => {
    signInAs("attorney");
    vi.mocked(closeMatter).mockResolvedValue(true);
    const result = await closeMatterAction(null, form({ matterId: clientId }));
    expect(result).toBeNull();
    expect(closeMatter).toHaveBeenCalledWith(clientId, "user-1");
  });

  it("reports not found when the db matched nothing", async () => {
    signInAs("admin");
    vi.mocked(closeMatter).mockResolvedValue(false);
    const result = await closeMatterAction(null, form({ matterId: clientId }));
    expect(result?.error).toMatch(/not found/i);
  });
});
