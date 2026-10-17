# firm/ setup log

Every step used to build this project, in order, so it can be replicated from scratch.
Run from the repo root (`matterdesk/`) unless a step says otherwise. After each step run
`pnpm format:check && pnpm typecheck && pnpm lint`, then make one commit.

Environment when written: macOS, Node 24.3.0, Docker 29.0.1, Corepack 0.33.0.

## Step 1: pnpm via Corepack

```bash
corepack enable pnpm         # puts a pnpm shim on PATH
corepack install -g pnpm@10  # Corepack 0.33 cannot run pnpm 12, so pin 10.x
pnpm -v                      # 10.34.7
```

Concept: Corepack ships with Node and runs the pnpm version a project pins in
`packageManager`, so everyone uses the same one.

## Step 2: Next.js 15 scaffold

```bash
pnpm create next-app@15 firm --ts --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-pnpm --no-turbopack
cd firm
pnpm pkg set packageManager=pnpm@10.34.7 scripts.typecheck="tsc --noEmit"
pnpm typecheck && pnpm lint
```

## Step 3: shadcn/ui and Prettier

```bash
pnpm dlx shadcn@latest init -d
pnpm add -D prettier prettier-plugin-tailwindcss
pnpm pkg set scripts.format="prettier --write ." scripts.format:check="prettier --check ."
```

`.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

`.prettierignore`:

```
.next
node_modules
pnpm-lock.yaml
drizzle
```

Then `pnpm format` once to rewrite the scaffolded files into Prettier style.

## Step 4: Postgres 16 + pgvector in Docker Compose

Write `compose.yaml` (one `db` service on `pgvector/pgvector:pg16`, named volume `pgdata`,
healthcheck with `pg_isready`, port `127.0.0.1:5433:5432`) and `.env.example`. Add
`!.env.example` after `.env*` in `.gitignore` so the template stays tracked.

```bash
cp .env.example .env
docker compose config      # validate the file
docker compose up -d
docker compose ps          # expect "healthy"
```

Concepts:

- One Postgres holds relational data and vectors, so permission filtering and transactions
  stay in a single query.
- `POSTGRES_*` variables only apply on the first start with an empty volume.
- The host port is 5433 because a local Postgres already uses 5432.

## Step 5: Drizzle, Vitest, zod

```bash
pnpm add drizzle-orm postgres zod
pnpm add -D drizzle-kit vitest
pnpm pkg set scripts.test="vitest run --passWithNoTests" \
  scripts.db:generate="drizzle-kit generate" scripts.db:migrate="drizzle-kit migrate"
