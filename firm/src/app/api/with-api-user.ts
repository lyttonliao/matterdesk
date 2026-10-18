// BIG PICTURE
// Wraps a route handler so it only runs for a signed-in user. Route handlers are
// public endpoints, so every one needs this check; wrapping makes it impossible
// to forget and keeps the 401 response in place. The handler receives the user as
// an argument, and the id used for database access always comes from the session
// Server Actions and pages do not use this; their failure is a returned error or
// a redirect, not a JSON 401.
import { getCurrentUser } from "@/auth/current-user";

type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
// What Next passes to every route handler. Routes with dynamic segments
// declare their own narrower type in the handler
type RouteCtx = { params: Promise<Record<string, string>> };

// Ctx is the second argument Next passes (the dynamic route params); routes
// without one leave it as void, so calling handler(request) still type-checks
export function withApiUser<Ctx = RouteCtx>(
  handler: (request: Request, user: SessionUser, ctx: Ctx) => Promise<Response>,
) {
  return async (request: Request, ctx: Ctx) => {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    return handler(request, user, ctx);
  };
}
