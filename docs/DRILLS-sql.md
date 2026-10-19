# Module 02 query drills

Four SQL patterns that come up in a Postgres interview. Each is phrased against our real
schema (`clients`, `matters`, `matter_members`, `users`, `notes`). Write your answer in
`docs/DRILLS-sql-answers.sql`, run it, and I review it line by line.

## How to run

```
cd firm
docker compose exec -T db psql -U firm -d firm -f - < ../docs/DRILLS-sql-answers.sql
```

- `docker compose exec -T db`: run a command inside the running `db` container; `-T` turns off the pseudo-terminal so stdin redirection (`<`) works.
- `psql -U firm -d firm`: connect as the owner role `firm` to database `firm`. The owner bypasses RLS (row-level security), which is what you want for these drills: they test SQL e, not permissions.
- `-f -` reads the script from stdin.

Use `EXPLAIN (ANALYZE, BUFFERS)` in front of any drill to see the plan. With only a handful of
seed rows Postgres will pick a sequential scan; that is normal, the point is reading the plan.

## Drill 1: LEFT JOIN with a count

**Task:** every client with the number of matters they have, including clients with zero.
Columns: `client_id`, `full_name`, `matter_count`. Order by `matter_count` desc, then name.

**Why it matters:** an `INNER JOIN` silently drops clients with no matters. The classic bug is
`count(*)`, which counts the NULL-extended row as 1, so a client with no matters reports 1.
Count a column from the right-hand table (`count(m.id)`), which ignores NULLs.

**Edge cases:** a client with zero matters must appear with 0. A condition on `m` (for
example "only open matters") belongs in the `ON` clause, not `WHERE`, or the LEFT JOIN
collapses back into an inner join.

Extension: same query, but count only `open` matters per client, still keeping zero-count clients.

## Drill 2: membership with EXISTS

**Task:** given a user id, list matters that user can reach: they are in `matter_members`
for it, or they created it. Columns: `id`, `title`, `status`. Write it with `EXISTS`
(correlated subquery) and no `JOIN` on `matter_members`.

**Why it matters:** this is the same predicate our RLS select policy encodes. A `JOIN` on a
membership table can multiply rows when the relationship is many-to-many; `EXISTS` is a
yes/no test per matter, so it never duplicates. It also stops at the first match.

**Edge cases:** a user who is both creator and member must appear once. Parameterize the
user id (`:uid` in psql via `-v uid=...`, never string-pasted).

Extension: the inverse, matters with no member rows at all, using `NOT EXISTS`. Say why
`NOT IN (subquery)` is dangerous when the subquery can return NULL.

## Drill 3: DISTINCT ON, latest row per group

**Task:** for each matter, its most recent note. Columns: `matter_id`, `title`, `note_id`,
`created_at`. Matters with no notes may be omitted.

**Why it matters:** `DISTINCT ON (matter_id)` is a Postgres-only way to keep the first row of
each group. "First" is decided by `ORDER BY`, and the `DISTINCT ON` expression must be the
leftmost `ORDER BY` key, so the order is `matter_id, created_at DESC`. Forgetting the
`ORDER BY` gives an arbitrary row, with no error.

The portable alternative is `row_number() OVER (PARTITION BY matter_id ORDER BY created_at DESC)`
filtered to `= 1` in an outer query. Write both and say which index would serve each
(`notes(matter_id, created_at DESC)`).

**Edge case:** two notes with the same `created_at` for one matter. Add a tiebreaker (`id`)
so the result is deterministic.

## Drill 4: FILTER aggregates

**Task:** one row per client: `open_count`, `pending_count`, `closed_count`, `total`, in a
single pass over `matters` (no three subqueries, no `UNION`).

**Why it matters:** `count(*) FILTER (WHERE status = 'open')` is standard SQL for conditional
aggregation, the readable replacement for `sum(CASE WHEN status = 'open' THEN 1 ELSE 0 END)`.
One scan, one `GROUP BY`.

**Edge cases:** clients with no matters (combine with Drill 1's join), and `count` returning 0
versus `sum` returning NULL on an empty set.

## Done when

All four (plus extensions) run clean, and for each you can say in one sentence what row
count you expect from the seed data and why. Then tick Next step 1 in `firm/PLAN.md`.