```

Write `drizzle.config.ts` (schema `./src/db/schema.ts`, output `./drizzle`, URL from
`DATABASE_URL`) and `vitest.config.mts` (node environment, `src/**/*.test.ts`, `@` alias).
Both load `.env` with `process.loadEnvFile(".env")` because only Next.js reads it
automatically. The Vitest config is `.mts` and `tsconfig.json` `include` gains `"**/*.mts"`.

## Step 6: schema and first migration

Write `src/db/schema.ts` by hand (users, clients, matters, matter_members, documents), then:

```bash
pnpm db:generate --name init_schema   # writes drizzle/0000_init_schema.sql + meta/*
# read the SQL before applying it
pnpm db:migrate                       # applies unapplied files, records them in drizzle.__drizzle_migrations
docker compose exec -T db psql -U firm -d firm -c '\dt' -c '\d matters'
```

Concepts:

- `matter_members (matter_id, user_id)` is the permission table: a user sees a matter only
  through a row here.
- `users` are staff logins. `clients` are the people the firm represents, with an optional
  unique `user_id` for a future portal login (`ON DELETE SET NULL`).
- Commit `drizzle/meta/*` and never hand-edit it. The next `generate` diffs against it.
- Always read generated SQL: a column rename is generated as drop + add.
- Enable `vector` on Day 4 with `pnpm db:generate --custom --name enable_vector`, alongside
  the `chunks` table that needs it.

## Step 7: first test and validated environment

Write `src/db/matters.test.ts` (integration test against the real dev Postgres: insert a
user, client, matter and `matter_members` row, assert the join returns the matter only for
the member). Remove `--passWithNoTests` from the `test` script now that a test exists:

```bash
pnpm pkg set scripts.test="vitest run"
```

Write `src/env.schema.ts` (zod schema), `src/env.ts` (`export const env = schema.parse(process.env)`)
and `src/env.test.ts` (`safeParse` accepts a valid URL, rejects a malformed or missing one).

Concepts:

- Integration tests hit the real database so constraints, joins and cascades are exercised.
  Use per-run unique values and delete in foreign-key order.
- Validate configuration once at boot (fail fast) and import the typed `env`, never
  `process.env`. The schema lives in its own file so tests do not parse the real environment.
- Environment values are strings: use `z.coerce.number()` for numbers.

## Step 8: app role for Row-Level Security (RLS)

A superuser bypasses RLS, so the app must not connect as `firm`. Create a restricted role
`firm_app` (owner `firm` keeps migrations):

```bash
pnpm db:generate --custom --name=app_role   # ONCE: each run adds a journal entry + snapshot
# write drizzle/0001_app_role.sql: guarded CREATE ROLE, GRANT USAGE, GRANT table privileges,
# ALTER DEFAULT PRIVILEGES for future tables; separate statements with --> statement-breakpoint
pnpm db:migrate
psql "$DATABASE_URL" -c "ALTER ROLE firm_app PASSWORD 'firm_app_dev'"   # dev only, out of band
```

Concepts:

- Roles are cluster-wide; `CREATE ROLE` has no `IF NOT EXISTS`, hence the `DO` block.
- The password is not in the migration (it is committed). Production sets it from Secrets
  Manager or Terraform.
- `ALTER DEFAULT PRIVILEGES` covers tables created later; `GRANT ... ON ALL TABLES` only
  the existing ones.
- Env split: the app reads `APP_DATABASE_URL` (`firm_app`); `DATABASE_URL` (owner) is for
  drizzle-kit and test seeding only.
- If drizzle-kit fails with just "Command failed", call `migrate()` from
  `drizzle-orm/postgres-js/migrator` in a script to see the real error (here: a journal
  entry with no SQL file).

## Step 9: matters.created_by

Why: the RLS select policy needs to let a creator read a matter before their
`matter_members` row exists (`INSERT ... RETURNING`).

```bash
# schema.ts: matters.createdBy (uuid, notNull, FK to users) + index matters_created_by_idx
# matters.ts: createMatter inserts { ...input, createdBy: creatorId }
# test fixtures that insert matters directly now pass createdBy
pnpm db:generate --name=matters_created_by   # a real schema change: no --custom
cat drizzle/0002_matters_created_by.sql      # ADD COLUMN NOT NULL, FK, CREATE INDEX
pnpm db:migrate
```

Concepts:

- The creator is a separate, trusted argument (`creatorId`, from the session), spread last,
  so a caller cannot choose it through `input` (mass assignment).
- Adding a `NOT NULL` column only works directly because the tables were empty. On a populated
  table: add nullable, backfill, then add the constraint.
- FK `ON DELETE NO ACTION`: a user who created matters cannot be hard-deleted (audit trail).
- Index the column the policy filters on, or every matter query scans the table.

## Step 10: Row-Level Security policies

```bash
pnpm db:generate --custom --name=rls_policies   # ONCE, see Step 8
# write drizzle/0003_rls_policies.sql (policy table and helper explained in docs/NOTES-day3.md, sections 2-3):
#   app_user_id() helper; ENABLE ROW LEVEL SECURITY on matters, matter_members, documents;
#   policies for select/insert/update; no DELETE policy; REVOKE UPDATE then
#   GRANT UPDATE (title, status, type, opened_at) ON matters
pnpm db:migrate
psql "$DATABASE_URL" -c "select tablename, policyname, cmd from pg_policies order by 1, 2"
```

Test risky SQL before applying it, inside a transaction that rolls back:

```bash
(echo "BEGIN;"; cat check.sql; echo "ROLLBACK;") | psql "$DATABASE_URL"
# inside check.sql, act as the app: SET LOCAL ROLE firm_app;
#   select set_config('app.user_id', '<uuid>', true);
```

Concepts:

- `ENABLE ROW LEVEL SECURITY` = default deny. `USING` filters existing rows; `WITH CHECK`
  validates new ones. No policy for a command (here DELETE) means that command is denied.
- `app_user_id()` uses `NULLIF(…, '')` because a reverted custom setting is `''`, and
  `''::uuid` throws. No user set means NULL means no rows (fail closed).
- Policy recursion: `matter_members`' own policy must not query `matter_members`.
- RLS cannot compare old and new values, so immutable columns are protected with column
  privileges, which are checked before RLS.

## Step 11: per-request identity and tests

```bash
# src/db/with-user.ts: withUser(userId, fn) = transaction + set_config('app.user_id', id, true)
# src/db/matters.ts: every function runs inside withUser
# src/db/test-owner.ts: owner connection for fixtures (reads DATABASE_URL directly)
# tests: matters.queries.test.ts and matters.test.ts seed via the owner;
#        with-user.test.ts and matters.rls.test.ts are new
pnpm format && pnpm typecheck && pnpm lint
pnpm test          # run AFTER db:migrate: the RLS tests fail by design before it
```

Concepts:

- Transaction-scoped setting (`SET LOCAL` semantics): ends at commit/rollback, so a pooled
  connection cannot leak one user's identity to the next request.
- `set_config` takes bind parameters; `SET` does not (injection risk).
- Two connections in tests: owner for fixtures and verification, `firm_app` for the code
  under test. A leftover check as `firm_app` would pass even if the rollback failed.
- Assert the Postgres error code (`42501`) on `err.cause`, not the message text.

## Step 12: authentication (opaque server sessions)

```bash
pnpm add @node-rs/argon2                 # Argon2id hashing (OWASP: 19 MiB, 2 passes, 1 lane)
pnpm db:generate --name=sessions && pnpm db:migrate   # sessions(id = SHA-256 of token, user_id, expires_at)
# src/auth/password.ts  hashPassword / verifyPassword
# src/auth/session.ts   createSession / validateSession (sliding 30-day expiry) / deleteSession
# src/auth/cookie.ts    the only place that knows the cookie name and flags
# src/auth/current-user.ts  getCurrentUser(): cookie -> session -> user | null (cached per request)
# src/auth/login.ts     login(): identical failure for bad email and bad password, 5 failures per 15 min lockout
# src/app/login/        loginAction / logoutAction (Server Actions), login page + form
# src/app/page.tsx      redirect("/login") without a user; else list matters via listMattersForUser(user.id)
# scripts/create-user.ts  operator script (owner connection), password from NEW_USER_PASSWORD
read -s PW && NEW_USER_PASSWORD=$PW node --env-file=.env scripts/create-user.ts \
  alice@firm.test alice "Alice Attorney" attorney
pnpm format && pnpm typecheck && pnpm lint && pnpm test
pnpm dev    # / redirects to /login; sign in; sign out; / redirects again
```

Concepts:

- The cookie carries a random token; the database stores only its SHA-256 hash, so a leaked
  `sessions` table cannot be replayed. Logout deletes the row and takes effect immediately.
- The user id given to `withUser` always comes from `getCurrentUser()`, never from client input.
- `redirect()` throws; code after it does not run, so TypeScript narrows `user` to non-null.
- Server Actions are POST-only with an Origin check; with `SameSite=Lax` that is the CSRF defense.
