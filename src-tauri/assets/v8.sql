ALTER TABLE practice_sessions ADD COLUMN is_daily INTEGER NOT NULL DEFAULT 0;
ALTER TABLE practice_sessions ADD COLUMN submitted_local_date TEXT;
CREATE UNIQUE INDEX idx_daily_practice_submission
  ON practice_sessions(submitted_local_date) WHERE is_daily=1;

ALTER TABLE answer_attempts ADD COLUMN local_date TEXT;
ALTER TABLE practice_questions ADD COLUMN revision_hint_local_date TEXT;
ALTER TABLE mistakes ADD COLUMN confirmed_evidence_local_date TEXT;

CREATE TABLE practice_schedule_origin (local_date TEXT NOT NULL);
