# firm/ fullstack plan: Firmly interview prep

Source: the "Firmly Interview Prep" artifact, https://claude.ai/artifact/4Vx6eXVvYmFaARZSobWQDt
(9 modules, 00-08). It is separate from the AI course in `README.md` and `docs/COURSE.md`.
`firm/` is the lab for modules 01-03 and 07. Checkbox progress in the artifact lives in the
browser, so the table below is the source of truth for this repo.

Target: on-site assessment on a laptop with nothing installed (likely a small Next.js
build, written questions, or code review), then a team interview.

| Module | Topic                                                                      | Status in `firm/`                                                                                                                                                                               |
| ------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00     | What to expect, five-session plan                                          | read                                                                                                                                                                                            |
| 01     | Next.js 15 / React 19                                                      | done: async `cookies()`, Server Component pages (list with `?status=`, `/matters/[id]`), create-matter Server Action (zod + `useActionState`), route handlers with awaited `params` and 401/404 |
| 02     | PostgreSQL and SQL                                                         | mostly done: schema, indexes, parameterized queries, `withUser` transactions. drills done (LEFT JOIN count, membership `EXISTS`, `DISTINCT ON`, `FILTER`; answers in `docs/DRILLS-sql-answer.sql`)                       |
| 03     | Auth and permissions                                                       | mostly done: sessions, Argon2id, cookie flags, RLS, role check on matter insert, scoped queries in the two routes and the detail page. TODO: see Next step 4                                    |
| 04     | RAG and permission-aware retrieval                                         | not started (shares Days 4-6 of the AI plan)                                                                                                                                                    |
| 05     | Self-hosted LLMs, Docker, sandboxing                                       | covered by the AI plan (Days 1-2, 9, 11); talking points only                                                                                                                                   |
| 06     | Code review drills (A: document route, B: RAG answer, C: client component) | not started                                                                                                                                                                                     |
| 07     | Mock assessment: Matter Intake (90 min, do twice)                          | after steps 1-2 of Next                                                                                                                                                                         |
| 08     | Team interview: stories, design questions, questions to ask                | no code                                                                                                                                                                                         |

## Done

Create-matter Server Action, route handlers (`GET /api/matters`, `GET /api/matters/[id]`),
`?status=` filter, `/matters/[id]` detail page, notes (table, RLS, add-note action), and
close-matter (attorney/admin only).

## Next, in order

1. ~~Module 02 query drills~~ done.
2. Module 06 code-review drills (snippets in `docs/DRILLS-review.md`; A: document route, B: RAG answer, C: client component).
   Raw material from our own bugs: missing `EXISTS`, wrong table in an insert, mis-named column.
3. Module 07 mock assessment: Matter Intake, 90 min timed in StackBlitz or CodeSandbox,
   do it twice. Run it after steps 1-2 so the patterns are fresh.
4. Security gaps (module 03):
   - RLS on `clients`/`users` (then make `app_user_is_staff()` `SECURITY DEFINER`).
   - Gate more than `/` (middleware or per-page checks).
   - Replace the in-memory login lockout (`shortcut:` in `src/auth/login.ts`).
5. Smaller gaps in notes and lists: edit/delete for notes (currently append-only),
   pagination, a test for the detail page, an audit trail of who closed a matter.
6. Module 04 (RAG, permission-aware retrieval) with the AI plan's Days 4-6, then module 08 stories.
