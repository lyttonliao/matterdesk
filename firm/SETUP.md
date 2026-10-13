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
