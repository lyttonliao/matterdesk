// BIG PICTURE
// Client lookups for forms. `clients` has no RLS yet (known gap), so this
// reads through plain `db` and returns only id and name, never the date of birth
import { db } from "@/db";
import { clients } from "@/db/schema";

export function listClients() {
  return db
    .select({ id: clients.id, fullName: clients.fullName })
    .from(clients)
    .orderBy(clients.fullName);
}
