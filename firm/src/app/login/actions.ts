// BIG PICTURE
// Server Actions for the login form and the logout button. Next restricts these to POST
// and checks the Origin header, which is the cross-site request forgery (CSRF) defense
// on top of the SameSite=Lax cookie.
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  clearSessionCookie,
  SESSION_COOKIE,
  setSessionCookie,
} from "@/auth/cookie";
import { login } from "@/auth/login";
import { deleteSession } from "@/auth/session";

export async function loginAction(
  _prev: { error: string } | null,
  formData: FormData,
) {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || typeof password !== "string") {
    return { error: "Enter your email and password." };
  }

  const result = await login(email, password);
  if (!result.ok) {
    return {
      error:
        result.reason === "rate_limited"
          ? "Too many attempts. Try again in 15 minutes."
          : "Invalid email or password.",
    };
  }

  await setSessionCookie(result.token, result.expiresAt);
  redirect("/");
}

export async function logoutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  await clearSessionCookie();
  redirect("/login");
}
