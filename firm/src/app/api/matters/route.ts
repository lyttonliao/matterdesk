// BIG PICTURE
// GET /api/matters?status=open. JSON list of the matters the signed-in user belongs to
// A route handler is a public endpoint like a Server Action, so it authenticates
// itself and validates its query string. The user id comes from the session only.
import { listMattersForUser } from "@/db/matters";
import { StatusSchema } from "@/app/matters/status-filter";
import { withApiUser } from "../with-api-user";

export const GET = withApiUser(async (request, user) => {
  // searchParams.get returns null when absent; zod's optional() wants undefined
  const status = StatusSchema.safeParse(
    new URL(request.url).searchParams.get("status") ?? undefined,
  );
  if (!status.success) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }

  return Response.json(await listMattersForUser(user.id, status.data));
});
