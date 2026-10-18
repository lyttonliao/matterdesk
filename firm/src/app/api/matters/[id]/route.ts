// BIG PICTURE
// GET /api/matters/:id. One matter, only if the signed-in user is a member
// "Malformed id", "no such matter" and "not a member" all return the same 404,
// so callers cannot probe which matter ids exist.
import { z } from "zod";
import { withApiUser } from "../../with-api-user";
import { getMatterForUser } from "@/db/matters";

export const GET = withApiUser(
  async (
    _request: Request,
    user,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params; // async in Next 15
    // Postgres throws on a non-UUID (22P02), which would surface as a 500
    const matterId = z.uuid().safeParse(id);
    const matter = matterId.success
      ? await getMatterForUser(matterId.data, user.id)
      : null;
    if (!matter) return Response.json({ error: "Not found" }, { status: 404 });

    return Response.json(matter);
  },
);
