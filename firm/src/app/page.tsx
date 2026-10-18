// BIG PICTURE
// Home. Visitors without a valid session go to /login; otherwise it lists the matters
// the logged-in user can see. The user id comes from the session, never from the request.
import Link from "next/link";
import { redirect } from "next/navigation";
import { MATTER_STATUSES, StatusSchema } from "./matters/status-filter";
import { getCurrentUser } from "@/auth/current-user";
import { Button } from "@/components/ui/button";
import { listMattersForUser } from "@/db/matters";
import { logoutAction } from "./login/actions";
import { canCreateMatter } from "@/auth/roles";
import { listClients } from "@/db/clients";
import { NewMatterForm } from "./matters/new-matter-form";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>; // async in Next 15
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // An unknown ?status= falls back to "all" rather than erroring; it is only a view filter
  const status = StatusSchema.safeParse((await searchParams).status).data;
  const matters = await listMattersForUser(user.id, status);
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
      <nav className="flex gap-3 text-sm">
        {[undefined, ...MATTER_STATUSES].map((s) => (
          <Link
            key={s ?? "all"}
            href={s ? `/?status=${s}` : "/"}
            className={s === status ? "font-semibold underline" : ""}
          >
            {s ?? "all"}
          </Link>
        ))}
      </nav>
      {matters.length === 0 ? (
        <p>No matters yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {matters.map((m) => (
            <li key={m.id}>
              <Link href={`/matters/${m.id}`} className="underline">
                {m.title}
              </Link>
              ({m.status})
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
