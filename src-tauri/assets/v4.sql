
CREATE TABLE papers (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  analysis_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','done','failed')),
  error_message TEXT,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  grade INTEGER,
  semester INTEGER,
  curriculum_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (curriculum_id) REFERENCES curricula(id)
);
CREATE INDEX idx_papers_key ON papers(analysis_key);

CREATE TABLE paper_pages (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  image_path TEXT NOT NULL,
  image_hash TEXT NOT NULL,
  UNIQUE (paper_id, position),
  FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
);

CREATE TABLE mistake_pages (
  mistake_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mistake_id, page_id),
  FOREIGN KEY (mistake_id) REFERENCES mistakes(id) ON DELETE CASCADE,
  FOREIGN KEY (page_id) REFERENCES paper_pages(id) ON DELETE CASCADE
);

ALTER TABLE mistakes ADD COLUMN paper_id TEXT REFERENCES papers(id);
ALTER TABLE mistakes ADD COLUMN semester INTEGER;
ALTER TABLE mistakes ADD COLUMN incomplete INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_mistakes_paper ON mistakes(paper_id);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

ALTER TABLE answer_attempts ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0;
ALTER TABLE practice_questions ADD COLUMN options_json TEXT;

CREATE TABLE practice_sessions_new (
  id TEXT PRIMARY KEY,
  practice_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  completed_at TEXT
);
INSERT INTO practice_sessions_new SELECT id, practice_date, status, created_at, completed_at FROM practice_sessions;
DROP TABLE practice_sessions;
ALTER TABLE practice_sessions_new RENAME TO practice_sessions;
