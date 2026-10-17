// BIG PICTURE
// /login. Already-authenticated visitors are sent home; everyone else sees the form.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/auth/current-user";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Sign in to MatterDesk</h1>
      <LoginForm />
    </main>
  );
}
