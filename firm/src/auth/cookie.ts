// BIG PICTURE
// The only place that knows the session cookie's name and flags. The cookie carries
// the raw session token; everything else about the session lives inside the db
import { cookies } from "next/headers";

export const SESSION_COOKIE = "session";

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, // JS cannot read it, so XSS cannot steal the token
    secure: process.env.NODE_ENV === "production", // http://localhost would drop it
    sameSite: "lax", // not sent on cross-site POSTs (CSRF defense), sent on link clicks
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}
