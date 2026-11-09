/** 迁移 1:全部基础表,与设计文档第 7 节一致。schema_migrations 由迁移执行器自己创建。 */
export const SCHEMA_V1 = `
CREATE TABLE root_causes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- 教材编排:某学段下的某个版本,如"人教版小学数学"。加初中/高中/其他版本只需新增一行。
CREATE TABLE curricula (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL CHECK (stage IN ('primary','junior','senior')),
  subject TEXT NOT NULL DEFAULT 'math',
  edition TEXT NOT NULL,
  label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

-- 知识点是与教材版本无关的"概念"。掌握度挂在概念上,换教材版本不会丢失。
-- stage = 'any' 表示各学段通用(如 other)。
CREATE TABLE knowledge_points (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('primary','junior','senior','any')),
  subject TEXT NOT NULL DEFAULT 'math',
  active INTEGER NOT NULL DEFAULT 1
);

-- 概念在某教材中的位置。grade 用全国统一年级编号:1-6 小学,7-9 初中,10-12 高中。
CREATE TABLE curriculum_knowledge_points (
  curriculum_id TEXT NOT NULL,
  knowledge_point_id TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 12),
  semester INTEGER CHECK (semester IS NULL OR semester IN (1, 2)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (curriculum_id, knowledge_point_id),
  FOREIGN KEY (curriculum_id) REFERENCES curricula(id),
  FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points(id)
);

CREATE TABLE mistakes (
  id TEXT PRIMARY KEY,
  image_path TEXT,
  image_hash TEXT UNIQUE,
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

CREATE TABLE mistake_root_causes (
  mistake_id TEXT NOT NULL,
  root_cause_id TEXT NOT NULL,
  confidence REAL,
  evidence TEXT,
  confirmed INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mistake_id, root_cause_id),
  FOREIGN KEY (mistake_id) REFERENCES mistakes(id),
  FOREIGN KEY (root_cause_id) REFERENCES root_causes(id)
);

CREATE TABLE mastery (
  root_cause_id TEXT NOT NULL,
  knowledge_point_id TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 1.0,
  consecutive_correct INTEGER NOT NULL DEFAULT 0,
  review_level INTEGER NOT NULL DEFAULT 0,
  total_attempts INTEGER NOT NULL DEFAULT 0,
  correct_attempts INTEGER NOT NULL DEFAULT 0,
  last_practiced_at TEXT,
  last_wrong_at TEXT,
  next_review_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','review')),
  PRIMARY KEY (root_cause_id, knowledge_point_id),
  FOREIGN KEY (root_cause_id) REFERENCES root_causes(id),
  FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points(id)
);

CREATE TABLE practice_sessions (
  id TEXT PRIMARY KEY,
  practice_date TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE practice_questions (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  position INTEGER,
  root_cause_id TEXT NOT NULL,
  knowledge_point_id TEXT NOT NULL,
  source_mistake_id TEXT,
  question_markdown TEXT NOT NULL,
  answer_type TEXT NOT NULL,
  correct_answer TEXT NOT NULL,
  answer_unit TEXT,
  solution_markdown TEXT,
  difficulty INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pool'
    CHECK (status IN ('pool','assigned','answered','discarded')),
  verify_json TEXT,
  generation_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES practice_sessions(id),
  FOREIGN KEY (root_cause_id) REFERENCES root_causes(id),
  FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points(id),
  FOREIGN KEY (source_mistake_id) REFERENCES mistakes(id)
);

CREATE TABLE answer_attempts (
  id TEXT PRIMARY KEY,
  practice_question_id TEXT NOT NULL,
  root_cause_id TEXT NOT NULL,
  knowledge_point_id TEXT NOT NULL,
  submitted_answer TEXT NOT NULL,
  normalized_answer TEXT,
  is_correct INTEGER NOT NULL,
  used_hint INTEGER NOT NULL DEFAULT 0,
  answer_time_ms INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (practice_question_id) REFERENCES practice_questions(id),
  FOREIGN KEY (root_cause_id) REFERENCES root_causes(id),
  FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points(id)
);

CREATE INDEX idx_attempts_question ON answer_attempts(practice_question_id);
CREATE INDEX idx_attempts_cause ON answer_attempts(root_cause_id, knowledge_point_id, created_at);
CREATE INDEX idx_questions_pool ON practice_questions(root_cause_id, knowledge_point_id, status);
CREATE INDEX idx_mistakes_status ON mistakes(status, created_at);

-- input_json 不保存图片 base64,只保存图片哈希和提示词参数
CREATE TABLE ai_runs (
  id TEXT PRIMARY KEY,
  run_type TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL
);
`;
