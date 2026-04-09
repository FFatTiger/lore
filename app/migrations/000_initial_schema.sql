-- Migration 000: Initial schema
-- Creates all tables, indexes, and extensions for a fresh Lore database.
-- Uses IF NOT EXISTS throughout so it is safe to run on existing databases
-- that predate the migration system.

-- =========================================================================
-- Extensions
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- Chinese FTS: try pg_jieba first, fall back to zhparser, skip if neither available.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_jieba;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS zhparser;
    BEGIN
      CREATE TEXT SEARCH CONFIGURATION zhparser (PARSER = zhparser);
      ALTER TEXT SEARCH CONFIGURATION zhparser ADD MAPPING FOR n,v,a,i,e,l,t WITH simple;
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Neither pg_jieba nor zhparser available — using simple tokenizer';
  END;
END $$;

-- =========================================================================
-- Core tables
-- =========================================================================

CREATE TABLE IF NOT EXISTS nodes (
  uuid       TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memories (
  id          BIGSERIAL PRIMARY KEY,
  node_uuid   TEXT NOT NULL,
  content     TEXT,
  deprecated  BOOLEAN NOT NULL DEFAULT FALSE,
  migrated_to TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS memories_node_uuid_idx ON memories(node_uuid);

CREATE TABLE IF NOT EXISTS edges (
  id          BIGSERIAL PRIMARY KEY,
  parent_uuid TEXT NOT NULL,
  child_uuid  TEXT NOT NULL,
  priority    INTEGER NOT NULL DEFAULT 0,
  disclosure  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS edges_parent_uuid_idx ON edges(parent_uuid);
CREATE INDEX IF NOT EXISTS edges_child_uuid_idx ON edges(child_uuid);

CREATE TABLE IF NOT EXISTS paths (
  domain     TEXT NOT NULL,
  path       TEXT NOT NULL,
  edge_id    INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (domain, path)
);
CREATE INDEX IF NOT EXISTS paths_edge_id_idx ON paths(edge_id);

CREATE TABLE IF NOT EXISTS glossary_keywords (
  id         BIGSERIAL PRIMARY KEY,
  keyword    TEXT NOT NULL,
  node_uuid  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (keyword, node_uuid)
);
CREATE INDEX IF NOT EXISTS glossary_keywords_node_uuid_idx ON glossary_keywords(node_uuid);

CREATE TABLE IF NOT EXISTS session_read_nodes (
  session_id    TEXT NOT NULL,
  uri           TEXT NOT NULL,
  node_uuid     TEXT NOT NULL,
  session_key   TEXT,
  source        TEXT NOT NULL DEFAULT 'tool:get_node',
  read_count    INTEGER NOT NULL DEFAULT 1,
  first_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, uri)
);

-- =========================================================================
-- Operational tables
-- =========================================================================

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memory_events (
  id              BIGSERIAL PRIMARY KEY,
  event_type      TEXT NOT NULL,
  node_uri        TEXT NOT NULL,
  node_uuid       TEXT,
  domain          TEXT NOT NULL DEFAULT 'core',
  path            TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT 'unknown',
  session_id      TEXT,
  before_snapshot JSONB,
  after_snapshot  JSONB,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS memory_events_created_idx    ON memory_events(created_at DESC);
CREATE INDEX IF NOT EXISTS memory_events_node_uri_idx   ON memory_events(node_uri, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_events_node_uuid_idx  ON memory_events(node_uuid, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_events_type_idx       ON memory_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_events_source_idx     ON memory_events(source, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_events_details_gin_idx ON memory_events USING GIN (details);

CREATE TABLE IF NOT EXISTS dream_diary (
  id           BIGSERIAL PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms  INTEGER,
  status       TEXT NOT NULL DEFAULT 'running',
  summary      JSONB NOT NULL DEFAULT '{}'::jsonb,
  narrative    TEXT,
  tool_calls   JSONB NOT NULL DEFAULT '[]'::jsonb,
  details      JSONB NOT NULL DEFAULT '{}'::jsonb,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS dream_diary_started_idx ON dream_diary(started_at DESC);

CREATE TABLE IF NOT EXISTS recall_events (
  id               BIGSERIAL PRIMARY KEY,
  query_text       TEXT NOT NULL,
  node_uri         TEXT NOT NULL,
  retrieval_path   TEXT NOT NULL,
  view_type        TEXT,
  pre_rank_score   REAL,
  final_rank_score REAL,
  selected         BOOLEAN NOT NULL DEFAULT FALSE,
  used_in_answer   BOOLEAN NOT NULL DEFAULT FALSE,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS recall_events_created_idx  ON recall_events(created_at DESC);
CREATE INDEX IF NOT EXISTS recall_events_node_idx     ON recall_events(node_uri, created_at DESC);
CREATE INDEX IF NOT EXISTS recall_events_path_idx     ON recall_events(retrieval_path, view_type, created_at DESC);
CREATE INDEX IF NOT EXISTS recall_events_selected_idx ON recall_events(selected, used_in_answer, created_at DESC);
CREATE INDEX IF NOT EXISTS recall_events_meta_gin_idx ON recall_events USING GIN (metadata);

CREATE TABLE IF NOT EXISTS memory_views (
  id               BIGSERIAL PRIMARY KEY,
  domain           TEXT NOT NULL,
  path             TEXT NOT NULL,
  uri              TEXT NOT NULL,
  node_uuid        TEXT NOT NULL,
  memory_id        BIGINT NOT NULL,
  priority         INTEGER NOT NULL DEFAULT 0,
  disclosure       TEXT,
  view_type        TEXT NOT NULL,
  source           TEXT NOT NULL DEFAULT 'generated',
  status           TEXT NOT NULL DEFAULT 'active',
  weight           REAL NOT NULL DEFAULT 1.0,
  text_content     TEXT NOT NULL,
  fts              tsvector,
  embedding_model  TEXT NOT NULL DEFAULT '',
  embedding_dim    INTEGER NOT NULL DEFAULT 0,
  embedding_vector vector,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_signature TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS memory_views_uri_view_type_idx ON memory_views(domain, path, view_type);
CREATE INDEX IF NOT EXISTS memory_views_model_idx ON memory_views(embedding_model, status, domain, view_type);
CREATE INDEX IF NOT EXISTS memory_views_uri_idx   ON memory_views(uri);
CREATE INDEX IF NOT EXISTS memory_views_node_idx  ON memory_views(node_uuid, memory_id);
CREATE INDEX IF NOT EXISTS memory_views_fts_idx   ON memory_views USING GIN (fts);

CREATE TABLE IF NOT EXISTS glossary_term_embeddings (
  id               BIGSERIAL PRIMARY KEY,
  domain           TEXT NOT NULL,
  path             TEXT NOT NULL,
  uri              TEXT NOT NULL,
  node_uuid        TEXT NOT NULL,
  memory_id        BIGINT NOT NULL,
  priority         INTEGER NOT NULL DEFAULT 0,
  disclosure       TEXT,
  keyword          TEXT NOT NULL,
  match_text       TEXT NOT NULL,
  source           TEXT NOT NULL DEFAULT 'generated',
  status           TEXT NOT NULL DEFAULT 'active',
  embedding_model  TEXT NOT NULL DEFAULT '',
  embedding_dim    INTEGER NOT NULL DEFAULT 0,
  embedding_vector vector,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_signature TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS glossary_term_embeddings_node_keyword_idx ON glossary_term_embeddings(node_uuid, keyword);
CREATE INDEX IF NOT EXISTS glossary_term_embeddings_model_idx ON glossary_term_embeddings(embedding_model, status, domain);
CREATE INDEX IF NOT EXISTS glossary_term_embeddings_uri_idx   ON glossary_term_embeddings(uri);
CREATE INDEX IF NOT EXISTS glossary_term_embeddings_node_idx  ON glossary_term_embeddings(node_uuid, memory_id);
