-- Migration 005: Recall query and candidate rollups
-- Splits query-level and candidate-level analytics from path-level recall_events.

CREATE TABLE IF NOT EXISTS recall_queries (
  query_id     TEXT PRIMARY KEY,
  query_text   TEXT NOT NULL,
  session_id   TEXT,
  client_type  TEXT,
  merged_count INTEGER NOT NULL DEFAULT 0 CHECK (merged_count >= 0),
  shown_count  INTEGER NOT NULL DEFAULT 0 CHECK (shown_count >= 0),
  used_count   INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recall_query_candidates (
  id                 BIGSERIAL PRIMARY KEY,
  query_id           TEXT NOT NULL REFERENCES recall_queries(query_id) ON DELETE CASCADE,
  node_uri           TEXT NOT NULL,
  client_type        TEXT,
  final_rank_score   REAL,
  selected           BOOLEAN NOT NULL DEFAULT FALSE,
  used_in_answer     BOOLEAN NOT NULL DEFAULT FALSE,
  ranked_position    INTEGER,
  displayed_position INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (query_id, node_uri)
);

ALTER TABLE recall_events
  ADD COLUMN IF NOT EXISTS query_id TEXT,
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS client_type TEXT,
  ADD COLUMN IF NOT EXISTS ranked_position INTEGER,
  ADD COLUMN IF NOT EXISTS displayed_position INTEGER;

CREATE INDEX IF NOT EXISTS recall_queries_created_at_idx
  ON recall_queries (created_at DESC);

CREATE INDEX IF NOT EXISTS recall_queries_client_type_created_at_idx
  ON recall_queries (client_type, created_at DESC);

CREATE INDEX IF NOT EXISTS recall_query_candidates_query_id_idx
  ON recall_query_candidates (query_id);

CREATE INDEX IF NOT EXISTS recall_query_candidates_created_at_idx
  ON recall_query_candidates (created_at DESC);

CREATE INDEX IF NOT EXISTS recall_query_candidates_client_type_created_at_idx
  ON recall_query_candidates (client_type, created_at DESC);

CREATE INDEX IF NOT EXISTS recall_query_candidates_selected_idx
  ON recall_query_candidates (query_id, created_at DESC)
  WHERE selected = TRUE;

CREATE INDEX IF NOT EXISTS recall_query_candidates_used_in_answer_idx
  ON recall_query_candidates (query_id, created_at DESC)
  WHERE used_in_answer = TRUE;

CREATE INDEX IF NOT EXISTS recall_events_query_id_created_at_idx
  ON recall_events (query_id, created_at DESC);

CREATE INDEX IF NOT EXISTS recall_events_query_id_node_uri_idx
  ON recall_events (query_id, node_uri);

CREATE INDEX IF NOT EXISTS recall_events_query_selected_unused_idx
  ON recall_events (query_id)
  WHERE selected = TRUE AND used_in_answer = FALSE;
