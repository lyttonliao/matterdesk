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
