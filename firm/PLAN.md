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
| 01     | Next.js 15 / React 19                                                      | partial: async `cookies()` and a Server Component page done. TODO: Server Action with zod + `useActionState`, route handler with awaited `params` and 401/404             |
| 02     | PostgreSQL and SQL                                                         | mostly done: schema, indexes, parameterized queries, `withUser` transactions. TODO: the four query drills (LEFT JOIN count, membership `EXISTS`, `DISTINCT ON`, `FILTER`) |
| 03     | Auth and permissions                                                       | mostly done: sessions, Argon2id, cookie flags, RLS. TODO: role check on matter insert, IDOR check in every route                                                          |
| 04     | RAG and permission-aware retrieval                                         | not started (shares Days 4-6 of the AI plan)                                                                                                                              |
| 05     | Self-hosted LLMs, Docker, sandboxing                                       | covered by the AI plan (Days 1-2, 9, 11); talking points only                                                                                                             |
| 06     | Code review drills (A: document route, B: RAG answer, C: client component) | not started                                                                                                                                                               |
| 07     | Mock assessment: Matter Intake (90 min, do twice)                          | next                                                                                                                                                                      |
| 08     | Team interview: stories, design questions, questions to ask                | no code                                                                                                                                                                   |

## Next, in order

1. Create-matter Server Action: zod validation, `getCurrentUser()`, role check
   (`client` cannot create), `createMatter(input, user.id)`, form with `useActionState`, test.
   Covers module 01, 03 and the permission rule of 07.
2. Route handler `GET /api/matters?status=` and `GET /api/matters/[id]` (401, 404, scoped query).
3. Matter list with `?status=` filter, detail page with notes (notes table + add-note action;
   paralegals add notes but cannot close a matter).
4. Module 02 query drills.
5. Module 06 drills, then redo module 07 timed (90 min) in StackBlitz or CodeSandbox.
6. Module 04 with the AI plan's Days 4-6, then module 08 stories.

Open gaps from Day 3: no RLS on `clients`/`users`, only `/` is gated, login lockout is
in-memory (`shortcut:` in `src/auth/login.ts`).
