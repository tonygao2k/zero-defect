CREATE TABLE practice_start_samples (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  path TEXT CHECK (path IN ('ready', 'online', 'resume')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed', 'interrupted')),
  elapsed_ms INTEGER CHECK (elapsed_ms BETWEEN 0 AND 86400000)
);
