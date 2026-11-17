
CREATE TABLE mistakes_new (
  id TEXT PRIMARY KEY,
  image_path TEXT,
  image_hash TEXT,
  analysis_key TEXT,
  question_markdown TEXT NOT NULL,
  student_answer TEXT,
  student_work_markdown TEXT,
  correct_answer TEXT,
  grade INTEGER,
  subject TEXT NOT NULL DEFAULT 'math',
  curriculum_id TEXT,
  knowledge_point_id TEXT,
  analysis_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','unattributed','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (curriculum_id) REFERENCES curricula(id),
  FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points(id)
);

INSERT INTO mistakes_new (
  id, image_path, image_hash, analysis_key, question_markdown, student_answer, student_work_markdown,
  correct_answer, grade, subject, curriculum_id, knowledge_point_id, analysis_json, status, created_at, updated_at
)
SELECT
  id, image_path, image_hash, image_hash, question_markdown, student_answer, student_work_markdown,
  correct_answer, grade, subject, curriculum_id, knowledge_point_id, analysis_json, status, created_at, updated_at
FROM mistakes;

DROP TABLE mistakes;
ALTER TABLE mistakes_new RENAME TO mistakes;

CREATE INDEX idx_mistakes_status ON mistakes(status, created_at);
CREATE INDEX idx_mistakes_analysis_key ON mistakes(analysis_key);
