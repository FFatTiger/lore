-- Migration 003: Recall analytics performance indexes
-- Adds expression indexes and composite indexes to speed up recall analytics queries.

-- Expression index for query_id extraction (used in GROUP BY and WHERE clauses)
CREATE INDEX IF NOT EXISTS recall_events_query_id_idx
  ON recall_events ((COALESCE(metadata->>'query_id', id::text)), created_at DESC);

-- Expression index for client_type extraction (used in WHERE and GROUP BY)
CREATE INDEX IF NOT EXISTS recall_events_client_type_idx
  ON recall_events ((LOWER(COALESCE(metadata->>'client_type', ''))), created_at DESC);

-- Composite index for time-filtered node aggregation (used in summary/distinct queries)
CREATE INDEX IF NOT EXISTS recall_events_created_node_idx
  ON recall_events (created_at, node_uri);

-- Composite index for time-filtered query grouping
CREATE INDEX IF NOT EXISTS recall_events_created_query_id_idx
  ON recall_events (created_at, (COALESCE(metadata->>'query_id', id::text)));
