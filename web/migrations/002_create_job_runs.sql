CREATE TABLE IF NOT EXISTS job_runs (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
  slot_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'running', 'completed', 'error', 'skipped')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS job_runs_unique_slot
  ON job_runs (job_id, slot_key)
  WHERE slot_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_runs_created_idx
  ON job_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS job_runs_job_created_idx
  ON job_runs (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_runs_status_created_idx
  ON job_runs (status, created_at DESC);
