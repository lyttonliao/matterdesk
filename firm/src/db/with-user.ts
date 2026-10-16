// BIG PICTURE
// Runs database work as one user. It opens a transaction and sets the
// transaction-local setting app.user_id, which the Row-Level Security (RLS) policies
// read through app_user_id(). Every query on `tx` is then filtered by the database.
// The setting disappears at commit or rollback, so it cannot leak to the next request
// that reuses the same pooled connection.
import { sql } from "drizzle-orm";
import { db } from "@/db";

// The transaction handle type, derived from db.transaction's callback so we do not
// hardcode drizzle's internal generics.
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withUser<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Why a transaction plus set_config: a connection pool hands the same connection to
    // different requests. A plain SET would stay on the connection and leak one user's
    // identity into the next request; SET LOCAL ends with the transaction. SET cannot
    // take $1 parameters (you would splice userId into the string: SQL injection), but
    // set_config(name, value, is_local => true) is the same operation as a function
    // call, and a function call can take a bind parameter.
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
