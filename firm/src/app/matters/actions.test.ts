// BIG PICTURE
// Decision tests for createMatterAction. Session, db and cache are mocked, so these
// check the action's own rules: who may call it, what input it accepts, and that
// the creator id comes from the session rather than the form
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/db/matters", () => ({ createMatter: vi.fn() }));

import { getCurrentUser } from "@/auth/current-user";
import { createMatter } from "@/db/matters";
import { createMatterAction } from "./actions";

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
