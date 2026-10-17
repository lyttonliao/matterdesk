// BIG PICTURE
// Home. Visitors without a valid session go to /login; otherwise it lists the matters
// the logged-in user can see. The user id comes from the session, never from the request.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/auth/current-user";
import { Button } from "@/components/ui/button";
import { listMattersForUser } from "@/db/matters";
import { logoutAction } from "./login/actions";
import { canCreateMatter } from "@/auth/roles";
import { listClients } from "@/db/clients";
import { NewMatterForm } from "./matters/new-matter-form";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const matters = await listMattersForUser(user.id);
  const clients = canCreateMatter(user.role) ? await listClients() : [];

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
      {canCreateMatter(user.role) && <NewMatterForm clients={clients} />}
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
