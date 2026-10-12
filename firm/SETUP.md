# firm/ setup log

Every command used to build this project, in order, so it can be replicated from scratch.
Run from the repo root (`matterdesk/`) unless a step says otherwise. Each step ends with the
gates (`pnpm typecheck`, `pnpm lint`, `pnpm format:check`) and one commit.

Environment when written: macOS, Node 24.3.0, Docker 29.0.1, Corepack 0.33.0.

## Step 1: pnpm via Corepack (no repo change)

```bash
corepack enable pnpm        # puts a pnpm shim on PATH (/opt/homebrew/bin/pnpm)
corepack install -g pnpm@10 # sets the global default to pnpm 10.x
pnpm -v                     # 10.34.7
```

**Gotcha:** `corepack enable pnpm` alone then running `pnpm -v` failed with
`Cannot find module '.../pnpm/12.11.2/bin/pnpm.cjs'`. pnpm 12 ships `bin/pnpm.mjs`, but
Corepack 0.33.0 still expects `pnpm.cjs`. Pinning pnpm 10 avoids it. Alternative: update
Corepack (`npm i -g corepack@latest`) and use pnpm 12.

## Step 2: Next.js 15 scaffold (commit `e6efc0c`)

```bash
pnpm create next-app@15 firm --ts --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-pnpm --no-turbopack
cd firm
pnpm pkg set packageManager=pnpm@10.34.7 scripts.typecheck="tsc --noEmit"
pnpm typecheck && pnpm lint
```

- `--no-turbopack` keeps webpack for `next dev`.
- The generator did not run `git init` because it detected an enclosing repo.
- `tsconfig.json` already had `"strict": true`; verify with `grep strict tsconfig.json`.
- pnpm prints "Ignored build scripts: unrs-resolver". It is an optional native speedup for
  ESLint's import resolver; safe to ignore, do not run `pnpm approve-builds`.

## Step 3: shadcn/ui and Prettier

```bash
cd firm
pnpm dlx shadcn@latest init -d     # -d = accept defaults
pnpm add -D prettier prettier-plugin-tailwindcss
```

Files created by hand:

`.prettierrc`

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

`.prettierignore`

```
.next
node_modules
pnpm-lock.yaml
```

Scripts and formatting:

```bash
pnpm pkg set scripts.format="prettier --write ." scripts.format:check="prettier --check ."
pnpm format          # rewrite the scaffolded files into Prettier style
pnpm format:check && pnpm typecheck && pnpm lint
```

**What `shadcn init -d` changed:** created `components.json`, `src/lib/utils.ts`,
`src/components/ui/button.tsx`; edited `src/app/globals.css` (theme CSS variables) and
`package.json`.

**Gotcha:** this shadcn CLI version (4.21.4) generates `export { cn } from "cn"` in
`utils.ts`, depending on the `cn` npm package (shadcn-ui's own repo; replacement for
`clsx` + `tailwind-merge`), not the older `clsx`/`tailwind-merge` implementation seen in
most tutorials. Checked with `npm view cn@0.4.0 repository.url maintainers`.
Tutorials may show a different `utils.ts`.

## Step 4: Postgres 16 + pgvector in Docker Compose

Files (written by hand): `compose.yaml`, `.env.example`; `compose-cheat-sheet.yaml` is an
annotated study reference with extra keys and is not loaded by Compose. One line added to
`.gitignore` after `.env*`:

```
!.env.example
```

(Next's template ignores `.env*`, which would also hide the template.)

```bash
cp .env.example .env                       # optional; compose.yaml has the same defaults
docker compose config                      # offline parse; works without a daemon
open -a Docker                             # start Docker Desktop, wait until it is ready
docker compose up -d
docker compose ps                          # expect "Up ... (healthy)", 127.0.0.1:5433->5432
docker compose exec -T db psql -U firm -d firm -At \
  -c "SELECT version();" \
  -c "SELECT name || ' ' || default_version FROM pg_available_extensions WHERE name = 'vector';"
# PostgreSQL 16.15 ..., vector 0.8.7
```

The extension is available but not enabled. The first migration runs
`CREATE EXTENSION IF NOT EXISTS vector`.

**Gotchas on this machine:**

- A local Postgres already listens on 127.0.0.1:5432, so the container publishes on host
  port **5433**. Check yours with `lsof -nP -iTCP:5432 -sTCP:LISTEN`.
- My shell had `DOCKER_HOST` pointing at a stopped Lima VM, which overrides the active
  Docker context. Run Docker commands as `env -u DOCKER_HOST docker compose ...`, or
  `unset DOCKER_HOST` for the session. Skip this if `echo $DOCKER_HOST` is empty for you.
- The `POSTGRES_*` variables only apply on the first start with an empty volume. To change
  them afterwards: `docker compose down -v` (deletes the data), then `up -d`.

## Replication checklist

1. Steps in order, one commit each.
2. After every step: `pnpm typecheck && pnpm lint && pnpm format:check`.
3. Never commit without the gates passing.
