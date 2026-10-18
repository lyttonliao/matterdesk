# Day 3 notes: access control in the database (roles, Row-Level Security, per-request identity)

Importance: **★★★ must know** · **★★ should know** · **★ reference**. Everything marked "verified" was run against this project's Postgres (SQL in rolled-back transactions, then the 24-test suite). Statements marked "recalled" come from memory.

## 0. The big picture ★★★

A law-firm app must guarantee that Alice never reads Bob's matters. The question is *where* that rule lives. We put it in **two places**, so one mistake is not a leak:

| Layer | Who enforces | Fails when |
|---|---|---|
| **Application** (`matters.ts`: `WHERE matter_members.user_id = me`) | our TypeScript | someone writes a new query and forgets the filter |
| **Database** (Row-Level Security policies + column grants) | Postgres itself | the app connects as a role that bypasses it |

The chain that makes the database layer work, in order:
1. Connect as a **restricted role** (`firm_app`) that cannot bypass the policies.
2. For each request, tell the database **who is asking** (`withUser` sets `app.user_id`).
3. **Policies** use that identity to filter rows and validate writes.

Break any link and the layer silently does nothing, which is why the tests check each one.

## 1. Roles and the superuser bypass ★★★

A Postgres **role** is a login (or a group) with a set of privileges. Two roles here:

- `firm`: the **owner** (superuser). Runs migrations, seeds test data.
- `firm_app`: what the running app uses. `NOSUPERUSER NOBYPASSRLS`, with only `SELECT/INSERT/UPDATE/DELETE`.

**Why two:** a superuser skips every RLS policy. If the app connected as `firm`, all policies would exist and none would apply, and every test would still pass. The blast radius of an app bug (for example SQL injection) is also limited to what `firm_app` may do.

Practical details we hit (verified):
- Roles are **cluster-wide**, and `CREATE ROLE` has no `IF NOT EXISTS`, so the migration guards it with a `DO` block checking `pg_roles`.
- The password is **not in the migration** (it is committed to git). It is set separately: `ALTER ROLE firm_app PASSWORD '…'`. Production would take it from Secrets Manager or Terraform.
- `ALTER DEFAULT PRIVILEGES` covers tables created *later*; `GRANT … ON ALL TABLES` covers only tables that exist now. Without the first, every future migration produces tables the app cannot touch.

## 2. Row-Level Security mechanics ★★★

`ALTER TABLE matters ENABLE ROW LEVEL SECURITY` turns on default deny: with no policy, a non-owner sees and changes **nothing**. A **policy** then opens specific doors:

```sql
CREATE POLICY matter_members_select ON matter_members FOR SELECT
  USING (user_id = app_user_id());
```

- `FOR SELECT | INSERT | UPDATE | DELETE | ALL`: which command the policy covers.
- `USING (expr)`: filters **existing** rows. Postgres appends it to the query's `WHERE`. NULL counts as false.
- `WITH CHECK (expr)`: validates **new or changed** rows. Failure raises an error (SQLSTATE `42501`) instead of silently filtering.
- Several policies on the same command are OR-ed together (permissive).
- `EXISTS (SELECT 1 FROM … WHERE …)`: true if the subquery returns at least one row. The `1` is a throwaway; only row existence matters. In `matters_select`, `matters.id` inside the subquery refers to the outer row being tested (a correlated subquery).

The policies we wrote, with the question each one answers:

| Policy | Question | Rule |
|---|---|---|
| `matter_members_select` | which membership rows are visible? | only my own |
| `matter_members_insert` | who may add members? | only the matter's creator |
| `matters_select` | may I see this matter? | I created it **or** I am a member |
| `matters_insert` | may I create this row? | `created_by` must be me (no forging) |
| `matters_update` | may I change it? | members only |
| `documents_all` | any operation on documents | I am a member of the document's matter |
| (none for DELETE) | | default deny: the app can never delete a matter |

Why the identity link differs per policy: a brand-new matter has no member row yet, so INSERT can only check `created_by`. SELECT also allows `created_by` as a bridge for the same reason (see 4). UPDATE is member-only, because "removed from the matter" should mean "cannot edit it".

## 3. Passing identity to the database ★★★

Postgres does not know who the web user is. We pass it as a **custom setting**, `app.user_id`, and read it in policies through a helper:

```sql
CREATE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
```

Read it from the inside out (verified):

| Situation | `current_setting(…, true)` | after `NULLIF(…, '')` | `::uuid` |
|---|---|---|---|
| set to Alice's uuid | `'aaaaaaaa-…'` | same | Alice's uuid |
| never set in this session | NULL (`true` = return NULL instead of erroring) | NULL | NULL |
| set earlier, transaction ended | `''` (empty string, not NULL) | NULL | NULL |

The third row is the Postgres quirk: once a custom setting exists in a session, "reverting" gives `''`, and `''::uuid` throws. `NULLIF` turns both unset cases into NULL, so `user_id = NULL` is never true and **no user means no rows** (fail closed).

