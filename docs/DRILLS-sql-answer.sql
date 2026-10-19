-- Drill 1, part 1
EXPLAIN (ANALYZE, BUFFERS)
SELECT c.id AS client_id, c.full_name, COUNT(m.id) AS matter_count
FROM clients c
LEFT JOIN matters m ON m.client_id = c.id
GROUP BY c.id
ORDER BY matter_count DESC, c.full_name;

-- Drill 1, part 2 (condition in ON, so zero-count clients survive)
EXPLAIN (ANALYZE, BUFFERS)

SELECT c.id AS client_id, c.full_name, COUNT(m.id) AS open_matter_count
FROM clients c
LEFT JOIN matters m ON m.client_id = c.id AND m.status = 'open'
GROUP BY c.id
ORDER BY open_matter_count DESC, c.full_name;

-- Drill 2.1: matters the user created or is a member of
\set uid 'f2d438a6-684e-45f8-ba47-315ef7b09091'
EXPLAIN (ANALYZE, BUFFERS)
SELECT m.id, m.title, m.status
FROM matters m
WHERE m.created_by = :'uid'
   OR EXISTS (
     SELECT 1 FROM matter_members mm
     WHERE mm.matter_id = m.id AND mm.user_id = :'uid'
   );

-- Drill 2.2: matters with no members at all
EXPLAIN (ANALYZE, BUFFERS)
SELECT m.id, m.title, m.status
FROM matters m
WHERE NOT EXISTS (
  SELECT 1 FROM matter_members mm WHERE mm.matter_id = m.id
);

-- Drill 3, DISTINCT ON
EXPLAIN (ANALYZE, BUFFERS)
SELECT DISTINCT ON (n.matter_id)
  n.matter_id, m.title, n.id AS note_id, n.created_at
FROM notes n
JOIN matters m ON m.id = n.matter_id
ORDER BY n.matter_id, n.created_at DESC, n.id DESC;

-- Drill 3, row_number()
EXPLAIN (ANALYZE, BUFFERS)
WITH last_notes AS (
  SELECT n.matter_id, m.title, n.id AS note_id, n.created_at,
         ROW_NUMBER() OVER (
           PARTITION BY n.matter_id ORDER BY n.created_at DESC, n.id DESC
         ) AS rn
  FROM notes n
  JOIN matters m ON m.id = n.matter_id
)
SELECT matter_id, title, note_id, created_at
FROM last_notes
WHERE rn = 1;

-- Drill 4
EXPLAIN (ANALYZE, BUFFERS)
SELECT
  c.id as client_id,
  c.full_name,
  COUNT(m.id) FILTER (WHERE status = 'open') AS open_count,
  COUNT(m.id) FILTER (WHERE status = 'pending') AS pending_count,
  COUNT(m.id) FILTER (WHERE status = 'closed') AS closed_count,
  COUNT(m.id) AS total
FROM clients c
LEFT JOIN matters m ON m.client_id = c.id
GROUP BY c.id
ORDER BY total DESC, c.full_name;

-- =====================================================================
-- NOTES: expected row counts and EXPLAIN (ANALYZE, BUFFERS) readings
-- Seed at the time of writing: 5 clients, 2 matters (both open, both Jane Smith's),
-- 2 matter_members, 2 notes (both on one matter). All plans are seq scans because the
-- tables are tiny and never analyzed (the planner guesses 700 rows for notes).
-- =====================================================================

-- Row counts (all verified by running them)
-- 1a, 1b, 4: 5 rows. One row per client, LEFT JOIN keeps the 4 clients with no matters;
--            only Jane Smith has matters (2, both open), so 1b matches 1a here.
-- 2.1: 2 rows. alice (uid) created and/or belongs to both matters; EXISTS never duplicates.
-- 2.2: 0 rows. Every matter has a matter_members row, so NOT EXISTS finds none.
-- 3:   1 row. Only one matter has notes; the other has none and is omitted.

-- EXPLAIN 2.1 (EXISTS inside an OR)
-- Plan: Seq Scan on matters, Filter: (created_by = uid OR (hashed SubPlan)).
-- Not a semi-join. Postgres only rewrites EXISTS into a semi-join when it is a top-level
-- AND condition; under an OR it stays a subplan, here hashed once (matter_members is read
-- once, filtered by user_id). "never executed" shows that when created_by matches first,
-- the OR short-circuits and the subplan is skipped. To get a semi-join, split the query
-- into two SELECTs combined with UNION.

-- EXPLAIN 3 (row_number version) vs DISTINCT ON
-- Both: Hash Join (notes x matters) -> Sort on (matter_id, created_at DESC, id DESC).
-- DISTINCT ON then needs only a Unique node (keeps the first row of each matter_id).
-- row_number adds a WindowAgg (numbers rows per partition) plus a Subquery Scan with
-- Filter rn = 1. Postgres trims it with "Run Condition: row_number() <= 1", so it stops
-- numbering a partition after the first row. Same cost class; DISTINCT ON is one node
-- simpler. With a big table, notes_matter_id_created_at_idx (matter_id, created_at)
-- could feed the sort in order, as a backward scan for DESC; the extra id DESC may still
-- need an incremental sort.

-- EXPLAIN 4 (FILTER)
-- Plan: Seq Scan on clients + Hash (Seq Scan on matters) -> Hash Left Join -> HashAggregate
-- (Group Key: c.id). matters is scanned once, and the three FILTER counts plus total are
-- all computed inside that one HashAggregate. Three subqueries would scan it three times.
-- The join emits 6 rows (5 clients, one of them twice for its 2 matters) and aggregates
-- to 5.
