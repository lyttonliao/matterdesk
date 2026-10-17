import { redirect } from "next/navigation";
import { getCurrentUser } from "@/auth/current-user";
import { Button } from "@/components/ui/button";
import { listMattersForUser } from "@/db/matters";
import { logoutAction } from "./login/actions";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const matters = await listMattersForUser(user.id);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Welcome, {user.fullName}</h1>
        <form action={logoutAction}>
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </header>
      {matters.length === 0 ? (
        <p>No matters yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {matters.map((m) => (
            <li key={m.id}>
              {m.title} ({m.status})
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
