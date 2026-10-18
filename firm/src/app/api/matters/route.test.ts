// BIG PICTURE
// Decision tests for the matters route handlers: 401 without a session, 400 on a
// bad status, 404 for a bad or foreign id, and that the user id passed to the
// db layer comes from the session. Session and db are mocked.
import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, describe, vi } from "vitest";

vi.mock("@/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/db/matters", () => ({
  listMattersForUser: vi.fn(),
  getMatterForUser: vi.fn(),
}));

import { getCurrentUser } from "@/auth/current-user";
import { getMatterForUser, listMattersForUser } from "@/db/matters";
import { GET as getList } from "./route";
import { GET as getOne } from "./[id]/route";

const user = { id: "user-1", role: "attorney", fullName: "Test User" };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const noParams = { params: Promise.resolve({}) };

beforeEach(() => vi.resetAllMocks());

describe("GET /api/matters", () => {
  it("401 without a session", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await getList(new Request("http://x/api/matters"), noParams);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(listMattersForUser).not.toHaveBeenCalled();
  });

  it("400 on an unknown status", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    const res = await getList(
      new Request("http://x/api/matters?status=banana"),
      noParams,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid status" });
  });

  it("lists for the session user and passes the status filter", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    vi.mocked(listMattersForUser).mockResolvedValue([]);
    const res = await getList(
      new Request("http://x/api/matters?status=open"),
      noParams,
    );
    expect(res.status).toBe(200);
    expect(listMattersForUser).toHaveBeenCalledWith("user-1", "open");
  });
});

describe("GET /api/matters/[id]", () => {
  it("401 without a session", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await getOne(new Request("http://x"), ctx(randomUUID()));
    expect(res.status).toBe(401);
  });

  it("404 for a malformed id, without touching the db", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    const res = await getOne(new Request("http://x"), ctx("abc"));
    expect(res.status).toBe(404);
    expect(getMatterForUser).not.toHaveBeenCalled();
  });

  it("404 when the user is not a member (db returns null)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    vi.mocked(getMatterForUser).mockResolvedValue(null);
    const res = await getOne(new Request("http://x"), ctx(randomUUID()));
    expect(res.status).toBe(404);
  });

  it("200 with the matter for a member", async () => {
    const id = randomUUID();
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    vi.mocked(getMatterForUser).mockResolvedValue({
      id,
      title: "Estate of Smith",
      status: "open",
      type: "will",
      createdAt: new Date(),
    });
    const res = await getOne(new Request("http://x"), ctx(id));
    expect(res.status).toBe(200);
    expect(getMatterForUser).toHaveBeenCalledWith(id, "user-1");
    expect((await res.json()).title).toBe("Estate of Smith");
  });
});
