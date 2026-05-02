-- Manual backfill for Migration 005: recall query and candidate rollups.
--
-- Run this only against a cloned database first. The automatic migration runner
-- ignores migrations/manual, so this script will not run on server startup.
--
-- Historical rows without a real metadata query_id are intentionally skipped.
-- Do not replace missing query_id with recall_events.id; that would pollute the
-- long-lived query/candidate rollup tables with event-level pseudo queries.

BEGIN;

UPDATE recall_events
SET
  query_id = NULLIF(metadata->>'query_id', ''),
  session_id = NULLIF(metadata->>'session_id', ''),
  client_type = NULLIF(metadata->>'client_type', ''),
  ranked_position = CASE
    WHEN (metadata->>'ranked_position') ~ '^[0-9]+$' THEN (metadata->>'ranked_position')::integer
    ELSE ranked_position
  END,
  displayed_position = CASE
    WHEN (metadata->>'displayed_position') ~ '^[0-9]+$' THEN (metadata->>'displayed_position')::integer
    ELSE displayed_position
  END
WHERE NULLIF(metadata->>'query_id', '') IS NOT NULL
  AND query_id IS NULL;

WITH latest_query AS (
  SELECT DISTINCT ON (query_id)
    query_id,
    query_text,
    session_id,
    client_type
  FROM recall_events
  WHERE NULLIF(query_id, '') IS NOT NULL
  ORDER BY query_id, created_at DESC, id DESC
),
query_counts AS (
  SELECT
    query_id,
    COUNT(DISTINCT node_uri)::integer AS merged_count,
    COUNT(DISTINCT node_uri) FILTER (WHERE selected = TRUE)::integer AS shown_count,
    COUNT(DISTINCT node_uri) FILTER (WHERE used_in_answer = TRUE)::integer AS used_count,
    MAX(created_at) AS created_at
  FROM recall_events
  WHERE NULLIF(query_id, '') IS NOT NULL
  GROUP BY query_id
)
INSERT INTO recall_queries (
  query_id,
  query_text,
  session_id,
  client_type,
  merged_count,
  shown_count,
  used_count,
  created_at
)
SELECT
  c.query_id,
  l.query_text,
  l.session_id,
  l.client_type,
  c.merged_count,
  c.shown_count,
  c.used_count,
  c.created_at
FROM query_counts c
JOIN latest_query l ON l.query_id = c.query_id
ON CONFLICT (query_id) DO UPDATE SET
  query_text = EXCLUDED.query_text,
  session_id = EXCLUDED.session_id,
  client_type = EXCLUDED.client_type,
  merged_count = EXCLUDED.merged_count,
  shown_count = EXCLUDED.shown_count,
  used_count = EXCLUDED.used_count,
  created_at = EXCLUDED.created_at;

INSERT INTO recall_query_candidates (
  query_id,
  node_uri,
  client_type,
  final_rank_score,
  selected,
  used_in_answer,
  ranked_position,
  displayed_position,
  created_at
)
SELECT
  query_id,
  node_uri,
  (ARRAY_AGG(client_type ORDER BY created_at DESC, id DESC)
    FILTER (WHERE NULLIF(client_type, '') IS NOT NULL))[1] AS client_type,
  MAX(final_rank_score) AS final_rank_score,
  BOOL_OR(selected) AS selected,
  BOOL_OR(used_in_answer) AS used_in_answer,
  MIN(ranked_position) FILTER (WHERE ranked_position IS NOT NULL) AS ranked_position,
  MIN(displayed_position) FILTER (WHERE displayed_position IS NOT NULL) AS displayed_position,
  MAX(created_at) AS created_at
FROM recall_events
WHERE NULLIF(query_id, '') IS NOT NULL
GROUP BY query_id, node_uri
ON CONFLICT (query_id, node_uri) DO UPDATE SET
  client_type = EXCLUDED.client_type,
  final_rank_score = EXCLUDED.final_rank_score,
  selected = EXCLUDED.selected,
  used_in_answer = EXCLUDED.used_in_answer,
  ranked_position = EXCLUDED.ranked_position,
  displayed_position = EXCLUDED.displayed_position,
  created_at = EXCLUDED.created_at;

ANALYZE recall_events;
ANALYZE recall_queries;
ANALYZE recall_query_candidates;

COMMIT;