`STABLE` tells the planner the result is constant within one statement, so it can evaluate the function once per query rather than once per row.

**How the app sets it** (`src/db/with-user.ts`):

```ts
db.transaction(async (tx) => {
  await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
  return fn(tx);
});
```

- **Transaction-scoped** (`is_local = true`, same as `SET LOCAL`): the setting ends at commit/rollback. A connection pool reuses connections between requests; a plain `SET` would leak Alice's identity to the next request that gets the same connection.
- **`set_config` instead of `SET`**: `SET` cannot take bind parameters, so you would paste the id into the SQL string (injection risk). `set_config` is a function call and takes `$1`.

## 4. Traps we hit ★★

1. **Policy recursion.** A `matter_members` policy that queries `matter_members` fails with "infinite recursion detected". Fix: its own policy is the simple `user_id = me`, and the `matters` policy reads *that*.
2. **`INSERT … RETURNING` needs SELECT permission.** `createMatter` inserts the matter, then the member row. At the moment of `RETURNING`, the creator is not a member yet, so the SELECT policy would hide the row they just inserted. Fix: add `matters.created_by` and let the SELECT policy also match it. The alternative was a `SECURITY DEFINER` function (runs with the owner's rights); less transparent, more logic in SQL.
3. **UPDATE could rewrite `created_by`** (verified: `UPDATE 1`). A member could set `created_by = bob` and thereby give Bob read access. A policy cannot compare old and new values, so we use **column-level privileges**: `REVOKE UPDATE` on the table, then `GRANT UPDATE (title, status, type, opened_at)`. The privilege check runs *before* RLS, so a forbidden column fails with `permission denied` whatever the policy says. Verified: changing `created_by` or `client_id` is denied, changing `title` works.
4. **A `NOT NULL` column is easy to add only because the tables were empty.** On a populated table: add nullable, backfill, then add the constraint.

## 5. Defense in depth ★★

RLS is the last line, not the only one. The API layer (built on Day 3 step 5 and after) still has to do what the database cannot:

- **authenticate** (who is this?) and hand the id to `withUser`;
- check **roles** (a `client` user must not create matters; RLS does not look at `users.role` yet);
- **validate input** (zod), rate-limit, audit-log, return friendly 403/404 responses.

Conversely the database catches the API's mistakes. Broken access control is the top category of the OWASP Top 10 (recalled: #1 since the 2021 edition). The shared principle: **deny by default at every layer**.

Known gaps, deliberately left for later:
- `clients` (date of birth) and `users` have **no RLS**: any `firm_app` query can read them.
- A removed member who *created* the matter can still read it (the `created_by` bridge). A `role` column on `matter_members` (`owner`/`editor`/`viewer`) is the standard fix.
- `FORCE ROW LEVEL SECURITY` is not set; it would bind a non-superuser owner, but production needs a non-superuser owner first.

## 6. Testing access control ★★

- **Two connections.** Fixtures and verification use the owner (bypasses RLS); the code under test uses `firm_app`. Seeding as `firm_app` would be blocked by the policies, and checking "nothing was left behind" as `firm_app` would return empty rows *even if the rollback failed*.
- **Test the database directly.** `matters.rls.test.ts` queries with **no user filter** and expects Alice to get only her rows. If it passes, the database did the filtering, not the app code.
- **Assert the error code**, not the message: drizzle wraps a Postgres error as `DrizzleQueryError` and the original is on `.cause`, so the test matches `{ cause: { code: "42501" } }` (verified). `42501` = `insufficient_privilege`, used for both an RLS rejection and a missing column grant.
- A test of `createMatter` with a random creator id now fails at the `created_by` foreign key, so it no longer proves the transaction rolls back. The real rollback test is in `with-user.test.ts`: insert, `throw`, then check as the owner that nothing persisted.

## 7. Tooling lessons ★

- `drizzle-kit generate --custom` is **not idempotent**: every run adds a journal entry and a snapshot. Run it once. A journal entry with no SQL file makes `db:migrate` fail with only "Command failed".
- When drizzle-kit hides the error, call `migrate()` from `drizzle-orm/postgres-js/migrator` in a short script; it throws the real message.
- **Never edit a migration after it is applied**; add a new one. That is why the SQL files carry no teaching comments and the walkthrough lives here.
- Drizzle splits a migration on the literal line `--> statement-breakpoint`; a `DO $$ … $$` block counts as one statement.
- Validate risky SQL first in a transaction you roll back (`BEGIN; …; ROLLBACK;`). Switch identity inside it with `SET LOCAL ROLE firm_app`.

## Next
Authentication is built (see `firm/SETUP.md` Step 12). Remaining Day 3 work: a create-matter Server Action with zod input validation and a role check (a `client` user must not create matters), then RLS on `clients`/`users`. Then Day 4 (embeddings). JWTs vs. opaque sessions comparison still owed: JWTs are for verifiers that cannot reach your session store (service-to-service, OAuth/OIDC).
