# firm/ fullstack plan: Firmly interview prep

Source: the "Firmly Interview Prep" artifact, https://claude.ai/artifact/4Vx6eXVvYmFaARZSobWQDt
(9 modules, 00-08). It is separate from the AI course in `README.md` and `docs/COURSE.md`.
`firm/` is the lab for modules 01-03 and 07. Checkbox progress in the artifact lives in the
browser, so the table below is the source of truth for this repo.

Target: on-site assessment on a laptop with nothing installed (likely a small Next.js
build, written questions, or code review), then a team interview.

| Module | Topic                                                                      | Status in `firm/`                                                                                                                                                         |
| ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00     | What to expect, five-session plan                                          | read                                                                                                                                                                      |
| 01     | Next.js 15 / React 19                                                      | done: async `cookies()`, Server Component pages (list with `?status=`, `/matters/[id]`), create-matter Server Action (zod + `useActionState`), route handlers with awaited `params` and 401/404 |
| 02     | PostgreSQL and SQL                                                         | mostly done: schema, indexes, parameterized queries, `withUser` transactions. TODO: the four query drills (LEFT JOIN count, membership `EXISTS`, `DISTINCT ON`, `FILTER`) |
| 03     | Auth and permissions                                                       | mostly done: sessions, Argon2id, cookie flags, RLS, role check on matter insert, scoped queries in the two routes and the detail page. TODO: role rules for notes (paralegal cannot close)  |
| 04     | RAG and permission-aware retrieval                                         | not started (shares Days 4-6 of the AI plan)                                                                                                                              |
| 05     | Self-hosted LLMs, Docker, sandboxing                                       | covered by the AI plan (Days 1-2, 9, 11); talking points only                                                                                                             |
| 06     | Code review drills (A: document route, B: RAG answer, C: client component) | not started                                                                                                                                                               |
| 07     | Mock assessment: Matter Intake (90 min, do twice)                          | next                                                                                                                                                                      |
| 08     | Team interview: stories, design questions, questions to ask                | no code                                                                                                                                                                   |

## Next, in order

1. ~~Create-matter Server Action~~ done.
2. ~~Route handlers `GET /api/matters?status=` and `GET /api/matters/[id]`~~ done.
3. ~~Matter list `?status=` filter and `/matters/[id]` detail page~~ done. Remaining: notes
   (notes table + RLS migration + add-note action on the detail page; paralegals add notes
   but cannot close a matter, so also a close-matter action with a role check).
4. Module 02 query drills.
5. Module 06 drills, then redo module 07 timed (90 min) in StackBlitz or CodeSandbox.
6. Module 04 with the AI plan's Days 4-6, then module 08 stories.

Open gaps from Day 3: no RLS on `clients`/`users`, only `/` is gated, login lockout is
in-memory (`shortcut:` in `src/auth/login.ts`).
